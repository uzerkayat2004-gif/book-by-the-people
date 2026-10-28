import Link from "next/link";
import { notFound } from "next/navigation";
import { Reader } from "@/components/reader";
import { getCurrentUser } from "@/lib/auth";
import { currentDocument, loadBookBySlug } from "@/lib/load-book";
import { readableDraftId } from "@/lib/privacy";

export default async function ReadPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string; c?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const loaded = await loadBookBySlug(slug);
  if (!loaded) notFound();
  const user = await getCurrentUser();
  // Only the owner may preview a draft; everyone else reads the published version, once there is one.
  const draftId = readableDraftId(loaded, user ? { id: user.id } : null, query.preview === "1");
  if (!draftId) {
    return (
      <main className="page speak">
        <div className="narrow">
          <h1>Not published yet</h1>
          <p className="lead">The voices are still coming in, or the creator is still editing.</p>
          <Link className="btn btn--red btn--big btn--block" href={`/b/${loaded.slug}`}>
            Back to the book
          </Link>
        </div>
      </main>
    );
  }
  const document = await currentDocument(loaded.id, draftId);
  if (!document) notFound();
  const chapter = Number(query.c || "1");
  return (
    <Reader
      slug={loaded.slug}
      book={document}
      chapter={Number.isFinite(chapter) ? chapter : 1}
      media={{ audio: Boolean(loaded.audiobookKey), video: Boolean(loaded.videoKey) }}
    />
  );
}
