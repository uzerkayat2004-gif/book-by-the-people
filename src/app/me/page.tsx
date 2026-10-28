import Link from "next/link";
import { redirect } from "next/navigation";
import { DeleteMyVoice } from "@/components/delete-my-voice";
import { EditProfile } from "@/components/edit-profile";
import { getCurrentUser } from "@/lib/auth";
import { countryByCode, flagEmoji } from "@/lib/countries";
import { prisma } from "@/lib/db";
import { homeBookLite } from "@/lib/public-books";
import { voicesLeftToday } from "@/lib/services/pipeline";
import { releaseLabel } from "@/lib/stage";

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "B") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default async function MePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/me");
  const book = await homeBookLite();
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
              {[
                country ? `${flagEmoji(country.code)} ${user.region ? `${user.region}, ` : ""}${country.name}` : null,
                user.ageBand || null,
                user.handle ? `@${user.handle}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
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
                <span className="muted"> · {voice.status === "READY" ? "sealed" : voice.status.toLowerCase()} · </span>
                <DeleteMyVoice voiceId={voice.id} compact />
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
        </div>
        <div className="meown">
          <span className="label">Your books</span>
          {mine.length ? (
            <div className="mebooks">
              {mine.map((item) => (
                <Link key={item.id} href={`/studio/${item.slug}`} className="mebook">
                  <span>{item.title}</span>
                  <small>{item.status === "PUBLISHED" ? "Released" : item.status === "COLLECTING" ? "Taking voices" : item.status.toLowerCase()} · Studio →</small>
                </Link>
              ))}
            </div>
          ) : null}
          <Link className="btn btn--block" href="/books/new">
            + Start your own book
          </Link>
        </div>
      </div>
    </main>
  );
}
