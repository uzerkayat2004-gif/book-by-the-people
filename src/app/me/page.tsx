import Link from "next/link";
import { redirect } from "next/navigation";
import { EditProfile } from "@/components/edit-profile";
import { getCurrentUser } from "@/lib/auth";
import { countryByCode, flagEmoji } from "@/lib/countries";
import { prisma } from "@/lib/db";
import { voicesLeftToday } from "@/lib/services/pipeline";
import { releaseLabel } from "@/lib/stage";

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "B") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/me");
  const book = await prisma.book.findFirst({ where: { featured: true }, select: { id: true, slug: true, closesAt: true } });
  const mine = await prisma.book.findMany({ where: { creatorId: user.id }, orderBy: { updatedAt: "desc" }, select: { id: true, slug: true, title: true, status: true } });
  const spoken = await prisma.voice.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8, include: { book: { select: { title: true, slug: true } } } });
  const left = book ? await voicesLeftToday(book.id, user.id) : 3;
  const country = countryByCode(user.countryCode);
  const when = releaseLabel(book?.closesAt ?? null);
  return (
    <main className="page me">
      <div className="narrow">
        <div className="card prof">
          <span className="face" style={{ background: "var(--grad-btn)" }}>
            {initials(user.name || user.email)}
          </span>
          <div style={{ flex: 1 }}>
            <div className="prof__name">{user.name || "Your name"}</div>
            <div className="prof__meta">
              {country ? <span>{flagEmoji(country.code)} {user.region ? `${user.region}, ` : ""}{country.name}</span> : null}
              {user.ageBand ? <span>{user.ageBand}</span> : null}
              {user.handle ? <span>@{user.handle}</span> : null}
            </div>
          </div>
          <EditProfile
            name={user.name || ""}
            handle={user.handle}
            ageBand={user.ageBand}
            countryCode={user.countryCode || "IN"}
            region={user.region}
          />
        </div>
        <div className="sealhead">
          <span className="label red">Sealed until {when}</span>
        </div>
        <div className="card note">
          {spoken.length === 0 ? (
            <p className="muted" style={{ fontFamily: "var(--sans)", margin: 0 }}>
              Nothing yet.
            </p>
          ) : (
            spoken.map((voice) => (
              <p key={voice.id} style={{ margin: "0 0 8px" }}>
                <Link href={`/b/${voice.book.slug}`}>{voice.book.title}</Link>
                <span className="muted"> · {voice.status}</span>
              </p>
            ))
          )}
        </div>
        <div style={{ marginTop: 22 }}>
          <Link className="btn btn--red btn--big btn--block" href={book ? `/b/${book.slug}/voice` : "/speak"}>
            <span className="rec" />
            Add your voice
          </Link>
          <div className="under">{left} left today</div>
          <Link className="btn btn--block" href="/books/new" style={{ marginTop: 10 }}>
            Start your own book
          </Link>
          {mine.length ? (
            <div className="chlist4" style={{ marginTop: 16 }}>
              {mine.map((item) => (
                <Link key={item.id} href={`/studio/${item.slug}`} className="ch4">
                  <span className="ch4__t">
                    <b>{item.title}</b>
                    <small>{item.status}</small>
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
