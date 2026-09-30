/**
 * Where learner code runs, checked before the worker grades anything.
 *
 * With RUNNER_FUNCTION set, the worker hands every submission to the runner
 * Lambda, which sits in a VPC with no route out and holds no credential.
 * Without it, the worker runs the battery itself, on whatever host the worker
 * is on, next to the database password and the host's AWS role. That is fine
 * on a laptop and wrong on a server students can reach, so a production
 * worker refuses to start that way unless someone has said, in writing, that
 * they mean it.
 */
export interface Placement {
  ok: boolean;
  message: string;
}

type Env = Partial<Record<"NODE_ENV" | "RUNNER_FUNCTION" | "RUNNER_LOCAL_OK", string>>;

export function runnerPlacement(env: Env = process.env): Placement {
  if (env.RUNNER_FUNCTION) {
    return { ok: true, message: `learner code runs in the Lambda ${env.RUNNER_FUNCTION}` };
  }
  if (env.NODE_ENV !== "production") {
    return { ok: true, message: "learner code runs on this host, which is a development machine" };
  }
  if (env.RUNNER_LOCAL_OK === "1") {
    return {
      ok: true,
      message: "learner code runs on this host, beside the database, because RUNNER_LOCAL_OK=1 " +
               "says so. Only people you trust should be able to submit.",
    };
  }
  return {
    ok: false,
    message:
      "This worker would run learner code on this host, beside the database, and NODE_ENV is " +
      "production.\n" +
      "  Fix it:        set RUNNER_FUNCTION to the runner Lambda's name (a stack output)\n" +
      "  Or accept it:  RUNNER_LOCAL_OK=1, for a box only people you trust can reach",
  };
}
