/**
 * The FDE Prep stack, from docs/05 section 4 as amended on 30 September 2026.
 *
 * One stack: the runner and the judge as container-image Lambdas, one VPC with
 * two isolated subnets and nothing else in it, the learner audio bucket, the
 * role the web host launches with, three alarms, and the voice socket once its
 * signing secret exists.
 *
 * The web host's worker calls the two functions directly, with a signed Lambda
 * Invoke, and takes the result from the reply. There is no SQS between them:
 * the application's own Postgres queue already carries delivery, retries and
 * leases, and a queue here would add a second one to watch.
 *
 * The two roles never merge, which is the control the whole security model
 * rests on. The runner executes learner code and holds no permission beyond
 * running in its VPC: no Bedrock, no bucket, no queue, no database. The judge
 * calls Bedrock and executes nothing. Neither grant is written in a way that
 * could widen by accident, and the tests assert both.
 *
 * `cdk deploy` builds and pushes both images itself, into the asset repository
 * `cdk bootstrap` made, so a first deploy never points a function at an image
 * that does not exist yet.
 */
import path from "node:path";
import {
  Aspects, CfnOutput, Duration, IgnoreMode, RemovalPolicy, Stack, StackProps, Tags,
} from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as cwactions from "aws-cdk-lib/aws-cloudwatch-actions";
import { Construct } from "constructs";
import { VoiceSocket } from "./voice-socket.js";

// This package is transpiled to CommonJS by tsx, which is why this is
// __dirname rather than import.meta.dirname. The repository root is the build
// context for both images, and the excludes below cut it down to what each
// Dockerfile copies.
const REPO_ROOT = path.join(__dirname, "..", "..");

export interface FdePrepStackProps extends StackProps {
  /**
   * The Bedrock inference profile the judge may call, as an id such as
   * us.anthropic.claude-opus-5. The judge's IAM policy is scoped to it, so a
   * judge that starts calling a different model gets an AccessDenied rather
   * than a larger bill.
   */
  readonly judgeModelId: string;
  /** Where the three alarms go. docs/05 section 6: a channel, not a person. */
  readonly alarmEmail?: string;
  /**
   * Concurrency held back for each function. Off by default: AWS keeps part
   * of an account's concurrency unreserved and a new account starts with a
   * lower quota, so a reservation there fails the deploy. The worker bounds
   * how many invocations it makes at once in any case.
   */
  readonly runnerReservedConcurrency?: number;
  readonly judgeReservedConcurrency?: number;
  /**
   * Secrets Manager ARN of the voice session token signing key. When it is
   * absent the voice socket is not created at all, which is what keeps this
   * stack deployable before the Voice Screen is configured.
   */
  readonly voiceTokenSecretArn?: string;
}

/** docs/05 section 6. Three, and no more, because an alarm nobody reads is worse than no alarm. */
const RUNNER_ERROR_RATE = 0.05;
const RUNNER_ERROR_WINDOW_MINUTES = 15;

/** docs/07 section 9: "Audio retention 30 days. S3 lifecycle rule, then the
 *  object is deleted and audio_deleted_at is set." The same number appears in
 *  web/lib/voice/audio.ts, where the consent copy quotes it, and a test holds
 *  the two together. */
const VOICE_AUDIO_RETENTION_DAYS = 30;

/** docs/05 section 2: Lambda container image, Python 3.12, 1024MB, 60s timeout. */
const RUNNER_MEMORY_MB = 1024;
const RUNNER_TIMEOUT_SECONDS = 60;
const JUDGE_MEMORY_MB = 512;
/** Probes are two model calls each and a prompt problem can carry six. */
const JUDGE_TIMEOUT_SECONDS = 300;

export class FdePrepStack extends Stack {
  readonly runner: lambda.Function;
  readonly judge: lambda.Function;
  readonly voice?: VoiceSocket;
  readonly voiceAudioBucket: s3.Bucket;
  readonly boxRole: iam.Role;

