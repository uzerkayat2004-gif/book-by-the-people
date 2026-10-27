"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-24">
      <h1 className="display text-6xl">Something slipped</h1>
      <p className="mt-4 text-sm text-white/60">The page could not load. Voices already stored are still there.</p>
      <button type="button" onClick={reset} className="mt-6 rounded-full bg-white px-4 py-2 text-sm text-black">
        Try again
      </button>
    </main>
  );
}
