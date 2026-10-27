import { IconCheck } from "@/components/icons";

export default function PrivacyPage() {
  return (
    <main className="page" data-nofoot="">
      <div className="narrow done">
        <span className="label">Privacy</span>
        <h3>Your words, your name</h3>
        <ul className="trustlist">
          <li>
            <IconCheck />
            <span>
              Before Oct 26 only your name, country and state are public. Your
              words stay sealed.
            </span>
          </li>
          <li>
            <IconCheck />
            <span>Quotes are always your exact words, with your name.</span>
          </li>
          <li>
            <IconCheck />
            <span>
              An AI service (Nebius) sorts the voices. It isn&apos;t used for
              training.
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
