import Link from "next/link";
import { BookHome } from "@/components/book-home";
import { prisma } from "@/lib/db";
import { currentDocument, voterChoice, pausedNow } from "@/lib/load-book";
import { presentHome } from "@/lib/present-home";
import { homeBook, openBooks, releasedBooks, releasedWhere } from "@/lib/public-books";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  const query = await searchParams;
  const featured = await homeBook();

  if (!featured) {
    return (
      <main className="page speak">
        <div className="narrow">
          <h1>Book by the People</h1>
          <p className="lead">No book is open yet.</p>
          <Link className="btn btn--red btn--big btn--block" href="/books/new">
            Start a book
          </Link>
        </div>
      </main>
    );
  }

  const [openNow, released, releasedTotal] = await Promise.all([
    openBooks(featured.id, 6),
    releasedBooks({ exceptId: featured.id, take: 4 }),
    prisma.book.count({ where: { ...releasedWhere, id: { not: featured.id } } }),
  ]);
  const document =
    featured.status === "PUBLISHED" ? await currentDocument(featured.id, featured.publishedDraftId) : null;
  const vote = await voterChoice(featured.id);
  const paused = await pausedNow(featured.id);
  const model = presentHome({
    status: featured.status,
    stageOverride: query.stage ?? null,
    question: featured.question,
    closesAt: featured.closesAt,
    publishedAt: featured.publishedAt,
    voices: featured.voices,
    slug: featured.slug,
    paused,
    voiceHref: featured.type === "OPEN" ? `/b/${featured.slug}/voice` : null,
    document,
    pollQuestion: featured.pollQuestion,
    poll: featured.showPoll
      ? featured.pollOptions.map((option) => ({ id: option.id, label: option.label, votes: option._count.votes }))
      : [],
    bookId: featured.id,
    yourVote: vote,
  });

  return (
    <BookHome
      {...model}
      title={featured.title}
      slug={featured.slug}
      media={{ audio: Boolean(featured.audiobookKey), video: Boolean(featured.videoKey) }}
      openNow={openNow}
      released={released}
      releasedTotal={releasedTotal}
    />
  );
}
