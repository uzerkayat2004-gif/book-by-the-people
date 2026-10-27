import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";

if (process.env.DATABASE_URL?.startsWith("file:./") || process.env.DATABASE_URL?.startsWith("file:../")) {
  const file = process.env.DATABASE_URL.slice("file:".length);
  process.env.DATABASE_URL = `file:${path.resolve(process.cwd(), file)}`;
}
import { assembleBook } from "../src/lib/book/assemble";
import { wavDurationMs } from "../src/lib/book/speech";
import type { SourceVoice } from "../src/lib/book/types";

const prisma = new PrismaClient();
const audioDir = path.join(process.cwd(), "data", "audio");

const sample = [
  {
    id: "voice_meera",
    name: "Meera Iyer",
    country: "IN",
    language: "en",
    espeak: "en-us",
    startWord: "mango",
    original: "The draft makes me smarter when I check the answer and lazier when I skip the draft. I want the argument, not the shortcut.",
    english: "The draft makes me smarter when I check the answer and lazier when I skip the draft. I want the argument, not the shortcut.",
    translated: false,
  },
  {
    id: "voice_luis",
    name: "Luis Ortega",
    country: "MX",
    language: "es",
    espeak: "es",
    startWord: "faro",
    original: "El borrador me hace revisar la respuesta. Me vuelvo más perezoso cuando dejo de comprobar.",
    english: "The draft makes me check the answer. I get lazier when I stop checking.",
    translated: true,
  },
  {
    id: "voice_adeola",
    name: "Adeola Bankole",
    country: "NG",
    language: "en",
    espeak: "en-us",
    startWord: "copper",
    original: "The draft makes me lazier when I skip the draft and smarter when I check the answer. I will take the sharper question over the faster one.",
    english: "The draft makes me lazier when I skip the draft and smarter when I check the answer. I will take the sharper question over the faster one.",
    translated: false,
  },
  {
    id: "voice_kabir",
    name: "Kabir Shah",
    country: "IN",
    language: "hinglish",
    espeak: "en-in",
    startWord: "chai",
    original: "My memory gets worse because I forget the lesson I did not write and the memory fades, yaar, by the weekend.",
    english: "My memory gets worse because I forget the lesson I did not write and the memory fades, yaar, by the weekend.",
    translated: false,
  },
  {
    id: "voice_chloe",
    name: "Chloe Martin",
    country: "FR",
    language: "fr",
    espeak: "fr",
    startWord: "mangue",
    original: "Ma mémoire empire parce que j'oublie la leçon que je n'ai pas écrite moi-même.",
    english: "My memory gets worse because I forget the lesson I did not write and the memory fades.",
    translated: true,
  },
];

function writeClip(file: string, voice: string, text: string) {
  try {
    execFileSync("espeak-ng", ["-v", voice, "-s", "148", "-w", file, text], { stdio: "ignore" });
  } catch {
    execFileSync(
      "ffmpeg",
      ["-y", "-f", "lavfi", "-i", "sine=frequency=196:duration=4", "-ac", "1", "-ar", "24000", file],
      { stdio: "ignore" },
    );
  }
}

async function alignFeaturedHome() {
  const book = await prisma.book.findUnique({ where: { slug: "smarter-or-lazier" } });
  if (!book) return;
  await prisma.voice.updateMany({
    where: { bookId: book.id, contributorName: { in: ["Meera Iyer", "Usman"] } },
    data: { contributorName: "Usman", countryCode: "IN", hidden: false },
  });
  await prisma.voice.updateMany({
    where: { bookId: book.id, contributorName: { in: ["Kabir Shah", "Uzer Kayat"] } },
    data: { contributorName: "Uzer Kayat", countryCode: "IN", hidden: false },
  });
  await prisma.voice.updateMany({
    where: { bookId: book.id, contributorName: { in: ["Luis Ortega", "Adeola Bankole", "Chloe Martin"] } },
    data: { hidden: true },
  });
}

