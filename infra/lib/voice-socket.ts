/**
 * The voice session endpoint. docs/07 section 7.
 *
 * "Vercel's serverless functions are a poor fit for a long bidirectional
 * socket, so this endpoint is separate infrastructure: API Gateway WebSocket
 * API in front of a Lambda, on the same AWS account as the runner."
 *
 * The shape that follows from that, and the reason there are two functions
 * rather than one: API Gateway invokes a Lambda once per message, and no
 * invocation spans an answer, so nothing here can hold an Amazon Transcribe
 * stream open across frames. The socket function puts each frame on a FIFO
 * queue and the runner function drains a batch of them through one Transcribe
 * stream, presenting the same SessionId every time so the service resumes
 * that transcription instead of starting cold.
 *
 * API Gateway WebSocket quotas verified 2026-09-15 against the AWS General
 * Reference, all four not adjustable:
 *
 *   idle connection timeout        600 seconds
 *   connection duration            7,200 seconds
 *   frame size                     32 KB
 *   message payload size           128 KB
 *
 * The application's own ceilings are set under those in voice/src/config.ts.
 *
 * The trust boundary from .claude/rules/01-trust-boundaries.md holds here as
 * everywhere: neither function executes learner code, neither has a Bedrock
 * grant, and the code-execution runner has no speech grant. Tests assert all
 * three rather than trusting the reading.
 */
