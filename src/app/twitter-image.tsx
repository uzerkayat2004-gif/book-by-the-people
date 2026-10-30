import { OG_SIZE, ogCard } from "@/lib/og/card";

export const alt = "Book by the People: one question, everyone answers, a real book in people's exact words.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard({
    kicker: "One question · Everyone answers",
    title: "A real book, written from people's exact words.",
    foot: "Add your voice. Read the book when it drops.",
  });
}
