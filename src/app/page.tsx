import Link from "next/link";
import { BookHome } from "@/components/book-home";
import { prisma } from "@/lib/db";
import { currentDocument, voterChoice, pausedNow } from "@/lib/load-book";
import { presentHome } from "@/lib/present-home";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  const query = await searchParams;
  const featured =
    (await prisma.book.findFirst({
      where: { featured: true },
      include: {
        voices: { orderBy: { createdAt: "asc" } },
        pollOptions: { orderBy: { position: "asc" }, include: { _count: { select: { votes: true } } } },
      },
    })) ??
    (await prisma.book.findFirst({
      include: {
        voices: { orderBy: { createdAt: "asc" } },
        pollOptions: { orderBy: { position: "asc" }, include: { _count: { select: { votes: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }));

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

  const others = await prisma.book.findMany({
    where: { id: { not: featured.id }, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    take: 6,
    include: { _count: { select: { voices: { where: { status: "READY", hidden: false } } } } },
  });
  const document =
    featured.status === "PUBLISHED" ? await currentDocument(featured.id, featured.publishedDraftId) : null;
  const vote = await voterChoice(featured.id);
  const paused = await pausedNow(featured.id);
  const model = presentHome({
    status: featured.status,
    stageOverride: query.stage ?? "closed",
    question: featured.question,
    closesAt: featured.closesAt,
    publishedAt: featured.publishedAt,
    voices: featured.voices,
    slug: featured.slug,
    paused,
    voiceHref: `/b/${featured.slug}/voice`,
    document,
    pollQuestion: featured.pollQuestion,
    poll: featured.pollOptions.map((option) => ({ id: option.id, label: option.label, votes: option._count.votes })),
    bookId: featured.id,
    yourVote: vote,
  });

  return (
    <BookHome
      {...model}
      others={others.map((book) => ({
        href: `/b/${book.slug}`,
        title: book.title,
        meta: `${book.type} · ${book._count.voices} voices`,
      }))}
    />
  );
}
