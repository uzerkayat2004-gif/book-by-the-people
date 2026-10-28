/**
 * Demo seed. Rebuilds the demo library from scratch every run:
 *   - Uzer Kayat (demo@bookbythepeople.dev): Book 1 "Is AI making you smarter or lazier?" (OPEN, published,
 *     featured) with backup history and release media, plus "Sunday table" (INVITED, collecting).
 *   - Asha Menon (asha@bookbythepeople.dev): "On the record" (FAMOUS, published, real sourced quotes only)
 *     and "Notes to my younger self" (SOLO, collecting).
 *   - Rafael Costa (rafael@bookbythepeople.dev): "City at night" (OPEN, collecting, one voice needs review).
 * Voice clips and the audiobook are spoken locally (system eSpeak NG, the Windows or macOS voice, or the
 * built-in WebAssembly eSpeak NG), so nothing needs an API key or an installed program.
 * Refuses to run against production unless SEED_FORCE=1.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { assembleBook } from "../src/lib/book/assemble";
import { themeLabel } from "../src/lib/book/plan";
import { wavDurationMs } from "../src/lib/book/speech";
import type { SourceVoice } from "../src/lib/book/types";
import { FAMOUS_RECORD } from "../src/lib/famous-quotes";
import { wasmSpeakToWav, wavToMp3 } from "../src/lib/media/js-audio";
import { narrationScript } from "../src/lib/media/script";
import { mediaVersionKey } from "../src/lib/media/version";

if (process.env.DATABASE_URL?.startsWith("file:./") || process.env.DATABASE_URL?.startsWith("file:../")) {
  process.env.DATABASE_URL = `file:${path.resolve(process.cwd(), process.env.DATABASE_URL.slice("file:".length))}`;
}
if (process.env.NODE_ENV === "production" && process.env.SEED_FORCE !== "1") {
  console.error("Refusing to reseed a production database. Set SEED_FORCE=1 if you mean it.");
  process.exit(1);
}

const prisma = new PrismaClient();
const audioDir = path.resolve(process.env.LOCAL_STORAGE_DIR || path.join("data", "audio"));
const SAMPLE_USER = "seed-sample";
const NOW = Date.now();
const DAY = 86_400_000;
const FONT =
  [
    process.env.MEDIA_FONT ?? "",
    "/usr/share/fonts/truetype/macos/Inter-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "C:\\Windows\\Fonts\\segoeuib.ttf",
    "C:\\Windows\\Fonts\\arialbd.ttf",
  ].find((file) => file && existsSync(file)) ?? "";

/** ffmpeg from FFMPEG_PATH, then the copy from Book settings → Audio tools, then PATH. */
const FFMPEG =
  [
    process.env.FFMPEG_PATH ?? "",
    path.join(
      path.resolve(process.env.LOCAL_MODELS_DIR || path.join("data", "models")),
      "runtime",
      "tools",
      process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
    ),
  ].find((file) => file && existsSync(file)) ?? "ffmpeg";
