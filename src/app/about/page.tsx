import Link from "next/link";

export const metadata = { title: "About", description: "One question. Everyone answers in their own words. A real book, in people's exact words." };

export default function AboutPage() {
  return (
    <main className="page" data-nofoot="">
      <div className="narrow done">
        <span className="label">About</span>
        <h1>Book by the People</h1>
        <p>
          One question. Everyone writes an answer in their own words. AI checks every voice and groups the same views, then writes a real book
          using people&apos;s exact words, with every contributor credited.
        </p>
        <p>
          <Link href="/books">See the books taking voices now</Link> · <Link href="/library">Read released books</Link>
        </p>
      </div>
    </main>
  );
}
