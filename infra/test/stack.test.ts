/**
 * Assertions over the synthesised template.
 *
 * The first group is the trust boundary from .claude/rules/01: the runner
 * executes learner code and must reach nothing, and the judge calls models and
 * must reach no bucket. Those are IAM and network facts, so they are checked
 * against what the stack actually generates rather than against the code that
 * asked for it. A grant added in the wrong place fails here.
 *
 * Then how work reaches the two functions (docs/05 section 2, amended
 * 30 September 2026): the web host invokes them directly, with no queue
 * between, and holds no model permission itself. Then the deploy: both images
 * are built by `cdk deploy`, from build contexts that hold their own code and
 * nothing else, so a first deploy from a clean account has something to run.
 *
 * Then docs/05 section 6, the three alarms, checked by their numbers: an alarm
 * at the wrong threshold is an alarm nobody reads.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, describe } from "node:test";
import { App } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { FdePrepStack, type FdePrepStackProps } from "../lib/fdeprep-stack.js";

const BASE: FdePrepStackProps = {
  env: { account: "111122223333", region: "us-east-1" },
  judgeModelId: "us.anthropic.claude-opus-5",
};

function synth(extra: Partial<FdePrepStackProps> = {}): Template {
  const app = new App();
  const stack = new FdePrepStack(app, "TestStack", { ...BASE, ...extra });
  return Template.fromStack(stack);
}

/** Every managed policy's statements, keyed by the policy's logical id. */
function managedStatements(template: Template, which: string): Array<Record<string, unknown>> {
  const statements: Array<Record<string, unknown>> = [];
  for (const [id, policy] of Object.entries(template.findResources("AWS::IAM::ManagedPolicy"))) {
    if (!id.startsWith(which)) continue;
    statements.push(...(policy as {
      Properties: { PolicyDocument: { Statement: Array<Record<string, unknown>> } };
    }).Properties.PolicyDocument.Statement);
  }
  return statements;
}

function flatActions(statements: Array<Record<string, unknown>>): string[] {
  return statements.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]) as string[]);
}

/** Every file staged into each Docker image asset, relative to the asset root. */
function stagedAssets(): Array<{ dockerfile: string; files: string[] }> {
  const outdir = mkdtempSync(path.join(tmpdir(), "fdeprep-synth-"));
  const app = new App({ outdir });
  new FdePrepStack(app, "TestStack", BASE);
  const assembly = app.synth();
  const assets: Array<{ dockerfile: string; files: string[] }> = [];
  for (const entry of readdirSync(assembly.directory)) {
    if (!entry.startsWith("asset.")) continue;
    const root = path.join(assembly.directory, entry);
    if (!statSync(root).isDirectory()) continue;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(path.relative(root, full));
      }
    };
    walk(root);
    const dockerfile = files.find((f) => f.startsWith("Dockerfile")) ?? "";
    assets.push({ dockerfile, files: files.sort() });
  }
  return assets;
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
    assert.deepEqual(actions.filter((a) => a.startsWith("bedrock")), [],
      "learner code never reaches a model endpoint, in any phase, for any reason");
  });

  test("the runner holds nothing beyond running in its VPC", () => {
    // It reads no bucket, writes no queue and calls no service. The worker
    // hands it one submission and takes the result from the reply.
    const template = synth();
    assert.deepEqual(actionsFor(template, "RunnerRole"), []);
    const [, role] = Object.entries(template.findResources("AWS::IAM::Role"))
      .find(([id]) => id.startsWith("RunnerRole"))!;
    const managed = JSON.stringify((role as { Properties: { ManagedPolicyArns: unknown } })
      .Properties.ManagedPolicyArns);
    assert.match(managed, /AWSLambdaVPCAccessExecutionRole/);
    assert.equal((managed.match(/arn:/g) ?? []).length, 1, "one managed policy and no other");
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

  test("the runner's network reaches nothing, not even an AWS endpoint", () => {
    // The runner needs no service from inside the VPC: its event arrives in
    // the invocation and its result leaves in the reply, and Lambda ships its
    // logs from outside the VPC.
    const template = synth();
    template.resourceCountIs("AWS::EC2::VPCEndpoint", 0);
    template.resourceCountIs("AWS::EC2::InternetGateway", 0);
  });
});

describe("how work reaches the two functions", () => {
  test("no queue stands between the application and the runner or the judge", () => {
    // The worker calls each function directly and the application's own
    // Postgres queue carries delivery, retries and leases (docs/05 section 2,
    // amended 30 September 2026).
    const template = synth();
    template.resourceCountIs("AWS::SQS::Queue", 0);
    template.resourceCountIs("AWS::Lambda::EventSourceMapping", 0);
  });

  test("the web host may invoke both functions, and holds no model permission", () => {
    const template = synth();
    const statements = managedStatements(template, "BoxPolicy");
    const actions = flatActions(statements);
    assert.ok(actions.includes("lambda:InvokeFunction"));
    assert.deepEqual(actions.filter((a) => a.startsWith("bedrock")), [],
      "the host holds no model credential; the judge function does");
    const invoke = statements.find((s) =>
      flatActions([s]).includes("lambda:InvokeFunction"))!;
    const resources = JSON.stringify(invoke.Resource);
    assert.match(resources, /Runner/);
    assert.match(resources, /Judge/);
  });

  test("the web host writes learner audio and no other bucket", () => {
    const statements = managedStatements(synth(), "BoxPolicy");
    const s3 = statements.filter((s) => flatActions([s]).some((a) => a.startsWith("s3:")));
    assert.equal(s3.length, 1);
    assert.match(JSON.stringify(s3[0]!.Resource), /VoiceAudioBucket/);
  });

  test("the web host gets an instance profile to launch with", () => {
    synth().resourceCountIs("AWS::IAM::InstanceProfile", 1);
  });
});

