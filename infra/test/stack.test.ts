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

  test("every bucket blocks public access and carries a lifecycle rule", () => {
    const template = synth();
    // Traces, problem bundles and learner audio. The count is asserted in the
    // learner audio suite below; what matters here is that no bucket escapes
    // the two rules, however many there are.
    const buckets = Object.values(template.findResources("AWS::S3::Bucket"));
    assert.ok(buckets.length >= 2);
    for (const bucket of buckets) {
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

/**
 * The voice socket. docs/07 section 7.
 *
 * The socket is optional in the stack, so the first test here is that the
 * rest of the infrastructure still renders without it. Everything after that
 * synthesises with a secret ARN supplied.
 */
const VOICE_SECRET_ARN =
  "arn:aws:secretsmanager:us-east-1:111122223333:secret:fdeprep/voice-token-AbCdEf";

function synthWithVoice(): Template {
  const app = new App();
  const stack = new FdePrepStack(app, "TestStack", {
    env: { account: "111122223333", region: "us-east-1" },
    judgeModelId: "us.anthropic.claude-opus-5",
    voiceTokenSecretArn: VOICE_SECRET_ARN,
  });
  return Template.fromStack(stack);
}

describe("the voice socket", () => {
  test("no socket is created until a signing secret is configured", () => {
    synth().resourceCountIs("AWS::ApiGatewayV2::Api", 0);
  });

  test("the socket is a WebSocket API with three routes", () => {
    const template = synthWithVoice();
    template.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      ProtocolType: "WEBSOCKET",
      RouteSelectionExpression: "$request.body.action",
    });
    const routes = Object.values(template.findResources("AWS::ApiGatewayV2::Route")).map(
      (route) => (route as { Properties: { RouteKey: string } }).Properties.RouteKey,
    );
    assert.deepEqual(routes.sort(), ["$connect", "$default", "$disconnect"]);
  });

  test("only the handshake is authorized, which is all AWS allows", () => {
    const template = synthWithVoice();
    template.resourceCountIs("AWS::ApiGatewayV2::Authorizer", 1);
    template.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "REQUEST",
      IdentitySource: ["route.request.querystring.token"],
    });

    const authorized = Object.values(template.findResources("AWS::ApiGatewayV2::Route"))
      .map((route) => (route as { Properties: { RouteKey: string; AuthorizationType?: string } }).Properties)
      .filter((props) => props.AuthorizationType === "CUSTOM")
      .map((props) => props.RouteKey);
    assert.deepEqual(authorized, ["$connect"]);
  });

  test("frames travel on a FIFO queue with a dead letter queue", () => {
    const template = synthWithVoice();
    const queues = Object.values(template.findResources("AWS::SQS::Queue"))
      .map((queue) => (queue as { Properties: Record<string, unknown> }).Properties)
      .filter((props) => props.FifoQueue === true);
    assert.equal(queues.length, 2, "one frame queue and its dead letter queue");

    const withDlq = queues.find((props) => props.RedrivePolicy);
    assert.ok(withDlq, "the frame queue redrives to the dead letter queue");
    assert.equal(
      (withDlq.RedrivePolicy as { maxReceiveCount: number }).maxReceiveCount,
      3,
    );
  });

  test("the speech grant names one action and sits on its own role", () => {
    const actions = actionsFor(synthWithVoice(), "StreamRole");
    assert.deepEqual(
      actions.filter((a) => a.startsWith("transcribe:")),
      ["transcribe:StartStreamTranscription"],
    );
    assert.deepEqual(actions.filter((a) => a.startsWith("bedrock")), [],
      "the speech path calls no model endpoint");
    assert.deepEqual(actions.filter((a) => a.startsWith("s3:")), [],
      "the speech path writes no bucket in this phase");
  });

  /**
   * The rule the whole security model rests on, pointed at the new service:
   * the Lambda that executes learner code gains nothing from the Voice Screen
   * existing.
   */
  test("the Lambda that executes learner code has no speech permission", () => {
    const actions = actionsFor(synthWithVoice(), "RunnerRole");
    assert.ok(actions.length > 0);
    assert.deepEqual(actions.filter((a) => a.startsWith("transcribe:")), []);
    assert.deepEqual(actions.filter((a) => a.startsWith("bedrock")), []);
  });

  test("the socket function relays frames and never transcribes them", () => {
    const actions = actionsFor(synthWithVoice(), "SocketRole");
    assert.ok(actions.includes("sqs:SendMessage"));
    assert.deepEqual(actions.filter((a) => a.startsWith("transcribe:")), []);
    assert.deepEqual(actions.filter((a) => a.startsWith("secretsmanager:")), [],
      "the signing secret is the authorizer's alone");
  });

  test("the authorizer reads the signing secret and nothing else of note", () => {
    const actions = actionsFor(synthWithVoice(), "AuthorizerRole");
    assert.ok(actions.some((a) => a.startsWith("secretsmanager:GetSecretValue")));
    assert.deepEqual(actions.filter((a) => a.startsWith("sqs:")), []);
    assert.deepEqual(actions.filter((a) => a.startsWith("transcribe:")), []);
  });

  test("the signing secret's value never reaches the template", () => {
    const rendered = JSON.stringify(synthWithVoice().toJSON());
    assert.ok(rendered.includes(VOICE_SECRET_ARN), "the ARN is configuration and may appear");
    assert.ok(
      !rendered.includes("{{resolve:secretsmanager"),
      "no dynamic reference, so no secret value is rendered into the Lambda's environment",
    );
  });

  test("neither voice function is placed in the VPC", () => {
    const template = synthWithVoice();
    const inVpc = Object.entries(template.findResources("AWS::Lambda::Function"))
      .filter(([, fn]) => (fn as { Properties: { VpcConfig?: unknown } }).Properties.VpcConfig)
      .map(([id]) => id);
    assert.deepEqual(
      inVpc.filter((id) => id.startsWith("Voice")),
      [],
      "these functions execute no learner code and need public endpoints",
    );
  });
});

