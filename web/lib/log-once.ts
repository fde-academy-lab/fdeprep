/**
 * A line for whoever runs the platform, written to the server log once per
 * process rather than on every render.
 *
 * What a deployment is missing goes here and never onto a screen: a learner
 * cannot set an environment variable, and a variable name on a sign-in page
 * tells a stranger how the deployment is put together.
 */
const said = new Set<string>();

export function logOnce(line: string): void {
  if (said.has(line)) return;
  said.add(line);
  console.error(line);
}
