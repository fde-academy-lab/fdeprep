/**
 * Assertions over the synthesised template.
 *
 * The first group is the trust boundary from .claude/rules/01: the runner
 * executes learner code and must reach no model, and the judge calls models and
 * must reach no bucket. Those are IAM facts, so they are checked against the
 * IAM the stack actually generates rather than against the code that asked for
 * it. A grant added in the wrong place fails here.
 *
 * The second group is docs/05 section 6, the three alarms, checked by their
 * numbers: an alarm at the wrong threshold is an alarm nobody reads.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { App } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { FdePrepStack } from "../lib/fdeprep-stack.js";

function synth(): Template {
  const app = new App();
  const stack = new FdePrepStack(app, "TestStack", {
    env: { account: "111122223333", region: "us-east-1" },
    judgeModelId: "us.anthropic.claude-opus-5",
  });
  return Template.fromStack(stack);
}

/** Every action on every policy attached to a role whose logical id contains `which`. */
function actionsFor(template: Template, which: string): string[] {
  const policies = template.findResources("AWS::IAM::Policy");
  const actions: string[] = [];
  for (const policy of Object.values(policies)) {
    const roles = JSON.stringify((policy as { Properties: { Roles: unknown } }).Properties.Roles);
    if (!roles.includes(which)) continue;
    const document = (policy as {
      Properties: { PolicyDocument: { Statement: Array<{ Action: string | string[] }> } };
    }).Properties.PolicyDocument;
    for (const statement of document.Statement) {
      const action = statement.Action;
      actions.push(...(Array.isArray(action) ? action : [action]));
    }
  }
  return actions;
}

describe("the trust boundary, as IAM rather than as intent", () => {
  test("the runner has no Bedrock permission at all", () => {
    const actions = actionsFor(synth(), "RunnerRole");
    assert.ok(actions.length > 0, "the runner should have some permissions");
    assert.deepEqual(actions.filter((a) => a.startsWith("bedrock")), [],
      "learner code never reaches a model endpoint, in any phase, for any reason");
  });

  test("the judge touches no bucket", () => {
    const actions = actionsFor(synth(), "JudgeRole");
    assert.deepEqual(actions.filter((a) => a.startsWith("s3:")), [],
      "the judge executes no learner code and has no trace to write");
  });

  test("the judge's Bedrock grant names one model rather than every model", () => {
    const template = synth();
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([Match.objectLike({
          Action: Match.arrayWith(["bedrock:InvokeModel"]),
          Resource: Match.arrayWith([Match.stringLikeRegexp("claude-opus-5")]),
        })]),
      }),
    });
  });

  test("the two Lambdas do not share a role", () => {
    const template = synth();
    const functions = Object.values(template.findResources("AWS::Lambda::Function"));
    const roles = functions.map((fn) =>
      JSON.stringify((fn as { Properties: { Role: unknown } }).Properties.Role));
    assert.equal(new Set(roles).size, 2, "two Lambdas that never share a role");
  });

  test("the runner sits in the VPC and the judge does not", () => {
    const template = synth();
    const functions = template.findResources("AWS::Lambda::Function");
    const inVpc = Object.entries(functions)
      .filter(([, fn]) => (fn as { Properties: Record<string, unknown> }).Properties.VpcConfig)
      .map(([name]) => name);
    assert.equal(inVpc.length, 1);
    assert.ok(inVpc[0]!.startsWith("Runner"), `expected the runner, got ${inVpc[0]}`);
  });
});

describe("the network, from docs/05 section 4", () => {
  test("there is no NAT gateway", () => {
    // "It removes the largest fixed line on the AWS bill and it removes the
    // runner's route to the internet in one move."
    synth().resourceCountIs("AWS::EC2::NatGateway", 0);
  });

  test("both subnets are private", () => {
    const template = synth();
    template.resourceCountIs("AWS::EC2::Subnet", 2);
    for (const subnet of Object.values(template.findResources("AWS::EC2::Subnet"))) {
      const properties = (subnet as { Properties: Record<string, unknown> }).Properties;
      assert.notEqual(properties.MapPublicIpOnLaunch, true);
    }
  });

  test("S3 and SQS are reachable through endpoints", () => {
    const template = synth();
    template.resourceCountIs("AWS::EC2::VPCEndpoint", 2);
    template.hasResourceProperties("AWS::EC2::VPCEndpoint", { VpcEndpointType: "Gateway" });
    template.hasResourceProperties("AWS::EC2::VPCEndpoint", { VpcEndpointType: "Interface" });
  });
});

