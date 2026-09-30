/**
 * What every code problem runs under, shown in its Constraints table.
 *
 * ALWAYS_ALLOWED_IMPORTS mirrors runner/problem.py, and a test keeps the two
 * equal, because a list on the page that disagrees with the gate is worse than
 * no list. PYTHON_VERSION is the runner image's, from the Dockerfile.
 */
export const ALWAYS_ALLOWED_IMPORTS = [
  "json", "re", "math", "typing", "dataclasses", "collections",
] as const;

export const PYTHON_VERSION = "3.12";
