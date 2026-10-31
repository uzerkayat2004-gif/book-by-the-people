import Link from "next/link";
import { BookHome } from "@/components/book-home";
import { currentDocument, voterChoice, pausedNow } from "@/lib/load-book";
import { presentHome } from "@/lib/present-home";
import { refreshStaleMedia } from "@/lib/services/books";
import { homeBook, openBooks, ownerName } from "@/lib/public-books";

export const dynamic = "force-dynamic";

/** The home page: the featured book, then a short strip of other books being written (all of them live on /books). */
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

  const released = featured.status === "PUBLISHED" && Boolean(featured.publishedDraftId);
  const [openNow, document] = await Promise.all([
    openBooks(featured.id, 6),
    released ? currentDocument(featured.id, featured.publishedDraftId) : Promise.resolve(null),
  ]);
  if (released) await refreshStaleMedia(featured.id).catch(() => undefined);
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
    liveGlobe: featured.type === "OPEN" && !featured.unlisted,
  });

  return (
    <BookHome
      {...model}
      mode="home"
      owner={ownerName(featured.creator)}
      title={featured.title}
      slug={featured.slug}
      media={{ audio: Boolean(featured.audiobookKey), video: Boolean(featured.videoKey), audioBytes: featured.audiobookBytes, videoBytes: featured.videoBytes }}
      openNow={openNow}
    />
  );
}
