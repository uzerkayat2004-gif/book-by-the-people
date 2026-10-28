import { IconCheck } from "@/components/icons";

export const metadata = { title: "Terms · Book by the People" };

export default function TermsPage() {
  return (
    <main className="page" data-nofoot="">
      <div className="narrow done">
        <span className="label">Terms</span>
        <h3>Simple rules</h3>
        <ul className="trustlist">
          <li>
            <IconCheck />
            <span>The app is free. Creators bring their own AI key and pay their AI provider directly.</span>
          </li>
          <li>
            <IconCheck />
            <span>Your voice stays yours. A book quotes your exact words, with your name.</span>
          </li>
          <li>
            <IconCheck />
            <span>No hate, harassment or someone else&apos;s private details. We remove voices that break this.</span>
          </li>
          <li>
            <IconCheck />
            <span>18+ only. Delete your voice any time before the book is released.</span>
          </li>
          <li>
            <IconCheck />
            <span>The service is offered as is, with no warranty.</span>
          </li>
        </ul>
      </div>
    </main>
  );
}
