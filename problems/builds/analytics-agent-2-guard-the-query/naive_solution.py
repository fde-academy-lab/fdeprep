"""What an unprepared learner writes in four minutes.

It keeps stage 1, asks for the query and runs it when it starts with SELECT.
That stops a bare DELETE and nothing else: a DELETE chained after a SELECT
runs, a SELECT that creates a table runs, and a join to a table nobody picked
runs on a connection that can write.
"""

import json
import re

PICK_PROMPT = (
    "You help a garden-centre chain's managers query their sales database.\n"
    'Reply with one JSON object and nothing else: {"tables": ["<name>", ...]}\n'
    "List only the tables the question needs. The schema is below.\n"
)

SQL_PROMPT = (
    "Write one PostgreSQL SELECT statement that answers the question, using only "
    "the tables below. Reply with the SQL and nothing else.\n"
)


def read_schema(tools: dict) -> dict:
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
        if table is not None and not table.get("deprecated") and name not in kept:
            kept.append(name)
    return kept


def write_sql(question: str, tables: list, schema: dict, llm) -> str:
    listing = "\n".join(
        f"{name}({', '.join(schema[name].get('columns') or [])})" for name in tables
    )
    return llm(
        f"{SQL_PROMPT}<tables>\n{listing}\n</tables>\n<question>\n{question}\n</question>"
    ).strip()


def run_agent(question: str, llm, tools: dict) -> str:
    schema = read_schema(tools)
    tables = pick_tables(question, schema, llm)
    out = {"status": "refused", "tables": tables, "sql": None,
           "columns": None, "rows": None, "reason": None}
    if not tables:
        out["reason"] = "no described, current table answers this question"
        return json.dumps(out)

    sql = write_sql(question, tables, schema, llm)
    if not sql.upper().startswith("SELECT"):
        out["reason"] = "the query does not start with SELECT"
        return json.dumps(out)

    result = tools["run_query"](sql=sql)
    out.update(status="answered", sql=sql, columns=result["columns"], rows=result["rows"])
    return json.dumps(out)
