import { notFound, redirect } from "next/navigation";
import { StudioDesk } from "@/components/live-studio";
import { getCurrentUser } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { prisma } from "@/lib/db";
import { planChapters } from "@/lib/book/plan";
import type { SourceVoice } from "@/lib/book/types";
import { currentDocument } from "@/lib/load-book";
import { bookSpendUsd, spendPaused } from "@/lib/services/spend";

export default async function StudioBookPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/studio");
  const { bookId } = await params;
  const query = await searchParams;
  const initialTab = query.tab === "ai" || query.tab === "make" || query.tab === "release" ? query.tab : "settings";
  const book = await prisma.book.findFirst({
    where: { creatorId: user.id, OR: [{ id: bookId }, { slug: bookId }] },
    include: {
      voices: { orderBy: { createdAt: "asc" } },
      drafts: { orderBy: { version: "desc" } },
      pollOptions: { orderBy: { position: "asc" }, include: { _count: { select: { votes: true } } } },
      backups: { orderBy: { createdAt: "desc" }, take: 8 },
    },
  });
  if (!book) notFound();
  const mine = await prisma.book.findMany({
    where: { creatorId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, title: true },
  });
  const spent = await bookSpendUsd(book.id);
  const cap = getConfig().spendCapUsd;
  const paused = await spendPaused(book.id);
  let log: string[] = [];
  try {
    const parsed = book.generationLog ? (JSON.parse(book.generationLog) as string[]) : [];
    if (Array.isArray(parsed)) log = parsed;
  } catch {
    log = [];
  }
  const document = await currentDocument(book.id, book.publishedDraftId ?? book.currentDraftId);
  const themes = document?.chapters.length
    ? document.chapters
        .map((chapter) => ({
          label: chapter.title,
          count: new Set(chapter.quotes.filter((quote) => !quote.hidden).map((quote) => quote.voiceId)).size,
        }))
        .filter((group) => group.count > 0)
    : planChapters(
        book.voices.map(
          (voice): SourceVoice => ({
            id: voice.id,
            contributorName: voice.contributorName,
            language: voice.language,
            countryCode: voice.countryCode,
            originalText: voice.originalText,
            englishText: voice.englishText,
            translated: voice.translated,
            turns: [],
            durationMs: voice.durationMs,
            createdAt: voice.createdAt.getTime(),
            kind: voice.kind === "sourced_quote" ? "sourced_quote" : "voice",
            sourceUrl: voice.sourceUrl,
            sourceTitle: voice.sourceTitle,
            sourceDate: voice.sourceDate,
            hidden: voice.hidden,
            status: voice.status,
            startWord: voice.startWord,
            hasAudio: Boolean(voice.storageKey),
          }),
        ),
        book.type,
      ).map((plan) => ({ label: plan.theme, count: plan.voiceIds.length }));
  const invitePath =
    book.type === "FAMOUS"
      ? `/studio/${book.id}`
      : book.type === "INVITED"
        ? `/b/${book.slug}/voice?invite=${book.inviteToken}`
        : `/b/${book.slug}/voice`;

  return (
    <StudioDesk
        book={{
          id: book.id,
          slug: book.slug,
          title: book.title,
          question: book.question,
          type: book.type,
          status: book.status,
          coverVibe: book.coverVibe,
          closesAt: book.closesAt?.toISOString() ?? null,
          pollQuestion: book.pollQuestion,
          invitePath,
          generationError: book.generationError,
          log,
          paused,
        }}
        voices={book.voices.map((voice) => ({
          id: voice.id,
          name: voice.contributorName,
          language: voice.language,
          countryCode: voice.countryCode,
          originalText: voice.originalText,
          englishText: voice.englishText,
          translated: voice.translated,
          status: voice.status,
          hidden: voice.hidden,
          rejectReason: voice.rejectReason,
          kind: voice.kind,
          sourceUrl: voice.sourceUrl,
          sourceDate: voice.sourceDate,
          hasAudio: Boolean(voice.storageKey),
          decision: voice.decision,
          themeLabel: voice.themeLabel,
          pipelineStep: voice.pipelineStep,
        }))}
        drafts={book.drafts.map((draft) => ({
          id: draft.id,
          version: draft.version,
          provider: draft.provider,
          model: draft.model,
          note: draft.note,
          current: draft.id === book.currentDraftId,
        }))}
        initialTab={initialTab}
        pollOptions={book.pollOptions.map((option) => ({ label: option.label, votes: option._count.votes }))}
        canChangeType={book.voices.length === 0}
        spend={{
          usd: spent < 0.01 ? "<$0.01" : `$${spent.toFixed(2)}`,
          cap: cap === null ? "$20.00" : `$${cap.toFixed(2)}`,
        }}
        chapters={document?.chapters.map((chapter) => chapter.title) ?? []}
        themes={themes}
        books={mine}
        backups={book.backups.map((backup) => ({
          label: backup.label,
          voices: backup.voiceCount,
          note: backup.note,
        }))}
        media={{
          audioHref: book.audiobookKey ? `/api/media/${book.slug}/audiobook` : null,
          videoHref: book.videoKey ? `/api/media/${book.slug}/video` : null,
          audioBytes: book.audiobookBytes,
          videoBytes: book.videoBytes,
          audioName: book.audiobookKey?.endsWith(".mp3") ? `${book.slug}.mp3` : book.audiobookKey ? `${book.slug}.wav` : "",
          videoName: book.videoKey ? `${book.slug}.mp4` : "",
        }}
        aiPaused={book.aiPaused}
        showPoll={book.showPoll}
        bookNumber={book.bookNumber}
      />
  );
}
