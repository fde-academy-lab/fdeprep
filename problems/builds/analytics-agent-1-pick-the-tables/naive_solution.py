"""What an unprepared learner writes in four minutes.

It describes the schema, shows it to the model and returns the model's pick
as it came. A table the schema has never heard of goes through, the archive
the schema marks deprecated goes through, and a reply that is not JSON
raises before anything is picked.
"""

import json
import re

PICK_PROMPT = (
    "You help a garden-centre chain's managers query their sales database.\n"
    'Reply with one JSON object and nothing else: {"tables": ["<name>", ...]}\n'
    "List only the tables the question needs. The schema is below.\n"
)


def read_schema(tools: dict) -> dict:
    return {table["name"]: table for table in tools["describe"]()["tables"]}


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
    return json.loads(reply)["tables"]


def run_agent(question: str, llm, tools: dict) -> str:
    schema = read_schema(tools)
    return json.dumps({"tables": pick_tables(question, schema, llm)})
