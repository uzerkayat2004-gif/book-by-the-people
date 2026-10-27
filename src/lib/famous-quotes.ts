/**
 * Real, public-domain quotations, each checked against its source text.
 * Used to seed the demo Famous book, and in mock mode as clearly labeled
 * samples. Famous books never generate or paraphrase a quote.
 */
export type FamousQuote = {
  speaker: string;
  date: string;
  title: string;
  url: string;
  text: string;
};

export const FAMOUS_SAMPLES: FamousQuote[] = [
  {
    speaker: "Plato",
    date: "c. 370 BC",
    title: "Phaedrus (Jowett translation, Project Gutenberg #1636)",
    url: "https://www.gutenberg.org/ebooks/1636",
    text: "this discovery of yours will create forgetfulness in the learners' souls, because they will not use their memories; they will trust to the external written characters and not remember of themselves.",
  },
  {
    speaker: "Ada Lovelace",
    date: "1843",
    title: "Scientific Memoirs, Vol. 3, Note G",
    url: "https://en.wikisource.org/wiki/Page:Scientific_Memoirs,_Vol._3_(1843).djvu/732",
    text: "The Analytical Engine has no pretensions whatever to originate any thing. It can do whatever we know how to order it to perform.",
  },
  {
    speaker: "Francis Bacon",
    date: "1625",
    title: "Of Studies, The Essays (Project Gutenberg #575)",
    url: "https://www.gutenberg.org/ebooks/575",
    text: "Reading maketh a full man; conference a ready man; and writing an exact man.",
  },
];

/** The seeded Famous book: the samples above plus one more checked line. */
export const FAMOUS_RECORD: FamousQuote[] = [
  ...FAMOUS_SAMPLES,
  {
    speaker: "Abraham Lincoln",
    date: "1863-11-19",
    title: "Gettysburg Address (Bliss copy), Wikisource",
    url: "https://en.wikisource.org/wiki/Gettysburg_Address_(Bliss_copy)",
    text: "that government of the people, by the people, for the people, shall not perish from the earth.",
  },
];

export const SAMPLE_PREFIX = "Sample · ";

/** Twitter/X status IDs are snowflakes: the post time is encoded in the ID. */
export function xPostDate(url: string): string | null {
  const match = url.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d{15,20})/i);
  if (!match) return null;
  const ms = Number(BigInt(match[1]) >> BigInt(22)) + 1288834974657;
  if (!Number.isFinite(ms) || ms < Date.UTC(2010, 10, 4)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}
