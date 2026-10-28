import Link from "next/link";
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
        {books.length === 0 ? (
          <section className="firstrun" aria-labelledby="firstrun-title">
            <h2 id="firstrun-title">Make your first book</h2>
            <ol className="firstrun__steps">
              <li>
                <i>1</i>
                <b>Ask one question</b>
                <span>It goes on the cover.</span>
              </li>
              <li>
                <i>2</i>
                <b>Add your AI key</b>
                <span>Meta, OpenRouter or any provider. Encrypted.</span>
              </li>
              <li>
                <i>3</i>
                <b>Share the link</b>
                <span>People answer by voice. AI writes the book.</span>
              </li>
            </ol>
            <Link className="btn btn--red btn--big" href="/books/new">
              Start your first book
            </Link>
          </section>
        ) : (
          <p className="lead">Your books. Several can take voices at once. Each has its own settings, AI, make and release tabs.</p>
        )}
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
