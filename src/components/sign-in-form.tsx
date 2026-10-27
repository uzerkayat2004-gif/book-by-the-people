"use client";

import { useState } from "react";
import { IconGoogle } from "@/components/icons";

export function SignInForm({
  nextPath,
  error,
  google,
  demoEmail,
}: {
  nextPath: string;
  error: string | null;
  google: boolean;
  demoEmail: string | null;
}) {
  const [email, setEmail] = useState(demoEmail ?? "");
  const [link, setLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(error);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/auth/magic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, next: nextPath }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error ?? "Could not send the link.");
      return;
    }
    if (data.devLink) setLink(data.devLink);
    else setMessage("Check your inbox for the sign-in link.");
  }

  return (
    <form onSubmit={submit}>
      {google ? (
        <a className="gbtn" href={`/api/auth/google?next=${encodeURIComponent(nextPath)}`}>
          <IconGoogle /> Continue with Google
        </a>
      ) : (
        <span className="gbtn" aria-disabled="true" title="Google sign-in is not set up on this site yet. Use email.">
          <IconGoogle /> Continue with Google
        </span>
      )}
      <div className="under">{google ? "18+ · we never post for you" : "Google sign-in is off here for now · use email"}</div>
      <div className="or">or email</div>
      <label className="field" htmlFor="email">
        <span>Email</span>
        <input id="email" className="input" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
      </label>
      {message ? <p className="err">{message}</p> : null}
      <button className="btn btn--red btn--big btn--block" type="submit" disabled={busy}>
        {busy ? "Sending…" : "Email me a link"}
      </button>
      {link ? (
        <a className="btn btn--block" href={link} style={{ marginTop: 12 }}>
          Open the magic link
        </a>
      ) : null}
      {demoEmail ? (
        <button type="button" className="under" onClick={() => setEmail(demoEmail)} style={{ display: "block", width: "100%" }}>
          Use the sample studio: {demoEmail}
        </button>
      ) : null}
    </form>
  );
}
