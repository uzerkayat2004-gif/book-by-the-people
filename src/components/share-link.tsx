"use client";

import { useState } from "react";

/** "Copy book link" and the phone's own share sheet. The link is built from the page's own address. */
export function ShareLink({
  path,
  title,
  big = false,
  showUrl = false,
}: {
  path: string;
  title: string;
  big?: boolean;
  showUrl?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const url = () => `${window.location.origin}${path}`;
  async function copy() {
    await navigator.clipboard.writeText(url()).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  async function share() {
    if (typeof navigator.share === "function") {
      await navigator.share({ title, text: title, url: url() }).catch(() => undefined);
      return;
    }
    await copy();
  }
  return (
    <div className={`sharelink${big ? " sharelink--big" : ""}`} data-testid="share-link">
      {showUrl ? (
        <code className="sharelink__url" ref={(node) => void (node && !origin && setOrigin(window.location.host))}>
          {origin}
          {path}
        </code>
      ) : null}
      <button className="btn btn--red btn--sm sharelink__copy" type="button" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy book link"}
      </button>
      <button className="btn btn--ghost btn--sm" type="button" onClick={() => void share()}>
        Share
      </button>
    </div>
  );
}
