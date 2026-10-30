import { redirect } from "next/navigation";
import { CreateBookForm } from "@/components/create-book-form";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { aiOptions } from "@/lib/ai/book-ai";

export const metadata = { title: "Start a book", robots: { index: false, follow: false } };

export default async function NewBookPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/books/new");
  const books = await prisma.book.findMany({
    where: { creatorId: user.id },
    include: { pollOptions: { include: { _count: { select: { votes: true } } } } },
  });
  let suggestion = "";
  let best = 0;
  for (const book of books) {
    for (const option of book.pollOptions) {
      if (option._count.votes > best) {
        best = option._count.votes;
        suggestion = option.label;
      }
    }
  }
  const ai = await aiOptions(user.id);
  const first = books.length === 0;
  return (
    <main className="page admin newbookpage">
      <div className="wrap admin4">
        <p className="label">Studio · new book</p>
        <h1>{first ? "Your first book" : "New book"}</h1>
        <p className="lead">One question. Pick who can answer it, when it comes out, and the AI that writes it.</p>
        <CreateBookForm suggestion={suggestion} ai={ai} />
      </div>
    </main>
  );
}
