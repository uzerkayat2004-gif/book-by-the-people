import { redirect } from "next/navigation";
import { CreateBookForm } from "@/components/create-book-form";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
  return (
    <main className="page admin newbookpage">
      <div className="wrap admin4">
        <p className="label">Studio · new book</p>
        <h1>New book</h1>
        <p className="lead">One question. Pick who can answer it and when it comes out.</p>
        <CreateBookForm suggestion={suggestion} />
      </div>
    </main>
  );
}
