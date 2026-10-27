import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function StudioPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/studio");
  const books = await prisma.book.findMany({
    where: { creatorId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { voices: true } } },
  });
  return (
    <main className="page admin">
      <div className="wrap admin4">
        <div className="ai__head">
          <div>
            <p className="label">{user.email}</p>
            <h1>Studio</h1>
          </div>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link className="btn btn--red" href="/books/new">
              New book
            </Link>
            <Link className="btn" href="/books/new">
              Start your own book
            </Link>
          </span>
        </div>
        {books.length === 0 ? (
          <div className="card bl">
            <p className="muted" style={{ fontFamily: "var(--sans)", margin: 0 }}>
              You have not started a book yet. The first one can be a question you actually want answered.
            </p>
          </div>
        ) : (
          <div className="chlist4">
            {books.map((book) => (
              <Link key={book.id} href={`/studio/${book.id}`} className="ch4">
                <span className="ch4__n">{book.status.slice(0, 2)}</span>
                <span className="ch4__t">
                  <b>{book.title}</b>
                  <small>
                    {book.type} · {book.status} · {book._count.voices} voices
                  </small>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
