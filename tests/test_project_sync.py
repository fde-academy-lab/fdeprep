"""The sync from docs/project/backlog.yaml to GitHub issues and the Project.

GitHub is replaced by an in-memory fake with the same surface as the real
client, so the tests can say what a sync does to a repository without a
token: which issues exist, what they say, which are closed, how they nest,
and what the board shows. The HTTP layer is tested on its own against a fake
opener, because rate limits and a leaked token are failures that only show on
the wire.
"""

from __future__ import annotations

import io
import json
import urllib.error

import pytest

from tools.backlog import parse_backlog
from tools.project_sync import (
    Field, GitHubClient, Issue, Item, MissingToken, Project, SyncError, Syncer, choose_project,
    marker_of,
)

TINY = {
    "version": 1,
    "as_of": "2026-09-30",
    "project": {"owner": "acme", "owner_type": "organization", "repository": "prep",
                "number": 7, "status": {"field": "Status", "done": "Done",
                                        "in_progress": "In Progress", "todo": "Todo"}},
    "sprints": {"field": "Sprint", "start": "2026-09-13", "days": 7, "count": 6},
    "areas": [
        {"name": "Runner and sandbox", "label": "area: runner", "color": "1f6feb"},
        {"name": "Web application", "label": "area: web", "color": "8250df"},
    ],
    "stages": [
        {"id": "S1", "name": "Core grading platform", "kind": "history",
         "start": "2026-09-13", "finish": "2026-09-14", "area": "Runner and sandbox",
         "priority": "P0", "summary": "The runner and the pipeline.", "why": "Grading exists.",
         "estimate": {"optimistic": 5, "likely": 8, "pessimistic": 14},
         "stories": [
             {"id": "S1.1", "title": "The runner", "type": "Feature", "status": "done",
              "points": 13, "area": "Runner and sandbox", "pr": 1, "finish": "2026-09-14",
              "summary": "Runs learner code against a scripted model."},
             {"id": "S1.2", "title": "Close the private attribute read", "type": "Bug",
              "status": "done", "points": 3, "area": "Runner and sandbox", "pr": 2,
              "finish": "2026-09-14", "found_by": "Reading",
              "summary": "Learner code could read the scripted model."},
         ]},
        {"id": "S2", "name": "Problem pages", "kind": "roadmap", "horizon": "next",
         "start": "2026-10-01", "finish": "2026-10-03", "area": "Web application",
         "priority": "P1", "summary": "Clearer problem pages.", "why": "Learners read less.",
         "estimate": {"optimistic": 3, "likely": 5, "pessimistic": 9},
         "rice": {"reach": 30, "impact": 2, "confidence": 0.8},
         "stories": [
             {"id": "S2.1", "title": "Highlight identifiers", "type": "Feature", "status": "todo",
              "points": 5, "area": "Web application", "finish": "2026-10-02",
              "summary": "Names in code render as code.",
              "acceptance": ["delete_account renders as inline code in the scenario card."]},
         ]},
    ],
}


class FakeApi:
    """GitHub in memory. Every write is recorded, so a test can count them."""

    def __init__(self, project_fields=None, issues=None, merged=(1, 2)):
        self.writes: list[tuple] = []
        self.merged = set(merged)
        self._labels: set[str] = set()
        self._issues: dict[int, Issue] = {i.number: i for i in (issues or [])}
        self._next = max(self._issues, default=0) + 1
        status = Field("F_status", "Status", "SINGLE_SELECT",
                       {"Todo": "o_todo", "In Progress": "o_prog", "Done": "o_done"})
        fields = {"Status": status}
        fields.update(project_fields or {})
        self._project = Project("P_1", 7, "Delivery", fields, {})
        self._field_seq = 0

    # reads
    def labels(self):
        return set(self._labels)

    def issues(self):
        return list(self._issues.values())

    def merged_pulls(self):
        return set(self.merged)

    def project(self):
        return self._project

    # writes
    def create_label(self, name, color, description):
        self.writes.append(("create_label", name))
        self._labels.add(name)

    def create_issue(self, title, body, labels, type, parent_database_id):
        number = self._next
        self._next += 1
        parent = next((i.number for i in self._issues.values()
                       if i.database_id == parent_database_id), None)
        issue = Issue(number, 1000 + number, f"I_{number}", title, body, "open", None,
                      sorted(labels), type, parent)
        self._issues[number] = issue
        self.writes.append(("create_issue", title))
        return issue

    def update_issue(self, number, **changes):
        issue = self._issues[number]
        for key, value in changes.items():
            setattr(issue, key, sorted(value) if key == "labels" else value)
        self.writes.append(("update_issue", number, tuple(sorted(changes))))
        return issue

    def set_parent(self, parent_number, child_database_id):
        child = next(i for i in self._issues.values() if i.database_id == child_database_id)
        child.parent_number = parent_number
        self.writes.append(("set_parent", parent_number, child.number))

    def create_field(self, name, data_type, options=None, iterations=None):
        self._field_seq += 1
        choices = {o["name"]: f"o_{name}_{o['name']}" for o in (options or [])}
        choices.update({it["title"]: f"it_{it['title']}" for it in (iterations or [])})
        field = Field(f"F_{self._field_seq}", name, data_type, choices)
        self._project.fields[name] = field
        self.writes.append(("create_field", name))
        return field

    def add_field_options(self, field, options):
        for option in options:
            field.options[option["name"]] = f"o_{field.name}_{option['name']}"
        self.writes.append(("add_field_options", field.name, tuple(o["name"] for o in options)))
        return field

    def add_item(self, content_node_id):
        item = Item(f"PVTI_{content_node_id}", content_node_id, {})
        self._project.items[content_node_id] = item
        self.writes.append(("add_item", content_node_id))
        return item

    def set_values(self, item, values):
        by_id = {f.id: f for f in self._project.fields.values()}
        for field_id, value in values.items():
            field = by_id[field_id]
            if "singleSelectOptionId" in value:
                name = next(n for n, i in field.options.items()
                            if i == value["singleSelectOptionId"])
                item.values[field.name] = name
            elif "iterationId" in value:
                name = next(n for n, i in field.options.items() if i == value["iterationId"])
                item.values[field.name] = name
            else:
                item.values[field.name] = next(iter(value.values()))
        self.writes.append(("set_values", item.id, len(values)))