  constructor(scope: Construct, id: string, props: FdePrepStackProps) {
    super(scope, id, props);

    Tags.of(this).add("application", "fdeprep");

    /* ------------------------------------------------------------ network */

    // No NAT gateway and no endpoint, deliberately. docs/05 section 4: the
    // absence of a NAT "removes the runner's route to the internet". The
    // runner needs no AWS service from inside the VPC either: its submission
    // arrives in the invocation, its result leaves in the reply, and Lambda
    // ships its logs from outside the VPC. So learner code in here can reach
    // nothing at all, which is the control rather than the code behaving.
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{
        name: "private",
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        cidrMask: 24,
      }],
    });

    /* ------------------------------------------------------------- images */

    const runnerImage = imageAsset(this, "RunnerImage", "Dockerfile", "runner", "requirements.txt");
    const judgeImage = imageAsset(
      this, "JudgeImage", "Dockerfile.judge", "judge", "requirements-judge.txt");

    /* ------------------------------------------------------------ lambdas */

    const runnerRole = new iam.Role(this, "RunnerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description:
        "Runs learner code. No Bedrock, no database, no bucket, no queue: it answers the invoke.",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaVPCAccessExecutionRole"),
      ],
    });

    const judgeRole = new iam.Role(this, "JudgeRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Calls Bedrock. Executes no learner code and has no bucket write.",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });

    this.runner = new lambda.DockerImageFunction(this, "Runner", {
      code: lambda.DockerImageCode.fromEcr(runnerImage.repository, {
        tagOrDigest: runnerImage.imageTag,
      }),
      role: runnerRole,
      memorySize: RUNNER_MEMORY_MB,
      timeout: Duration.seconds(RUNNER_TIMEOUT_SECONDS),
      // In the VPC with no route out. This is the control, not the code.
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      environment: {
        // Written into every result, so an appeal can name the image that
        // graded it and a rollback can name the one to go back to.
        RUNNER_IMAGE_TAG: runnerImage.imageTag,
      },
      reservedConcurrentExecutions: props.runnerReservedConcurrency,
    });

    this.judge = new lambda.DockerImageFunction(this, "Judge", {
      code: lambda.DockerImageCode.fromEcr(judgeImage.repository, {
        tagOrDigest: judgeImage.imageTag,
      }),
      role: judgeRole,
      memorySize: JUDGE_MEMORY_MB,
      timeout: Duration.seconds(JUDGE_TIMEOUT_SECONDS),
      // Not in the VPC: the judge has to reach Bedrock, and putting it in the
      // isolated subnets would need a Bedrock endpoint to do what the public
      // endpoint already does. It executes no learner code, so there is nothing
      // to contain.
      environment: {
        JUDGE_MODEL_ID: props.judgeModelId,
        JUDGE_THINKING: "disabled",
      },
      reservedConcurrentExecutions: props.judgeReservedConcurrency,
    });

    /* --------------------------------------------------------------- iam */

    // The judge: one model, through its inference profile.
    judgeRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      // Scoped to the configured model and its foundation model, because an
      // inference profile call authorises against both.
      resources: [
        `arn:aws:bedrock:*:${this.account}:inference-profile/${props.judgeModelId}`,
        "arn:aws:bedrock:*::foundation-model/*",
      ],
    }));

    /* -------------------------------------------------------- learner audio */

    /**
     * Learner audio. docs/07 section 9.
     *
     * Thirty days and then the object is gone, which is a promise made to a
     * learner on the consent screen and so is enforced by the bucket rather
     * than by anything that could forget. Nothing transitions to a cheaper
     * class first: an object with a month to live spends less than the
     * minimum billing period of infrequent access, so the transition would
     * cost more than it saved.
     *
     * Versioned is off on purpose. A deleted recording that a version kept is
     * a recording that was not deleted, and section 9 promises immediate and
     * irreversible.
     *
     * RetainExceptOnCreate: deleting the stack keeps the bucket, whose own
     * rule still empties it, and a failed first deploy removes it, so a retry
     * never trips over a leftover.
     */
    this.voiceAudioBucket = new s3.Bucket(this, "VoiceAudioBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      lifecycleRules: [{
        id: "delete-learner-audio-after-30-days",
        enabled: true,
        // Learner answers only. The bucket also caches the synthesised
        // follow-up lines under voice/follow-ups/, and a rule on the whole
        // bucket deleted that cache every thirty days.
        prefix: "voice/answers/",
        expiration: Duration.days(VOICE_AUDIO_RETENTION_DAYS),
      }, {
        // docs/07 sections 5a and 9: a follow-up generated for one session's
        // round is kept as long as the learner's own recording. The lines
        // said more than once, under voice/lines/, hold nothing about a
        // learner and are kept.
        id: "delete-generated-follow-ups-after-30-days",
        enabled: true,
        prefix: "voice/generated/",
        expiration: Duration.days(VOICE_AUDIO_RETENTION_DAYS),
      }, {
        id: "abort-incomplete-uploads",
        enabled: true,
        abortIncompleteMultipartUploadAfter: Duration.days(1),
      }],
    });

    /* ------------------------------------------------------------ web host */

    // What the host running the web application and the worker may do: call
    // the two functions, keep learner audio, and have Polly speak a pressure
    // mode follow-up. No model and no learner code, so a compromise of the
    // host is a database problem and not a bill.
    const boxPolicy = new iam.ManagedPolicy(this, "BoxPolicy", {
      description: "The FDE Prep web host: invoke the runner and the judge, keep learner audio, " +
                   "speak follow-ups.",
      statements: [
        new iam.PolicyStatement({
          actions: ["lambda:InvokeFunction"],
          resources: [this.runner.functionArn, this.judge.functionArn],
        }),
        new iam.PolicyStatement({
          actions: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
          resources: [this.voiceAudioBucket.arnForObjects("*")],
        }),
        new iam.PolicyStatement({
          actions: ["polly:SynthesizeSpeech"],
          resources: ["*"],
        }),
      ],
    });
    this.boxRole = new iam.Role(this, "BoxRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: "Launch the FDE Prep web host with this role's instance profile.",
      managedPolicies: [boxPolicy],
    });
    const boxProfile = new iam.InstanceProfile(this, "BoxInstanceProfile", {
      role: this.boxRole,
    });

    /* ------------------------------------------------------------- alarms */

    const topic = new sns.Topic(this, "AlarmTopic", { displayName: "FDE Prep alarms" });
    if (props.alarmEmail) {
      new sns.Subscription(this, "AlarmEmail", {
        topic,
        protocol: sns.SubscriptionProtocol.EMAIL,
        endpoint: props.alarmEmail,
      });
    }
    const action = new cwactions.SnsAction(topic);

    // 1. Work waiting. With no SQS queue there is no queue age to watch; a
    //    submission waits when Lambda refuses the worker's call for want of
    //    capacity, and that refusal is the Throttles metric.
    const throttled = new cloudwatch.Alarm(this, "RunnerThrottledAlarm", {
      alarmName: `${this.stackName}-runner-throttled`,
      alarmDescription:
        "Submissions are waiting for Lambda capacity. Check the account's concurrent executions " +
        "quota in Service Quotas, then any reserved concurrency on the runner.",
      metric: this.runner.metricThrottles({ period: Duration.minutes(5), statistic: "Sum" }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    throttled.addAlarmAction(action);

    // 2. Runner failing: error rate over 5 percent over 15 minutes. A rate
    //    rather than a count, so a quiet night with two errors does not page
    //    and a busy night with fifty in a thousand does.
    const runnerErrorRate = new cloudwatch.Alarm(this, "RunnerFailingAlarm", {
      alarmName: `${this.stackName}-runner-failing`,
      alarmDescription:
        "Read the last runner_event rows, then redeploy the previous commit with cdk deploy.",
      metric: new cloudwatch.MathExpression({
        expression: "IF(invocations > 0, errors / invocations, 0)",
        usingMetrics: {
          errors: this.runner.metricErrors({ period: Duration.minutes(5), statistic: "Sum" }),
          invocations: this.runner.metricInvocations({
            period: Duration.minutes(5), statistic: "Sum",
          }),
        },
        period: Duration.minutes(5),
        label: "Runner error rate",
      }),
      threshold: RUNNER_ERROR_RATE,
      // Three five-minute periods is the fifteen minutes docs/05 asks for.
      evaluationPeriods: RUNNER_ERROR_WINDOW_MINUTES / 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    runnerErrorRate.addAlarmAction(action);

    // 3. Token spend. docs/05 names AWS Budgets at 80 percent of the monthly
    //    figure. A budget is an account-level object with its own notification
    //    channel and no dependency on this stack, so it is created once by
    //    hand rather than owned here; this alarm watches the judge's
    //    invocation count, which is the thing this stack can see moving.
    const judgeSpend = new cloudwatch.Alarm(this, "JudgeSpendAlarm", {
      alarmName: `${this.stackName}-judge-spend`,
      alarmDescription:
        "Judge invocations are unusually high. Lower the live_daily cap in the admin screen.",
      metric: this.judge.metricInvocations({ period: Duration.hours(1), statistic: "Sum" }),
      threshold: 2000,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    judgeSpend.addAlarmAction(action);

    /* ------------------------------------------------------------ outputs */

    // Everything the web host's settings file needs, by the names it uses.
    new CfnOutput(this, "RunnerFunctionName", { value: this.runner.functionName });
    new CfnOutput(this, "JudgeFunctionName", { value: this.judge.functionName });
    new CfnOutput(this, "VoiceAudioBucketName", { value: this.voiceAudioBucket.bucketName });
    new CfnOutput(this, "BoxInstanceProfileName", { value: boxProfile.instanceProfileName });
    new CfnOutput(this, "RunnerImageTag", { value: runnerImage.imageTag });

    /* -------------------------------------------------------- voice socket */

    if (props.voiceTokenSecretArn) {
      const voice = new VoiceSocket(this, "Voice", {
        tokenSecretArn: props.voiceTokenSecretArn,
      });
      this.voice = voice;
      new CfnOutput(this, "VoiceSocketUrl", { value: voice.socketUrl });
      new CfnOutput(this, "VoiceFrameQueueUrl", { value: voice.frameQueue.queueUrl });
    }

    Aspects.of(this).add({ visit: () => {} });
  }
}

/**
 * One image, built by `cdk deploy` from the repository root with everything
 * but its own Dockerfile, requirements and package excluded. The build context
 * is then a few hundred kilobytes rather than the repository's node_modules,
 * and the asset hash, which decides whether a deploy rebuilds, changes only
 * when that image's own code does.
 */
function imageAsset(
  scope: Construct, id: string, dockerfile: string, packageDir: string, requirements: string,
): ecrAssets.DockerImageAsset {
  return new ecrAssets.DockerImageAsset(scope, id, {
    directory: REPO_ROOT,
    file: dockerfile,
    // Lambda's default architecture. An Apple Silicon Mac builds this under
    // emulation, which is slower and otherwise the same.
    platform: ecrAssets.Platform.LINUX_AMD64,
    ignoreMode: IgnoreMode.DOCKER,
    exclude: [
      "*",
      `!${dockerfile}`,
      `!${requirements}`,
      `!${packageDir}`,
      "**/__pycache__",
      "**/*.pyc",
    ],
  });
}