const HAS_FFMPEG = (() => {
  try {
    execFileSync(FFMPEG, ["-version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();

type Person = {
  id: string;
  name: string;
  country: string;
  language: string;
  espeak: string;
  startWord: string;
  original: string;
  english: string;
  translated: boolean;
  hidden?: boolean;
  sample?: boolean;
  decision?: string;
  check?: Record<string, unknown>;
};

const POLL = [
  "Should kids under 16 be banned from social media?",
  "Would you quit your safe job to start your own business?",
  "Would you work 70 hours a week and miss your family and friends, until you're rich?",
];

const BOOK_ONE: Person[] = [
  {
    id: "voice_usman",
    name: "Usman",
    country: "IN",
    language: "en",
    espeak: "en-us",
    startWord: "mango",
    original: "The draft makes me smarter when I check the answer and lazier when I skip the draft. I want the argument, not the shortcut.",
    english: "The draft makes me smarter when I check the answer and lazier when I skip the draft. I want the argument, not the shortcut.",
    translated: false,
  },
  {
    id: "voice_uzer",
    name: "Uzer Kayat",
    country: "IN",
    language: "hinglish",
    espeak: "en-in",
    startWord: "chai",
    original: "My memory gets worse because I forget the lesson I did not write and the memory fades, yaar, by the weekend.",
    english: "My memory gets worse because I forget the lesson I did not write and the memory fades, yaar, by the weekend.",
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
    hidden: true,
    sample: true,
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
    hidden: true,
    sample: true,
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
    hidden: true,
    sample: true,
  },
];

const SUNDAY: Person[] = [
  {
    id: "voice_nani",
    name: "Zubeda Kayat",
    country: "IN",
    language: "hi",
    espeak: "hi",
    startWord: "aam",
    original: "Mujhe yaad rakhna ki ghar ka darwaza hamesha khula tha, aur khana hamesha ek aadmi zyada ke liye banta tha.",
    english: "Remember that the door of the house was always open, and food was always made for one extra person.",
    translated: true,
  },
  {
    id: "voice_sami",
    name: "Sami",
    country: "AE",
    language: "en",
    espeak: "en-gb",
    startWord: "lantern",
    original: "Remember the Sunday walks, not the presents. Remember that we laughed at the same old jokes every single week.",
    english: "Remember the Sunday walks, not the presents. Remember that we laughed at the same old jokes every single week.",
    translated: false,
  },
];

const CITY: Person[] = [
  {
    id: "voice_ines",
    name: "Inês Rocha",
    country: "PT",
    language: "pt",
    espeak: "pt",
    startWord: "farol",
    original: "Depois da meia-noite a minha rua soa a elétricos vazios e a uma padaria que já está a acordar.",
    english: "After midnight my street sounds like empty trams and a bakery that is already waking up.",
    translated: true,
  },
  {
    id: "voice_kwame",
    name: "Kwame Mensah",
    country: "GH",
    language: "en",
    espeak: "en-us",
    startWord: "river",
    original: "After midnight the city sounds like generators humming and one radio playing highlife three streets away.",
    english: "After midnight the city sounds like generators humming and one radio playing highlife three streets away.",
    translated: false,
  },
  {
    id: "voice_fake",
    name: "Elon Musk",
    country: "US",
    language: "en",
    espeak: "en-us",
    startWord: "rocket",
    original: "This is Elon Musk and after midnight my city sounds like rockets.",
    english: "This is Elon Musk and after midnight my city sounds like rockets.",
    translated: false,
    decision: "needs_you",
    check: { impersonation: true, note: "Says they are a well-known person. Confirm before using." },
  },
];

const SOLO: Person[] = [
  {
    id: "voice_asha",
    name: "Asha Menon",
    country: "IN",
    language: "ml",
    espeak: "ml",
    startWord: "thengu",
    original: "Ninte bhayam ninte vazhi alla. Chodhikkan madikkenda.",
    english: "Your fear is not your path. Do not be shy to ask.",
    translated: true,
  },
];

function run(cmd: string, args: string[]) {
  execFileSync(cmd === "ffmpeg" ? FFMPEG : cmd, args, { stdio: "ignore", windowsHide: true });
}

/** A short soft tone, written directly so the seed works with no speech engine and no ffmpeg. */
function toneWav(file: string, seconds = 4) {
  const rate = 24000;
  const samples = rate * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const fade = Math.min(1, i / 2400, (samples - i) / 2400);
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 196 * i) / rate) * 6000 * fade), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
}

/** Speaks with espeak-ng, then the Windows voice, then macOS say, then the built-in WebAssembly voice. */
async function speak(file: string, voice: string, text: string, speed = 148) {
  try {
    run("espeak-ng", ["-v", voice, "-s", String(speed), "-w", file, text]);
    return;
  } catch {}
  if (process.platform === "win32") {
    const input = `${file}.txt`;
    try {
      writeFileSync(input, text, "utf8");
      const script =
        "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; " +
        "$s.SetOutputToWaveFile($env:BBTP_TTS_OUT); $s.Speak([IO.File]::ReadAllText($env:BBTP_TTS_IN)); $s.Dispose()";
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, BBTP_TTS_IN: input, BBTP_TTS_OUT: file },
      });
      return;
    } catch {
      // fall through to the tone
    } finally {
      rmSync(input, { force: true });
    }
  }
  if (process.platform === "darwin") {
    try {
      run("/usr/bin/say", ["--file-format=WAVE", "--data-format=LEI16@22050", "-o", file, text]);
      return;
    } catch {}
  }
  for (const v of [voice, "en-us"]) {
    try {
      writeFileSync(file, await wasmSpeakToWav(text, { voice: v, speed }));
      return;
    } catch {}
  }
  toneWav(file); // last resort only: the seed still finishes
}

