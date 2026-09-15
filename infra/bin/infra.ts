#!/usr/bin/env node
/**
 * One stack, as docs/05 section 4 says.
 *
 * Nothing here deploys. `cdk synth` renders the template; a human runs
 * `cdk deploy`, and the deploy workflow moves image tags rather than
 * infrastructure.
 */
import { App } from "aws-cdk-lib";
import { FdePrepStack } from "../lib/fdeprep-stack.js";

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
  runnerImageTag: process.env.RUNNER_IMAGE_TAG,
  judgeImageTag: process.env.JUDGE_IMAGE_TAG,
  // The voice socket is created only once a human has made the signing secret
  // and put its ARN here. Without it the rest of the stack still deploys.
  voiceTokenSecretArn: process.env.VOICE_TOKEN_SECRET_ARN,
});
