"""Reference solution for analytics-agent-1-pick-the-tables.

The model picks tables from a schema it has only read about, and the schema
tool is the authority on what exists and what is current. A picked name is
kept only when describe() lists it and does not mark it deprecated. A reply
that cannot be read picks nothing, because a guess at the tables is worse
than admitting there is no pick.

Every later stage of the build writes and runs queries against this pick, so
a table dropped here is a table no query can read.
"""

import json
import re

PICK_PROMPT = (
    "You help a garden-centre chain's managers query their sales database.\n"
    'Reply with one JSON object and nothing else: {"tables": ["<name>", ...]}\n'
    "List only the tables the question needs. The schema is below.\n"
)


def read_schema(tools: dict) -> dict:
    """Map each table name describe() lists to its entry."""
    reply = tools["describe"]()
    tables = reply.get("tables") if isinstance(reply, dict) else None
    if not isinstance(tables, list):
        return {}
    return {
        table["name"]: table
        for table in tables
        if isinstance(table, dict) and isinstance(table.get("name"), str)
    }


def schema_text(schema: dict) -> str:
    return "\n".join(
        f"{name}: {table.get('description', '')} Columns: {', '.join(table.get('columns') or [])}."
        for name, table in schema.items()
    )


def pick_tables(question: str, schema: dict, llm) -> list:
    reply = llm(
        f"{PICK_PROMPT}<schema>\n{schema_text(schema)}\n</schema>\n"
        f"<question>\n{question}\n</question>"
    )
    try:
        data = json.loads(reply)
    except ValueError:
        return []
    names = data.get("tables") if isinstance(data, dict) else None
    if not isinstance(names, list):
        return []

    kept = []
    for name in names:
        table = schema.get(name) if isinstance(name, str) else None
        # Existing is not enough. The archive exists, answers queries and has
        # not changed since March 2024, and the schema says so in a field.
        if table is not None and not table.get("deprecated") and name not in kept:
            kept.append(name)
    return kept


def run_agent(question: str, llm, tools: dict) -> str:
    schema = read_schema(tools)
    return json.dumps({"tables": pick_tables(question, schema, llm)})
