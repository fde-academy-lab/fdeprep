/**
 * The $connect authorizer.
 *
 * AWS documents that a Lambda authorizer on a WebSocket API attaches to the
 * $connect route and to no other, which suits this design: the token is
 * checked once, at the handshake, and a connection that gets past it is a
 * connection the application minted a token for.
 *
 * This function reaches no database. It verifies an HMAC over claims the
 * application already checked, which is what lets the consent gate and the
 * cap live in the application where the rest of the gates live, rather than
 * being reimplemented in an authorizer that would have to be kept in step.
 */
import { readVoiceToken, TokenRejected } from "../../../web/lib/voice/token.ts";
import type { AuthorizerEvent, AuthorizerResult } from "./events.ts";

function policy(effect: "Allow" | "Deny", resource: string, principalId: string): AuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: "2012-10-17",
      Statement: [{ Action: "execute-api:Invoke", Effect: effect, Resource: resource }],
    },
  };
}

export async function handler(event: AuthorizerEvent): Promise<AuthorizerResult> {
  const secret = process.env.VOICE_TOKEN_SECRET ?? "";
  const token = event.queryStringParameters?.token ?? "";

  try {
    const claims = readVoiceToken(token, secret);
    return {
      ...policy("Allow", event.methodArn, `voice-session-${claims.sid}`),
      // Authorizer context takes strings, numbers and booleans only. These
      // are carried for the handler that writes the session row in a later
      // phase; nothing in the audio path reads them, which is deliberate.
      context: { sid: claims.sid, eid: claims.eid, qid: claims.qid, mode: claims.mode },
    };
  } catch (error) {
    // A denied handshake reaches the browser as a bare 401, so the reason
    // goes to the log rather than to the learner. The application already
    // told them what to do when it refused to mint the token.
    const why = error instanceof TokenRejected ? error.message : "token verification failed";
    console.warn(`voice connect denied: ${why}`);
    return policy("Deny", event.methodArn, "voice-anonymous");
  }
}
