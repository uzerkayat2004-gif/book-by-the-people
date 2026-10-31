import Link from "next/link";
import { notFound } from "next/navigation";
import { IconLock } from "@/components/icons";
import { prisma } from "@/lib/db";
import { canSeeOwnVoice } from "@/lib/privacy";
import { getViewer } from "@/lib/viewer";
import { DeleteMyVoice } from "@/components/delete-my-voice";
import { releaseLabel } from "@/lib/stage";
import { fill, langAttrs, languageName, uiFor } from "@/lib/i18n";

export default async function ThanksPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const { slug } = await params;
  const { id } = await searchParams;
  const book = await prisma.book.findUnique({ where: { slug } });
  if (!book || !id) notFound();
  const voice = await prisma.voice.findFirst({ where: { id, bookId: book.id } });
  if (!voice) notFound();
  // Your own words are for you (and the book's owner) only.
  const { viewer, guestKey } = await getViewer();
  if (!canSeeOwnVoice(voice, book, viewer, guestKey)) notFound();
  // Waiting for the creator (or for AI) still counts as kept; only a refused voice is "not this time".
  const ready = voice.status === "READY" || voice.status === "NEEDS_YOU" || voice.status === "PROCESSING";
  const ui = uiFor(book.language, book.uiJson);
  const target = book.language || "en";
  const bookName = languageName(target, target);
  // Words in another language are put into the book's language when they are added (or soon after).
  const translated = voice.translated && voice.bookLanguage === target && voice.englishText.trim() && voice.englishText.trim() !== voice.originalText.trim();
  const waiting = !translated && voice.bookLanguage !== target && voice.language !== target;
  return (
    <main className="page speak vf" {...langAttrs(target)}>
      <div className="narrow vf__wrap">
        <div className="done">
          <div className="sealbig">
            <IconLock />
          </div>
          <h1>{ready ? ui.sealed : ui.notThisTime}</h1>
          <p className="lead">
            {ready
              ? book.status === "PUBLISHED"
                ? ui.youreIn
                : fill(ui.sealedUntil, { when: releaseLabel(book.closesAt) })
              : voice.rejectReason || ui.notUsed}
          </p>
        </div>
        {voice.originalText ? (
          <section className="thanks__words" aria-label={ui.yourWords}>
            {translated ? <h2 className="thanks__label">{ui.yourWords}</h2> : null}
            <div className="transcript" dir="auto">{voice.originalText}</div>
            {translated ? (
              <>
                <h2 className="thanks__label">{fill(ui.inTheBook, { language: bookName })}</h2>
                <div className="transcript transcript--book" dir="auto" data-testid="book-text">
                  {voice.englishText}
                </div>
              </>
            ) : waiting && ready ? (
              <p className="thanks__note" data-testid="translate-later">
                {fill(ui.translateLater, { language: bookName })}
              </p>
            ) : null}
          </section>
        ) : null}
        <DeleteMyVoice voiceId={voice.id} after={`/b/${book.slug}`} />
        <div className="grow" />
        {ready ? (
          <Link className="btn btn--red btn--big btn--block" href={`/b/${book.slug}/credit/${voice.id}`}>
            {ui.doneBtn}
          </Link>
        ) : (
          <a className="btn btn--red btn--big btn--block" href={`/b/${book.slug}/voice`}>
            {ui.tryAgain}
          </a>
        )}
      </div>
    </main>
  );
}
