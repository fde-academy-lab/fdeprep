"""The trusted half of every sandbox run.

Learner code holds proxies (runner/harness/proxy.py). Each call it makes
crosses a pipe to this process, which runs the scripted model and the tool
fixtures, applies the call budget and records the step. The trace a case is
judged on is written here, by the runner, the way docs/03 section 9.4 already
has the worker write the trace of a live run. Nothing the sandbox writes about
its own calls is read.

This module also owns how the sandbox process starts: with an allowlisted
environment, in a session of its own, with no process allowance, and only
after the runner has closed its own /proc entries to it.
"""

from __future__ import annotations

import json
import os
import pathlib
import selectors
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Any

from runner.harness.mock_llm import BudgetExceeded, MockLLM, ToolTable
from runner.harness.proxy import MAX_MESSAGE_BYTES

STDIO_LIMIT = 32 * 1024
MAX_PENDING_REPLY_BYTES = 4 * 1024 * 1024
PR_SET_DUMPABLE = 4


def child_env(repo_root: pathlib.Path) -> dict[str, str]:
    """The sandbox's whole environment.

    Nothing is inherited. In Lambda the runner's own environment carries
    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_SESSION_TOKEN for an
    execution role that reads every problem bundle and sends to the results
    queue, and the trace replay shows a learner every prompt their code sent.
    """
    return {
        "PATH": "/usr/bin:/bin",
        "PYTHONPATH": str(repo_root),
        "PYTHONHASHSEED": "0",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUTF8": "1",
    }


_hardened = False


def harden_parent() -> None:
    """Close this process's /proc entries to the sandbox.

    The sandbox runs as the same user as the runner, and a same-user process
    can read /proc/<pid>/environ, where the credentials above live however
    carefully the child's own environment is built. A process that is not
    dumpable has its /proc entries owned by root, so a child without
    CAP_SYS_PTRACE is refused. exec gives the sandbox a fresh flag of its own,
    so this changes nothing inside it.
    """
    global _hardened
    if _hardened or not sys.platform.startswith("linux"):
        return
    import ctypes

    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "prctl(PR_SET_DUMPABLE, 0) failed")
    _hardened = True


class SandboxProtocolError(RuntimeError):
    """The sandbox broke the protocol or returned something that is not a valid result."""


class Session:
    """The scripted model and the tool table, answering on the learner's behalf."""

    def __init__(self, llm: MockLLM, tools: ToolTable) -> None:
        self.llm = llm
        self.tools = tools

    def answer(self, message: Any) -> dict[str, Any]:
        if not isinstance(message, dict):
            return _refusal("RuntimeError", "a call arrived that was not a call")
        op = message.get("op")
        try:
            if op == "llm":
                return {"ok": self.llm(str(message.get("prompt", "")))}
            if op == "tool":
                return {"ok": self.tools.call(str(message.get("name")), message.get("args"))}
        except BudgetExceeded as exc:
            return _refusal("BudgetExceeded", str(exc))
        except Exception as exc:  # a fixture raising is the fixture's whole point
            return _refusal(type(exc).__name__, str(exc))
        return _refusal("RuntimeError", f"unknown call {op!r}")

    def answer_line(self, line: bytes) -> bytes:
        try:
            reply = self.answer(json.loads(line))
        except ValueError:
            reply = _refusal("ValueError", "the call could not be read")
        try:
            text = json.dumps(reply)
        except (TypeError, ValueError):
            text = json.dumps(_refusal("RuntimeError", "the answer could not be encoded"))
        return text.encode("ascii") + b"\n"


def _refusal(kind: str, message: str) -> dict[str, Any]:
    return {"raise": {"type": kind, "message": message}}


@dataclass
class Exchange:
    """How the sandbox process ended, from the runner's side."""

    killed: bool
    returncode: int | None
    stdout: str
    stderr: str
    wall_ms: int


def converse(command: list[str], *, cwd: str, env: dict[str, str], wall_ms: int,
             slack_s: float, session: Session) -> Exchange:
    """Start the sandbox and answer its calls until it exits or runs out of time.

    stdout, stderr and the call pipe are read together, because a sandbox that
    fills one while the runner waits on another would otherwise hold the
    runner until the Lambda timeout.
    """
    harden_parent()
    request_read, request_write = os.pipe()
    reply_read, reply_write = os.pipe()
    started = time.monotonic()
    try:
        process = subprocess.Popen(
            [*command, str(request_write), str(reply_read)],
            cwd=cwd, env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            pass_fds=(request_write, reply_read), start_new_session=True,
        )
    except BaseException:
        for fd in (request_read, request_write, reply_read, reply_write):
            os.close(fd)
        raise
    os.close(request_write)
    os.close(reply_read)
    os.set_blocking(reply_write, False)

    deadline = started + wall_ms / 1000.0 + slack_s
    captured = {"stdout": bytearray(), "stderr": bytearray()}
    inbox, outbox = bytearray(), bytearray()
    violation: str | None = None
    killed = False
    selector = selectors.DefaultSelector()
    selector.register(request_read, selectors.EVENT_READ, "calls")
    selector.register(process.stdout, selectors.EVENT_READ, "stdout")
    selector.register(process.stderr, selectors.EVENT_READ, "stderr")

    try:
        while violation is None and any(
                key.data != "answers" for key in selector.get_map().values()):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                killed = True
                break
            for key, _ in selector.select(timeout=remaining):
                if key.data == "answers":
                    try:
                        del outbox[:os.write(reply_write, outbox)]
                    except BlockingIOError:
                        continue
                    except BrokenPipeError:
                        outbox.clear()
                    if not outbox:
                        selector.unregister(reply_write)
                    continue

                chunk = os.read(key.fd, 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                if key.data in captured:
                    kept = captured[key.data]
                    kept += chunk[:max(0, STDIO_LIMIT - len(kept))]
                    continue

                inbox += chunk
                while (end := inbox.find(b"\n")) >= 0:
                    line = bytes(inbox[:end])
                    del inbox[:end + 1]
                    outbox += session.answer_line(line)
                if len(inbox) > MAX_MESSAGE_BYTES:
                    violation = "the sandbox sent a call over the 4MB limit"
                    break
                if len(outbox) > MAX_PENDING_REPLY_BYTES:
                    violation = "the sandbox sent calls without reading the answers"
                    break
                if outbox and reply_write not in selector.get_map():
                    selector.register(reply_write, selectors.EVENT_WRITE, "answers")
    finally:
        selector.close()
        os.close(request_read)
        os.close(reply_write)

    if not killed and violation is None:
        try:
            process.wait(timeout=max(0.0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            killed = True

    # The pid still names the sandbox's process group here, because nothing
    # has reaped it: anything it started goes with it. Lambda refuses the fork
    # in the first place; this is for a runner started as root.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    process.wait()
    process.stdout.close()
    process.stderr.close()

    if violation is not None:
        raise SandboxProtocolError(violation)
    return Exchange(
        killed=killed,
        returncode=None if killed else process.returncode,
        stdout=captured["stdout"].decode("utf-8", "replace"),
        stderr=captured["stderr"].decode("utf-8", "replace"),
        wall_ms=int((time.monotonic() - started) * 1000),
    )
