import Link from "next/link";
import { notFound } from "next/navigation";
import { IconLock } from "@/components/icons";
import { prisma } from "@/lib/db";
import { canSeeOwnVoice } from "@/lib/privacy";
import { getViewer } from "@/lib/viewer";
import { DeleteMyVoice } from "@/components/delete-my-voice";
import { releaseLabel } from "@/lib/stage";

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
  return (
    <main className="page speak vf">
      <div className="narrow vf__wrap">
        <div className="done">
          <div className="sealbig">
            <IconLock />
          </div>
          <h1>{ready ? "Sealed." : "Not this time."}</h1>
          <p className="lead">
            {ready
              ? book.status === "PUBLISHED"
                ? "You're in. Your words are kept with your name."
                : `Voices close ${releaseLabel(book.closesAt)}. Yours stays sealed until the book is released.`
              : voice.rejectReason || "Your words are kept, but they will not be used in the book."}
          </p>
        </div>
        {voice.originalText ? <div className="transcript" style={{ marginTop: 18 }}>{voice.originalText}</div> : null}
        <DeleteMyVoice voiceId={voice.id} after={`/b/${book.slug}`} />
        <div className="grow" />
        {ready ? (
          <Link className="btn btn--red btn--big btn--block" href={`/b/${book.slug}/credit/${voice.id}`}>
            Done
          </Link>
        ) : (
          <Link className="btn btn--red btn--big btn--block" href={`/b/${book.slug}/voice`}>
            Try again
          </Link>
        )}
      </div>
    </main>
  );
}