function drawtext(text: string, size: number, y: number) {
  const safe = text.replace(/[\\':%]/g, "").slice(0, 70);
  const font = FONT ? `'${FONT.replace(/\\/g, "/").replace(/:/g, "\\:")}'` : "";
  return `drawtext=${font ? `fontfile=${font}:` : ""}text='${safe}':fontsize=${size}:fontcolor=white:x=(w-text_w)/2:y=${y}`;
}

/** Narrate the whole book to mp3 and, with ffmpeg, render a matching mp4. Returns stored keys and sizes. */
async function renderMedia(bookId: string, title: string, script: string) {
  const work = path.join(tmpdir(), `bbtp-seed-${bookId}`);
  mkdirSync(work, { recursive: true });
  const wav = path.join(work, "speech.wav");
  await speak(wav, "en-us", script, 155);
  const audioKey = `book-${bookId}-audiobook.mp3`;
  if (!HAS_FFMPEG) {
    // No ffmpeg: encode the mp3 in JavaScript and skip the video. Release → Make again adds it later.
    writeFileSync(path.join(audioDir, audioKey), await wavToMp3(readFileSync(wav)));
    rmSync(work, { recursive: true, force: true });
    return {
      audiobookKey: audioKey,
      audiobookBytes: readFileSync(path.join(audioDir, audioKey)).length,
      audiobookName: "",
      videoKey: null,
      videoBytes: 0,
      videoName: "",
    };
  }
  const videoKey = `book-${bookId}-video.mp4`;
  run("ffmpeg", ["-y", "-i", wav, "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "48k", path.join(audioDir, audioKey)]);
  run("ffmpeg", [
    "-y",
    "-i",
    wav,
    "-f",
    "lavfi",
    "-i",
    "color=c=0x9b1c24:s=854x480:r=24",
    "-f",
    "lavfi",
    "-i",
    "nullsrc=s=854x480:r=24",
    "-filter_complex",
    `[1:v]noise=alls=18:allf=t,${drawtext("BOOK BY THE PEOPLE", 28, 150)},${drawtext(title, 22, 215)},${drawtext("A book written by everyone who spoke", 16, 270)}[v]`,
    "-map",
    "[v]",
    "-map",
    "0:a",
    "-shortest",
    "-c:v",
    "libx264",
    "-b:v",
    "340k",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-movflags",
    "+faststart",
    path.join(audioDir, videoKey),
  ]);
  rmSync(work, { recursive: true, force: true });
  return {
    audiobookKey: audioKey,
    audiobookBytes: readFileSync(path.join(audioDir, audioKey)).length,
    audiobookName: "",
    videoKey,
    videoBytes: readFileSync(path.join(audioDir, videoKey)).length,
    videoName: "",
  };
}

/** Marks the media as made with the current narration, so the app does not narrate it again. */
async function markMedia(bookId: string) {
  await prisma.pipelineJob.create({ data: { bookId, step: "media", key: mediaVersionKey(bookId), status: "done" } });
}

async function addVoices(bookId: string, people: Person[], startAt: number) {
  const sources: SourceVoice[] = [];
  for (const [index, person] of people.entries()) {
    const key = `${person.id}.wav`;
    const file = path.join(audioDir, key);
    const spoken = `${person.startWord}. ${person.original}`;
    await speak(file, person.espeak, spoken);
    const durationMs = wavDurationMs(readFileSync(file)) ?? 6000;
    const cut = Math.min(900, Math.round(durationMs * 0.18));
    const createdAt = startAt + index * 3_600_000;
    const turns = [
      { turnId: 1, startMs: 0, endMs: cut, transcript: `${person.startWord}.` },
      { turnId: 2, startMs: cut, endMs: durationMs, transcript: person.original },
    ];
    const decision = person.decision ?? (person.hidden ? "hidden" : "approved");
    const theme = decision === "approved" ? themeLabel([{ text: person.english }]) : "";
    await prisma.voice.create({
      data: {
        id: person.id,
        bookId,
        contributorName: person.name,
        language: person.language,
        countryCode: person.country,
        consentAt: new Date(createdAt),
        storageKey: key,
        mimeType: "audio/wav",
        durationMs,
        startWord: person.startWord,
        startWordPassed: true,
        originalText: spoken,
        englishText: person.english,
        translated: person.translated,
        turnsJson: JSON.stringify(turns),
        status: decision === "needs_you" ? "NEEDS_YOU" : "READY",
        hidden: Boolean(person.hidden),
        userId: person.sample ? SAMPLE_USER : "",
        decision,
        themeLabel: theme,
        pipelineStep: "group",
        checkJson: JSON.stringify({ onTopic: true, realPerson: true, copyPaste: false, duplicate: false, impersonation: false, theme, ...person.check }),
        createdAt: new Date(createdAt),
      },
    });
    sources.push({
      id: person.id,
      contributorName: person.name,
      language: person.language,
      countryCode: person.country,
      originalText: spoken,
      englishText: person.english,
      translated: person.translated,
      turns,
      durationMs,
      createdAt,
      kind: "voice",
      sourceUrl: null,
      sourceTitle: null,
      hidden: Boolean(person.hidden),
      status: decision === "needs_you" ? "NEEDS_YOU" : "READY",
      startWord: person.startWord,
      hasAudio: true,
    });
  }
  return sources;
}

async function publish(bookId: string, document: ReturnType<typeof assembleBook>, note: string) {
  const draft = await prisma.bookDraft.create({
    data: { bookId, version: 1, contentJson: JSON.stringify(document), provider: document.provider, model: document.model, note },
  });
  await prisma.book.update({ where: { id: bookId }, data: { currentDraftId: draft.id, publishedDraftId: draft.id } });
}


async function reset() {
  await prisma.book.deleteMany();
  await prisma.user.deleteMany();
  // Local files belong only to the rows just deleted. S3 objects are left alone.
  if ((process.env.STORAGE_DRIVER ?? "local") === "local") rmSync(audioDir, { recursive: true, force: true });
  mkdirSync(audioDir, { recursive: true });
}

async function main() {
  await reset();
  const owner = await prisma.user.create({
    data: { email: "demo@bookbythepeople.dev", name: "Uzer Kayat", countryCode: "IN", region: "Gujarat", ageBand: "18–24", handle: "uzerkayat" },
  });
  const asha = await prisma.user.create({
    data: { email: "asha@bookbythepeople.dev", name: "Asha Menon", countryCode: "IN", region: "Kerala", handle: "ashamenon" },
  });
  const rafael = await prisma.user.create({
    data: { email: "rafael@bookbythepeople.dev", name: "Rafael Costa", countryCode: "PT", region: "Lisbon", handle: "rafacosta" },
  });

  // Book 1 — the owner's published book.
  const one = await prisma.book.create({
    data: {
      slug: "smarter-or-lazier",
      title: "Book by the People",
      question: "Is AI making you smarter or lazier?",
      type: "OPEN",
      coverVibe: "ember",
      status: "PUBLISHED",
      closesAt: new Date("2026-10-25T18:30:00.000Z"),
      publishedAt: new Date("2026-10-26T16:00:00.000Z"),
      creatorId: owner.id,
      inviteToken: "sample-invite-token",
      featured: true,
      voiceLimitPerDay: 3,
      pollQuestion: "What should the next book ask?",
      pollOptions: { create: POLL.map((label, position) => ({ label, position })) },
    },
  });
  const oneVoices = await addVoices(one.id, BOOK_ONE, Date.parse("2026-10-20T00:00:00Z"));
  const oneDoc = assembleBook({
    title: one.title,
    question: one.question,
    bookType: "OPEN",
    voices: oneVoices,
    now: "2026-10-26T16:00:00.000Z",
    provider: "mock",
    model: "local-assembly",
  });
  await publish(one.id, oneDoc, "Sample book for demo mode. The clips are spoken by a local voice so the reader works without an API key.");
  // Release media: the whole book, narrated.
  await prisma.book.update({ where: { id: one.id }, data: await renderMedia(one.id, oneDoc.title, narrationScript(oneDoc)) });
  await markMedia(one.id);
  // Backup history (count-only rows from before snapshots existed).
  const history: [number, number][] = [
    [2, 0],
    [4, 0],
    [4.01, 4],
    [4.02, 2],
    [4.03, 2],
    [4.04, 0],
  ];
  // Each row is a real snapshot of the book while it was still collecting, so Restore works.
  const oneRows = await prisma.voice.findMany({ where: { bookId: one.id }, orderBy: { createdAt: "asc" } });
  for (const [days, voiceCount] of history) {
    const takenAt = new Date(NOW - days * DAY);
    const snapshot = {
      version: 1,
      takenAt: takenAt.toISOString(),
      book: { title: one.title, question: one.question, status: "COLLECTING", currentDraftId: null, publishedDraftId: null },
      voices: oneRows.slice(0, voiceCount).map((voice) => ({
        ...voice,
        consentAt: voice.consentAt.toISOString(),
        createdAt: voice.createdAt.toISOString(),
      })),
      drafts: [],
      votes: [],
    };
    await prisma.backup.create({
      data: { bookId: one.id, voiceCount, label: "", note: "Backup history", snapshot: JSON.stringify(snapshot), createdAt: takenAt },
    });
  }

  // Sunday table — INVITED, collecting.
  const sunday = await prisma.book.create({
    data: {
      slug: "sunday-table",
      title: "Sunday table",
      question: "What do you want the people you love to remember?",
      type: "INVITED",
      coverVibe: "ember",
      status: "COLLECTING",
      closesAt: new Date(NOW + 35 * DAY),
      creatorId: owner.id,
      inviteToken: "sunday-invite",
      language: "hi",
      voiceLimitPerDay: 3,
      pollQuestion: "What should the next book ask?",
      pollOptions: { create: ["What did a stranger teach you?", "What are you afraid to automate?"].map((label, position) => ({ label, position })) },
    },
  });
  await addVoices(sunday.id, SUNDAY, NOW - 3 * DAY);

  // On the record — FAMOUS, published, real sourced quotes only.
  const record = await prisma.book.create({
    data: {
      slug: "on-the-record",
      title: "On the record",
      question: "What has been said, in public, about thinking for yourself?",
      type: "FAMOUS",
      status: "PUBLISHED",
      publishedAt: new Date(NOW - 1 * DAY),
      creatorId: asha.id,
      inviteToken: "record-invite",
      pollQuestion: "What should the next book ask?",
      pollOptions: { create: ["Which public line should the next book start from?", "Whose letters should we read next?"].map((label, position) => ({ label, position })) },
    },
  });
  const quotes: SourceVoice[] = [];
  for (const [index, quote] of FAMOUS_RECORD.entries()) {
    const createdAt = NOW - 6 * DAY + index * 1000;
    const theme = themeLabel([{ text: quote.text }]);
    const row = await prisma.voice.create({
      data: {
        bookId: record.id,
        contributorName: quote.speaker,
        language: "en",
        consentAt: new Date(createdAt),
        originalText: quote.text,
        englishText: quote.text,
        status: "READY",
        kind: "sourced_quote",
        sourceUrl: quote.url,
        sourceTitle: quote.title,
        sourceDate: quote.date,
        startWordPassed: true,
        decision: "approved",
        themeLabel: theme,
        pipelineStep: "group",
        createdAt: new Date(createdAt),
      },
    });
    quotes.push({
      id: row.id,
      contributorName: quote.speaker,
      language: "en",
      countryCode: null,
      originalText: quote.text,
      englishText: quote.text,
      translated: false,
      turns: [],
      durationMs: 0,
      createdAt,
      kind: "sourced_quote",
      sourceUrl: quote.url,
      sourceTitle: quote.title,
      sourceDate: quote.date,
      hidden: false,
      status: "READY",
      startWord: "",
      hasAudio: false,
    });
  }
  const recordDoc = assembleBook({
    title: record.title,
    question: record.question,
    bookType: "FAMOUS",
    voices: quotes,
    now: new Date(NOW - DAY).toISOString(),
    provider: "mock",
    model: "sourced-only",
  });
  await publish(record.id, recordDoc, "Real quotations only, each with its source link and date. Nothing here was generated.");
  await prisma.book.update({ where: { id: record.id }, data: await renderMedia(record.id, record.title, narrationScript(recordDoc)) });
  await markMedia(record.id);

  // Notes to my younger self — SOLO, collecting.
  const solo = await prisma.book.create({
    data: {
      slug: "notes-to-my-younger-self",
      title: "Notes to my younger self",
      question: "What would you tell yourself at nineteen?",
      type: "SOLO",
      status: "COLLECTING",
      closesAt: new Date(NOW + 60 * DAY),
      creatorId: asha.id,
      inviteToken: "solo-invite",
      language: "ml",
      voiceLimitPerDay: 20,
      pollQuestion: "What should the next book ask?",
      pollOptions: { create: ["What did you get right?", "Who should you have called?"].map((label, position) => ({ label, position })) },
    },
  });
  await addVoices(solo.id, SOLO, NOW - 2 * DAY);

  // City at night — OPEN, collecting, one voice waiting for review.
  const city = await prisma.book.create({
    data: {
      slug: "city-at-night",
      title: "City at night",
      question: "What does your city sound like after midnight?",
      type: "OPEN",
      status: "COLLECTING",
      closesAt: new Date(NOW + 14 * DAY),
      creatorId: rafael.id,
      inviteToken: "city-invite",
      language: "pt",
      voiceLimitPerDay: 3,
      pollQuestion: "What should the next book ask?",
      pollOptions: { create: ["Who keeps the city running?", "What would you walk home for?"].map((label, position) => ({ label, position })) },
    },
  });
  await addVoices(city.id, CITY, NOW - 4 * DAY);

  const counts = await prisma.book.findMany({ select: { slug: true, _count: { select: { voices: true } } } });
  console.log(`Seeded ${counts.map((book) => `${book.slug} (${book._count.voices})`).join(", ")}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
