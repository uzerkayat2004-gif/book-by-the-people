import Link from "next/link";
import { notFound } from "next/navigation";
import { ShareCard } from "@/components/share-card";
import { headers } from "next/headers";
import { visibleQuotes } from "@/lib/book/assemble";
import { canSeeOwnVoice, isOwner, isReleasedBook } from "@/lib/privacy";
import { getViewer } from "@/lib/viewer";
import { countryByCode, flagEmoji } from "@/lib/countries";
import { currentDocument, loadBookBySlug } from "@/lib/load-book";

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

export default async function CreditPage({
  params,
}: {
  params: Promise<{ slug: string; voiceId: string }>;
}) {
  const { slug, voiceId } = await params;
  const loaded = await loadBookBySlug(slug);
  if (!loaded) notFound();
  const { viewer, guestKey } = await getViewer();
  const voice = loaded.voices.find((item) => item.id === voiceId);
  if (!voice || voice.hidden) notFound();
  // Before release this card is only for the person who spoke (and the book's owner). Nobody else, not even the admin.
  if (!isReleasedBook(loaded) && !canSeeOwnVoice(voice, loaded, viewer, guestKey)) notFound();
  const published = isReleasedBook(loaded) ? await currentDocument(loaded.id, loaded.publishedDraftId) : null;
  const preview = isOwner(loaded, viewer) ? await currentDocument(loaded.id, loaded.currentDraftId) : null;
  const document = published ?? preview;
  const quote = document ? visibleQuotes(document).find((item) => item.voiceId === voiceId) : null;
  if (!quote && loaded.status === "PUBLISHED") notFound();
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${proto}://${host}` : "";
  const pageUrl = `${origin}/b/${loaded.slug}/credit/${voice.id}`;
  const country = countryByCode(voice.countryCode);
  const place = [voice.region, country?.name].filter(Boolean).join(", ") || "the world";
  const ready = isReleasedBook(loaded) ? loaded.voices.filter((item) => item.status === "READY" && !item.hidden) : [];
  const countries = new Set(ready.map((item) => item.countryCode).filter(Boolean)).size;
  const chapterIndex = document?.chapters.findIndex((chapter) => chapter.quotes.some((item) => item.voiceId === voice.id && !item.hidden)) ?? -1;
  const chapter = chapterIndex >= 0 && document ? document.chapters[chapterIndex] : null;
  const released = loaded.status === "PUBLISHED" && Boolean(quote && chapter);
  const profile = (
    <div className="card prof">
      <span className="face" style={{ background: "var(--grad-btn)" }}>
        {initials(voice.contributorName)}
      </span>
      <div>
        <div className="prof__name">{voice.contributorName}</div>
        <div className="prof__meta">
          {country ? <span>{flagEmoji(country.code)}</span> : null}
          {voice.region ? <span>{voice.region}</span> : null}
          {country ? <span>{country.name}</span> : null}
          {released && voice.ageBand ? <span>{voice.ageBand}</span> : null}
          {released && voice.handle ? <span>@{voice.handle}</span> : null}
        </div>
      </div>
    </div>
  );

  return (
    <main className={released ? "page me me4" : "page me"}>
      <div className={released ? "wrap" : "narrow"}>
        {released && quote && chapter ? (
          <>
            <div className="card inbook">
              <div className="label">The book is out</div>
              <h2>You&apos;re in Chapter {chapterIndex + 1}</h2>
              <p>“{chapter.title}”</p>
            </div>
            <ShareCard
              name={voice.contributorName}
              place={place}
              quote={quote.englishText || quote.originalText}
              chapter={chapterIndex + 1}
              chapterTitle={chapter.title}
              similar={Math.max(1, chapter.quotes.filter((item) => !item.hidden).length)}
              theme={chapter.theme || chapter.title}
              people={ready.length}
              countries={countries}
              names={ready.map((item) => item.contributorName)}
              linkHost={host.replace(/^www\./, "")}
              pageUrl={pageUrl}
            />
            <div style={{ marginTop: 22 }}>{profile}</div>
          </>
        ) : (
          <>
            <div className="sealhead">
              <span className="label red">Sealed until the book is released</span>
            </div>
            {profile}
            <div className="card note" style={{ marginTop: 14 }}>
              <p className="muted" style={{ fontFamily: "var(--sans)", fontSize: 15, margin: 0 }}>
                Only your name{country ? ", country" : ""}
                {voice.region ? ", and state" : ""} are public. Your words stay sealed.
              </p>
            </div>
            <div style={{ marginTop: 22 }}>
              <Link className="btn btn--red btn--big btn--block" href={`/b/${loaded.slug}`}>
                Back to the book
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
