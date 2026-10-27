import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Editor } from "@/components/editor";
import { getCurrentUser } from "@/lib/auth";
import { parseDocument } from "@/lib/book/assemble";
import { prisma } from "@/lib/db";

export default async function EditorPage({ params }: { params: Promise<{ bookId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/studio");
  const { bookId } = await params;
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book || book.creatorId !== user.id) notFound();
  if (!book.currentDraftId) {
    return (
      <main className="page speak">
        <div className="narrow">
          <h1>No draft yet</h1>
          <Link className="btn btn--red btn--big btn--block" href={`/studio/${book.id}`}>
            Make the book first
          </Link>
        </div>
      </main>
    );
  }
  const draft = await prisma.bookDraft.findUnique({ where: { id: book.currentDraftId } });
  const document = draft ? parseDocument(draft.contentJson) : null;
  if (!document) notFound();
  return (
    <main className="page admin">
      <div className="wrap admin4">
        <Editor bookId={book.id} slug={book.slug} initial={document} />
      </div>
    </main>
  );
}
