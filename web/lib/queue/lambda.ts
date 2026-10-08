/**
 * The deployed road to the runner and the judge: a synchronous Lambda Invoke,
 * signed with the host's own AWS role.
 *
 * The worker used to reach a deployed function by HTTP POST, which only ever
 * worked against the local runtime interface emulator: the stack gives the
 * functions no URL, and an unsigned public URL on the runner would let anyone
 * run code in it. An Invoke is authorised by IAM, so the host's role decides
 * who may call the function, and the reply carries the result back (docs/05
 * section 2, amended 30 September 2026). A trace is capped at 256 KB and a
 * synchronous reply may be 6 MB, so the result always fits.
 *
 * Any failure raises. The workers already turn a raised error into an error
 * verdict, and under docs/03 section 8 an error verdict never spends an
 * attempt, so a timeout, a throttle or a crashed function costs the learner
 * nothing.
 */
import { InvokeCommand, LambdaClient, type InvokeCommandOutput } from "@aws-sdk/client-lambda";

export class LambdaFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LambdaFailed";
  }
}

/** What the workers call. A test passes its own. The signal, when given,
 *  abandons the call: the voice follow-up uses it to stop waiting on a reply
 *  long past its deadline. */
export type Invoker = (
  functionName: string, event: Record<string, unknown>, options?: { abortSignal?: AbortSignal },
) => Promise<Record<string, unknown>>;

/**
 * The one method of LambdaClient this uses, so a test can stand in for it.
 *
 * The second argument is the SDK's HttpHandlerOptions, of which only the
 * abort signal is used. Checked on 8 October 2026 against
 * @aws-sdk/client-lambda 3.1132.0: Client.send(command, options) in
 * @smithy/core 3.34.1, and @smithy/node-http-handler 4.12.1 rejects the
 * request when abortSignal fires.
 */
export interface LambdaSender {
  send(command: InvokeCommand, options?: { abortSignal?: AbortSignal }):
    Promise<Pick<InvokeCommandOutput, "FunctionError" | "Payload">>;
}

/**
 * Longer than the judge's own 300 second ceiling in infra/, so the function
 * times out first and says so, rather than the socket giving up without a
 * reason. A shorter wait would turn a slow judgement into a false failure.
 */
const REQUEST_TIMEOUT_MS = 330_000;
const CONNECTION_TIMEOUT_MS = 5_000;

let shared: LambdaClient | undefined;

function defaultClient(): LambdaClient {
  shared ??= new LambdaClient({
    region: process.env.AWS_REGION,
    requestHandler: {
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      requestTimeout: REQUEST_TIMEOUT_MS,
      throwOnRequestTimeout: true,
    },
  });
  return shared;
}

const decoder = new TextDecoder();

export function lambdaInvoker(client?: LambdaSender): Invoker {
  return async (functionName, event, options) => {
    const sender = client ?? defaultClient();
    const command = new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify(event)),
    });
    const response = options?.abortSignal
      ? await sender.send(command, { abortSignal: options.abortSignal })
      : await sender.send(command);
    const text = response.Payload ? decoder.decode(response.Payload) : "";

    // A function that raised, ran out of time or ran out of memory still
    // answers 200, with FunctionError set and AWS's own account of what went
    // wrong in the payload.
    if (response.FunctionError) {
      throw new LambdaFailed(
        `${functionName} failed (${response.FunctionError}): ${describe(text)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LambdaFailed(`${functionName} replied with something that is not JSON: ` +
                             text.slice(0, 200));
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new LambdaFailed(`${functionName} replied with ${text.slice(0, 200)}, not a result`);
    }
    return parsed as Record<string, unknown>;
  };
}

/** The error message out of AWS's error payload, or the payload itself. */
function describe(text: string): string {
  try {
    const body = JSON.parse(text) as { errorMessage?: string; errorType?: string };
    if (body.errorMessage) {
      return body.errorType ? `${body.errorType}: ${body.errorMessage}` : body.errorMessage;
    }
  } catch {
    // Not JSON, so the raw text is the best account there is.
  }
  return text.slice(0, 500);
}

export const invokeLambda: Invoker = (functionName, event, options) =>
  lambdaInvoker()(functionName, event, options);
