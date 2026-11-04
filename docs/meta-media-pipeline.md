# Audiobook and Video book, made with Meta models

Status: design, Nov 3 2026. Built for the Meta AI Developer Hackathon (due Thu Nov 5, 7:30 AM IST).
Audiobook first. The video book is built only if the audiobook is reliable.

## 1. What Meta can do today (checked Nov 3 2026)

Hosted Meta Model API: `https://api.meta.ai/v1`, OpenAI-style, `Authorization: Bearer <creator key>`. Limits are per team.

| Model | What it does | Endpoint | Price | Limit |
|---|---|---|---|---|
| `muse-spark-1.3` (Recommended writer) | text, image, audio, PDF in, text out, 1M-token context, structured JSON output | `POST /chat/completions` (or Responses) | $1.25 in / $4.25 out per 1M tokens | 3,000 RPM, 4M TPM |
| `muse-spark-1.3-contributor`, `1.2`, `1.2-contributor` | same, cheaper (contributor $0.10 / $0.20) | same | | contributor 150 RPM |
| `muse-wonder-1.0` | preview, strongest writer | same | $4 / $20 per 1M | 3,000 RPM |
| `muse-image-1.0` | makes and edits images | `POST /images/generations`, `/images/edits` | $0.01 per image | 150 RPM |
| `muse-voice-transcribe-1.0` | speech to text only, 25 languages | `POST /asr/transcribe` | $0.18 per hour | 256 streams |
| `GET /models` | lists the models this key's team can use | | free | |

Muse Image notes: `size` like `1792x1024` only sets the shape; `output_format` webp, png or jpeg;
`response_format` b64_json or url; `n` 1–10; `reasoning_strength: "low"` is faster; no `seed`
(unknown fields give 400). 503 can be retried. 400 `content_policy_violation` must not be retried.

### The honest gaps

1. **No Meta text-to-speech API.** The docs say Muse Voice Transcribe "does not synthesize speech", and there is no TTS page.
2. **No Meta video generation API.** There is no video endpoint.

### How we still keep the voice Meta

Meta publishes **MMS-TTS** (Massively Multilingual Speech), its own open text-to-speech model
(`facebook/mms-tts-<lang>`, VITS, 16 kHz, mono). It is free to run, but we run it ourselves rather than calling a Meta API.

Tested on the box Nov 3 with transformers.js 3.8.1 + onnxruntime-node, using the ONNX copies `Xenova/mms-tts-<lang>`:

| Weights | Size | Speed (box CPU) | Quality (checked by transcribing with Whisper) |
|---|---|---|---|
| fp32 `model.onnx` | 114 MB | 6.5 s of audio in 0.4 s (about 15× faster than real time) | English word-perfect; Hindi close |
| q8 `model_quantized.onnx` | 38 MB | 10× slower | **broken** (Whisper heard noise). Never use. |
| fp16 | 58 MB | does not run on CPU in Node | not usable |

Ready ONNX voices: English (eng), Hindi (hin), Spanish (spa), French (fra), German (deu), Arabic (ara), Russian (rus), Portuguese (por),
Vietnamese (vie), Romanian (ron), Yoruba (yor). Korean needs romanised text (uroman), so it is not offered yet.
**Japanese, Italian and Chinese have no MMS-TTS model.** For those release languages the audiobook says
"No Meta voice for this language yet" and skips them. It does not fall back quietly to another voice.

Limits to say out loud:
- MMS-TTS has one voice per language: no male/female choice and plain, slightly robotic prosody. Muse Spark's narrator
  script (short sentences, pauses, no symbols) makes it sound much better.
- The licence is CC-BY-NC 4.0 (non-commercial). That fits a free hobby project and the hackathon. The book page
  credits "Voice: Meta MMS-TTS".
- **Pre-commercial TODO:** before Book by the People earns money in any way (paid plans, ads, sponsorship), replace
  MMS-TTS with a voice whose licence allows commercial use, or get a licence from Meta. Approved for the hackathon only.

## 2. Switches

- `HACKATHON_META_ONLY` (env, default `1` while the hackathon runs). On: every picker lists only Meta models
  (provider type `meta`, plus the Meta MMS voice). Off: the same pickers also list the creator's other saved models
  (OpenAI-compatible, Gemini, and so on) and the built-in eSpeak voice. No code is deleted. One helper,
  `mediaMetaOnly()`, reads it, and every option list goes through `filterOptions()`.
