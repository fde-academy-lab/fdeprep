#!/usr/bin/env node
/**
 * One stack, as docs/05 section 4 says.
 *
 * Nothing here deploys by itself. `cdk synth` renders the template; a human
 * runs `cdk deploy`, which builds both images, pushes them to the asset
 * repository `cdk bootstrap` made, and points the functions at them.
 */
import { App } from "aws-cdk-lib";
import { FdePrepStack } from "../lib/fdeprep-stack.js";

/** A whole number from the environment, or nothing. Anything else is refused. */
function count(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a whole number above zero, got "${raw}".`);
  }
  return value;
}

const app = new App();

new FdePrepStack(app, "FdePrepStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  // The model the judge may call. Named here and passed in, never inlined at a
  // call site, which is the same rule judge/config.py follows.
  judgeModelId: process.env.JUDGE_MODEL_ID ?? "us.anthropic.claude-opus-5",
  alarmEmail: process.env.ALARM_EMAIL,
  // Off unless set. A new account cannot spare reserved concurrency.
  runnerReservedConcurrency: count("RUNNER_RESERVED_CONCURRENCY"),
  judgeReservedConcurrency: count("JUDGE_RESERVED_CONCURRENCY"),
  // The voice socket is created only once a human has made the signing secret
  // and put its ARN here. Without it the rest of the stack still deploys.
  voiceTokenSecretArn: process.env.VOICE_TOKEN_SECRET_ARN,
});
