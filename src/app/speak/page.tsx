import { SignInForm } from "@/components/sign-in-form";
import { VoiceForm } from "@/components/voice-form";
import { getCurrentUser } from "@/lib/auth";
import { speechAvailable } from "@/lib/ai/speech";
import { getConfig } from "@/lib/config";
import { voiceBookLite } from "@/lib/public-books";
import { voicesLeftToday } from "@/lib/services/pipeline";
import { releaseLabel } from "@/lib/stage";

export default async function SpeakPage({ searchParams }: { searchParams: Promise<{ word?: string }> }) {
  const query = await searchParams;
  const user = await getCurrentUser();
  const book = await voiceBookLite();
  const cfg = getConfig();
  if (!user || !book) {
    return (
      <main className="page speak gate-live">
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
          <SignInForm
            nextPath="/speak"
            error={null}
            google={Boolean(cfg.googleClientId && cfg.googleClientSecret)}
            demoEmail={null}
          />
        </div>
      </main>
    );
  }
  return (
    <VoiceForm
      bookId={book.id}
      slug={book.slug}
      question={book.question}
      invite={null}
      paused={false}
      demo={cfg.aiMode === "mock"}
      preview={null}
      opens={releaseLabel(book.closesAt)}
      surface="live"
      presetName={user.name || ""}
      presetWord={query.word ?? null}
      leftToday={await voicesLeftToday(book.id, user.id)}
      cloudSpeech={await speechAvailable(book.id)}
    />
  );
}
