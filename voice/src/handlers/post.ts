/**
 * Sending a message back down a WebSocket the Lambda is not holding.
 *
 * API Gateway keeps the socket; the only way back to the browser is the
 * management API against the connection id. A gone connection answers 410,
 * which is ordinary when a learner closes the tab mid-answer and is not worth
 * failing an invocation over.
 */
import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import type { ServerMessage } from "../../../web/lib/voice/protocol.ts";

const clients = new Map<string, ApiGatewayManagementApiClient>();

function clientFor(endpoint: string): ApiGatewayManagementApiClient {
  let client = clients.get(endpoint);
  if (!client) {
    client = new ApiGatewayManagementApiClient({ endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

/** Returns false when the connection is gone, so a caller streaming into it
 *  can stop rather than keep paying for transcription nobody will read. */
export async function postTo(
  endpoint: string,
  connectionId: string,
  message: ServerMessage,
): Promise<boolean> {
  try {
    await clientFor(endpoint).send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(message)),
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof GoneException) return false;
    throw error;
  }
}
