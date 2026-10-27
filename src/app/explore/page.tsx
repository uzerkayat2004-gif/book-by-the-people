import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const books = await prisma.book.findMany({
    where: { type: { in: ["OPEN", "FAMOUS"] }, featured: false },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { voices: true } } },
  });
  return (
    <main className="page home4">
      <div className="wrap">
        <h1>Explore</h1>
        <p className="lead">Open books, invited books, and famous-voice books made from public quotations.</p>
        {books.length === 0 ? <div className="card bl">No other books yet.</div> : null}
        <div className="chlist4">
          {books.map((book) => (
            <Link key={book.id} href={`/b/${book.slug}`} className="ch4">
              <span className="ch4__n">{book.type.slice(0, 2)}</span>
              <span className="ch4__t">
                <b>{book.title}</b>
                <small>
                  {book.question} · {book._count.voices} voices · {book.status}
                </small>
              </span>
            </Link>
          ))}
        </div>
        <p className="ownbook">
          <Link href="/books/new">Start your own book</Link>
        </p>
      </div>
    </main>
  );
}
