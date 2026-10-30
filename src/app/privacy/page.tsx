import { IconCheck } from "@/components/icons";

export const metadata = { title: "Privacy · Book by the People" };

export default function PrivacyPage() {
  return (
    <main className="page" data-nofoot="">
      <div className="narrow done">
        <span className="label">Privacy</span>
        <h3>Your words, your name</h3>
        <ul className="trustlist">
          <li>
            <IconCheck />
            <span>Until a book is released, only your name, country and state are public. Your words stay sealed.</span>
          </li>
          <li>
            <IconCheck />
            <span>Quotes are always your exact words, with your name.</span>
          </li>
          <li>
            <IconCheck />
            <span>
              We never store your audio. When you speak, short pieces of it are sent to the AI provider the book&apos;s
              creator chose, only to turn them into words on your screen, then thrown away. (If the book has no speech
              model, your browser&apos;s own speech-to-text is used instead.) You can edit the words before you send.
            </span>
          </li>
          <li>
            <IconCheck />
            <span>
              Each book&apos;s creator brings their own AI key, usually Meta&apos;s models. Your words go to that AI only to
              check them and write the book. That provider&apos;s own privacy rules apply.
            </span>
          </li>
          <li>
            <IconCheck />
            <span>AI keys are encrypted and never shown again, not even to the creator.</span>
          </li>
          <li>
            <IconCheck />
            <span>
              The site runs on Vercel. Accounts, books and your words are kept in a Neon database. Finished
              book files (like the AI-read audiobook) are kept in Vercel Blob storage.
            </span>
          </li>
          <li>
            <IconCheck />
            <span>18+ only. Delete your voice any time before release.</span>
          </li>
        </ul>
      </div>
    </main>
  );
}
