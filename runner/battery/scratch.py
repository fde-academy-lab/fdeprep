"""Clearing the scratch directory between cases (docs/03 sections 1 and 7).

In Lambda, /tmp outlives the invocation that wrote it and the sandbox runs as
the runner's own user, so anything learner code leaves there is readable by
the next code that runs on the same instance. The case's working directory is
removed after every case already; this removes whatever else the code wrote.

Only the runner image sets RUNNER_SCRATCH_DIR. A developer's /tmp is shared
with every other process on the machine and is never cleared.
"""

from __future__ import annotations

import errno
import os

ENV = "RUNNER_SCRATCH_DIR"
HOIST_PREFIX = ".fdeprep-hoisted-"

_DIRECTORY = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
_TAKEN = {errno.EEXIST, errno.ENOTEMPTY, errno.ENOTDIR, errno.EISDIR}


def configured() -> str | None:
    return os.environ.get(ENV) or None


def clear(directory: str) -> None:
    """Remove everything beneath directory and leave directory itself.

    Runs only after the sandbox's process group is dead, so nothing changes
    underneath it. Symbolic links are removed and never followed. A directory
    the code locked is unlocked first, since it belongs to the same user.

    Nothing recurses and no path grows past one name: each directory is
    emptied by moving its subdirectories up to the top level, where a later
    pass empties them in turn. A tree nested past the recursion limit or past
    PATH_MAX goes the same way as a flat one.
    """
    top = os.open(directory, _DIRECTORY)
    hoisted = 0
    try:
        while True:
            with os.scandir(top) as listing:
                entries = [(e.name, e.is_dir(follow_symlinks=False)) for e in listing]
            if not entries:
                return
            for name, is_dir in entries:
                if not is_dir:
                    os.unlink(name, dir_fd=top)
                    continue
                os.chmod(name, 0o700, dir_fd=top)
                inner = os.open(name, _DIRECTORY, dir_fd=top)
                try:
                    with os.scandir(inner) as listing:
                        children = [(c.name, c.is_dir(follow_symlinks=False)) for c in listing]
                    for child, child_is_dir in children:
                        if not child_is_dir:
                            os.unlink(child, dir_fd=inner)
                            continue
                        # Moving a directory to a new parent rewrites its own
                        # "..", which needs write permission on it.
                        os.chmod(child, 0o700, dir_fd=inner)
                        hoisted = _hoist(child, inner, top, hoisted)
                finally:
                    os.close(inner)
                os.rmdir(name, dir_fd=top)
    finally:
        os.close(top)


def _hoist(name: str, parent: int, top: int, counter: int) -> int:
    """Move parent/name to the top level under a free name; return the counter."""
    while True:
        counter += 1
        try:
            os.rename(name, f"{HOIST_PREFIX}{counter}", src_dir_fd=parent, dst_dir_fd=top)
            return counter
        except OSError as exc:
            if exc.errno not in _TAKEN:
                raise