def tiny():
    return parse_backlog(TINY)


def issue_for(api, backlog_id):
    return next(i for i in api.issues() if marker_of(i.body) == backlog_id)


# ---------------------------------------------------------------- the board

def test_a_first_sync_builds_the_board():
    api = FakeApi()
    Syncer(tiny(), api).run()

    s1, s11, s12 = issue_for(api, "S1"), issue_for(api, "S1.1"), issue_for(api, "S1.2")
    assert s1.type == "Feature" and s11.type == "Feature" and s12.type == "Bug"
    assert s11.parent_number == s1.number and s12.parent_number == s1.number
    assert (s11.state, s11.state_reason) == ("closed", "completed")
    assert issue_for(api, "S2.1").state == "open"
    assert "area: runner" in s11.labels and "history" in s11.labels
    assert "roadmap" in issue_for(api, "S2.1").labels

    project = api.project()
    for name in ("Stage", "Level", "Area", "Priority", "Points", "Start", "Finish",
                 "Pull request", "Found by", "Estimate (person-days)", "Sprint"):
        assert name in project.fields, name
    item = project.items[s12.node_id]
    assert item.values["Status"] == "Done"
    assert item.values["Stage"] == "S1 Core grading platform"
    assert item.values["Level"] == "Story"
    assert item.values["Points"] == 3
    assert item.values["Found by"] == "Reading"
    assert item.values["Pull request"] == "#2"
    assert item.values["Finish"] == "2026-09-14"
    assert item.values["Sprint"] == "Sprint 1"
    epic = project.items[s1.node_id]
    assert epic.values["Level"] == "Epic"
    assert epic.values["Points"] == 16
    assert epic.values["Estimate (person-days)"] == pytest.approx(8.5)


def test_epics_exist_before_their_stories_so_nesting_needs_no_second_pass():
    api = FakeApi()
    Syncer(tiny(), api).run()
    created = [w[1] for w in api.writes if w[0] == "create_issue"]
    assert created.index("S1 · Core grading platform") < created.index("S1.1 · The runner")
    assert not [w for w in api.writes if w[0] == "set_parent"]


def test_a_second_sync_writes_nothing():
    api = FakeApi()
    Syncer(tiny(), api).run()
    api.writes.clear()
    Syncer(tiny(), api).run()
    assert api.writes == []


def test_a_status_change_moves_the_issue_and_the_card_and_nothing_else():
    api = FakeApi()
    Syncer(tiny(), api).run()
    api.writes.clear()
    changed = json.loads(json.dumps(TINY))
    changed["stages"][1]["stories"][0]["status"] = "in_progress"
    Syncer(parse_backlog(changed), api).run()

    story = issue_for(api, "S2.1")
    assert api.project().items[story.node_id].values["Status"] == "In Progress"
    kinds = sorted({w[0] for w in api.writes})
    assert kinds == ["set_values", "update_issue"], api.writes


def test_an_issue_edited_by_hand_is_put_back():
    api = FakeApi()
    Syncer(tiny(), api).run()
    story = issue_for(api, "S1.1")
    api.update_issue(story.number, title="renamed on the website")
    api.writes.clear()
    Syncer(tiny(), api).run()
    assert issue_for(api, "S1.1").title == "S1.1 · The runner"


def test_an_issue_the_file_does_not_own_is_left_alone():
    stranger = Issue(1, 11, "I_x", "A question from a learner", "No marker here.", "open", None,
                     [], None, None)
    api = FakeApi(issues=[stranger])
    Syncer(tiny(), api).run()
    assert api.issues()[0] is stranger or any(i.title == "A question from a learner"
                                              for i in api.issues())
    assert all(w[1] != 1 for w in api.writes if w[0] == "update_issue")


