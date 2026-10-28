"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Lets the person who recorded a voice remove it for good. Asks once before deleting. */
export function DeleteMyVoice({ voiceId, after, compact = false }: { voiceId: string; after?: string; compact?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirm" | "busy" | "error">("idle");
  async function remove() {
    setState("busy");
    const response = await fetch(`/api/voices/${voiceId}`, { method: "DELETE" });
    if (!response.ok) {
      setState("error");
      return;
    }
    if (after) router.push(after);
    else router.refresh();
  }
  if (state === "confirm" || state === "busy") {
    return (
      <span className={`delvoice${compact ? " delvoice--sm" : ""}`}>
        <span>Delete your voice for good?</span>
        <button className="link delvoice__yes" type="button" disabled={state === "busy"} onClick={() => void remove()}>
          Delete
        </button>
        <button className="link" type="button" onClick={() => setState("idle")}>
          Keep
        </button>
      </span>
    );
  }
  return (
    <span className={`delvoice${compact ? " delvoice--sm" : ""}`}>
      <button className="link delvoice__go" type="button" onClick={() => setState("confirm")} data-testid="delete-my-voice">
        Delete my voice
      </button>
      {state === "error" ? <span className="delvoice__err">That did not work.</span> : null}
    </span>
  );
}
