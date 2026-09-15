/**
 * Which adapter runs is a server-side decision.
 *
 * `.claude/rules/01-trust-boundaries.md`: the browser may not supply a model
 * identifier. The same reasoning covers the speech provider, so the choice
 * comes from configuration and there is no code path that reads it from a
 * socket message.
 */
import type { VoiceConfig } from "../config.ts";
import type { VoiceAdapter } from "./adapter.ts";
import { ScriptedAdapter } from "./scripted.ts";
import { TranscribeAdapter } from "./transcribe.ts";

export function adapterFor(config: VoiceConfig): VoiceAdapter {
  return config.stt === "transcribe" ? new TranscribeAdapter(config) : new ScriptedAdapter();
}

export { BaseAdapter } from "./adapter.ts";
export type { SttAdapter, SttErrors, VoiceAdapter } from "./adapter.ts";
export { ScriptedAdapter } from "./scripted.ts";
export { TranscribeAdapter } from "./transcribe.ts";