- Uploads stay: the creator can still upload their own audio or video file in the same Studio card.
  An upload always wins over a made file until the creator deletes it.
- While `HACKATHON_META_ONLY` is on, **Publish no longer makes the built-in eSpeak audiobook and video** on its own,
  stale media is not refreshed by eSpeak, and the old "Make audiobook" (eSpeak) endpoint answers 409. The creator
  makes the Meta audiobook and video book from Release. With the switch off, the old behaviour comes back unchanged.
  The built-in voice never replaces a Meta file (`-mm-` keys) or an upload.

## 3. Model pickers (per book, per step)

Studio → the released book → "Audiobook" card and "Video book" card. Each card has a small "Models" section.

| Card | Step | Default (Recommended) | Options come from |
|---|---|---|---|
| Audiobook | Script writer | `muse-spark-1.3` | the creator's saved models with a text role, checked against `GET /v1/models` (cached 10 min) |
| Audiobook | Voice model | Meta MMS-TTS | the voice engine list (MMS; plus eSpeak and others when the flag is off) |
| Audiobook | Voice | the MMS voice for each language | per language; shows "No Meta voice" where none exists |
| Video book | Scene writer | `muse-spark-1.3` | as above |
| Video book | Pictures | `muse-image-1.0` | models with image output from `/v1/models`, or "Title cards only (no pictures)" |
| Video book | Voice model / voice | Meta MMS-TTS | as above |

- The Recommended option is first in each list and labelled "Recommended". The other models the key can use follow.
  A model the key cannot use is greyed out, with the reason "Not on your key".
- Choices are saved per book in the book's media state file (JSON in storage, see section 7). Without a saved choice, the Recommended model is used.
- **Re-running only what changed.** Each step's cache key is a hash of its own input plus its own model and settings:
  - `script = hash(book draft id, language, writer model)`
  - `voice chunk = hash(chunk text, voice engine, voice id)`
  - `image = hash(scene prompt, image model, size)`
  - `assembly = hash(all part keys)`

  Change the voice and only the voice chunks and the assembly run again; the script is reused.
  Change the writer and everything after it runs again. Nothing runs again by itself on a change: the card shows
  "Changed: press Make again to update", plus an estimate of the cost.

## 4. Audiobook flow

```
Release → Studio "Make audiobook" → plan → script (Muse Spark) → voice chunks (MMS) → join → ready
```

1. **Plan** (fast): it reads the published draft and the release languages. It drops languages with no voice
   (and says so), estimates the minutes and the Muse Spark cost, and creates one `PipelineJob` row per unit of work.
2. **Script** (one Muse Spark call per chapter per language, JSON schema output). It turns each chapter into narration:
   - an intro ("This is …, a book written from N people's voices"); chapter titles read as "Chapter two: …";
   - quotes said as "Asha, from Pune, said: …";
   - sentences of 25 words at most, numbers written out, no symbols or emoji;
   - `pause` marks (short, long) between sections.

   For a non-English release language it writes straight in that language from the existing `BookTranslation`
   text, if there is one, or else from the main draft. Output: `{ chapters: [{ title, segments: [{ text, pause }] }] }`.
   Checks: valid JSON and not empty. If it fails, it falls back to the existing `narrationScript()` text for that chapter
   (marked "plain script"), so a model hiccup never blocks the audiobook.
3. **Voice** (server, MMS-TTS fp32 via onnxruntime-node). It cuts segments into chunks of about 400 characters at
   sentence ends, synthesises each one, adds the pause as silence, encodes to MP3 (the existing lamejs encoder,
   48 kbps mono), and stores each part in Blob as `book-<id>-mm-<lang>-u<n>-v<hash>-p<i>.mp3`.
4. **Join**: MP3 frames at the same settings can be joined end to end, so the chapter files are joined into one
   `book-<id>-audiobook-<lang>.mp3`. A chapter list `[{ title, startMs }]` is saved in the media state file. Chapter names always come from the book, never from the model.
