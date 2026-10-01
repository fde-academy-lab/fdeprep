"""Reference solution for validate-an-mcp-tool-result.

The MCP server is another team's code, so nothing it returns reaches the model
until the adapter has checked it against the schema the tool declared.
isError is read first, because a failed call can still carry structuredContent
that matches the schema, and its zeroes look exactly like an empty shelf. A
result that passes enters as its declared fields and nothing else, so _meta and
any undeclared field stay out of the prompt. A result that fails enters as one
line saying it was rejected.

The schema check covers what this schema uses: an object, required fields,
string and integer types, and a minimum. A boolean is excluded from integer by
hand, because isinstance(True, int) is true in Python and JSON Schema does not
count a boolean as an integer.
"""

import json
import re

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "sku": {"type": "string"},
        "store": {"type": "string"},
        "on_hand": {"type": "integer", "minimum": 0},
    },
    "required": ["sku", "store", "on_hand"],
}

_ACTION = re.compile(r"Action:\s*(\w+)\((.*?)\)\s*$", re.MULTILINE)
_JSON_TYPES = {"string": str, "integer": int}


def _arguments(raw: str) -> dict:
    args = {}
    for pair in raw.split(","):
        if "=" in pair:
            key, value = pair.split("=", 1)
            args[key.strip()] = value.strip()
    return args


def matches_schema(value, schema: dict) -> bool:
    if not isinstance(value, dict):
        return False
    if any(name not in value for name in schema.get("required", [])):
        return False
    for name, rule in schema.get("properties", {}).items():
        if name not in value:
            continue
        field = value[name]
        expected = _JSON_TYPES.get(rule.get("type"))
        if expected is None or isinstance(field, bool) or not isinstance(field, expected):
            return False
        if "minimum" in rule and field < rule["minimum"]:
            return False
    return True


def _error_text(result: dict) -> str:
    blocks = result.get("content")
    if not isinstance(blocks, list):
        return ""
    texts = [
        block["text"] for block in blocks
        if isinstance(block, dict) and block.get("type") == "text"
        and isinstance(block.get("text"), str)
    ]
    return " ".join(texts)[:200]


def admit(result) -> str:
    if not isinstance(result, dict):
        return "check_stock: rejected, the result was not an MCP tool result."
    if result.get("isError") is True:
        return f"check_stock failed: <error>{_error_text(result)}</error>"

    data = result.get("structuredContent")
    if not matches_schema(data, OUTPUT_SCHEMA):
        return "check_stock: rejected, the result did not match the declared schema."

    declared = {name: data[name] for name in OUTPUT_SCHEMA["properties"]}
    return f"check_stock: {json.dumps(declared)}"


def run_agent(question: str, llm, tools: dict) -> str:
    scratchpad = f"Question: {question}\n"

    for _ in range(3):
        output = llm(scratchpad)

        if "Final Answer:" in output:
            answer = output.split("Final Answer:", 1)[1].strip()
            if answer:
                return answer
            scratchpad += f"{output}\nThat answer was empty.\n"
            continue

        action = _ACTION.search(output)
        if action is None or action.group(1) not in tools:
            scratchpad += f"{output}\nThat was not a tool you have.\n"
            continue

        result = tools[action.group(1)](**_arguments(action.group(2)))
        scratchpad += f"{output}\n{admit(result)}\n"

    return "I could not check the stock."
