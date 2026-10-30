import { notFound } from "next/navigation";
import { BookHome } from "@/components/book-home";
import { getCurrentUser } from "@/lib/auth";
import { canAcceptVoice } from "@/lib/book/lifecycle";
import { currentDocument, loadBookBySlug, pausedNow, voterChoice } from "@/lib/load-book";
import { presentHome } from "@/lib/present-home";
import { refreshStaleMedia } from "@/lib/services/books";
import { ownerName } from "@/lib/public-books";
import { isReleasedBook } from "@/lib/privacy";
import { prisma } from "@/lib/db";
import type { Metadata } from "next";

/** Share previews show only the public card: title and question. Unlisted books ask search engines to stay away. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const book = await prisma.book.findUnique({ where: { slug }, select: { title: true, question: true, unlisted: true, type: true } });
  if (!book) return { title: "Book not found" };
  return {
    title: book.title,
    description: book.question,
    openGraph: { type: "website", siteName: "Book by the People", title: book.title, description: book.question },
    twitter: { card: "summary_large_image", title: book.title, description: book.question },
    robots: book.unlisted || book.type === "INVITED" || book.type === "SOLO" ? { index: false, follow: false } : undefined,
  };
}

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ invite?: string; stage?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const loaded = await loadBookBySlug(slug);
  if (!loaded) notFound();
  const user = await getCurrentUser();
  const paused = await pausedNow(loaded.id);
  const gate = canAcceptVoice({
    bookType: loaded.type,
    status: loaded.status,
    closesAt: loaded.closesAt?.getTime() ?? null,
    creatorId: loaded.creatorId,
    inviteToken: loaded.inviteToken,
    viewerId: user?.id ?? null,
    providedInvite: query.invite ?? null,
    paused,
  });
  const voiceHref = gate.ok ? `/b/${loaded.slug}/voice${query.invite ? `?invite=${query.invite}` : ""}` : null;
  const document = isReleasedBook(loaded) ? await currentDocument(loaded.id, loaded.publishedDraftId) : null;
  if (loaded.status === "PUBLISHED") await refreshStaleMedia(loaded.id).catch(() => undefined);
  const vote = await voterChoice(loaded.id);
  const model = presentHome({
    status: loaded.status,
    stageOverride: query.stage,
    question: loaded.question,
    closesAt: loaded.closesAt,
    publishedAt: loaded.publishedAt,
    voices: loaded.voices,
    slug: loaded.slug,
    paused,
    voiceHref,
    document,
    pollQuestion: loaded.pollQuestion,
    poll: loaded.showPoll
      ? loaded.pollOptions.map((option) => ({ id: option.id, label: option.label, votes: option._count.votes }))
      : [],
    bookId: loaded.id,
    yourVote: vote,
  });
  return (
    <BookHome
      {...model}
      title={loaded.title}
      slug={loaded.slug}
      media={{ audio: Boolean(loaded.audiobookKey), video: Boolean(loaded.videoKey), audioBytes: loaded.audiobookBytes, videoBytes: loaded.videoBytes }}
      mode="book"
      owner={ownerName(loaded.creator)}
    />
  );
}