async function main() {
  await alignFeaturedHome();
  const existing = await prisma.book.findUnique({ where: { slug: "smarter-or-lazier" } });
  if (existing) {
    const owner = await prisma.user.findUnique({ where: { email: "demo@bookbythepeople.dev" } });
    if (owner && !(await prisma.book.findUnique({ where: { slug: "book-by-the-people" } }))) {
      await prisma.book.create({
        data: {
          slug: "book-by-the-people",
          title: "Book by the People",
          question: "Is AI making you smarter or lazier?",
          type: "OPEN",
          status: "COLLECTING",
          closesAt: new Date("2026-10-25T18:30:00.000Z"),
          creatorId: owner.id,
          inviteToken: "live-studio-invite",
          featured: false,
          pollQuestion: "What should the next book ask?",
          pollOptions: {
            create: [
              { label: "Should kids under 16 be banned from social media?", position: 0 },
              { label: "Would you quit your safe job to start your own business?", position: 1 },
              { label: "Would you work 70 hours a week and miss your family and friends, until you're rich?", position: 2 },
            ],
          },
        },
      });
    }
    console.log("Sample book already seeded.");
    await ensureLibrary();
    return;
  }
  mkdirSync(audioDir, { recursive: true });
  const user = await prisma.user.upsert({
    where: { email: "demo@bookbythepeople.dev" },
    update: {},
    create: {
      email: "demo@bookbythepeople.dev",
      name: "Uzer Kayat",
      countryCode: "IN",
      region: "Gujarat",
      ageBand: "18–24",
      handle: "uzerkayat",
    },
  });

  const voices: SourceVoice[] = [];
  for (const [index, person] of sample.entries()) {
    const file = path.join(audioDir, `${person.id}.wav`);
    const spoken = `${person.startWord}. ${person.original}`;
    writeClip(file, person.espeak, spoken);
    const bytes = readFileSync(file);
    const durationMs = wavDurationMs(bytes) ?? 6000;
    const cut = Math.min(900, Math.round(durationMs * 0.18));
    const createdAt = Date.parse("2026-10-20T00:00:00Z") + index * 3600_000;
    voices.push({
      id: person.id,
      contributorName: person.name,
      language: person.language,
      countryCode: person.country,
      originalText: spoken,
      englishText: person.english,
      translated: person.translated,
      turns: [
        { turnId: 1, startMs: 0, endMs: cut, transcript: `${person.startWord}.` },
        { turnId: 2, startMs: cut, endMs: durationMs, transcript: person.original },
      ],
      durationMs,
      createdAt,
      kind: "voice",
      sourceUrl: null,
      sourceTitle: null,
      hidden: false,
      status: "READY",
      startWord: person.startWord,
      hasAudio: true,
    });
  }

  const document = assembleBook({
    title: "Book by the People",
    question: "Is AI making you smarter or lazier?",
    bookType: "OPEN",
    voices,
    now: "2026-10-26T16:00:00.000Z",
    provider: "mock",
    model: "local-assembly",
  });

  const book = await prisma.book.create({
    data: {
      slug: "smarter-or-lazier",
      title: "Book by the People",
      question: "Is AI making you smarter or lazier?",
      type: "OPEN",
      coverVibe: "ember",
      status: "PUBLISHED",
      closesAt: new Date("2026-10-25T18:30:00.000Z"),
      publishedAt: new Date("2026-10-26T16:00:00.000Z"),
      creatorId: user.id,
      inviteToken: "sample-invite-token",
      featured: true,
      pollQuestion: "What should the next book ask?",
      pollOptions: {
        create: [
          { label: "Should kids under 16 be banned from social media?", position: 0 },
          { label: "Would you quit your safe job to start your own business?", position: 1 },
          { label: "Would you work 70 hours a week and miss your family and friends, until you're rich?", position: 2 },
        ],
      },
    },
  });

  for (const voice of voices) {
    await prisma.voice.create({
      data: {
        id: voice.id,
        bookId: book.id,
        contributorName: voice.contributorName,
        language: voice.language,
        countryCode: voice.countryCode,
        consentAt: new Date(voice.createdAt),
        storageKey: `${voice.id}.wav`,
        mimeType: "audio/wav",
        durationMs: voice.durationMs,
        startWord: voice.startWord,
        startWordPassed: true,
        originalText: voice.originalText,
        englishText: voice.englishText,
        translated: voice.translated,
        turnsJson: JSON.stringify(voice.turns),
        status: "READY",
        kind: "voice",
        createdAt: new Date(voice.createdAt),
      },
    });
  }

  const draft = await prisma.bookDraft.create({
    data: {
      bookId: book.id,
      version: 1,
      contentJson: JSON.stringify(document),
      provider: "mock",
      model: "local-assembly",
      note: "Sample book for demo mode. The clips are spoken by a local voice so the reader works without an API key.",
    },
  });
  await prisma.book.update({
    where: { id: book.id },
    data: { currentDraftId: draft.id, publishedDraftId: draft.id },
  });
  console.log(`Seeded ${document.chapters.length} chapters and ${voices.length} voices.`);
  await ensureLibrary();
}

