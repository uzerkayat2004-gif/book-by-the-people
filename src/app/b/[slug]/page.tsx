import { notFound } from "next/navigation";
import { readerTracks } from "@/lib/media/meta/audiobook";
import { readerFilm } from "@/lib/media/meta/videobook";
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
import { langAttrs, uiFor } from "@/lib/i18n";
import { LangSwitch } from "@/components/lang-switch";
import { readyLanguages, translatedDocument } from "@/lib/services/translations";

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
  searchParams: Promise<{ invite?: string; stage?: string; lang?: string }>;
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
  const original = isReleasedBook(loaded) ? await currentDocument(loaded.id, loaded.publishedDraftId) : null;
  // Released in more languages? ?lang=ja shows that edition (page words included).
  const languages = original ? await readyLanguages(loaded.id) : [];
  const bookLang = loaded.language || "en";
  const wanted = query.lang && languages.includes(query.lang) && query.lang !== bookLang ? query.lang : "";
  const edition = wanted ? await translatedDocument(loaded.id, wanted, loaded.publishedDraftId) : null;
  const document = edition ?? original;
  const pageLang = edition ? wanted : bookLang;
  const ui = uiFor(pageLang, edition ? null : loaded.uiJson);
  if (loaded.status === "PUBLISHED") await refreshStaleMedia(loaded.id).catch(() => undefined);
  const vote = await voterChoice(loaded.id);
  const film = loaded.status === "PUBLISHED" ? await readerFilm(loaded).catch(() => null) : null;
  const meta = loaded.status === "PUBLISHED" ? await readerTracks(loaded, pageLang).catch(() => ({ tracks: [], credit: "" })) : { tracks: [], credit: "" };
  const model = presentHome({
    readQuery: edition ? `lang=${wanted}` : "",
    status: loaded.status,
    stageOverride: query.stage,
    question: edition?.question || loaded.question,
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
    liveGlobe: loaded.type === "OPEN" && !loaded.unlisted,
    audioBytes: loaded.audiobookBytes,
  });
  return (
    <BookHome
      {...model}
      slug={loaded.slug}
      media={{ audio: Boolean(loaded.audiobookKey), video: Boolean(loaded.videoKey), audioBytes: loaded.audiobookBytes, videoBytes: loaded.videoBytes, tracks: meta.tracks, credit: meta.credit, film }}
      mode="book"
      owner={ownerName(loaded.creator)}
      ui={ui}
      lang={langAttrs(pageLang)}
      title={edition?.title || loaded.title}
      languages={
        languages.length > 1 ? (
          <div className="bookhero4__langs">
            <LangSwitch languages={languages} current={pageLang} label={ui.language} href={(code) => `/b/${loaded.slug}${code === bookLang ? "" : `?lang=${code}`}`} />
          </div>
        ) : null
      }
    />
  );
}