5. **Ready**: `audiobookKey`, bytes and name are set for the main language; other languages go in the state file's `audio[lang]` and play through `/api/media/<slug>/audiobook?lang=<code>`.

### Where it runs and how it stays within the free plan
- Vercel Hobby: 300 s per function, 4 active CPU-hours a month, 2 GB memory.
- **Short steps, driven by the page.** Studio calls `POST /api/books/<id>/media/meta/step` again and again. Each call:
  - takes the next pending unit under a 4-minute lease (`PipelineJob.status = running`, `runAfter = lease end`);
  - does at most about 200 s of work and saves it;
  - returns progress (`done / total`, the current step in plain words).

  If the tab closes, nothing is lost: the next visit to Studio continues where it stopped ("Resume").
  A lease that ran out is picked up again. Each unit retries up to 3 times (503s and timeouts wait 2, 6 and 15 s).
  A policy refusal does not retry: it shows a plain message.
- The voice model (114 MB) is downloaded once per warm server into `/tmp` from Hugging Face, checked against its known
  size, and reused. The first chunk on a cold server takes about 5–10 s longer.
- Bundle: `onnxruntime-node` ships CUDA and TensorRT libraries (≈340 MB). These are excluded from the trace
  (`outputFileTracingExcludes`), which leaves about 25 MB for Linux x64.
- CPU budget: MMS runs faster than real time on one vCPU, so a 30-minute audiobook uses a few CPU-minutes, well inside 4 CPU-hours.
- Storage: 48 kbps mono is about 21 MB per hour per language. Chapter files are deleted after joining. Old versions are
  deleted when a new one is ready.

### Guards
- Owner only, same-origin check, signed-in only. One run per book at a time (a lease row).
- At most 3 audiobook or video runs per book per day.
- The book's existing usage limit (`usageLimitKind`) also covers media calls. Every Muse call is logged in `AiUsage`
  with the step name, so the cost shows in Studio. An estimate is shown before "Make".
- Input cap: the existing 50,000-character narration cap per language (about one hour).
- Prompts carry only the book text, never keys or emails.

## 5. Video book flow (as built)

```
narration (the audiobook, made first if missing or out of date) → storyboard per chapter (Muse Spark)
→ pictures (Muse Image) → film plan → MP4 put together in the creator's browser → uploaded in parts → ready
```

State lives in `book-<id>-mm-video-state.json` (separate from the audiobook state, so the two never race).
It keeps the picks, the current run, the finished film and a cache of storyboards and pictures, so a changed pick
only redoes what it touches. Book language only. 3 runs a day. Leases (PipelineJob) stop two steps running at once.

1. **Narration**: the audiobook in the book's language. Starting the video starts the audiobook too (it keeps the
   audio when nothing changed), and the video steps drive it until it is current. If the audiobook fails, the video
   stops with its reason. The audiobook now also saves, per sentence, when it is spoken (`…-cues.json`) and where
   each chapter starts, timed from the real MP3 frames so nothing drifts.
