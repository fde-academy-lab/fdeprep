"""Put docs/project/backlog.yaml on GitHub: issues, sub-issues, and the Project board.

    python -m tools.project_sync               sync (needs PROJECT_TOKEN)
    python -m tools.project_sync --dry-run     say what a sync would change, write nothing
    python -m tools.project_sync --check       check the file and the pages, no network
    python -m tools.project_sync --render-docs rewrite the generated sections in docs/project

Every stage becomes a Feature issue and every story an issue of its own type
nested under it. Each issue carries a hidden marker naming its id in the file,
which is how a later sync finds it again, so the file stays the source of
truth: an issue edited by hand is put back, and an issue without a marker is
never touched. Labels a person adds survive, since only the area and
history or roadmap labels belong to the sync.

The board gets its fields from the file: Stage, Level, Area, Priority, Found
by, Risk, Points, Estimate, Start, Finish, Pull request and a weekly Sprint.
GitHub's API cannot create a Project view, so docs/project/board-setup.md
lists the five views to make by hand.

Writes are paced a second apart and every field on a card is set in one
request, because GitHub allows 500 content-creating requests an hour. A
secondary rate limit is waited out as GitHub asks, through its retry-after
header, and anything else that fails stops the sync with the message GitHub
gave. The sync is idempotent, so a run that stops part way is finished by
running it again.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Callable

from tools.backlog import (
    BACKLOG, FOUND_BY, PRIORITIES, RISKS, ROOT, STATUS_WORDS, Backlog, Stage, Story,
    labels_for, load_backlog, marker, owned_labels, stage_body, stage_title, story_body,
    story_title, update_docs, validate,
)

API = "https://api.github.com"
API_VERSION = "2026-03-10"
MARKER = re.compile(r"<!-- backlog:([A-Za-z0-9.]+) -->")
SETUP = "docs/project/board-setup.md"


class SyncError(RuntimeError):
    pass


class MissingToken(SyncError):
    pass


def marker_of(body: str | None) -> str | None:
    match = MARKER.search(body or "")
    return match.group(1) if match else None


@dataclasses.dataclass
class Issue:
    number: int
    database_id: int
    node_id: str
    title: str
    body: str
    state: str
    state_reason: str | None
    labels: list[str]
    type: str | None
    parent_number: int | None


@dataclasses.dataclass
class Field:
    id: str
    name: str
    data_type: str
    #: Option or iteration name to id. Single-select options also keep their
    #: colour and description, which GitHub needs back when options are added.
    options: dict[str, str]
    details: dict[str, dict] = dataclasses.field(default_factory=dict)


@dataclasses.dataclass
class Item:
    id: str
    content_node_id: str
    values: dict[str, object]


@dataclasses.dataclass
class Project:
    id: str
    number: int
    title: str
    fields: dict[str, Field]
    items: dict[str, Item]


# ------------------------------------------------------------------ desired state

LEVEL_OPTIONS = [("Epic", "PURPLE", "A stage of the build."), ("Story", "BLUE", "One piece of work.")]
PRIORITY_COLORS = {"P0": "RED", "P1": "ORANGE", "P2": "YELLOW", "P3": "GRAY"}
FOUND_COLORS = {"Reading": "BLUE", "Measuring": "PURPLE", "Running it": "ORANGE",
                "Testing": "GREEN", "Beta tester": "RED"}
RISK_COLORS = {"High": "RED", "Medium": "YELLOW", "Low": "GREEN"}
AREA_COLORS = ["BLUE", "PURPLE", "PINK", "GREEN", "YELLOW", "ORANGE", "RED", "GRAY", "BLUE",
               "GREEN"]


def field_specs(backlog: Backlog) -> list[dict]:
    """The custom fields the board needs, with every option the file uses."""
    def options(pairs):
        return [{"name": n, "color": c, "description": d} for n, c, d in pairs]
    stage_options = [(s.option, "GREEN" if s.kind == "history" else "BLUE",
                      s.summary[:120]) for s in backlog.stages]
    area_options = [(a.name, AREA_COLORS[i % len(AREA_COLORS)], a.description[:120])
                    for i, a in enumerate(backlog.areas)]
    return [
        {"name": "Stage", "type": "SINGLE_SELECT", "options": options(stage_options)},
        {"name": "Level", "type": "SINGLE_SELECT", "options": options(LEVEL_OPTIONS)},
        {"name": "Area", "type": "SINGLE_SELECT", "options": options(area_options)},
        {"name": "Priority", "type": "SINGLE_SELECT", "options": options(
            [(name, PRIORITY_COLORS[key], "") for key, name in PRIORITIES.items()])},
        {"name": "Found by", "type": "SINGLE_SELECT", "options": options(
            [(name, FOUND_COLORS[name], "How a bug was found.") for name in FOUND_BY])},
        {"name": "Risk", "type": "SINGLE_SELECT", "options": options(
            [(name, RISK_COLORS[name], "") for name in RISKS])},
        {"name": "Points", "type": "NUMBER"},
        {"name": "Estimate (person-days)", "type": "NUMBER"},
        {"name": "Start", "type": "DATE"},
        {"name": "Finish", "type": "DATE"},
        {"name": "Pull request", "type": "TEXT"},
        {"name": backlog.sprints.get("field", "Sprint"), "type": "ITERATION",
         "iterations": [{"title": title, "startDate": start.isoformat(), "duration": days}
                        for title, start, days in backlog.sprint_list()]},
    ]


def status_name(backlog: Backlog, status: str) -> str:
    return backlog.project["status"][status]


def stage_values(backlog: Backlog, stage: Stage) -> dict[str, object]:
    values = {
        backlog.project["status"]["field"]: status_name(backlog, stage.status),
        "Stage": stage.option, "Level": "Epic", "Area": stage.area,
        "Priority": PRIORITIES[stage.priority], "Points": stage.points,
        "Estimate (person-days)": round(stage.expected, 1),
        "Start": stage.start.isoformat(), "Finish": stage.finish.isoformat(),
    }
    if stage.risk:
        values["Risk"] = stage.risk
    sprint = backlog.sprint_for(stage.finish)
    if sprint:
        values[backlog.sprints.get("field", "Sprint")] = sprint
    return values


def story_values(backlog: Backlog, stage: Stage, story: Story) -> dict[str, object]:
    start = story.start or story.finish or stage.start
    values = {
        backlog.project["status"]["field"]: status_name(backlog, story.status),
        "Stage": stage.option, "Level": "Story", "Area": story.area,
        "Priority": PRIORITIES[story.priority or stage.priority], "Points": story.points,
        "Start": start.isoformat(), "Finish": (story.finish or stage.finish).isoformat(),
    }
    if story.pr:
        values["Pull request"] = f"#{story.pr}"
    if story.found_by:
        values["Found by"] = story.found_by
    if story.risk or stage.risk:
        values["Risk"] = story.risk or stage.risk
    sprint = backlog.sprint_for(story.finish or stage.finish)
    if sprint:
        values[backlog.sprints.get("field", "Sprint")] = sprint
    return values


@dataclasses.dataclass
class Desired:
    id: str
    title: str
    body: str
    labels: list[str]
    type: str
    closed: bool
    parent: str | None
    values: dict[str, object]


def desired_items(backlog: Backlog) -> list[Desired]:
    """Epics first, each followed by its stories, so a parent always exists first."""
    wanted = []
    for stage in backlog.stages:
        wanted.append(Desired(stage.id, stage_title(stage), stage_body(backlog, stage),
                              labels_for(backlog, stage, stage.area), "Feature",
                              stage.status == "done", None, stage_values(backlog, stage)))
        for story in stage.stories:
            wanted.append(Desired(story.id, story_title(story), story_body(backlog, stage, story),
                                  labels_for(backlog, stage, story.area), story.type,
                                  story.status == "done", stage.id,
                                  story_values(backlog, stage, story)))
    return wanted


# ------------------------------------------------------------------ the sync

class Syncer:
    def __init__(self, backlog: Backlog, api, log: Callable[[str], None] = print,
                 warn: Callable[[str], None] | None = None):
        self.backlog = backlog
        self.api = api
        self.log = log
        self.warn = warn or (lambda message: log(f"warning: {message}"))

    def run(self, dry_run: bool = False) -> None:
        errors = validate(self.backlog)
        if errors:
            raise SyncError("docs/project/backlog.yaml breaks its own rules:\n  "
                            + "\n  ".join(errors))
        api = DryRun(self.api, self.log) if dry_run else self.api
        project = api.project()
        fields = self._fields(api, project)
        self._labels(api)
        issues = self._issues(api)
        self._cards(api, project, fields, issues)
        self._unrecorded(api)
        self.log("dry run finished; nothing was written" if dry_run else "sync finished")

    def _unrecorded(self, api) -> list[int]:
        """Merged pull requests that no story names. A warning, so the board still syncs."""
        named = {story.pr for _, story in self.backlog.stories() if story.pr}
        missing = sorted(api.merged_pulls() - named)
        for number in missing:
            self.warn(f"pull request #{number} merged and no story in "
                      "docs/project/backlog.yaml names it")
        return missing

    # labels ---------------------------------------------------------------

    def _labels(self, api) -> None:
        wanted = {area.label: (area.color, area.description) for area in self.backlog.areas}
        wanted["history"] = ("d0d7de", "Delivered work, recorded from git and GitHub.")
        wanted["roadmap"] = ("54aeff", "Planned work, with estimates.")
        have = api.labels()
        for name, (color, description) in wanted.items():
            if name not in have:
                api.create_label(name, color, description)

    # issues ---------------------------------------------------------------

    def _issues(self, api) -> dict[str, Issue]:
        existing: dict[str, Issue] = {}
        for issue in api.issues():
            item_id = marker_of(issue.body)
            if item_id and item_id not in existing:
                existing[item_id] = issue
        owned = owned_labels(self.backlog)
        result: dict[str, Issue] = {}
        for want in desired_items(self.backlog):
            parent = result.get(want.parent) if want.parent else None
            issue = existing.get(want.id)
            if issue is None:
                issue = api.create_issue(want.title, want.body, want.labels, want.type,
                                         parent.database_id if parent else None)
                if parent:
                    issue.parent_number = parent.number
                if want.closed:
                    issue = api.update_issue(issue.number, state="closed",
                                             state_reason="completed")
            else:
                changes: dict[str, object] = {}
                if issue.title != want.title:
                    changes["title"] = want.title
                if issue.body != want.body:
                    changes["body"] = want.body
                labels = sorted((set(issue.labels) - owned) | set(want.labels))
                if sorted(issue.labels) != labels:
                    changes["labels"] = labels
                if issue.type != want.type:
                    changes["type"] = want.type
                if want.closed and (issue.state != "closed" or issue.state_reason != "completed"):
                    changes["state"], changes["state_reason"] = "closed", "completed"
                if not want.closed and issue.state != "open":
                    changes["state"], changes["state_reason"] = "open", "reopened"
                if changes:
                    issue = api.update_issue(issue.number, **changes)
                if parent and issue.parent_number != parent.number:
                    api.set_parent(parent.number, issue.database_id)
                    issue.parent_number = parent.number
            result[want.id] = issue
        return result

    # the board ------------------------------------------------------------

    def _fields(self, api, project: Project) -> dict[str, Field]:
        status_field = self.backlog.project["status"]["field"]
        status = project.fields.get(status_field)
        if status is None:
            raise SyncError(f"The Project has no {status_field!r} field.")
        needed = [self.backlog.project["status"][k] for k in ("done", "in_progress", "todo")]
        missing = [name for name in needed if name not in status.options]
        if missing:
            raise SyncError(f"The Project's {status_field} field has no option named "
                            f"{', '.join(repr(m) for m in missing)}. Rename an option on the "
                            "board, or change project.status in docs/project/backlog.yaml.")
        for spec in field_specs(self.backlog):
            field = project.fields.get(spec["name"])
            if field is None:
                field = api.create_field(spec["name"], spec["type"], options=spec.get("options"),
                                         iterations=spec.get("iterations"))
                project.fields[spec["name"]] = field
                continue
            if field.data_type != spec["type"]:
                raise SyncError(f"The Project already has a field named {spec['name']!r} of "
                                f"type {field.data_type}, and the sync needs {spec['type']}. "
                                "Rename or delete it on the board.")
            if spec["type"] == "SINGLE_SELECT":
                new = [o for o in spec["options"] if o["name"] not in field.options]
                if new:
                    project.fields[spec["name"]] = api.add_field_options(field, new)
            if spec["type"] == "ITERATION":
                absent = [it["title"] for it in spec["iterations"]
                          if it["title"] not in field.options]
                if absent:
                    self.log(f"note: the {field.name} field lacks {', '.join(absent)}; add them "
                             "on the board. Cards in those sprints keep no sprint until then.")
        return project.fields

    def _cards(self, api, project: Project, fields: dict[str, Field],
               issues: dict[str, Issue]) -> None:
        wanted = {w.id: w for w in desired_items(self.backlog)}
        for item_id, issue in issues.items():
            item = project.items.get(issue.node_id)
            if item is None:
                item = api.add_item(issue.node_id)
                project.items[issue.node_id] = item
            changes: dict[str, dict] = {}
            for name, value in wanted[item_id].values.items():
                field = fields[name]
                encoded = _encode(field, value)
                if encoded is None:
                    continue
                if not _same(item.values.get(name), value):
                    changes[field.id] = encoded
            if changes:
                api.set_values(item, changes)


def _encode(field: Field, value) -> dict | None:
    if field.data_type == "SINGLE_SELECT":
        option = field.options.get(str(value))
        return {"singleSelectOptionId": option} if option else None
    if field.data_type == "ITERATION":
        iteration = field.options.get(str(value))
        return {"iterationId": iteration} if iteration else None
    if field.data_type == "NUMBER":
        return {"number": float(value)}
    if field.data_type == "DATE":
        return {"date": str(value)}
    return {"text": str(value)}


def _same(current, wanted) -> bool:
    if current is None:
        return False
    if isinstance(wanted, (int, float)) and not isinstance(wanted, bool):
        try:
            return abs(float(current) - float(wanted)) < 1e-9
        except (TypeError, ValueError):
            return False
    return str(current) == str(wanted)


class DryRun:
    """Reads go to GitHub; writes are described and never sent."""

    def __init__(self, api, log):
        self._api = api
        self._log = log
        self._seq = 0

    def labels(self):
        return self._api.labels()

    def issues(self):
        return self._api.issues()

    def merged_pulls(self):
        return self._api.merged_pulls()

    def project(self):
        return self._api.project()

    def _next(self) -> int:
        self._seq += 1
        return -self._seq

    def create_label(self, name, color, description):
        self._log(f"would create label {name!r}")

    def create_issue(self, title, body, labels, type, parent_database_id):
        n = self._next()
        self._log(f"would create issue {title!r} ({type})")
        return Issue(n, n, f"dry{n}", title, body, "open", None, list(labels), type, None)

    def update_issue(self, number, **changes):
        self._log(f"would update issue #{number}: {', '.join(sorted(changes))}")
        return Issue(number, number, f"dry{number}", changes.get("title", ""),
                     changes.get("body", ""), changes.get("state", "open"),
                     changes.get("state_reason"), list(changes.get("labels", [])),
                     changes.get("type"), None)

    def set_parent(self, parent_number, child_database_id):
        self._log(f"would nest issue id {child_database_id} under #{parent_number}")

    def create_field(self, name, data_type, options=None, iterations=None):
        self._log(f"would create field {name!r} ({data_type})")
        names = [o["name"] for o in options or []] + [i["title"] for i in iterations or []]
        return Field(f"dry-{name}", name, data_type, {n: f"dry-{n}" for n in names})

    def add_field_options(self, field, options):
        self._log(f"would add {', '.join(o['name'] for o in options)} to {field.name!r}")
        grown = dict(field.options)
        grown.update({o["name"]: f"dry-{o['name']}" for o in options})
        return Field(field.id, field.name, field.data_type, grown, field.details)

    def add_item(self, content_node_id):
        self._log(f"would add {content_node_id} to the board")
        return Item(f"dry-item-{content_node_id}", content_node_id, {})

    def set_values(self, item, values):
        self._log(f"would set {len(values)} fields on {item.id}")


# ------------------------------------------------------------------ GitHub

def choose_project(linked: list[dict], repository: str, number: int | None) -> int:
    """The Project to sync into: the one named, or the only one linked to the repository."""
    if number is not None:
        return number
    mine = [p for p in linked if repository.lower() in (r.lower() for r in p["repositories"])]
    if len(mine) == 1:
        return mine[0]["number"]
    if not mine:
        raise SyncError(f"No Project is linked to {repository}. Link one from the repository's "
                        "Projects tab, or set project.number in docs/project/backlog.yaml.")
    listing = "; ".join(f"{p['number']} {p['title']}" for p in mine)
    raise SyncError(f"Several Projects are linked to {repository} ({listing}). Set "
                    "project.number in docs/project/backlog.yaml to the one to sync.")


class GitHubClient:
    """The REST and GraphQL calls the sync makes, paced, retried and redacted."""

    def __init__(self, token: str, owner: str, repo: str, *, opener=None,
                 sleep: Callable[[float], None] = time.sleep, write_interval: float = 1.0,
                 project_owner: str | None = None, project_owner_type: str = "organization",
                 project_number: int | None = None, log: Callable[[str], None] = print):
        self._token = token
        self.owner = owner
        self.repo = repo
        self._opener = opener or urllib.request.urlopen
        self._sleep = sleep
        self._interval = write_interval
        self._last_write = 0.0
        self.project_owner = project_owner or owner
        self.project_owner_type = project_owner_type
        self.project_number = project_number
        self._log = log
        self._project: Project | None = None

    def __repr__(self) -> str:
        return f"GitHubClient(owner={self.owner!r}, repo={self.repo!r})"

    @classmethod
    def from_environment(cls, owner: str, repo: str, **kwargs) -> "GitHubClient":
        token = os.environ.get("PROJECT_TOKEN") or os.environ.get("GH_TOKEN")
        if not token:
            raise MissingToken(f"PROJECT_TOKEN is not set. {SETUP} says how to make the token "
                               "and add it as a repository secret.")
        return cls(token, owner, repo, **kwargs)

    # transport ------------------------------------------------------------

    def _send(self, method: str, url: str, payload: dict | None, write: bool):
        body = json.dumps(payload).encode() if payload is not None else None
        headers = {"Authorization": f"Bearer {self._token}",
                   "Accept": "application/vnd.github+json",
                   "X-GitHub-Api-Version": API_VERSION,
                   "User-Agent": "fdeprep-project-sync"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        where = url.replace(API, "")
        for attempt in range(6):
            if write and self._interval:
                wait = self._last_write + self._interval - time.monotonic()
                if wait > 0:
                    self._sleep(wait)
            request = urllib.request.Request(url, data=body, method=method, headers=headers)
            try:
                with self._opener(request, timeout=60) as response:
                    if write:
                        self._last_write = time.monotonic()
                    raw = response.read()
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as error:
                text = error.read().decode(errors="replace") if error.fp else ""
                message = _message(text) or error.reason or "no message"
                retry_after = (error.headers or {}).get("retry-after")
                remaining = (error.headers or {}).get("x-ratelimit-remaining")
                limited = error.code in (403, 429) and (retry_after or remaining == "0"
                                                        or "rate limit" in message.lower())
                if limited and attempt < 5:
                    if retry_after:
                        pause = float(retry_after)
                    elif remaining == "0":
                        reset = float((error.headers or {}).get("x-ratelimit-reset", 0))
                        pause = max(1.0, reset - time.time())
                    else:
                        pause = 60.0 * 2 ** attempt
                    self._log(f"GitHub asked for a pause of {pause:.0f}s; waiting")
                    self._sleep(pause)
                    continue
                if error.code >= 500 and attempt < 3:
                    self._sleep(2.0 ** attempt)
                    continue
                raise SyncError(f"GitHub answered {error.code} to {method} {where}: "
                                f"{message}") from None
            except urllib.error.URLError as error:
                if attempt < 3:
                    self._sleep(2.0 ** attempt)
                    continue
                raise SyncError(f"Could not reach GitHub for {method} {where}: "
                                f"{error.reason}") from None
        raise SyncError(f"Gave up on {method} {where} after repeated rate limits.")

    def rest(self, method: str, path: str, payload: dict | None = None):
        return self._send(method, API + path, payload, write=method != "GET")

    def graphql(self, query: str, variables: dict | None = None) -> dict:
        write = query.lstrip().startswith("mutation")
        reply = self._send("POST", API + "/graphql", {"query": query,
                                                      "variables": variables or {}}, write)
        if reply and reply.get("errors"):
            raise SyncError("GitHub refused a query: "
                            + "; ".join(e.get("message", "") for e in reply["errors"]))
        return (reply or {}).get("data") or {}

    # labels and issues ----------------------------------------------------

    def labels(self) -> set[str]:
        names, page = set(), 1
        while True:
            batch = self.rest("GET", f"/repos/{self.owner}/{self.repo}/labels?per_page=100"
                                     f"&page={page}") or []
            names |= {label["name"] for label in batch}
            if len(batch) < 100:
                return names
            page += 1

    def create_label(self, name, color, description):
        self.rest("POST", f"/repos/{self.owner}/{self.repo}/labels",
                  {"name": name, "color": color, "description": description[:100]})

    ISSUES = """
    query($owner: String!, $repo: String!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        issues(first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: ASC}) {
          pageInfo { hasNextPage endCursor }
          nodes {
            number databaseId id title body state stateReason
            labels(first: 50) { nodes { name } }
            issueType { name }
            parent { number }
          }
        }
      }
    }"""

    def issues(self) -> list[Issue]:
        found, cursor = [], None
        while True:
            data = self.graphql(self.ISSUES, {"owner": self.owner, "repo": self.repo,
                                              "cursor": cursor})
            page = data["repository"]["issues"]
            for node in page["nodes"]:
                found.append(Issue(
                    node["number"], node["databaseId"], node["id"], node["title"],
                    node["body"] or "", node["state"].lower(),
                    (node.get("stateReason") or "").lower() or None,
                    sorted(label["name"] for label in node["labels"]["nodes"]),
                    (node.get("issueType") or {}).get("name"),
                    (node.get("parent") or {}).get("number")))
            if not page["pageInfo"]["hasNextPage"]:
                return found
            cursor = page["pageInfo"]["endCursor"]

    PULLS = """
    query($owner: String!, $repo: String!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequests(states: [MERGED], first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { number }
        }
      }
    }"""

    def merged_pulls(self) -> set[int]:
        found, cursor = set(), None
        while True:
            data = self.graphql(self.PULLS, {"owner": self.owner, "repo": self.repo,
                                             "cursor": cursor})
            page = data["repository"]["pullRequests"]
            found |= {node["number"] for node in page["nodes"]}
            if not page["pageInfo"]["hasNextPage"]:
                return found
            cursor = page["pageInfo"]["endCursor"]

    def _issue(self, raw: dict, parent_number: int | None = None) -> Issue:
        return Issue(raw["number"], raw["id"], raw["node_id"], raw["title"], raw.get("body") or "",
                     raw["state"], raw.get("state_reason"),
                     sorted(label["name"] for label in raw.get("labels", [])),
                     (raw.get("type") or {}).get("name"), parent_number)

    def create_issue(self, title, body, labels, type, parent_database_id):
        payload = {"title": title, "body": body, "labels": labels, "type": type}
        if parent_database_id:
            payload["parent_issue_id"] = parent_database_id
        self._log(f"create {title}")
        return self._issue(self.rest("POST", f"/repos/{self.owner}/{self.repo}/issues", payload))

    def update_issue(self, number, **changes):
        self._log(f"update #{number}: {', '.join(sorted(changes))}")
        raw = self.rest("PATCH", f"/repos/{self.owner}/{self.repo}/issues/{number}", changes)
        return self._issue(raw)

    def set_parent(self, parent_number, child_database_id):
        self.rest("POST", f"/repos/{self.owner}/{self.repo}/issues/{parent_number}/sub_issues",
                  {"sub_issue_id": child_database_id, "replace_parent": True})

    # the Project ----------------------------------------------------------

    FIELDS = """
    fields(first: 50) { nodes {
      __typename
      ... on ProjectV2FieldCommon { id name dataType }
      ... on ProjectV2SingleSelectField { options { id name color description } }
      ... on ProjectV2IterationField { configuration {
        iterations { id title } completedIterations { id title } } }
    } }"""

    ITEMS = """
    query($id: ID!, $cursor: String) { node(id: $id) { ... on ProjectV2 {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id content { ... on Issue { id } }
          fieldValues(first: 30) { nodes {
            __typename
            ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
            ... on ProjectV2ItemFieldIterationValue { title field { ... on ProjectV2FieldCommon { name } } }
          } } } } } } }"""

    def _owner_field(self) -> str:
        return "organization" if self.project_owner_type == "organization" else "user"

    def project(self) -> Project:
        if self._project:
            return self._project
        owner = self._owner_field()
        number = self.project_number
        if number is None:
            data = self.graphql(f"""query($login: String!) {{ {owner}(login: $login) {{
              projectsV2(first: 50) {{ nodes {{ number title closed
                repositories(first: 20) {{ nodes {{ nameWithOwner }} }} }} }} }} }}""",
                                {"login": self.project_owner})
            linked = [{"number": p["number"], "title": p["title"],
                       "repositories": [r["nameWithOwner"] for r in p["repositories"]["nodes"]]}
                      for p in data[owner]["projectsV2"]["nodes"] if not p["closed"]]
            number = choose_project(linked, f"{self.owner}/{self.repo}", None)
        data = self.graphql(f"""query($login: String!, $number: Int!) {{ {owner}(login: $login) {{
          projectV2(number: $number) {{ id number title {self.FIELDS} }} }} }}""",
                            {"login": self.project_owner, "number": number})
        raw = data[owner]["projectV2"]
        fields = {}
        for node in raw["fields"]["nodes"]:
            if not node.get("id"):
                continue
            fields[node["name"]] = self._field(node)
        items = {}
        cursor = None
        while True:
            page = self.graphql(self.ITEMS, {"id": raw["id"], "cursor": cursor})["node"]["items"]
            for node in page["nodes"]:
                content = node.get("content") or {}
                if not content.get("id"):
                    continue
                values = {}
                for value in node["fieldValues"]["nodes"]:
                    name = (value.get("field") or {}).get("name")
                    if not name:
                        continue
                    for key in ("name", "number", "date", "text", "title"):
                        if key in value and value[key] is not None:
                            values[name] = value[key]
                            break
                items[content["id"]] = Item(node["id"], content["id"], values)
            if not page["pageInfo"]["hasNextPage"]:
                break
            cursor = page["pageInfo"]["endCursor"]
        self._log(f"syncing into Project {raw['number']}, {raw['title']}")
        self._project = Project(raw["id"], raw["number"], raw["title"], fields, items)
        return self._project

    @staticmethod
    def _field(node: dict) -> Field:
        options, details = {}, {}
        for option in node.get("options") or []:
            options[option["name"]] = option["id"]
            details[option["name"]] = option
        configuration = node.get("configuration") or {}
        for iteration in (configuration.get("iterations") or []) + \
                (configuration.get("completedIterations") or []):
            options[iteration["title"]] = iteration["id"]
        return Field(node["id"], node["name"], node["dataType"], options, details)

    FIELD_RESULT = """projectV2Field {
      ... on ProjectV2FieldCommon { id name dataType }
      ... on ProjectV2SingleSelectField { options { id name color description } }
      ... on ProjectV2IterationField { configuration {
        iterations { id title } completedIterations { id title } } } }"""

    def create_field(self, name, data_type, options=None, iterations=None):
        project = self.project()
        payload: dict = {"projectId": project.id, "dataType": data_type, "name": name}
        if options:
            payload["singleSelectOptions"] = options
        if iterations:
            payload["iterationConfiguration"] = {
                "startDate": iterations[0]["startDate"], "duration": iterations[0]["duration"],
                "iterations": iterations}
        self._log(f"create field {name}")
        data = self.graphql(f"""mutation($input: CreateProjectV2FieldInput!) {{
          createProjectV2Field(input: $input) {{ {self.FIELD_RESULT} }} }}""", {"input": payload})
        return self._field(data["createProjectV2Field"]["projectV2Field"])

    def add_field_options(self, field, options):
        kept = [{"id": field.options[name], "name": name,
                 "color": field.details.get(name, {}).get("color", "GRAY"),
                 "description": field.details.get(name, {}).get("description", "")}
                for name in field.options]
        self._log(f"add {', '.join(o['name'] for o in options)} to {field.name}")
        data = self.graphql(f"""mutation($input: UpdateProjectV2FieldInput!) {{
          updateProjectV2Field(input: $input) {{ {self.FIELD_RESULT} }} }}""",
                            {"input": {"fieldId": field.id,
                                       "singleSelectOptions": kept + list(options)}})
        return self._field(data["updateProjectV2Field"]["projectV2Field"])

    def add_item(self, content_node_id):
        project = self.project()
        data = self.graphql("""mutation($project: ID!, $content: ID!) {
          addProjectV2ItemById(input: {projectId: $project, contentId: $content}) { item { id } } }""",
                            {"project": project.id, "content": content_node_id})
        return Item(data["addProjectV2ItemById"]["item"]["id"], content_node_id, {})

    def set_values(self, item, values):
        project = self.project()
        declarations = ["$project: ID!", "$item: ID!"]
        calls, variables = [], {"project": project.id, "item": item.id}
        for index, (field_id, value) in enumerate(values.items()):
            declarations += [f"$f{index}: ID!", f"$v{index}: ProjectV2FieldValue!"]
            calls.append(f"u{index}: updateProjectV2ItemFieldValue(input: {{projectId: $project, "
                         f"itemId: $item, fieldId: $f{index}, value: $v{index}}}) "
                         "{ clientMutationId }")
            variables[f"f{index}"] = field_id
            variables[f"v{index}"] = value
        self.graphql(f"mutation({', '.join(declarations)}) {{ {' '.join(calls)} }}", variables)


def _message(text: str) -> str:
    try:
        return json.loads(text).get("message", "")
    except (ValueError, AttributeError):
        return text[:200]


# ------------------------------------------------------------------ command line

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="plan only, write nothing")
    parser.add_argument("--check", action="store_true",
                        help="check the backlog and the generated pages, offline")
    parser.add_argument("--render-docs", action="store_true",
                        help="rewrite the generated sections in docs/project")
    parser.add_argument("--project-number", type=int, default=None)
    args = parser.parse_args(argv)
    backlog = load_backlog(BACKLOG)

    if args.render_docs:
        changed = update_docs(ROOT, backlog=backlog)
        print("rewrote " + ", ".join(changed) if changed else "every page was current")
        return 0
    if args.check:
        problems = validate(backlog)
        stale = update_docs(ROOT, check=True, backlog=backlog)
        for problem in problems:
            print(f"backlog: {problem}")
        for page in stale:
            print(f"stale: docs/project/{page}; run python -m tools.project_sync --render-docs")
        return 1 if problems or stale else 0

    project = backlog.project
    client = GitHubClient.from_environment(
        project["owner"], project["repository"], project_owner=project["owner"],
        project_owner_type=project.get("owner_type", "organization"),
        project_number=args.project_number or project.get("number"))
    # In a workflow run a warning becomes an annotation on the run's summary.
    if os.environ.get("GITHUB_ACTIONS") == "true":
        warn = lambda message: print(f"::warning::{message}")  # noqa: E731
    else:
        warn = lambda message: print(f"warning: {message}")  # noqa: E731
    Syncer(backlog, client, warn=warn).run(dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SyncError as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
