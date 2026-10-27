import Link from "next/link";
import { notFound } from "next/navigation";
import { IconLock } from "@/components/icons";
import { prisma } from "@/lib/db";
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
  const ready = voice.status === "READY";
  return (
    <main className="page speak">
      <div className="narrow">
        <div className="done">
          <div className="sealbig">
            <IconLock />
          </div>
          <h1>{ready ? "Sealed." : "Not this take."}</h1>
          <p className="lead">
            {ready
              ? book.status === "PUBLISHED"
                ? "You're in. The recording is stored with your name."
                : `Opens ${releaseLabel(book.closesAt)}.`
              : voice.rejectReason || "The recording is kept, and it will not be used in the book."}
          </p>
        </div>
        {voice.originalText ? <div className="transcript" style={{ marginTop: 18 }}>{voice.originalText}</div> : null}
        <div className="grow" />
        {ready ? (
          <Link className="btn btn--red btn--big btn--block" href={`/b/${book.slug}/credit/${voice.id}`}>
            Done
          </Link>
        ) : (
          <Link className="btn btn--red btn--big btn--block" href={`/b/${book.slug}/voice`}>
            Record again
          </Link>
        )}
      </div>
    </main>
  );
}
