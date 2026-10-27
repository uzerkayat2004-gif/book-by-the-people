# Book by the People

A book written from real voices. Someone asks one question. People record short answers in any language. When the voices close, the creator makes a book: chapters from what was actually said, verbatim quotations, and a play button that starts at that line in the original recording.

Anyone can create a book.

- **Solo.** One person, over time.
- **Invited.** A private link. Only people who have it can speak.
- **Open.** Anyone with the link, on a public page with a live globe.
- **Famous voices.** Public quotations the creator pastes, each with a source URL. The app does not invent quotations and does not synthesize a famous person's voice.

The interface follows the live Book by the People design: the same type, color, globe, and page flow. The books, studio, and providers are the v2 app. 

## Run it

```bash
npm install
npm run setup     # prisma db push + seed (wipes and recreates the demo data)
npm run dev       # http://localhost:43123
```

System tools: `ffmpeg` (24 kHz mono WAV conversion, release video) and `espeak-ng` (mock audiobook voice and sample clips). Optional `MEDIA_FONT` points the video renderer at a TTF if the default font is missing.

### Seeded data (`npm run db:seed`, also run on first `npm run dev`)

The seed **wipes the local database** and creates:

| Book | Slug | Mode | State | Owner |
| --- | --- | --- | --- | --- |
| Book 1 · Is AI making you smarter or lazier? | `smarter-or-lazier` | Open | Released (reader, audiobook, video, share cards, backups history) | `demo@bookbythepeople.dev` |
| Sunday table | `sunday-table` | Invited | Taking voices | `demo@bookbythepeople.dev` |
| On the record | `on-the-record` | Famous | Released, real dated quotes with source URLs | `asha@bookbythepeople.dev` |
| Notes to my younger self | `notes-to-my-younger-self` | Solo | Taking voices | `asha@bookbythepeople.dev` |
| City at night | `city-at-night` | Open | Taking voices | `rafael@bookbythepeople.dev` |

Sample clips are spoken locally by eSpeak NG so the reader works with no key; they are not recordings of real people. Sign in from `/sign-in` (dev mode shows the magic link on screen; use `localhost`, not `127.0.0.1`, so the cookie matches). Any seeded email works.

### Where things are

| Page | Route |
| --- | --- |
| Home (featured book) | `/` (`?stage=before|closed|after`) |
| Any book | `/b/[slug]`, speak `/b/[slug]/speak`, reader `/b/[slug]/read`, share card `/b/[slug]/c/[voiceId]` |
| Explore | `/explore` |
| Create a book | `/books/new` (linked from home, My page, Studio) |
| Studio (owner only) | `/studio` (your books) and `/studio/[slug]` (Settings · AI at work · Make the book · Release, pill book switcher) |
| My page | `/me` |

### Tests

```bash
npm test          # vitest unit tests
npm run test:e2e  # Playwright: create-book, speak, studio release, reader (needs the dev server on :43123)
npm run db:seed   # e2e runs create extra books; reseed afterwards
```

### Per-book AI keys

The app is free; a creator can paste their own Meta key in Book settings. It is encrypted with AES-256-GCM using `AI_KEY_SECRET` and is never sent back to the browser (the field only shows "saved"). Without a per-book key the server key (`META_API_KEY`) is used; in `AI_MODE=live` with no key at all the Studio shows a clear "add a key" error instead of running.

### Backups

The Studio's Make the book tab keeps a history of backups (snapshots of voices and drafts) that can be downloaded or restored. Local backups live under `data/`.

## How a book gets made

Each voice is processed as soon as it arrives, and the studio ticks the same jobs every 60 seconds. Jobs are idempotent. A failed step retries with backoff. The AI at work tab shows the step and the decision.

