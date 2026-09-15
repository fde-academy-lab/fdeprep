/**
 * $connect, $default and $disconnect.
 *
 * These three invocations are short and hold nothing. The Transcribe stream
 * cannot live here, because API Gateway invokes a Lambda once per message and
 * no invocation spans an answer, so this handler's whole job is to put each
 * frame on the queue the session runner reads. See runner.ts for the half
 * that holds the stream.
 */
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { parseClientMessage, FRAME_LIMIT_BYTES } from "../../../web/lib/voice/protocol.ts";
import { SESSION_CEILING_MS } from "../config.ts";
import type { WebSocketEvent } from "./events.ts";
import { postTo } from "./post.ts";

const sqs = new SQSClient({});

export type FrameMessage =
  | { kind: "audio"; connectionId: string; endpoint: string; seq: number; pcm: string }
  | { kind: "end"; connectionId: string; endpoint: string; reason: "stopped" | "client_gone" };

function endpointOf(event: WebSocketEvent): string {
  const { domainName, stage } = event.requestContext;
  return `https://${domainName}/${stage}`;
}

async function send(message: FrameMessage): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.VOICE_FRAME_QUEUE_URL,
      MessageBody: JSON.stringify(message),
      // One group per connection, so frames of one answer stay in order and
      // two learners never serialise behind each other.
      MessageGroupId: message.connectionId,
      MessageDeduplicationId:
        message.kind === "audio"
          ? `${message.connectionId}:${message.seq}`
          : `${message.connectionId}:end`,
    }),
  );
}

export async function handler(event: WebSocketEvent): Promise<{ statusCode: number }> {
  const { routeKey, connectionId } = event.requestContext;
  const endpoint = endpointOf(event);

  if (routeKey === "$connect") return { statusCode: 200 };

  if (routeKey === "$disconnect") {
    await send({ kind: "end", connectionId, endpoint, reason: "client_gone" });
    return { statusCode: 200 };
  }

  const raw = event.isBase64Encoded && event.body
    ? Buffer.from(event.body, "base64").toString("utf8")
    : (event.body ?? "");

  if (raw.length > FRAME_LIMIT_BYTES) {
    await postTo(endpoint, connectionId, {
      t: "error",
      code: "frame_too_large",
      message:
        `A ${raw.length} byte message exceeds the ${FRAME_LIMIT_BYTES} byte WebSocket frame ` +
        "limit. Send one 100ms frame per message. Nothing was recorded from it.",
    });
    return { statusCode: 200 };
  }

  const message = parseClientMessage(raw);
  if (!message) {
    await postTo(endpoint, connectionId, {
      t: "error",
      code: "bad_message",
      message: "That message is not audio or stop. Nothing was recorded from it.",
    });
    return { statusCode: 200 };
  }

  if (message.t === "stop") {
    await send({ kind: "end", connectionId, endpoint, reason: "stopped" });
    return { statusCode: 200 };
  }

  // Best effort, because connectedAt is documented on $connect and I could
  // not confirm it on $default. When it is missing the ceiling is API
  // Gateway's own 7,200 seconds, which is a backstop rather than this
  // application's answer.
  const connectedAt = event.requestContext.connectedAt;
  if (typeof connectedAt === "number" && Date.now() - connectedAt >= SESSION_CEILING_MS) {
    await send({ kind: "end", connectionId, endpoint, reason: "stopped" });
    return { statusCode: 200 };
  }

  await send({ kind: "audio", connectionId, endpoint, seq: message.seq, pcm: message.pcm });
  return { statusCode: 200 };
}
