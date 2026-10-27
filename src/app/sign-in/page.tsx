import { SignInForm } from "@/components/sign-in-form";
import { getConfig } from "@/lib/config";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const cfg = getConfig();
  const nextPath = params.next && params.next.startsWith("/") ? params.next : "/studio";
  const speak = nextPath.startsWith("/speak") || nextPath.includes("/voice");
  const error =
    params.error === "expired"
      ? "That link expired. Ask for another."
      : params.error === "google"
        ? "Google sign-in is not available."
        : params.error
          ? "That link did not work."
          : null;
  return (
    <main className={`page speak gate gate-live${speak ? "" : " gate-signin"}`}>
      <div className="narrow">
        {speak ? (
          <div className="stepdots">
            <i className="on" />
            <i />
            <i />
            <i />
          </div>
        ) : null}
        <h1>{speak ? "Add your voice" : "Sign in"}</h1>
        {speak ? <p className="lead">Sign in with Google to add your voice. Only your name and country are shown.</p> : null}
        <div className="grow" />
        <SignInForm
          nextPath={nextPath}
          error={error}
          google={Boolean(cfg.googleClientId && cfg.googleClientSecret)}
          demoEmail={cfg.aiMode === "mock" ? "demo@bookbythepeople.dev" : null}
        />
      </div>
    </main>
  );
}