1. Upload. ffmpeg converts the recording to 24 kHz mono WAV.
2. `muse-voice-transcribe` writes the transcript. In mock mode a local stand-in is used and spend stays $0.
3. The start word must be said first. If it is missing, nothing is saved: no voice row, no audio, a new word.
4. The words are translated into the book language when they are not already that language.
5. Checks: on topic, real person, copy-paste, impersonation, duplicate.
6. Decide: approve, needs you, not used, or hidden.
7. Group the approved voices into themes.
8. When voices close, or the creator clicks Make the book: outline, chapter titles, flowing chapter prose (`muse-spark`), front matter, and a cover byline with the real counts.
9. Release publishes the reader, an audiobook, a video (cover, chapter titles, narration), and the share cards. Listen and Watch are on the reader. The files download with or without an account.

The reader is plain prose. It does not print “N people said this” inside a chapter. A small voice count sits at the bottom of the chapter. The audiobook and the video narrate that prose. They do not announce how many people spoke.

A person can add 3 voices to a book per day. The speak page and My page show “3 left today”. Invited books use a link (`/b/[slug]/speak?invite=…`). Famous-voice books store only quotations the creator supplies, with a source URL and a date, and show both. The model is not asked to invent a quotation.

Each creator gets the same four-tab studio at `/studio/[slug]`. A book switcher appears when they have more than one. Start your own book is on the home page, My page, and Studio. `/explore` lists open books. `/b/[slug]` is the public page.

The poll is Vote for Book 2. The creator edits the choices. The winning choice is suggested as the question of their next book.

When `RESEND_API_KEY` and `EMAIL_FROM` are set, publishing emails people who spoke in that book. With no key, nothing is sent.

`AI_SPEND_CAP_USD` is one total cap for each book. There is no daily cap. The spend card shows that book’s spend against the cap. Unset means no cap. `0` pauses that book immediately. Mock mode records $0. Live mode with no `META_API_KEY` stops and says the key is missing.

## Meta models

Configured entirely from the environment. Nothing is hardcoded as a secret.

| Job | Model | Endpoint |
| --- | --- | --- |
| Speech to text | `muse-voice-transcribe-1.0` | `POST https://api.meta.ai/v1/asr/transcribe` |
| Translation, chapters, narrative | `muse-spark-1.3` | `POST https://api.meta.ai/v1/chat/completions` |
| Fallback writer | OpenAI-compatible host | `POST $WRITER_FALLBACK_BASE_URL/chat/completions` |

Set `AI_MODE=live` and `META_API_KEY` (or `MODEL_API_KEY`) to call Meta. With no key, `AI_MODE` defaults to `mock`: transcripts and the book draft are assembled locally, and the UI still runs the whole path.

Transcription uses `ENDPOINTING` so the response includes turn timestamps. Muse Voice Transcribe does not return word-level timestamps. The play button interpolates inside the matching turn from where the quotation sits in that turn's text. That approximation is labeled in code (`locateSpan`).

The writing call asks for JSON (preface, chapters, verbatim quotes, agreement, disagreement). The server then checks every quotation against the source transcript and drops any speaker the model invented. People the model skipped are appended so a voice is not lost. If the hosted model cannot be reached and a fallback host is configured, the same request is sent there.

Muse Spark Open is not served by the Meta Model API. Run it yourself, or point the fallback at Fireworks, Baseten, or another OpenAI-compatible host. The default fallback model id is the Hugging Face repo `meta-models/Muse-Spark-Open-816B-A42B`. Replace it with the id your host expects.

Spend is estimated from Meta's published standard rates (October 2026): transcription at `$0.18` per hour of audio, billed in whole seconds rounded down, and Muse Spark at `$1.25` / `$0.15` cached / `$4.25` per million input, cached-input, and output tokens. The cap is per book, not per day.

The studio chip names `muse-voice-transcribe` and `muse-spark`.

Audiobook speech is pluggable. `TTS_PROVIDER=mock` (the default) runs espeak-ng and stores a real file. `TTS_PROVIDER=http` POSTs `{ "text" }` to `TTS_URL`. The video is assembled with ffmpeg: a red cover frame, the chapter titles, and the narration. SQLite and local disk are the default. Set `STORAGE_DRIVER=s3` plus the `S3_*` variables for object storage, and point `DATABASE_URL` at Postgres after switching the Prisma provider.