const FAMOUS = [
  {
    speaker: "Ada Lovelace",
    date: "1843",
    title: "Notes on the Analytical Engine",
    url: "https://en.wikisource.org/wiki/Scientific_Memoirs/3/Note_G",
    text: "The Analytical Engine weaves algebraical patterns just as the Jacquard-loom weaves flowers and leaves.",
  },
  {
    speaker: "Abraham Lincoln",
    date: "1863-11-19",
    title: "Gettysburg Address",
    url: "https://en.wikisource.org/wiki/Gettysburg_Address_(Bliss_copy)",
    text: "that government of the people, by the people, for the people, shall not perish from the earth.",
  },
  {
    speaker: "Marcus Aurelius",
    date: "1862",
    title: "The Meditations, Book IV",
    url: "https://en.wikisource.org/wiki/The_Thoughts_of_the_Emperor_Marcus_Aurelius_Antoninus/Book_IV",
    text: "Do not act as if thou wert going to live ten thousand years. Death hangs over thee. While thou livest, while it is in thy power, be good.",
  },
];

async function ensureLibrary() {
  const owner = await prisma.user.findUnique({ where: { email: "demo@bookbythepeople.dev" } });
  if (!owner) return;
  await prisma.user.update({
    where: { id: owner.id },
    data: { name: "Uzer Kayat", countryCode: "IN", region: "Gujarat", ageBand: "18–24", handle: "uzerkayat" },
  });
  const studio = await prisma.book.findUnique({ where: { slug: "book-by-the-people" } });
  if (studio && (await prisma.backup.count({ where: { bookId: studio.id } })) === 0) {
    const rows = [
      ["2 days ago", 0],
      ["4 days ago", 0],
      ["4 days ago", 4],
      ["4 days ago", 2],
      ["4 days ago", 2],
      ["4 days ago", 0],
    ] as const;
    for (const [label, voiceCount] of rows) {
      await prisma.backup.create({
        data: { bookId: studio.id, label, voiceCount, note: "Sample backup row." },
      });
    }
  }
  if (!(await prisma.book.findUnique({ where: { slug: "sunday-table" } }))) {
    await prisma.book.create({
      data: {
        slug: "sunday-table",
        title: "Sunday table",
        question: "What do you want the people you love to remember?",
        type: "INVITED",
        status: "COLLECTING",
        closesAt: new Date("2026-12-01T18:30:00.000Z"),
        creatorId: owner.id,
        inviteToken: "sunday-invite",
        featured: false,
        pollQuestion: "What should the next book ask?",
        pollOptions: {
          create: [
            { label: "What did a stranger teach you?", position: 0 },
            { label: "What are you afraid to automate?", position: 1 },
          ],
        },
      },
    });
  }
  const asha = await prisma.user.upsert({
    where: { email: "asha@bookbythepeople.dev" },
    update: {},
    create: { email: "asha@bookbythepeople.dev", name: "Asha Menon", countryCode: "IN", region: "Kerala" },
  });
  if (!(await prisma.book.findUnique({ where: { slug: "city-at-night" } }))) {
    await prisma.book.create({
      data: {
        slug: "city-at-night",
        title: "City at night",
        question: "What does your city sound like after midnight?",
        type: "OPEN",
        status: "COLLECTING",
        closesAt: new Date("2026-12-15T18:30:00.000Z"),
        creatorId: asha.id,
        inviteToken: "city-invite",
        featured: false,
        pollQuestion: "What should the next book ask?",
        pollOptions: {
          create: [
            { label: "Who keeps the city running?", position: 0 },
            { label: "What would you walk home for?", position: 1 },
          ],
        },
      },
    });
  }
  if (!(await prisma.book.findUnique({ where: { slug: "on-the-record" } }))) {
    const book = await prisma.book.create({
      data: {
        slug: "on-the-record",
        title: "On the record",
        question: "What has been said, in public, about thinking clearly?",
        type: "FAMOUS",
        status: "PUBLISHED",
        publishedAt: new Date("2026-10-26T16:00:00.000Z"),
        creatorId: owner.id,
        inviteToken: "record-invite",
        featured: false,
        pollQuestion: "What should the next book ask?",
        pollOptions: {
          create: [
            { label: "Which public line should the next book start from?", position: 0 },
            { label: "Whose letters should we read next?", position: 1 },
          ],
        },
      },
    });
    const voices: SourceVoice[] = FAMOUS.map((quote, index) => ({
      id: `quote_${index}`,
      contributorName: quote.speaker,
      language: "en",
      countryCode: null,
      originalText: quote.text,
      englishText: quote.text,
      translated: false,
      turns: [],
      durationMs: 0,
      createdAt: Date.parse("2026-10-01T00:00:00Z") + index * 1000,
      kind: "sourced_quote",
      sourceUrl: quote.url,
      sourceTitle: quote.title,
      sourceDate: quote.date,
      hidden: false,
      status: "READY",
      startWord: "",
      hasAudio: false,
    }));
    for (const quote of FAMOUS) {
      await prisma.voice.create({
        data: {
          bookId: book.id,
          contributorName: quote.speaker,
          language: "en",
          consentAt: new Date("2026-10-01T00:00:00.000Z"),
          originalText: quote.text,
          englishText: quote.text,
          status: "READY",
          kind: "sourced_quote",
          sourceUrl: quote.url,
          sourceTitle: quote.title,
          sourceDate: quote.date,
          startWordPassed: true,
          decision: "approved",
          themeLabel: "Record",
          pipelineStep: "group",
        },
      });
    }
    const document = assembleBook({
      title: book.title,
      question: book.question,
      bookType: "FAMOUS",
      voices,
      now: "2026-10-26T16:00:00.000Z",
      provider: "mock",
      model: "sourced-only",
    });
    const draft = await prisma.bookDraft.create({
      data: {
        bookId: book.id,
        version: 1,
        contentJson: JSON.stringify(document),
        provider: "mock",
        model: "sourced-only",
        note: "Public-domain quotations only. Nothing here was generated.",
      },
    });
    await prisma.book.update({
      where: { id: book.id },
      data: { currentDraftId: draft.id, publishedDraftId: draft.id },
    });
  }
  await ensureReleaseMedia();
  console.log("Demo library ready.");
}

