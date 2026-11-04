# Book, audiobook and video book, v2

How a crowd of answers becomes one smooth book, then one audiobook and one documentary-style film,
all with Meta models. Plain words first; file names at the end.

## What good audio and video summaries do, and what we took

We studied how today's AI audio and video summary tools present a set of sources (public help
pages and announcements, 2025 to 2026).

**Audio summaries**
- Formats: *Deep Dive* (two hosts talking), *Brief* (one speaker, under 2 minutes), *Critique*
  (expert review) and *Debate* (two sides, without false balance).
- You can steer it with a focus prompt and pick a length.
- It sets out to be an "objective reflection of your sources": it summarises and links ideas, and
  does not add opinions.
- It hooks the listener early, builds up, contrasts and ends with a takeaway. It signposts ("first…",
  "on the other hand…") and recaps.

**Video summaries**
- *Explainer* and *Brief*: narrated, illustrated slides in one consistent visual style (several style
  presets).
- *Cinematic*: a model acts as the "creative director", plans the scenes and refines them so the
  look stays consistent.
- *Review producer notes*: you see a written plan of the film before it is rendered.

**What we use**
1. **The arc.** Hook, build-up, contrast, resolution and closing, as in those summaries. The plan step
   gives every section one of these roles.
2. **Fair contrast.** We avoid false balance (from *Debate*): a minority view gets its true size
   ("a handful of you…") and is not pushed up to look like half the crowd.
3. **An objective narrator.** One calm narrator voice reports what people said, and never adds
   facts or claims people did not make. This is the *Brief* format's single-speaker clarity, used at
   book length.
4. **Signposting and recap.** Each section opens by linking back to the one before it, and the closing
   section sums up.
5. **Producer notes.** The saved JSON outline (sections, clusters, counts, standout quotes) is our
   "producer notes". The audiobook and the film both follow it, so all three tell the same story in
   the same order.
6. **One visual style.** Every picture is made in one shared style and then given one colour grade,
   and the film uses one set of fonts, like a video style preset.
7. **Visuals that follow the narration.** A picture changes when the narration moves to a new idea,
   not on a timer.

We did not copy the two-host format. A book of real voices reads better with one narrator, and the
people's own words are the second "voice".

## The writer: map, reduce, plan, write, edit (all Muse Spark)

1. **Map.** Answers go to the model in batches of about 60, up to about 26k characters each, 6 at a
   time. For each batch the model returns groups: a label, a summary, member refs, short exact
   phrases and standout picks. We check every ref. Every phrase must appear word for word in that
   person's answer (exactIn), or it is dropped. Answers the model leaves out go to "Other thoughts".
   Batches are cached by hash, so a retry resumes.
2. **Reduce.** The groups are merged across batches, in rounds of up to 160 groups, until one set of
   themes is left. Counts are true counts of member answers, never the model's guess.
3. **Plan.** The model sees the clusters with their sizes, shares and top countries, plus the standout
   pool, and chooses:
   - the **form**: *chapters* when the themes really differ, or *continuous* (one flowing piece with
     soft section breaks) when most people agree. Without a model, a top share of 70% or more means
     continuous;
   - an arc of up to 8 sections, each with a role (hook, build, contrast, resolution, closing), a
     purpose and its clusters. In chapters form, each cluster is told only in one place;
   - the standouts to quote: about one per ten people, at least 2 and at most 12, and at most 3 per
     section.
4. **Write.** All sections are written in parallel, in one narrator voice. Each section gets:
   - its clusters' summaries and sizes in plain words ("nearly fifty of you", "a handful in Kenya");
     a size is said only in the first section that tells that view;
   - its share of the exact phrases;
   - its standouts.

   Short phrases may be quoted inline. A standout quote is its own block, with a one-sentence lead-in
   that never paraphrases it. No guessing anyone's gender, and no "one of you said…" for a single
   person. **guardQuotes** removes quotation marks from anything that is not word for word in some
   answer.
5. **Edit.** A last editor pass smooths the transitions and the repeated openings, and can sharpen
   chapter titles. An edit is refused if a paragraph shrinks below 55%, grows past 180%, or changes
   any number.

The book is saved with `form`, a `standfirst` (the one-line summary under the title) and the
`outline`. Chapters are made of **blocks**: a paragraph, a standout quote, or a soft section break.

### Names, famous people and the moderation hold

- Only standout contributors are named, with their exact words, their name and their place.
- A famous person is put up front only when they are **verified**: either a sourced quote with a
  source link, or a voice the creator marked **★ Well-known** in Studio. That mark is a button on each
  voice row in Studio; it is saved in `Voice.checkJson.notable`, so there is no schema change.
- A voice that only *claims* a famous name (flagged by the impersonation check) is never named. If it
  is quoted, it is shown as "A voice from {place}". The famous-name moderation hold is unchanged:
  such voices still need the creator's approval to be used, and approving one does not mark it
  well-known.

## Audiobook v2

- **Script from the blocks.** The narration follows the book in order:
  1. title, standfirst and preface;
  2. chapter titles (chapters form only);
  3. paragraphs;
  4. standout quotes, read by the same narrator with a lead-in ("As Priya from Chennai put it: …").
     The lead-in is skipped when the paragraph before already names the person;
  5. a closing thank-you.

  Every spoken piece keeps a `ref` back to its block (`p3` paragraph, `q4` quote, `c2` the first
  paragraph of a cluster), so the film can follow it. If a script writer is picked, Muse Spark only
  makes each paragraph easier to hear: it splits long sentences and writes numbers as words. It keeps
  every quote word for word, and any rewrite outside 60–160% of the original length is ignored.