describe("queues and buckets", () => {
  test("both working queues have a dead letter queue after three receives", () => {
    const template = synth();
    // Two working queues, two dead letter queues, and the results queue.
    template.resourceCountIs("AWS::SQS::Queue", 5);
    const withDlq = Object.values(template.findResources("AWS::SQS::Queue"))
      .filter((q) => (q as { Properties: Record<string, unknown> }).Properties.RedrivePolicy);
    assert.equal(withDlq.length, 2);
    for (const queue of withDlq) {
      const policy = (queue as { Properties: { RedrivePolicy: { maxReceiveCount: number } } })
        .Properties.RedrivePolicy;
      assert.equal(policy.maxReceiveCount, 3);
    }
  });

  test("both buckets block public access and carry a lifecycle rule", () => {
    const template = synth();
    template.resourceCountIs("AWS::S3::Bucket", 2);
    for (const bucket of Object.values(template.findResources("AWS::S3::Bucket"))) {
      const properties = (bucket as { Properties: Record<string, unknown> }).Properties;
      assert.ok(properties.LifecycleConfiguration, "every bucket needs a lifecycle rule");
      assert.deepEqual(properties.PublicAccessBlockConfiguration, {
        BlockPublicAcls: true, BlockPublicPolicy: true,
        IgnorePublicAcls: true, RestrictPublicBuckets: true,
      });
    }
  });

  test("there is one ECR repository for the runner image", () => {
    synth().resourceCountIs("AWS::ECR::Repository", 1);
  });
});

describe("the three alarms, at the numbers docs/05 section 6 gives", () => {
  test("there are exactly three", () => {
    // "Three, and no more, because an alarm nobody reads is worse than no alarm."
    synth().resourceCountIs("AWS::CloudWatch::Alarm", 3);
  });

  test("queue age over 120 seconds for 5 minutes", () => {
    synth().hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ApproximateAgeOfOldestMessage",
      Threshold: 120,
      EvaluationPeriods: 5,
      Period: 60,
      ComparisonOperator: "GreaterThanThreshold",
    });
  });

  test("runner error rate over 5 percent across 15 minutes", () => {
    // Three five-minute periods is the fifteen minutes the spec asks for. The
    // period sits on the two stat entries rather than on the expression, which
    // is how CloudWatch renders a metric-maths alarm.
    synth().hasResourceProperties("AWS::CloudWatch::Alarm", {
      Threshold: 0.05,
      EvaluationPeriods: 3,
      ComparisonOperator: "GreaterThanThreshold",
      Metrics: Match.arrayWith([
        Match.objectLike({ Expression: "IF(invocations > 0, errors / invocations, 0)" }),
        Match.objectLike({
          Id: "errors",
          MetricStat: Match.objectLike({
            Period: 300,
            Metric: Match.objectLike({ MetricName: "Errors", Namespace: "AWS/Lambda" }),
          }),
        }),
      ]),
    });
  });

  test("the error rate is a rate, so a quiet night with two errors does not page", () => {
    // A count alarm at the same threshold would fire on two failures out of
    // three at 22:00 and stay silent on fifty out of two thousand at noon.
    const alarms = synth().findResources("AWS::CloudWatch::Alarm");
    const runner = Object.entries(alarms).find(([name]) => name.startsWith("RunnerFailing"))![1];
    const metrics = (runner as { Properties: { Metrics: Array<{ Expression?: string }> } })
      .Properties.Metrics;
    assert.ok(metrics.some((m) => m.Expression?.includes("invocations")),
      "the alarm divides by invocations rather than counting errors");
  });

  test("every alarm reaches the channel rather than nobody", () => {
    const template = synth();
    template.resourceCountIs("AWS::SNS::Topic", 1);
    for (const alarm of Object.values(template.findResources("AWS::CloudWatch::Alarm"))) {
      const actions = (alarm as { Properties: { AlarmActions?: unknown[] } })
        .Properties.AlarmActions;
      assert.ok(actions && actions.length > 0, "an alarm with no action is a dashboard widget");
    }
  });

  test("every alarm says what to do, not just that something is wrong", () => {
    for (const alarm of Object.values(synth().findResources("AWS::CloudWatch::Alarm"))) {
      const description = (alarm as { Properties: { AlarmDescription?: string } })
        .Properties.AlarmDescription;
      assert.ok(description && description.length > 20,
        "the description is what the second operator reads at 21:00");
    }
  });
});
