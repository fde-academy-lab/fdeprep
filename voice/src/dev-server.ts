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
 * One session failing never takes the socket down. Anything thrown inside a
 * connection handler used to be an unhandled rejection, which ends a Node
 * process, so a transcriber that would not open (Amazon Transcribe on a
 * machine with no AWS credentials) stopped the socket for every Start after
 * it. That session now ends with an error the browser shows, and the socket
 * keeps serving. test/dev-server.test.ts holds it there.
 *
 *   VOICE_TOKEN_SECRET=dev npm run dev -w voice
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { readVoiceToken, TokenRejected } from "../../web/lib/voice/token.ts";
import { loadConfig, type VoiceConfig } from "./config.ts";
import { sttSessionIdFor } from "./ids.ts";
import { adapterFor, type VoiceAdapter } from "./stt/index.ts";
import { VoiceSession } from "./session.ts";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.VOICE_DEV_PORT ?? 8787);
const TICK_MS = 1_000;

/** RFC 6455: the server met a condition that stopped it fulfilling the
 *  request. The cockpit reads it as the transcriber failing. */
const CLOSE_FAILED = 1011;

export function startDevServer(
  port: number = PORT,
  /** Which transcriber each session gets. Tests pass one that fails. */
  makeAdapter: (config: VoiceConfig) => VoiceAdapter = adapterFor,
) {
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

    const adapter = makeAdapter(config);
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

    let ended = false;
    /** End this session and say why, without ending the process. */
    const fail = (error: unknown) => {
      if (ended) return;
      ended = true;
      clearInterval(timer);
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`voice session ${sid}: the transcriber failed: ${reason}`);
      if (socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify({
        t: "error",
        code: "stt_failed",
        message: `The development socket's transcriber failed: ${reason}.` +
          (config.stt === "transcribe"
            ? " On a machine without AWS credentials, start the socket with VOICE_STT=scripted."
            : ""),
      }));
      socket.close(CLOSE_FAILED, "transcriber failed");
    };

    const timer = setInterval(() => {
      session.tick().then((alive) => {
        if (!alive) {
          clearInterval(timer);
          socket.close(1000, session.closeReason ?? "closed");
        }
      }).catch(fail);
    }, TICK_MS);

    // Audio that arrives while the transcriber is still opening waits here
    // and goes to it in order once it is open. The browser sends frames as
    // soon as its microphone opens, and pushed straight through, the first
    // of them threw "push before open".
    let open = false;
    const waiting: string[] = [];
    const handle = (raw: string) => {
      session.handle(raw).then((alive) => {
        if (!alive) {
          clearInterval(timer);
          socket.close(1000, "stopped");
        }
      }).catch(fail);
    };

    socket.on("message", (data) => {
      if (open) handle(data.toString());
      else waiting.push(data.toString());
    });

    socket.on("close", () => {
      clearInterval(timer);
      session.close("client_gone").catch((error) => {
        console.error(`voice session ${sid}: closing after the browser left failed:`, error);
      });
    });

    try {
      await session.start();
    } catch (error) {
      fail(error);
      return;
    }
    open = true;
    for (const raw of waiting.splice(0)) handle(raw);
  });

  server.listen(port, () => {
    const address = server.address();
    const bound = typeof address === "object" && address ? address.port : port;
    console.log(`voice dev socket on ws://localhost:${bound} (stt: ${config.stt})`);
  });
  return server;
}

if (import.meta.filename === process.argv[1]) startDevServer();