- **One voice, one loudness.**
  - Each sentence from Meta MMS-TTS is trimmed of model silence, then levelled to the same loudness
    (RMS about −20 dBFS, measured on voiced frames only), with a soft peak limiter.
  - Edges get 12 ms and 30 ms fades.
  - The whole book uses one voice, one speed and one gain.
- **Natural pauses.** 0.34 s between sentences, 0.72 s between paragraphs, 1.4 s between sections and
  chapters.
- **No seams.** Parts are stored as raw WAV and joined with 20 ms equal-power crossfades, then the
  whole book is encoded to MP3 **once**. Before, separate MP3s were glued together.
- **Music bed (optional, on by default).** A soft pad made in code from sine tones, so there is
  nothing to license and it costs nothing. It plays alone for 3.2 s, sits under the first words and
  fades out, then comes back for about 6 s after the last word. Studio has a checkbox, "Soft music at
  the start and end". Chapter marks and captions move with the lead-in.

## Video book v2: documentary style

- **Fewer, longer scenes.** About one picture per 30 s of narration, 1 to 6 per section (24 per film
  at most). Muse Spark picks where each picture starts, at the moment the narration moves to a new
  idea, and keeps "one visual world" across the film. There are no full-screen quote cards any more.
- **Ken Burns** on every Muse Image picture: a slow eased push or pull with a gentle pan.
- **Crossfades** of 0.9 s between all scenes, a fade up from black at the start and a fade down to
  black at the end. A missing picture holds the previous one, so there is never a blank card in the
  middle.
- **Captions** in sync, from the per-sentence voice timings.
- **Quotes as lower-thirds** over the picture, timed to when the narrator reads them, with
  "— Name, City, Country". Captions step aside while a quote shows.
- **Count chips**, top right, when a view is first told: "46 VOICES · Teachers who stay". The opening
  shows "92 VOICES FROM 14 COUNTRIES".
- **Title and end credits.**
  - Opening: the title card with the standfirst.
  - End: the title, "Made from the voices of N people in M countries", "Quoted: …" with the named
    people, and the model credits. The credits play over the music outro.
- **One look.** Every picture gets the same grade (slightly less colour, a little more contrast, a
  warm tint, a vignette), with one set of fonts.

## Limits

- MMS-TTS is a research voice. It is clear but flat, and its licence is CC-BY-NC, so it is fine for
  this free, non-commercial project only. Meta has no TTS or video-generation API for us yet, so the
  film is put together in the browser from stills.
- A very large book is written over several requests (see v3 below), so no single request runs past
  the Vercel limit.
- Picture cost is about $0.01 each. The writer used about 44k tokens for a 92-voice book.

## Files

| Area | Files |
|---|---|
| Writer | `src/lib/book/feature.ts` (pure), `src/lib/ai/feature-writer.ts`, `src/lib/services/generate.ts` |
| Reader | `src/components/reader.tsx` (blocks, breaks, standfirst) |
| Audio | `src/lib/media/meta/sound.ts`, `narrate.ts` (featureNarration, spoken polish), `mms.ts`, `audiobook.ts` |
| Film | `src/lib/media/meta/storyboard.ts` (feature boards, overlays), `videobook.ts` (documentaryPlan), `film-client.ts` |
| v3 | `phrases.ts`, `flag-codes.ts`, `public/flags/`, `e2e/fixtures/fake-meta-feature.mjs` |
| Well-known mark | `src/app/api/voices/[id]/route.ts`, `src/lib/services/voices.ts`, `src/components/live-studio.tsx` |

## v3 polish

- **Remake fix.** After a join the voice pieces are deleted, so the next run marks them `joined` and
  records again; if older pieces are missing at join time, those chapters are recorded again instead of failing.
- **Big books.** Writing saves a checkpoint after each step (read the voices, merge, plan, each part,
  edit) in a storage JSON, no schema change. When a request runs short of time it stops cleanly and
  answers `continue: true`; Make in the Studio presses again by itself until the book is done.
  `GENERATE_BUDGET_MS` sets the time per request (default 240 s). Tested with 1,500 voices from 45
  countries on a fake Meta server: two requests, no step repeated.
- **Pictures.** Muse Spark first picks one look for the whole film (style, palette, light) from the
  outline. Every picture prompt is a concrete scene from the narration, plus that look and a list of
  things to avoid (text, logos, watermarks, broken hands or faces). Muse Image runs with
  `reasoning_strength: high` and its tools off. Muse Spark then looks at each picture and scores it;
  a clear fault (text, a bad hand or face, a score of 2 or less) gets one redraw with the fix, within
  the spend guard.
- **Voice.** The MMS model has no knobs we can reach (the ONNX export takes only the text), so the
  gains come around it: each sentence is read phrase by phrase with a short breath at commas, colons
  and dashes, then a light EQ (rumble cut, less boxiness, a little presence) and a gentle compressor,
  at the same loudness, encoded at 64 kbps.
- **Captions** break after sentences and clauses, never more than two even lines.
- **Narrator lines** (quote lead-ins, the opening "A book written by 92 people from 10 countries." and
  the closing thanks) exist in every language a Meta voice can read: `src/lib/media/meta/phrases.ts`.
- **Opening scene.** Every film opens on a 7.5 s branded scene: the logo and name, the title and the
  question, "92 voices · from 10 countries", over a softly blurred wall of every participating
  country's flag that drifts and pushes in, then a slow crossfade into the first picture. Flags are
  the bundled flag-icons SVGs (MIT, `public/flags/`), drawn in code, never by the image model. The
  layout fills the frame for 1 to 250 countries. The film card on the book page uses the same flag
  wall as its poster.
