import { notFound, redirect } from "next/navigation";
import { StudioDesk } from "@/components/live-studio";
import { getCurrentUser } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { canSendEmail } from "@/lib/mailer";
import { aiSummary, providerStore, writerChain, writerLive } from "@/lib/ai/providers";
import { usableProvider } from "@/lib/ai/book-source";
import { localModelsOff } from "@/lib/ai/local-gate";
import { shortLabel } from "@/lib/ai/provider-types";
import { backupAge } from "@/lib/services/backups";
import { canStoreKeys, keyLast4, openKey } from "@/lib/secret-box";
import { canLeadHome, homeBookLite } from "@/lib/public-books";
import { isSiteAdmin } from "@/lib/site-admin";
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
    select: { id: true, slug: true, title: true, status: true },
  });
  const [usage, limit] = await Promise.all([bookUsage(book.id), bookLimit(book.id)]);
  const sealed = (await prisma.book.findUnique({ where: { id: book.id }, select: { aiKeyCipher: true } }))?.aiKeyCipher ?? "";
  const hasAiKey = Boolean(sealed);
  let aiKeyLast4 = "";
  try {
    aiKeyLast4 = sealed ? keyLast4(openKey(sealed)) : "";
  } catch {
    aiKeyLast4 = "";
  }
  const onHome = (await homeBookLite())?.id === book.id;
  const paused = await spendPaused(book.id);
  const [providers, summary] = await Promise.all([providerStore.list(user.id), aiSummary(user.id)]);
  // A key pasted in Book settings runs this book on Meta even when the server has no key.
  const keyLabel = `${getConfig().writerModel} (book key${aiKeyLast4 ? ` ••••${aiKeyLast4}` : ""})`;
  const hearLabel = `${getConfig().transcribeModel} (book key)`;
  const choice = (await prisma.book.findUnique({ where: { id: book.id }, select: { aiProviderId: true, aiModel: true } })) ?? { aiProviderId: "", aiModel: "" };
  const [chain, aiReady] = await Promise.all([writerChain(book.id), writerLive(book.id)]);
  const bookWriter = chain[0] ? `${shortLabel(chain[0].label)} · ${chain[0].model}` : null;
  const base = hasAiKey
    ? { ...summary, writer: summary.writer ?? keyLabel, hearer: summary.hearer ?? hearLabel }
    : summary;
  const ai = bookWriter ? { ...base, writer: bookWriter } : base;
  const localOn = !localModelsOff();
  const bookModels = providers
    .filter((view) => usableProvider(view, localOn))
    .map((view) => ({ id: view.id, label: shortLabel(view.label), type: view.type, model: view.model, detail: view.hasKey ? `••••${view.keyLast4}` : "" }));
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
          emails: canSendEmail(),
        }}
        settings={{
          language: book.language,
          voiceLimitPerDay: book.voiceLimitPerDay,
          maxVoiceSeconds: book.maxVoiceSeconds,
          hasAiKey,
          aiKeyLast4,
          canStoreKeys: canStoreKeys(),
          aiReady,
          bookModel: { providerId: choice.aiProviderId, model: choice.aiModel, options: bookModels },
          home: {
            onHome,
            featured: book.featured,
            canFeature: isSiteAdmin(user.email),
            eligible: canLeadHome(book),
          },
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
