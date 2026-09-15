/**
 * The FDE Prep stack, from docs/05 section 4.
 *
 * One stack: two SQS queues plus two dead letter queues, two Lambda functions,
 * two S3 buckets with lifecycle policies, one VPC with two private subnets and
 * no NAT gateway, VPC endpoints for S3 and SQS, IAM roles, CloudWatch alarms,
 * one ECR repository for the runner image.
 *
 * The two roles never merge, which is the control the whole security model
 * rests on. The runner executes learner code and has no Bedrock permission and
 * no database credential. The judge calls Bedrock and executes nothing. Neither
 * grant is written in a way that could widen by accident: the runner's policy
 * names no Bedrock action at all, and a test asserts it.
 */
import {
  Aspects, CfnOutput, Duration, RemovalPolicy, Stack, StackProps, Tags,
} from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as eventsources from "aws-cdk-lib/aws-lambda-event-sources";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as cwactions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { VoiceSocket } from "./voice-socket.js";

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
  /** Tag on the runner image to deploy. The deploy workflow moves this. */
  readonly runnerImageTag?: string;
  readonly judgeImageTag?: string;
  /**
   * Secrets Manager ARN of the voice session token signing key. When it is
   * absent the voice socket is not created at all, which is what keeps this
   * stack deployable before the Voice Screen is configured.
   */
  readonly voiceTokenSecretArn?: string;
}

