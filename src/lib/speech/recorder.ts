"use client";

import { Chunker, type Clip } from "./chunker";
import { Downsampler } from "./wav";

export type LiveRecorder = {
  /** Ends the recording; the last clip (if it holds speech) is handed to onClip before this resolves. */
  stop: () => Promise<void>;
};

export function canRecord(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown };
  const media = navigator.mediaDevices as MediaDevices | undefined;
  return Boolean(typeof media?.getUserMedia === "function" && (w.AudioContext || w.webkitAudioContext));
}

/**
 * Records the microphone as raw samples in memory, cuts them at pauses and hands each clip on.
 * Nothing is saved: clips exist only until they are sent to be turned into words.
 */
export async function startRecorder(input: { onClip: (clip: Clip) => void; onLevel?: (level: number) => void }): Promise<LiveRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctx();
  await ctx.resume().catch(() => undefined);
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor works on every browser that records, including older Android Chrome and Safari.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  const down = new Downsampler(ctx.sampleRate);
  const chunker = new Chunker();
  let open = true;
  node.onaudioprocess = (event) => {
    if (!open) return;
    const samples = down.push(event.inputBuffer.getChannelData(0));
    for (const clip of chunker.push(samples)) input.onClip(clip);
    input.onLevel?.(chunker.level);
  };
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);
  return {
    async stop() {
      if (!open) return;
      open = false;
      node.onaudioprocess = null;
      try {
        source.disconnect();
        node.disconnect();
        mute.disconnect();
      } catch {
        // already disconnected
      }
      for (const track of stream.getTracks()) track.stop();
      await ctx.close().catch(() => undefined);
      const last = chunker.flush();
      if (last) input.onClip(last);
      input.onLevel?.(0);
    },
  };
}
