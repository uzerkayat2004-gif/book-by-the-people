import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminBookRow } from "@/components/admin/admin-book-row";
import { Pager, SearchBar } from "@/components/pager";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cleanSearch, pageOf } from "@/lib/privacy";
import { canLeadHome, ownerName } from "@/lib/public-books";
import { isNamedAdmin } from "@/lib/site-admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin", robots: { index: false, follow: false } };

/**
 * Site admin: choose the home page book and delete abusive books. It shows only the public card of each
 * book (title, question, owner name, status, voice count). There is no way from here to read voices,
 * transcripts, drafts, chapters, AI output, settings or keys of anyone's book.
 */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/admin");
  if (!isNamedAdmin(user.email)) notFound();
  const query = await searchParams;
  const q = cleanSearch(query.q);
  const postgres = /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "");
  const contains = postgres ? { contains: q, mode: "insensitive" as const } : { contains: q };
  const where = q ? { OR: [{ title: contains }, { question: contains }, { slug: contains }] } : {};
  const total = await prisma.book.count({ where });
  const paging = pageOf({ page: query.page, total, size: 20 });
  const books = await prisma.book.findMany({
    where,
    orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
    skip: paging.skip,
    take: paging.take,
    select: {
      id: true,
      slug: true,
      title: true,
      question: true,
      type: true,
      status: true,
      featured: true,
      unlisted: true,
      publishedDraftId: true,
      createdAt: true,
      creator: { select: { name: true, email: true } },
      _count: { select: { voices: true } },
    },
  });
  return (
    <main className="page explore adminpage">
      <div className="wrap">
        <p className="label">Site admin</p>
        <h1 className="explore__h">Books</h1>
        <p className="lead">Pick the home page book, or delete an abusive one. You see only what is public. Voices, drafts and keys stay with each owner.</p>
        <SearchBar action="/admin" q={q} placeholder="Find a book" />
        <ol className="adminlist" data-testid="admin-list">
          {books.map((book) => (
            <AdminBookRow
              key={book.id}
              book={{
                id: book.id,
                slug: book.slug,
                title: book.title,
                question: book.question,
                type: book.type,
                status: book.status,
                owner: ownerName(book.creator),
                voices: book._count.voices,
                featured: book.featured,
                unlisted: book.unlisted,
                canFeature: !book.unlisted && canLeadHome(book),
              }}
            />
          ))}
        </ol>
        {books.length === 0 ? <div className="card bl lib-empty">No books.</div> : null}
        <Pager base="/admin" page={paging.page} pages={paging.pages} params={{ q }} />
        <p className="ownbook">
          <Link href="/">Home</Link>
        </p>
      </div>
    </main>
  );
}
