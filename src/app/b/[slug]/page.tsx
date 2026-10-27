import { notFound } from "next/navigation";
import { BookHome } from "@/components/book-home";
import { getCurrentUser } from "@/lib/auth";
import { canAcceptVoice } from "@/lib/book/lifecycle";
import { currentDocument, loadBookBySlug, pausedNow, voterChoice } from "@/lib/load-book";
import { presentHome } from "@/lib/present-home";

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
  const document = loaded.status === "PUBLISHED" ? await currentDocument(loaded.id, loaded.publishedDraftId) : null;
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
  return <BookHome {...model} title={loaded.title} />;
}
