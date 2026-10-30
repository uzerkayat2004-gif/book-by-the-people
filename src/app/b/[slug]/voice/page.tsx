import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SignInForm } from "@/components/sign-in-form";
import { VoiceForm } from "@/components/voice-form";
import { getCurrentUser } from "@/lib/auth";
import { canAcceptVoice } from "@/lib/book/lifecycle";
import { getConfig } from "@/lib/config";
import { loadBookBySlug, pausedNow } from "@/lib/load-book";
import { voicesLeftToday } from "@/lib/services/pipeline";
import { releaseLabel } from "@/lib/stage";

export default async function VoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ invite?: string; step?: string; guest?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const loaded = await loadBookBySlug(slug);
  if (!loaded) notFound();
  if (loaded.type === "FAMOUS") redirect(`/studio/${loaded.id}`);
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

  const cfg = getConfig();
  const opens = releaseLabel(loaded.closesAt);
  const form = (
    <VoiceForm
      bookId={loaded.id}
      slug={loaded.slug}
      question={loaded.question}
      invite={query.invite ?? null}
      paused={paused}
      demo={cfg.aiMode === "mock"}
      preview={query.step ?? null}
      opens={opens}
      closed={!gate.ok}
      leftToday={await voicesLeftToday(loaded.id, user?.id ?? null)}
      defaultLanguage={loaded.language}
      maxSeconds={loaded.maxVoiceSeconds}
    />
  );

  if (query.step) return form;

  if (!gate.ok) {
    return (
      <main className="page speak">
        <div className="narrow">
          <div className="done">
            <h1>{loaded.status === "PUBLISHED" ? "The book is out" : "Voices are closed"}</h1>
            <p className="lead">{paused ? "Voices are paused right now." : gate.reason}</p>
          </div>
          <div className="grow" />
          <Link className="btn btn--red btn--big btn--block" href={loaded.status === "PUBLISHED" ? `/b/${loaded.slug}/read` : `/b/${loaded.slug}`}>
            {loaded.status === "PUBLISHED" ? "Read the book" : "Back to the book"}
          </Link>
        </div>
      </main>
    );
  }

  if (!user && !query.guest && loaded.type !== "INVITED") {
    const next = `/b/${loaded.slug}/voice${query.invite ? `?invite=${query.invite}` : ""}`;
    return (
      <main className="page speak">
        <div className="narrow">
          <div className="stepdots">
            <i className="on" />
            <i />
            <i />
            <i />
          </div>
          <h1>Add your voice</h1>
          <p className="lead">Sign in with Google to add your voice. Only your name and country are shown.</p>
          <div className="grow" />
          <SignInForm nextPath={next} error={null} google={Boolean(cfg.googleClientId && cfg.googleClientSecret)} demoEmail={null} />
          {loaded.type === "OPEN" ? (
            <Link className="link" href={`/b/${loaded.slug}/voice?guest=1`} style={{ display: "block", textAlign: "center", marginTop: 16 }}>
              Add a voice without an account
            </Link>
          ) : null}
        </div>
      </main>
    );
  }

  return form;
}