def test_a_merged_pull_request_no_story_names_is_reported_and_the_board_still_syncs():
    api = FakeApi(merged=(1, 2, 3))
    warnings: list[str] = []
    Syncer(tiny(), api, log=lambda line: None, warn=warnings.append).run()
    assert warnings == ["pull request #3 merged and no story in docs/project/backlog.yaml "
                        "names it"]
    assert issue_for(api, "S1.1").state == "closed"


def test_pull_requests_on_stories_raise_no_warning():
    warnings: list[str] = []
    Syncer(tiny(), FakeApi(merged=(1, 2)), log=lambda line: None, warn=warnings.append).run()
    assert warnings == []


def test_a_dry_run_writes_nothing_and_says_what_it_would_do():
    api = FakeApi()
    lines: list[str] = []
    Syncer(tiny(), api, log=lines.append).run(dry_run=True)
    assert api.writes == []
    assert any("create issue" in line and "S1.1" in line for line in lines), lines


def test_a_board_without_the_status_the_file_names_is_refused_with_the_name():
    api = FakeApi()
    api.project().fields["Status"].options.pop("In Progress")
    with pytest.raises(SyncError, match="In Progress"):
        Syncer(tiny(), api).run()


def test_a_new_stage_adds_its_option_to_the_existing_field():
    api = FakeApi()
    Syncer(tiny(), api).run()
    grown = json.loads(json.dumps(TINY))
    extra = json.loads(json.dumps(grown["stages"][1]))
    extra["id"], extra["name"] = "S3", "Voice interviewer"
    extra["stories"][0]["id"] = "S3.1"
    grown["stages"].append(extra)
    api.writes.clear()
    Syncer(parse_backlog(grown), api).run()
    assert ("add_field_options", "Stage", ("S3 Voice interviewer",)) in api.writes


# ---------------------------------------------------------------- choosing the project

def test_the_one_project_linked_to_the_repository_is_chosen():
    linked = [{"number": 3, "title": "Delivery", "repositories": ["acme/prep"]},
              {"number": 4, "title": "Hiring", "repositories": ["acme/other"]}]
    assert choose_project(linked, "acme/prep", number=None) == 3


def test_two_linked_projects_need_a_number_and_the_error_lists_them():
    linked = [{"number": 3, "title": "Delivery", "repositories": ["acme/prep"]},
              {"number": 5, "title": "Old board", "repositories": ["acme/prep"]}]
    with pytest.raises(SyncError, match="3.*Delivery.*5.*Old board"):
        choose_project(linked, "acme/prep", number=None)
    assert choose_project(linked, "acme/prep", number=5) == 5


# ---------------------------------------------------------------- the wire

class Response(io.BytesIO):
    def __init__(self, payload, status=200, headers=None):
        super().__init__(json.dumps(payload).encode())
        self.status = status
        self.headers = headers or {}


def http_error(code, payload, headers=None):
    return urllib.error.HTTPError("https://api.github.com/x", code, "error", headers or {},
                                  io.BytesIO(json.dumps(payload).encode()))


def test_a_secondary_rate_limit_waits_as_told_and_retries():
    calls, slept = [], []

    def opener(request, timeout):
        calls.append(request.full_url)
        if len(calls) == 1:
            raise http_error(403, {"message": "You have exceeded a secondary rate limit"},
                             {"retry-after": "7"})
        return Response({"ok": True})

    client = GitHubClient("t0ken-value", "acme", "prep", opener=opener, sleep=slept.append,
                          write_interval=0)
    assert client.rest("POST", "/repos/acme/prep/labels", {"name": "x"}) == {"ok": True}
    assert slept == [7] and len(calls) == 2


def test_a_plain_forbidden_is_not_retried_and_the_token_stays_secret():
    token = "ghp_do_not_print_me"

    def opener(request, timeout):
        assert request.get_header("Authorization") == f"Bearer {token}"
        raise http_error(403, {"message": "Resource not accessible by personal access token"})

    client = GitHubClient(token, "acme", "prep", opener=opener, sleep=lambda s: None,
                          write_interval=0)
    with pytest.raises(SyncError) as raised:
        client.rest("GET", "/repos/acme/prep/labels")
    assert "not accessible" in str(raised.value)
    assert token not in str(raised.value) and token not in repr(client)


def test_a_graphql_error_is_raised_with_its_message():
    def opener(request, timeout):
        return Response({"errors": [{"message": "Could not resolve to a ProjectV2"}]})

    client = GitHubClient("t", "acme", "prep", opener=opener, sleep=lambda s: None,
                          write_interval=0)
    with pytest.raises(SyncError, match="Could not resolve"):
        client.graphql("query { viewer { login } }")


def test_a_missing_token_names_the_secret_and_the_guide(monkeypatch):
    monkeypatch.delenv("PROJECT_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    with pytest.raises(MissingToken, match="PROJECT_TOKEN.*board-setup.md"):
        GitHubClient.from_environment("acme", "prep")