describe("images and buckets", () => {
  test("both images are built by cdk deploy itself, so a first deploy has something to run", () => {
    const template = synth();
    template.resourceCountIs("AWS::ECR::Repository", 0);
    const functions = Object.values(template.findResources("AWS::Lambda::Function"))
      .map((fn) => (fn as { Properties: Record<string, unknown> }).Properties);
    assert.equal(functions.length, 2);
    for (const props of functions) {
      assert.equal(props.PackageType, "Image");
      assert.match(JSON.stringify(props.Code), /container-assets/,
        "the image comes from the bootstrap asset repository");
    }
  });

  test("each image is built from its own code and nothing else in the repository", () => {
    const assets = stagedAssets();
    const runner = assets.find((a) => a.dockerfile === "Dockerfile")!;
    const judge = assets.find((a) => a.dockerfile === "Dockerfile.judge")!;
    assert.ok(runner && judge, "one asset per image");

    // CDK writes the exclude patterns into the staged context as a
    // .dockerignore, so Docker applies the same list at build time.
    const own = (f: string, ...keep: string[]) => f === ".dockerignore" || keep.includes(f);

    assert.ok(runner.files.includes("requirements.txt"));
    assert.ok(runner.files.includes(path.join("runner", "handler.py")));
    assert.ok(runner.files.every((f) => own(f, "Dockerfile", "requirements.txt") ||
      f.startsWith(`runner${path.sep}`)), `runner context holds: ${runner.files.join(", ")}`);

    assert.ok(judge.files.includes("requirements-judge.txt"));
    assert.ok(judge.files.includes(path.join("judge", "handler.py")));
    assert.ok(judge.files.every((f) => own(f, "Dockerfile.judge", "requirements-judge.txt") ||
      f.startsWith(`judge${path.sep}`)), `judge context holds: ${judge.files.join(", ")}`);

    for (const asset of [runner, judge]) {
      assert.ok(!asset.files.some((f) => f.includes("__pycache__")), "no bytecode in an image");
    }
  });

  test("nothing reserves concurrency unless asked, since a new account cannot spare it", () => {
    const quiet = synth();
    for (const fn of Object.values(quiet.findResources("AWS::Lambda::Function"))) {
      assert.equal((fn as { Properties: Record<string, unknown> }).Properties
        .ReservedConcurrentExecutions, undefined);
    }
    const reserved = synth({ runnerReservedConcurrency: 20, judgeReservedConcurrency: 5 });
    reserved.hasResourceProperties("AWS::Lambda::Function", {
      ReservedConcurrentExecutions: 20, VpcConfig: Match.anyValue(),
    });
    reserved.hasResourceProperties("AWS::Lambda::Function", { ReservedConcurrentExecutions: 5 });
  });

  test("a kept bucket survives deleting the stack but not a failed first deploy", () => {
    // RetainExceptOnCreate: a rollback of the deploy that created it deletes
    // it, so a retry never collides with a leftover, and a stack deletion
    // keeps learner audio until its own lifecycle rule removes it.
    const template = synth();
    for (const bucket of Object.values(template.findResources("AWS::S3::Bucket"))) {
      assert.equal((bucket as { DeletionPolicy?: string }).DeletionPolicy, "RetainExceptOnCreate");
    }
  });

  test("every bucket blocks public access and carries a lifecycle rule", () => {
    const template = synth();
    // The count is asserted in the learner audio suite below; what matters
    // here is that no bucket escapes the two rules, whatever the count.
    const buckets = Object.values(template.findResources("AWS::S3::Bucket"));
    assert.ok(buckets.length >= 1);
    for (const bucket of buckets) {
      const properties = (bucket as { Properties: Record<string, unknown> }).Properties;
      assert.ok(properties.LifecycleConfiguration, "every bucket needs a lifecycle rule");
      assert.deepEqual(properties.PublicAccessBlockConfiguration, {
        BlockPublicAcls: true, BlockPublicPolicy: true,
        IgnorePublicAcls: true, RestrictPublicBuckets: true,
      });
    }
  });

});

describe("the three alarms, at the numbers docs/05 section 6 gives", () => {
  test("there are exactly three", () => {
    // "Three, and no more, because an alarm nobody reads is worse than no alarm."
    synth().resourceCountIs("AWS::CloudWatch::Alarm", 3);
  });

  test("the runner being throttled, which is how waiting work shows up now", () => {
    // With no SQS queue there is no queue age to watch. A submission waits
    // when Lambda refuses the worker's call for want of capacity, and that
    // refusal is the Throttles metric.
    synth().hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Throttles",
      Namespace: "AWS/Lambda",
      Threshold: 0,
      EvaluationPeriods: 1,
      Period: 300,
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
  return synth({ voiceTokenSecretArn: VOICE_SECRET_ARN });
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

  test("learner audio is the only bucket, so a recording cannot land anywhere else", () => {
    // Traces come back in the runner's reply and live in Postgres, and the
    // problem travels in the invocation, so neither needs a bucket.
    synth().resourceCountIs("AWS::S3::Bucket", 1);
  });
});
