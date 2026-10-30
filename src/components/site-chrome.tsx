"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconArrow, IconBack, IconCheck } from "@/components/icons";
import { LogoMark } from "@/components/logo-mark";

function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "B") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function Clock({ mode, closesAt }: { mode: "none" | "out" | "closed" | "count"; closesAt: string | null }) {
  const [text, setText] = useState("00:00:00");
  useEffect(() => {
    if (mode !== "count" || !closesAt) return;
    const tick = () => {
      const seconds = Math.max(0, Math.floor((new Date(closesAt).getTime() - Date.now()) / 1000));
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      const pad = (value: number) => String(value).padStart(2, "0");
      setText(days > 0 ? `${days}d ${pad(hours)}:${pad(minutes)}` : `${pad(hours)}:${pad(minutes)}:${pad(secs)}`);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [mode, closesAt]);
  if (mode === "none") return null;
  if (mode === "out") {
    return (
      <span className="clock out">
        <span className="dot" />
        Out now
      </span>
    );
  }
  if (mode === "closed") {
    return (
      <span className="clock">
        <span className="dot" />
        Closed
      </span>
    );
  }
  return (
    <span className="clock">
      <span className="dot" />
      <span>{text}</span>
    </span>
  );
}

export function TopBar({
  user,
  featuredStatus,
  closesAt,
}: {
  user: { name: string } | null;
  featuredStatus: string | null;
  closesAt: string | null;
}) {
  return (
    <Suspense fallback={<header className="top" />}>
      <TopBarInner user={user} featuredStatus={featuredStatus} closesAt={closesAt} />
    </Suspense>
  );
}

function TopBarInner({
  user,
  featuredStatus,
  closesAt,
}: {
  user: { name: string } | null;
  featuredStatus: string | null;
  closesAt: string | null;
}) {
  const path = usePathname();
  const onHome = path === "/";
  const mode = "none";
  const onStudio = path.startsWith("/studio");
  const [menu, setMenu] = useState(false);
  return (
    <header className="top">
      <div className="top__bar">
        {onHome ? null : (
          <Link className="topback" href="/" aria-label="Back to home">
            <IconBack />
          </Link>
        )}
        <Link className="logo" href="/" aria-label="Book by the People home">
          <LogoMark />
          <span className="logo__word">Book by the People</span>
        </Link>
        <div className="top__right">
          <Clock mode={mode} closesAt={closesAt} />
          {onStudio ? null : (
            <>
              <Link className={`signin-link toplib${path === "/books" ? " on" : ""}`} href="/books">
                Books
              </Link>
              <Link className={`signin-link toplib${path.startsWith("/library") ? " on" : ""}`} href="/library">
                Library
              </Link>
            </>
          )}
          {user && !onStudio ? (
            <Link className={`signin-link toplib${path.startsWith("/studio") ? " on" : ""}`} href="/studio">
              Studio
            </Link>
          ) : null}
          {user ? (
            <div className="usermenu">
              <button className="avatar on" type="button" aria-label="My menu" onClick={() => setMenu((open) => !open)}>
                {initials(user.name)}
              </button>
              {menu ? (
                <div className="usermenu__pop">
                  <Link href="/me" onClick={() => setMenu(false)}>
                    My page
                  </Link>
                  <Link href="/studio" onClick={() => setMenu(false)}>
                    Studio
                  </Link>
                  <form action="/api/auth/sign-out" method="post">
                    <button type="submit">Sign out</button>
                  </form>
                </div>
              ) : null}
            </div>
          ) : (
            <Link className="signin-link" href={`/sign-in?next=${encodeURIComponent(path || "/")}`}>
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Sheet({ title, kicker, children, onClose }: { title: string; kicker: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="scrim open" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="grab" />
        <div className="label red">{kicker}</div>
        <h3>{title}</h3>
        {children}
        <button className="btn btn--block" type="button" onClick={onClose} style={{ marginTop: 16 }}>
          {title === "Real people. Real words." ? "Got it" : "Close"}
        </button>
      </div>
    </div>
  );
}

export function SiteFooter({ question, voiceHref }: { question: string | null; voiceHref: string }) {
  const [sheet, setSheet] = useState<null | "about" | "privacy" | "trust">(null);
  return (
    <>
      <footer className="foot7" data-testid="site-footer">
        <div className="wrap">
          <div className="foot7__top">
            <div className="foot7__brand">
              <Link className="logo foot7__logo" href="/" aria-label="Book by the People home">
                <LogoMark />
                <span className="logo__word">Book by the People</span>
              </Link>
              <p className="foot7__tag">Real voices, written into a real book by AI.</p>
            </div>
            <nav className="foot7__cols" aria-label="Footer">
              <div className="foot7__col">
                <span className="foot7__h">Take part</span>
                <Link href={voiceHref || "/speak"}>Add your voice</Link>
                <Link href="/books">Books</Link>
              </div>
              <div className="foot7__col">
                <span className="foot7__h">Read</span>
                <Link href="/library">Library</Link>
                <Link href="/me">My page</Link>
              </div>
              <div className="foot7__col">
                <span className="foot7__h">Trust</span>
                <button type="button" onClick={() => setSheet("about")}>
                  About
                </button>
                <button type="button" onClick={() => setSheet("trust")}>
                  How AI checks
                </button>
                <button type="button" onClick={() => setSheet("privacy")}>
                  Privacy
                </button>
              </div>
            </nav>
          </div>
          <div className="foot7__bot">
            <span className="foot7__copy">
              © 2026 Book by the People <span className="age18">18+</span>
            </span>
            <Link className="foot7__new" href="/books/new">
              Start your own book <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </footer>
      {sheet === "about" ? (
        <Sheet title="Book by the People" kicker="About" onClose={() => setSheet(null)}>
          <p className="soft">
            One question. Everyone writes an answer in their own words. AI checks every voice and groups the same views, then writes a real book using people&apos;s exact words — with every contributor credited.
          </p>
          <p className="soft">
            Book 1 asks: <b>{question || "Is AI making you smarter or lazier?"}</b>
          </p>
        </Sheet>
      ) : null}
      {sheet === "privacy" ? (
        <Sheet title="Your words, your name" kicker="Privacy" onClose={() => setSheet(null)}>
          <ul className="trustlist">
            <li>
              <IconCheck />
              <span>Until the book is released only your name, country and state are public. Your words stay sealed.</span>
            </li>
            <li>
              <IconCheck />
              <span>Quotes are always your exact words, with your name.</span>
            </li>
            <li>
              <IconCheck />
              <span>Only your written words are kept. The AI that checks and sorts them isn&apos;t trained on them.</span>
            </li>
            <li>
              <IconCheck />
              <span>18+ only. Delete your voice any time before release.</span>
            </li>
          </ul>
        </Sheet>
      ) : null}
      {sheet === "trust" ? (
        <Sheet title="Real people. Real words." kicker="Every voice checked by AI" onClose={() => setSheet(null)}>
          <ul className="trustlist">
            <li>
              <IconCheck />
              <span>
                <b>On topic?</b> Only voices about this question go in.
              </span>
            </li>
            <li>
              <IconCheck />
              <span>
                <b>A real person?</b> AI reads every voice for real, on-topic words. No file uploads.
              </span>
            </li>
            <li>
              <IconCheck />
              <span>
                <b>No spam copies?</b> The same words from many accounts count once.
              </span>
            </li>
            <li>
              <IconCheck />
              <span>
                <b>Not pretending?</b> Typing a famous @name never gets a ✓.
              </span>
            </li>
            <li>
              <IconCheck />
              <span>
                <b>Every quote is exact.</b> Word-for-word what you wrote, with your name.
              </span>
            </li>
          </ul>
          <p className="fine">Unsure ones go to a human. The AI never trains on your words.</p>
        </Sheet>
      ) : null}
      <span className="sr">
        <IconArrow />
      </span>
    </>
  );
}

export function Motion() {
  const path = usePathname();
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("static")) document.documentElement.classList.add("static");
  }, [path]);
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `if(location.search.indexOf("static=1")!==-1)document.documentElement.classList.add("static")`,
      }}
    />
  );
}