/** docs/07 section 9: audio retention is a promise on the consent screen, so
 *  it is enforced by the bucket rather than by anything that could forget. */
describe("learner audio", () => {
  test("the bucket deletes a recording after thirty days", () => {
    const template = synth();
    const buckets = Object.entries(template.findResources("AWS::S3::Bucket"))
      .filter(([id]) => id.startsWith("VoiceAudioBucket"));
    assert.equal(buckets.length, 1);

    const rules = (buckets[0]![1] as {
      Properties: { LifecycleConfiguration: { Rules: Array<Record<string, unknown>> } };
    }).Properties.LifecycleConfiguration.Rules;
    const expiry = rules.find((rule) => rule.ExpirationInDays !== undefined);
    assert.ok(expiry, "the audio bucket expires its objects");
    assert.equal(expiry.ExpirationInDays, 30);
    assert.equal(expiry.Status, "Enabled");
  });

  test("nothing versions a recording, because a deleted one has to be gone", () => {
    const template = synth();
    const [, bucket] = Object.entries(template.findResources("AWS::S3::Bucket"))
      .find(([id]) => id.startsWith("VoiceAudioBucket"))!;
    const props = (bucket as { Properties: Record<string, unknown> }).Properties;
    assert.equal(props.VersioningConfiguration, undefined);
    assert.deepEqual(props.PublicAccessBlockConfiguration, {
      BlockPublicAcls: true, BlockPublicPolicy: true,
      IgnorePublicAcls: true, RestrictPublicBuckets: true,
    });
  });

  test("the audio bucket is not the traces bucket", () => {
    const template = synth();
    const ids = Object.keys(template.findResources("AWS::S3::Bucket"));
    assert.equal(ids.length, 3, "traces, problem bundles, and learner audio");
  });
});