2. **Storyboard** (Muse Spark, JSON schema, one call per chapter, 4 at a time, 3 tries): the model gets the numbered
   narration segments and numbered visible quotes, and returns 1–5 scenes: `picture` (one-sentence prompt, at most
   3 per chapter) or `quote` (shows a contributor's quote card when it is read). The server checks every scene
   (valid, in order, real quotes, each once). Fallback: a built-in storyboard (title card, then each quote as it is read).
3. **Pictures** (Muse Image): `size 1792x1024`, `output_format jpeg`, `reasoning_strength low`, `b64_json`;
   a shared style line is added (painterly, ember red, no text, no real people). 3 at a time, at most 18 per film,
   3 tries, about $0.01 each (logged in Usage). The spend guard is checked before each batch: when it trips,
   the rest become styled cards. A refused or failed picture becomes a styled card. Pictures are reused across runs.
   "No pictures (styled cards)" is a picker choice and the fallback when there is no key.
4. **Film plan** (`GET …/media/meta/video?plan=1`, owner only): scene times from the sentence timings, captions
   (at most 84 characters a line), chapter titles, credit line, and owner-only links to the narration and pictures
   (`…/media/meta/asset`, only `book-<id>-mm-` files).
5. **Assembly in the browser** (`src/lib/media/meta/film-client.ts`, mediabunny, MPL-2.0): canvas 1280×720 at 24 fps;
   slow pan and zoom on pictures; styled title cards; quote cards (red quotation mark, the quote, "— Name, Country");
   chapter title for the first 3.5 s; captions in a box at the bottom (not on quote cards); 0.5 s cross-fades;
   a 4 s end card with credits (never how many people took part). Video H.264 (VP9/AV1 fallback) through WebCodecs.
   The narration MP3 is copied into the MP4 as it is (no re-encoding; Chromium has no AAC encoder);
   if the browser can't, it is re-encoded (AAC or Opus).
6. **Upload**: 3 MB parts (`PUT …/video/upload`, under Vercel's 4.5 MB body limit), then `finish`: the server joins
   them, checks it is an MP4, saves `book-<id>-mm-video-<hash>.mp4` and points `Book.videoKey` at it unless the
   creator uploaded a video (an upload always wins).
7. **Resume**: everything made is saved on the server. If the tab closes, opening Release carries on, including
   the browser step ("Finish the film"). Making again with nothing changed is instant.

Studio card "Video book with Meta": Scene writer (muse-spark-1.3 Recommended), Pictures (muse-image-1.0
Recommended, or No pictures), Voice (shared with the audiobook). Estimate: minutes of film, pictures, Meta cost,
time to make, runs left today.

## 6. What readers see

- Book page and Library card: an "Listen" player with a chapter list (it jumps to `startMs`) and a language
  switch for each release language that has a voice. A "Watch" player shows the video book with captions.
- Credits line under each player. Download buttons stay as they are.
- A book with an uploaded audio or video file shows that file instead.

## 7. Data changes

- **No database schema change** (so a deploy's `prisma db push` changes nothing in the prod DB).
- Per-book state is one JSON file in storage (Blob in prod, `data/audio` locally), `book-<id>-mm-state.json`:
  ```
  { v: 1,
    picks: { audiobook: { writer: "<targetId>::<model>" | "", voices: { [lang]: voiceId } } },
    run:   { id, status, draftId, languages, writer, voices, units: [{ lang, unit, title, scriptHash, voiceHash,
             scriptKey, parts, plain, note, tries }], phase, startedAt, finishedAt, error? },
    audio: { [lang]: { key, bytes, ms, chapters: [{ title, startMs }], writer, voice, plainUnits, madeAt, hash } },
    starts: { day, count } }
  ```
- Scripts: `book-<id>-mm-<lang>-u<n>-s<scriptHash>.json`; voice parts `...-v<voiceHash>-p<i>.mp3` (deleted after the
  join); finished audio `book-<id>-mm-audiobook-<lang>-<hash>.mp3`. Anything with `-mm-` is a Meta file.
- Only the existing `Book.audiobookKey/Bytes` is set (main language). The release auto-voice and the stale-media
  refresher never overwrite a Meta audiobook.
- The step lease uses the existing `PipelineJob` table (`key = <bookId>:mm:audiobook`, 240 s), so there is no new table.

## 8. Key ownership

- Calls use the **creator's own saved Meta key** (the `AiProvider` row the book uses; AES-256-GCM sealed). It is opened
  only inside the step route on the server, used in the `Authorization` header, and dropped.
- The browser never sees the key. The browser assembly gets only Blob file links.
- Errors go through `scrubSecrets()`. The status endpoint shows only the last 4 characters of the key.
- With no Meta key saved, the card says "Add your Meta key in Book settings" and makes nothing.

## 9. Risks

| Risk | What we do |
|---|---|
| MMS voice sounds plain | Muse Spark writes short, spoken sentences; pause marks; label it honestly as Meta MMS-TTS |
| No Japanese, Italian or Chinese voice | Say so on the card; those languages get no audiobook |
| onnxruntime-node too big or fails on Vercel | Trace exclusions; a test deploy to a **preview** with no prod DB writes before prod; fallback: run MMS in the creator's browser with transformers.js (already shipped for Whisper) |
| Cold start (model download) | Cached in `/tmp`; the card shows "Loading the Meta voice" |
| Muse Spark JSON fails | Schema output, 3 tries, then fall back to the plain script for that chapter |
| Muse Image refuses a scene | That scene becomes a title card |
| Function time | Every unit stays under about 200 s; the page drives the next step; leases, resume |
| Free limits | Small MP3s; delete old versions; CPU use is minutes per book |
| Real key not testable locally | The user saves their Meta key in local Studio (never in chat). Until then, tests use a fake Meta server |

## 10. Time estimate

- Audiobook (schema, pickers, script step, MMS voice, join, Studio card, players, tests): about 8–10 hours.
- Video book (storyboard, pictures, browser assembly, player, tests): about 8–10 more hours.
- Recommendation: finish and harden the audiobook first (by Nov 4 morning). Build the video book only if the audiobook
  passes a real-key end-to-end test, and ship it marked "beta" only if it passes the same test.

## 11. Build status (Nov 3 2026)

Audiobook built locally (not deployed). Checked:
- Unit tests for the text helpers, narration parsing, plain fallback and voice lists.
- End to end on a local book with no model (plain script + Meta voice): Make → player → chapters on the book page.
- End to end with a fake Meta server: `muse-spark-1.3` picked as Recommended from `GET /models`, a 429 retried,
  scripts written by the model, usage logged, the key never in any response, chapters named from the book.
- Whisper listened to the finished MP3 and got the words back.
- `next build` trace: the Meta route is about 142 MB (limit 250 MB); the CUDA/TensorRT libraries are left out and
  the runtime loads from the traced files alone.
- Real-key runs done on a local copy (see below).

Video book built locally (not deployed). Checked:
- Unit tests for storyboard parsing, limits, plain storyboard, prompt and caption splitting; MP3 frame timing.
- End to end with no model: styled cards, quote cards, captions, the MP4 (H.264 + MP3, 1280×720) made in Chromium,
  uploaded in parts, played on the book page; Make again with nothing changed is instant; working files are owner only.
- End to end with the fake Meta server: storyboards from muse-spark-1.3, pictures from muse-image-1.0 (a 503 retried),
  the exact request fields checked, the key never in any response, credits on the book page.
- `e2e/studio-release.spec.ts` now expects no automatic media in Meta-only mode.

Fake-server video test: same setup, `npx playwright test e2e/meta-video.spec.ts`.

How to run the fake-server test: start the fake Meta server (`node e2e/fixtures/fake-meta.mjs`, port 43999), run `next start` on 43124 with
`META_API_BASE_URL` pointing at it, then `E2E_FAKE_META=1 E2E_BASE=http://127.0.0.1:43124 npx playwright test e2e/meta-audiobook.spec.ts`.

### Real Meta key runs (Nov 3 2026, local copy, key only in the server process)

Both end-to-end tests passed with the real key (`E2E_REAL_META=1`, server on 43125 started with `AI_MODE=live`):
- Audiobook: 3 scripts written by muse-spark-1.3, none fell back to plain, 61 s of audio. Cost about $0.018.
- Video book: 3 storyboards from muse-spark-1.3 (none plain), 4 pictures from muse-image-1.0, 2 quote cards,
  a 59–62 s H.264 + MP3 film at 1280×720 (about 4.9 MB). Cost about $0.074 (scripts $0.018, storyboards $0.015, pictures $0.04).
- The key never showed up in server logs, test output, state files or screenshots (checked by matching, never printed).

How the real API differs from the docs we built against:
- `/v1/models` also lists `muse-wonder-1.0` and `sam-3.1` (not documented; not offered in the pickers).
- Muse Spark 1.3 reasons by default and the reasoning tokens count against `max_completion_tokens`. With a small
  limit the reply is all reasoning: `content` is null and `finish_reason` is `length`. Fix: `reasoning_effort: "low"`,
  narration limit 8000, storyboard limit 6000. Real runs use about 1,000–1,350 output tokens per chapter.
- Images: a `1792x1024` request returns a 2016×1152 JPEG (size sets the shape, not the pixels), about 400–700 KB,
  in about 9 s. The reply also has `output_format`, `background` and `usage` (in tokens, not money).
- Price estimates were raised to include reasoning tokens.

Fixes from the real run: a picture planned for the opening now shows after the 5 s title card (it was made but
never shown); the film records how many quote cards it has.

Still to note before commercial use: the MMS-TTS voices are CC-BY-NC (see §9).
