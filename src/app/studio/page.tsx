import { redirect } from "next/navigation";
import { BookCard, NewBookCard } from "@/components/book-card";
import { getCurrentUser } from "@/lib/auth";
import { bookCards } from "@/lib/book-cards";

export default async function StudioPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/studio");
  const books = await bookCards({ creatorId: user.id });
  return (
    <main className="page explore studiolist">
      <div className="exwrap">
        <p className="label">{user.email}</p>
        <h1 className="explore__h">Studio</h1>
        <p className="lead">Your books. Each one has its own settings, AI, make and release tabs.</p>
        <div className="bgrid">
          <NewBookCard />
          {books.map((book) => (
            <BookCard key={book.id} book={book} href={`/studio/${book.slug}`} cta="Open studio" />
          ))}
        </div>
      </div>
    </main>
  );
}
