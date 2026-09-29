"""Reference solution for analytics-agent-2-guard-the-query.

Stage 1's pick is unchanged, and it becomes the allowlist. A query reaches
the database only when it is one statement, reads and never writes, and names
no table outside the pick. Each of the three closes a way the incident could
come back: a DELETE chained after a SELECT, a SELECT that creates a table,
and a join to a table nobody chose.

A refused query never reaches run_query, and the refusal carries a reason a
manager can read.
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

WRITES = re.compile(
    r"(?i)\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|into)\b"
)
# A FROM clause may list several tables separated by commas, and a name may
# be quoted. Each item's first word is the table; anything after it is an alias.
TABLE_LIST = re.compile(
    r'(?i)\b(?:from|join)\s+((?:"?[a-z_][\w.]*"?(?:\s+(?:as\s+)?[a-z_]\w*)?\s*,\s*)*"?[a-z_][\w.]*"?)'
)
CTE_NAME = re.compile(r"(?i)\b([a-z_]\w*)\s+as\s*\(")


# Stage 1: keep only the tables the schema lists and does not mark deprecated.

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
        if table is not None and not table.get("deprecated") and name not in kept:
            kept.append(name)
    return kept


# Stage 2: one read over the picked tables, or nothing reaches the database.

def write_sql(question: str, tables: list, schema: dict, llm) -> str:
    listing = "\n".join(
        f"{name}({', '.join(schema[name].get('columns') or [])})" for name in tables
    )
    return llm(
        f"{SQL_PROMPT}<tables>\n{listing}\n</tables>\n<question>\n{question}\n</question>"
    ).strip()


def tables_read(sql: str) -> list:
    """Every table named after FROM or JOIN, lower-cased, schema prefix removed."""
    names = []
    for listed in TABLE_LIST.findall(sql):
        for item in listed.split(","):
            name = item.split()[0].strip('"')
            names.append(name.split(".")[-1].lower())
    return names


def guard(sql: str, allowed: list):
    """None when the query may run, otherwise the reason it may not."""
    text = sql.strip()
    if text.endswith(";"):
        text = text[:-1].rstrip()
    if not text:
        return "the model wrote no query"
    if ";" in text:
        return "the query holds more than one statement"
    if not re.match(r"(?i)(select|with)\b", text):
        return "the query does not start with SELECT"
    write = WRITES.search(text)
    if write:
        return f"the query uses {write.group(1).upper()}, which writes"
    defined = {name.lower() for name in CTE_NAME.findall(text)}
    for table in tables_read(text):
        if table not in allowed and table not in defined:
            return f"the query reads {table}, which was not picked for this question"
    return None


def run_agent(question: str, llm, tools: dict) -> str:
    schema = read_schema(tools)
    tables = pick_tables(question, schema, llm)
    out = {"status": "refused", "tables": tables, "sql": None,
           "columns": None, "rows": None, "reason": None}
    if not tables:
        out["reason"] = "no described, current table answers this question"
        return json.dumps(out)

    sql = write_sql(question, tables, schema, llm)
    reason = guard(sql, tables)
    if reason:
        out["reason"] = reason
        return json.dumps(out)

    result = tools["run_query"](sql=sql)
    out.update(status="answered", sql=sql, columns=result["columns"], rows=result["rows"])
    return json.dumps(out)