## Environment

Copy `.env.example` to `.env`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite by default (`file:./data/bbtp.db`). For Postgres, change the Prisma datasource provider to `postgresql` and set a Postgres URL. The schema uses only types both databases accept. |
| `AI_MODE` | `mock` or `live` |
| `APP_URL` | Public origin, used in emails |
| `META_API_KEY` / `MODEL_API_KEY` | Meta Model API bearer token |
| `META_API_BASE_URL` | Default `https://api.meta.ai/v1` |
| `META_TRANSCRIBE_MODEL` | Default `muse-voice-transcribe-1.0` |
| `META_TRANSCRIBE_MODE` | `ENDPOINTING` (turns), `PUSH_TO_TALK`, or `DIARIZATION` |
| `META_WRITER_BASE_URL` | Defaults to the Meta base URL |
| `META_WRITER_API_KEY` | Defaults to the Meta key |
| `META_WRITER_MODEL` | Default `muse-spark-1.3` |
| `META_WRITER_REASONING_EFFORT` | `low` by default. `none` is rejected by Muse Spark |
| `WRITER_FALLBACK_BASE_URL` | OpenAI-compatible base, no trailing path beyond `/v1` |
| `WRITER_FALLBACK_API_KEY` | Key for that host |
| `WRITER_FALLBACK_MODEL` | Model id on that host |
| `AI_SPEND_CAP_USD` | Total cap. Unset = unlimited |
| `AI_PRICE_*` | Overrides for the rate card |
| `STORAGE_DRIVER` | `local` or `s3` |
| `LOCAL_STORAGE_DIR` | Default `./data/audio` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | S3-compatible storage (AWS, R2, MinIO) |
| `AUTH_DEV_EXPOSE_LINKS` | Show the magic link on the sign-in page. Defaults on outside production |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional email delivery |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google sign-in. Redirect URL: `{origin}/api/auth/google/callback` |
| `TTS_PROVIDER`, `TTS_URL`, `TTS_API_KEY` | Audiobook voice. `mock` (espeak-ng, real file) or `http` |
| `AI_KEY_SECRET` | 32-byte base64 secret that encrypts per-book AI keys |
| `MEDIA_FONT` | Optional TTF path for the release video titles |
| `SEED_FORCE` | Set to `1` to allow seeding when `NODE_ENV=production` |

## Deploy

The app is a Next.js App Router project and can run on Vercel. Use Postgres there (SQLite on the server disk will not persist), set `STORAGE_DRIVER=s3` or another durable bucket, set `AUTH_DEV_EXPOSE_LINKS=false`, `AI_MODE=live`, `AI_KEY_SECRET`, and configure Resend or Google so creators can sign in. `ffmpeg` must exist in the transcription environment; Vercel's default runtime does not include it, so live transcription needs a host where `ffmpeg` is installed, or a conversion step in front of the route.

## Open questions about the Meta API

- Muse Voice Transcribe's file endpoint accepts only WAV (mono 16-bit PCM, 16 or 24 kHz), up to 10 minutes and 32 MB. This app converts with ffmpeg. Confirm that is still the contract when you receive a key.
- Turn timestamps are explicitly not precise acoustic boundaries, and word timestamps are not provided. The in-turn interpolation is the best the current response allows.
- Whether `api.meta.ai` is reachable from India was not verified here. That is why the writer has a fallback base URL, model, and key. The exact Fireworks or Baseten model slug for Muse Spark Open was not guessed; set `WRITER_FALLBACK_MODEL` to the id that host publishes.
- Contributor-tier model ids (`muse-spark-1.3-contributor`) are cheaper and allow training on your prompts. They are not the default. If you switch model ids, also set the `AI_PRICE_*` variables or the spend cap will assume standard rates.
- `reasoning_effort: "none"` returns HTTP 400 on Muse Spark. Some OpenAI-compatible hosts reject `reasoning_effort` or `max_completion_tokens`; the client retries once without the rejected field.