async function ensureReleaseMedia() {
  const books = await prisma.book.findMany({
    where: { status: "PUBLISHED", audiobookKey: null, slug: { in: ["smarter-or-lazier", "on-the-record"] } },
    include: { drafts: { orderBy: { version: "desc" }, take: 1 } },
  });
  mkdirSync(audioDir, { recursive: true });
  for (const book of books) {
    const raw = book.drafts[0]?.contentJson;
    let script = `${book.title}. ${book.question}`;
    if (raw) {
      try {
        const document = JSON.parse(raw) as { chapters?: { title: string; quotes?: { englishText?: string; hidden?: boolean }[] }[] };
        const parts: string[] = [];
        for (const chapter of document.chapters ?? []) {
          parts.push(chapter.title);
          for (const quote of chapter.quotes ?? []) {
            if (!quote.hidden && quote.englishText) parts.push(quote.englishText);
          }
        }
        if (parts.length) script = parts.join(". ").slice(0, 700);
      } catch {
        script = book.title;
      }
    }
    const wav = path.join(audioDir, `book-${book.id}-speech.wav`);
    const mp3 = path.join(audioDir, `book-${book.id}-audiobook.mp3`);
    const mp4 = path.join(audioDir, `book-${book.id}-video.mp4`);
    try {
      execFileSync("espeak-ng", ["-v", "en-us", "-s", "150", "-w", wav, script], { stdio: "ignore" });
    } catch {
      execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=196:duration=3", "-ac", "1", "-ar", "24000", wav], { stdio: "ignore" });
    }
    execFileSync("ffmpeg", ["-y", "-i", wav, "-codec:a", "libmp3lame", "-qscale:a", "8", mp3], { stdio: "ignore" });
    const title = book.title.replace(/'/g, "").slice(0, 60);
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-i",
        wav,
        "-f",
        "lavfi",
        "-i",
        "color=c=0x9b1c24:s=854x480:d=6",
        "-filter_complex",
        `[1:v]drawtext=fontfile=/usr/share/fonts/truetype/macos/Inter-Bold.ttf:text='BOOK BY THE PEOPLE':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=150,drawtext=fontfile=/usr/share/fonts/truetype/macos/Inter-Bold.ttf:text='${title}':fontsize=22:fontcolor=white:x=(w-text_w)/2:y=220[v]`,
        "-map",
        "[v]",
        "-map",
        "0:a",
        "-shortest",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        mp4,
      ],
      { stdio: "ignore" },
    );
    const audioBytes = readFileSync(mp3).length;
    const videoBytes = readFileSync(mp4).length;
    await prisma.book.update({
      where: { id: book.id },
      data: {
        audiobookKey: `book-${book.id}-audiobook.mp3`,
        videoKey: `book-${book.id}-video.mp4`,
        audiobookBytes: audioBytes,
        videoBytes: videoBytes,
      },
    });
    console.log(`Media for ${book.slug}: audio ${audioBytes} video ${videoBytes}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
