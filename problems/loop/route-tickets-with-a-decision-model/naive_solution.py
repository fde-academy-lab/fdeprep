"""What an unprepared learner writes in four minutes.

It asks the decision model and returns its choice as the route. A guess at
0.41 is routed like a certainty, a label that is not a queue is returned as
one, and a reply that carries an error raises a KeyError.
"""


def run_agent(question: str, llm, tools: dict) -> str:
    return tools["jev"](ticket=question)["choice"]