/** docs/05 section 6. Three, and no more, because an alarm nobody reads is worse than no alarm. */
const QUEUE_AGE_ALARM_SECONDS = 120;
const QUEUE_AGE_ALARM_PERIODS = 5;
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
  readonly submissionsQueue: sqs.Queue;
  readonly judgementsQueue: sqs.Queue;
  readonly resultsQueue: sqs.Queue;
  readonly runner: lambda.Function;
  readonly judge: lambda.Function;
  readonly tracesBucket: s3.Bucket;
  readonly bundlesBucket: s3.Bucket;
  readonly runnerRepository: ecr.Repository;
  readonly voice?: VoiceSocket;
  readonly voiceAudioBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: FdePrepStackProps) {
    super(scope, id, props);

    Tags.of(this).add("application", "fdeprep");

    /* ------------------------------------------------------------ network */

    // No NAT gateway, deliberately. docs/05 section 4: "It removes the largest
    // fixed line on the AWS bill and it removes the runner's route to the
    // internet in one move." The runner reaches S3 and SQS through endpoints
    // and can reach nothing else, which is what makes the trust boundary real
    // rather than a matter of the runner's code behaving.
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{
        name: "private",
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        cidrMask: 24,
      }],
    });

    vpc.addGatewayEndpoint("S3Endpoint", { service: ec2.GatewayVpcEndpointAwsService.S3 });
    vpc.addInterfaceEndpoint("SqsEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.SQS,
      privateDnsEnabled: true,
    });

    /* ------------------------------------------------------------- queues */

    // docs/05 section 2: SQS standard, with a dead letter queue after three
    // receives, so submissions survive a runner failure instead of vanishing.
    const { queue: submissionsQueue, dlq: submissionsDlq } =
      this.queueWithDlq("Submissions", RUNNER_TIMEOUT_SECONDS);
    const { queue: judgementsQueue, dlq: judgementsDlq } =
      this.queueWithDlq("Judgements", JUDGE_TIMEOUT_SECONDS);
    const resultsQueue = new sqs.Queue(this, "ResultsQueue", {
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
      visibilityTimeout: Duration.seconds(60),
    });

    this.submissionsQueue = submissionsQueue;
    this.judgementsQueue = judgementsQueue;
    this.resultsQueue = resultsQueue;

    /* ------------------------------------------------------------ buckets */

    // Traces are the only large object and lifecycle rules handle them.
    this.tracesBucket = new s3.Bucket(this, "TracesBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{
        id: "age-out-traces",
        enabled: true,
        transitions: [{
          storageClass: s3.StorageClass.INFREQUENT_ACCESS,
          transitionAfter: Duration.days(30),
        }],
        expiration: Duration.days(180),
        abortIncompleteMultipartUploadAfter: Duration.days(7),
      }],
    });

    this.bundlesBucket = new s3.Bucket(this, "ProblemBundlesBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      // A problem bundle a submission ran against has to stay readable for as
      // long as that submission's result is meaningful, so old versions are
      // kept rather than expired.
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{
        id: "age-out-old-bundle-versions",
        enabled: true,
        noncurrentVersionExpiration: Duration.days(365),
        abortIncompleteMultipartUploadAfter: Duration.days(7),
      }],
    });

    /* --------------------------------------------------------------- ecr */

    this.runnerRepository = new ecr.Repository(this, "RunnerRepository", {
      repositoryName: "fdeprep-runner",
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ maxImageCount: 20, description: "Keep the last twenty images" }],
    });

    /* ------------------------------------------------------------ lambdas */

    const runnerRole = new iam.Role(this, "RunnerRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description:
        "Runs learner code. No Bedrock, no database. Reads problem bundles and writes traces.",
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

    this.runner = new lambda.Function(this, "Runner", {
      runtime: lambda.Runtime.FROM_IMAGE,
      handler: lambda.Handler.FROM_IMAGE,
      code: lambda.Code.fromEcrImage(this.runnerRepository, {
        tagOrDigest: props.runnerImageTag ?? "latest",
      }),
      role: runnerRole,
      memorySize: RUNNER_MEMORY_MB,
      timeout: Duration.seconds(RUNNER_TIMEOUT_SECONDS),
      // In the VPC with no internet route. This is the control, not the code.
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      environment: {
        TRACES_BUCKET: this.tracesBucket.bucketName,
        BUNDLES_BUCKET: this.bundlesBucket.bucketName,
        RESULTS_QUEUE_URL: resultsQueue.queueUrl,
      },
      reservedConcurrentExecutions: 50,
    });

    this.judge = new lambda.Function(this, "Judge", {
      runtime: lambda.Runtime.FROM_IMAGE,
      handler: lambda.Handler.FROM_IMAGE,
      code: lambda.Code.fromEcrImage(this.runnerRepository, {
        tagOrDigest: props.judgeImageTag ?? "judge-latest",
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
        RESULTS_QUEUE_URL: resultsQueue.queueUrl,
      },
      reservedConcurrentExecutions: 20,
    });

    /* --------------------------------------------------------------- iam */

    // The runner: read bundles, write traces, send results, receive its own
    // queue. Nothing else, and nothing that reaches a model.
    this.bundlesBucket.grantRead(runnerRole);
    this.tracesBucket.grantPut(runnerRole);
    resultsQueue.grantSendMessages(runnerRole);
    submissionsQueue.grantConsumeMessages(runnerRole);

    // The judge: its own queue, the results queue, and one model.
    judgementsQueue.grantConsumeMessages(judgeRole);
    resultsQueue.grantSendMessages(judgeRole);
    judgeRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      // Scoped to the configured model and its foundation model, because an
      // inference profile call authorises against both.
      resources: [
        `arn:aws:bedrock:*:${this.account}:inference-profile/${props.judgeModelId}`,
        "arn:aws:bedrock:*::foundation-model/*",
      ],
    }));

    this.runner.addEventSource(new eventsources.SqsEventSource(submissionsQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));
    this.judge.addEventSource(new eventsources.SqsEventSource(judgementsQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));

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

    // 1. Queue backing up: ApproximateAgeOfOldestMessage over 120 seconds for
    //    5 minutes.
    const queueAge = new cloudwatch.Alarm(this, "QueueBackingUpAlarm", {
      alarmName: `${this.stackName}-queue-backing-up`,
      alarmDescription:
        "Submissions are waiting. Check the runner error rate, then the Lambda concurrency limit.",
      metric: submissionsQueue.metricApproximateAgeOfOldestMessage({
        period: Duration.minutes(1),
        statistic: "Maximum",
      }),
      threshold: QUEUE_AGE_ALARM_SECONDS,
      evaluationPeriods: QUEUE_AGE_ALARM_PERIODS,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    queueAge.addAlarmAction(action);

    // 2. Runner failing: error rate over 5 percent over 15 minutes. A rate
    //    rather than a count, so a quiet night with two errors does not page
    //    and a busy night with fifty in a thousand does.
    const runnerErrorRate = new cloudwatch.Alarm(this, "RunnerFailingAlarm", {
      alarmName: `${this.stackName}-runner-failing`,
      alarmDescription:
        "Read the last runner_event rows, then roll the runner image tag back.",
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

    new CfnOutput(this, "SubmissionsQueueUrl", { value: submissionsQueue.queueUrl });
    new CfnOutput(this, "JudgementsQueueUrl", { value: judgementsQueue.queueUrl });
    new CfnOutput(this, "ResultsQueueUrl", { value: resultsQueue.queueUrl });
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
     */
    this.voiceAudioBucket = new s3.Bucket(this, "VoiceAudioBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{
        id: "delete-learner-audio-after-30-days",
        enabled: true,
        expiration: Duration.days(VOICE_AUDIO_RETENTION_DAYS),
        abortIncompleteMultipartUploadAfter: Duration.days(1),
      }],
    });

    new CfnOutput(this, "VoiceAudioBucketName", { value: this.voiceAudioBucket.bucketName });
    new CfnOutput(this, "TracesBucketName", { value: this.tracesBucket.bucketName });
    new CfnOutput(this, "BundlesBucketName", { value: this.bundlesBucket.bucketName });
    new CfnOutput(this, "RunnerRepositoryUri", { value: this.runnerRepository.repositoryUri });
    new CfnOutput(this, "RunnerFunctionName", { value: this.runner.functionName });
    new CfnOutput(this, "JudgeFunctionName", { value: this.judge.functionName });
    new CfnOutput(this, "SubmissionsDlqUrl", { value: submissionsDlq.queueUrl });
    new CfnOutput(this, "JudgementsDlqUrl", { value: judgementsDlq.queueUrl });

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

  /** A queue and its dead letter queue, with the visibility timeout the consumer needs. */
  private queueWithDlq(name: string, consumerTimeoutSeconds: number) {
    const dlq = new sqs.Queue(this, `${name}Dlq`, {
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });
    const queue = new sqs.Queue(this, `${name}Queue`, {
      // Six times the consumer's own timeout, which is the margin AWS
      // recommends for a Lambda consumer and stops a slow run being delivered
      // twice while the first is still going.
      visibilityTimeout: Duration.seconds(consumerTimeoutSeconds * 6),
      retentionPeriod: Duration.days(4),
      enforceSSL: true,
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });
    return { queue, dlq };
  }
}
