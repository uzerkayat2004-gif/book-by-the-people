import { notFound, redirect } from "next/navigation";
import { StudioDesk } from "@/components/live-studio";
import { getCurrentUser } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { aiSummary, providerStore } from "@/lib/ai/providers";
import { backupAge } from "@/lib/services/backups";
import { canStoreKeys } from "@/lib/secret-box";
import { prisma } from "@/lib/db";
import { planChapters } from "@/lib/book/plan";
import type { SourceVoice } from "@/lib/book/types";
import { currentDocument } from "@/lib/load-book";
import { bookLimit, bookUsage, spendPaused } from "@/lib/services/spend";
import { limitShare, usageLine } from "@/lib/ai/spend";

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
  const [usage, limit] = await Promise.all([bookUsage(book.id), bookLimit(book.id)]);
  const hasAiKey = Boolean((await prisma.book.findUnique({ where: { id: book.id }, select: { aiKeyCipher: true } }))?.aiKeyCipher);
  const paused = await spendPaused(book.id);
  const [providers, ai] = await Promise.all([providerStore.list(user.id), aiSummary(user.id)]);
  const mediaJob = await prisma.pipelineJob.findUnique({ where: { key: `${book.id}:make:media` } });
  const mediaStatus = mediaState(mediaJob);
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
          sourceTitle: voice.sourceTitle,
          ...(() => {
            try {
              const checks = JSON.parse(voice.checkJson || "{}") as {
                onTopic?: boolean;
                realPerson?: boolean;
                copyPaste?: boolean;
                duplicate?: boolean;
                impersonation?: boolean;
              };
              return {
                impersonation: Boolean(checks.impersonation),
                checks: {
                  onTopic: checks.onTopic,
                  realPerson: checks.realPerson,
                  copyPaste: checks.copyPaste,
                  duplicate: checks.duplicate,
                  impersonation: checks.impersonation,
                },
              };
            } catch {
              return { impersonation: false, checks: null };
            }
          })(),
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
        usage={{
          kind: limit.kind,
          value: limit.value,
          line: usageLine(usage, limit),
          share: limitShare(usage, limit),
          reached: paused,
        }}
        chapters={document?.chapters.map((chapter) => chapter.title) ?? []}
        themes={themes}
        books={mine}
        backups={book.backups.map((backup) => ({
          id: backup.id,
          label: backupAge(backup.createdAt),
          restorable: Boolean(backup.snapshot),
          voices: backup.voiceCount,
          note: backup.note,
        }))}
        media={{
          audioHref: book.audiobookKey ? `/api/media/${book.slug}/audiobook` : null,
          videoHref: book.videoKey ? `/api/media/${book.slug}/video` : null,
          audioBytes: book.audiobookBytes,
          videoBytes: book.videoBytes,
          audioName:
            book.audiobookName ||
            (book.audiobookKey?.endsWith(".mp3") ? `${book.slug}.mp3` : book.audiobookKey ? `${book.slug}.wav` : ""),
          videoName: book.videoName || (book.videoKey ? `${book.slug}.mp4` : ""),
          status: mediaStatus,
          note: mediaJob?.lastError ?? null,
          emails: Boolean(getConfig().resendApiKey && getConfig().emailFrom),
        }}
        settings={{
          language: book.language,
          voiceLimitPerDay: book.voiceLimitPerDay,
          maxVoiceSeconds: book.maxVoiceSeconds,
          hasAiKey,
          canStoreKeys: canStoreKeys(),
          mockMode: !ai.writer,
          mockServer: getConfig().aiMode === "mock",
        }}
        providers={providers}
        ai={ai}
        aiPaused={book.aiPaused}
        showPoll={book.showPoll}
        bookNumber={book.bookNumber}
      />
  );
}

/** A run older than 30 minutes was cut off (for example by a restart); let the creator start it again. */
function mediaState(job: { status: string; updatedAt: Date } | null): string {
  if (!job) return "none";
  return job.status === "running" && Date.now() - job.updatedAt.getTime() > 30 * 60_000 ? "failed" : job.status;
}