import { Duration, Stack } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { WebSocketLambdaAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { WebSocketLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as eventsources from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import path from "node:path";

// This package is transpiled to CommonJS by tsx, which is why the imports
// above end in .js and this is __dirname rather than import.meta.dirname.
const VOICE_ROOT = path.join(__dirname, "..", "..", "voice");
const VOICE_SRC = path.join(VOICE_ROOT, "src");

/** Short: a handshake and a queue write, nothing else. */
const SOCKET_TIMEOUT_SECONDS = 10;

/** One batch of frames through one Transcribe stream. Generous against a slow
 *  stream open, still far under the fifteen minute Lambda ceiling. */
const RUNNER_TIMEOUT_SECONDS = 120;

/**
 * Frames per runner invocation.
 *
 * SQS refuses a batching window on a FIFO queue, so there is no dial here for
 * how long frames gather. What regulates it instead is FIFO's own rule that
 * one batch per message group is in flight at a time: the next batch of an
 * answer cannot start until the previous invocation returns, so frames pile
 * up for exactly as long as the last invocation took and the batch size
 * follows the arrival rate on its own. At ten frames a second and an
 * invocation of a few hundred milliseconds that settles around half a second
 * of audio per stream.
 *
 * Ten is the ceiling Lambda allows for a FIFO source.
 */
const BATCH_SIZE = 10;

export interface VoiceSocketProps {
  /**
   * Secrets Manager secret holding the token signing key, created outside
   * this stack so that rotating it is not a stack update and so its value
   * never appears in a template. The application signs with it and the
   * authorizer verifies with it.
   */
  readonly tokenSecretArn: string;
  readonly language?: string;
  /** Off by default: Amazon Transcribe's documentation says stabilization
   *  "may impact accuracy", and the final transcript is what gets scored. */
  readonly stabilizePartials?: boolean;
}

export class VoiceSocket extends Construct {
  readonly api: apigwv2.WebSocketApi;
  readonly stage: apigwv2.WebSocketStage;
  readonly frameQueue: sqs.Queue;
  readonly frameDlq: sqs.Queue;
  readonly socketFunction: lambda.Function;
  readonly runnerFunction: lambda.Function;
  readonly authorizerFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: VoiceSocketProps) {
    super(scope, id);

    const secret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "TokenSecret",
      props.tokenSecretArn,
    );

    /* -------------------------------------------------------------- queue */

    this.frameDlq = new sqs.Queue(this, "FrameDlq", {
      fifo: true,
      retentionPeriod: Duration.days(4),
      enforceSSL: true,
    });

    this.frameQueue = new sqs.Queue(this, "FrameQueue", {
      fifo: true,
      // The socket function supplies its own deduplication id per frame, so
      // content-based deduplication would only hash the same thing again.
      contentBasedDeduplication: false,
      // Audio the runner has not reached in a minute is audio from an answer
      // that has moved on. Keeping it longer would replay stale speech into a
      // live transcription.
      retentionPeriod: Duration.minutes(1),
      visibilityTimeout: Duration.seconds(RUNNER_TIMEOUT_SECONDS * 6),
      enforceSSL: true,
      deadLetterQueue: { queue: this.frameDlq, maxReceiveCount: 3 },
    });

    /* ------------------------------------------------------------- roles */

    const authorizerRole = this.lambdaRole("AuthorizerRole");
    const socketRole = this.lambdaRole("SocketRole");
    // Named StreamRole rather than VoiceRunnerRole so that no assertion
    // matching "RunnerRole" ever sweeps up the speech role by accident. The
    // Lambda that executes learner code is the runner; this one transcribes.
    const runnerRole = this.lambdaRole("StreamRole");

    secret.grantRead(authorizerRole);

    /* --------------------------------------------------------- functions */

    this.authorizerFunction = this.fn("Authorizer", "handlers/authorizer.ts", authorizerRole, {
      VOICE_TOKEN_SECRET_ARN: props.tokenSecretArn,
    }, SOCKET_TIMEOUT_SECONDS);

    this.socketFunction = this.fn("Socket", "handlers/socket.ts", socketRole, {
      VOICE_FRAME_QUEUE_URL: this.frameQueue.queueUrl,
    }, SOCKET_TIMEOUT_SECONDS);

    this.runnerFunction = this.fn("Runner", "handlers/runner.ts", runnerRole, {
      VOICE_STT: "transcribe",
      VOICE_LANGUAGE: props.language ?? "en-US",
      VOICE_STABILIZE_PARTIALS: props.stabilizePartials ? "1" : "0",
    }, RUNNER_TIMEOUT_SECONDS);

    this.frameQueue.grantSendMessages(socketRole);
    this.frameQueue.grantConsumeMessages(runnerRole);

    // The only speech grant in the account, and it names one action. The
    // Lambda that executes learner code has none.
    runnerRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["transcribe:StartStreamTranscription"],
        resources: ["*"],
      }),
    );

    this.runnerFunction.addEventSource(
      new eventsources.SqsEventSource(this.frameQueue, {
        batchSize: BATCH_SIZE,
        reportBatchItemFailures: true,
      }),
    );

    /* ------------------------------------------------------------ the api */

    this.api = new apigwv2.WebSocketApi(this, "Api", {
      apiName: `${Stack.of(this).stackName}-voice`,
      description: "Voice session socket. docs/07 section 7.",
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration("ConnectIntegration", this.socketFunction),
        // AWS documents that a WebSocket Lambda authorizer attaches to
        // $connect and to no other route, which is why the token is checked
        // once at the handshake and the audio path carries no claims.
        authorizer: new WebSocketLambdaAuthorizer("TokenAuthorizer", this.authorizerFunction, {
          identitySource: ["route.request.querystring.token"],
        }),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration("DisconnectIntegration", this.socketFunction),
      },
      defaultRouteOptions: {
        // Not "Default": CDK drops a path segment with that name when it
        // builds a logical id, so the integration would collide with the
        // route that contains it and the synth fails on a duplicate resource.
        integration: new WebSocketLambdaIntegration("FrameIntegration", this.socketFunction),
      },
    });

    this.stage = new apigwv2.WebSocketStage(this, "Stage", {
      webSocketApi: this.api,
      stageName: "live",
      autoDeploy: true,
    });

    // Posting a partial back down the socket is an execute-api call against
    // the connection, not a return value, because the function that holds the
    // transcript is not the one API Gateway is waiting on.
    this.api.grantManageConnections(socketRole);
    this.api.grantManageConnections(runnerRole);
  }

  /** The socket URL the application hands the browser. */
  get socketUrl(): string {
    return this.stage.url;
  }

  private lambdaRole(id: string): iam.Role {
    return new iam.Role(this, id, {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });
  }

  private fn(
    id: string,
    entry: string,
    role: iam.Role,
    environment: Record<string, string>,
    timeoutSeconds: number,
  ): NodejsFunction {
    return new NodejsFunction(this, id, {
      entry: path.join(VOICE_SRC, entry),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(timeoutSeconds),
      role,
      environment,
      // The handlers live in voice/, not here, so the bundler's root moves
      // there: NodejsFunction refuses an entry outside its project root, and
      // esbuild has to run somewhere it can resolve. The two shared modules
      // under web/lib/voice are followed as ordinary imports and land in the
      // same bundle.
      projectRoot: VOICE_ROOT,
      depsLockFilePath: path.join(VOICE_ROOT, "package-lock.json"),
      bundling: {
        format: OutputFormat.ESM,
        target: "node22",
        minify: false,
        sourceMap: true,
      },
      // No VPC. These functions execute no learner code and need Amazon
      // Transcribe and execute-api, both of which are public endpoints; the
      // isolated subnets would need two more interface endpoints to reach
      // what the internet already serves.
    });
  }
}
