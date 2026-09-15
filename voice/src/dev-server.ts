/**
 * The development socket.
 *
 * API Gateway is not something a session can stand up, and the capture
 * pipeline needs a real socket to prove anything against. This runs the same
 * VoiceSession, the same protocol and the same adapter behind a plain ws
 * server, so a browser at a microphone exercises everything except the AWS
 * transport itself.
 *
 * What it does not prove: the authorizer, the queue hop, and the fact that
 * the Lambda path opens one Transcribe stream per batch rather than one per
 * answer. Those need a deploy.
 *
 *   VOICE_TOKEN_SECRET=dev npm run dev -w voice
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { readVoiceToken, TokenRejected } from "../../web/lib/voice/token.ts";
import { loadConfig } from "./config.ts";
import { sttSessionIdFor } from "./ids.ts";
import { adapterFor } from "./stt/index.ts";
import { VoiceSession } from "./session.ts";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.VOICE_DEV_PORT ?? 8787);
const TICK_MS = 1_000;

export function startDevServer(port: number = PORT) {
  const config = loadConfig();
  const secret = process.env.VOICE_TOKEN_SECRET ?? "";
  const server = createServer();
  const sockets = new WebSocketServer({ server });

  sockets.on("connection", async (socket, request) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token") ?? "";

    let sid: string;
    try {
      sid = readVoiceToken(token, secret).sid;
    } catch (error) {
      const message = error instanceof TokenRejected ? error.message : "Token rejected.";
      socket.send(JSON.stringify({ t: "error", code: "bad_token", message }));
      socket.close(1008, "bad token");
      return;
    }

    const adapter = adapterFor(config);
    const session = new VoiceSession({
      sessionId: sid,
      // A connection id is what the Lambda path derives this from; here the
      // connection is this socket and a fresh UUID says the same thing.
      sttSessionId: config.stt === "transcribe" ? randomUUID() : sttSessionIdFor(sid),
      adapter,
      config,
      emit: (message) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
      },
    });

    const timer = setInterval(() => {
      void session.tick().then((alive) => {
        if (!alive) {
          clearInterval(timer);
          socket.close(1000, session.closeReason ?? "closed");
        }
      });
    }, TICK_MS);

    socket.on("message", (data) => {
      void session.handle(data.toString()).then((alive) => {
        if (!alive) {
          clearInterval(timer);
          socket.close(1000, "stopped");
        }
      });
    });

    socket.on("close", () => {
      clearInterval(timer);
      void session.close("client_gone");
    });

    await session.start();
  });

  server.listen(port, () => {
    console.log(`voice dev socket on ws://localhost:${port} (stt: ${config.stt})`);
  });
  return server;
}

if (import.meta.filename === process.argv[1]) startDevServer();
