# Deploying Book by the People

Prepared October 28, 2026. Limits below were read from each provider's pricing and docs pages that day; check them again before you sign up.

## The free setup (no card, no domain)

| Piece | Pick | Free limit (October 2026) |
| --- | --- | --- |
| App | **Vercel** Hobby | No card. For personal, non-commercial use. Functions run up to 300 s each; 4 h of active CPU, 360 GB-hours of memory and 1 M calls a month. A request or response body can be at most 4.5 MB. |
| Database | **Neon** Postgres, added from the Vercel Marketplace | No card. About 0.5 GB of data, 100 compute hours a month, sleeps when idle and wakes on the next visit (first load after a quiet spell takes a second or two). |
| Audio, video, voice clips | **Vercel Blob** | 1 GB stored, 10 GB downloads, 10,000 simple and 2,000 advanced operations a month. Over the limit it pauses for 30 days; you are never charged. |
| Sign-in | **Google sign-in** | Free, no domain. |
| Emails (optional) | **Gmail with an app password** (SMTP) | Free, no domain, about 500 emails a day, sent from your Gmail address. |
| Audiobook voice | Built in (eSpeak NG in WebAssembly + a JavaScript mp3 encoder) | Free. No API key, nothing to install. |

**Cost: $0.** AI is still billed to the Meta key each creator pastes into their book.

What you give up on the free setup, honestly:

- **No film on Vercel.** Vercel has no ffmpeg, so a released book gets the narrated audiobook (MP3) but no MP4. The page hides Watch when there is no film. A creator can still upload an MP4 they made elsewhere, if it is under 4.5 MB.
- **Uploads up to 4.5 MB.** Voice clips are far smaller, so recording is fine. A creator's own audiobook or video upload must be under 4.5 MB.
- **Narration voice.** The built-in voice is eSpeak NG: clear but robotic. Set `TTS_PROVIDER=http` and `TTS_URL` for a nicer voice service if you have one.
- **Non-commercial only.** Vercel Hobby is for personal projects. If the site starts making money, move to Vercel Pro ($20/month) or the Railway setup below.
- **Size.** 1 GB of Blob is roughly 2,000 voice clips plus 100 audiobooks. Neon's 0.5 GB holds many thousands of voices.
- **Only the last 3 production deployments are kept** on Hobby, so you can roll back only that far.

### Free options I checked and did not pick

- **Supabase** (free Postgres 500 MB + 1 GB storage, no card): works as the database (use its "Session pooler" URL as `DATABASE_URL`), but a free project **pauses after a week with no visits** and has to be woken by hand.
- **Cloudflare R2** (10 GB free): needs a payment method on file. Works with `STORAGE_DRIVER=s3` if you add one later.
- **Render** free web service: sleeps after 15 minutes, wipes local files, and its free Postgres is deleted after 30 days.
- **Koyeb, Oracle Cloud Always Free, Google Cloud Run**: all need a card. **Fly.io** has no free tier, **Railway** gives only $1 a month free, **Netlify** free credits are small.
- **Resend** (email): free, but without your own domain it only delivers to your own inbox, so it can't send sign-in links to other people. Gmail SMTP does not have that limit.

### Accounts you need (all free, no card)

1. GitHub, with this repo (keep it private; Vercel can deploy private repos).
2. Vercel (sign up with GitHub, choose Hobby).
3. Google Cloud, for the sign-in client (no billing account needed).
4. Optional: a Gmail address with 2-Step Verification on, for emails.

Neon and Blob are created from inside Vercel, so they need no separate sign-up form.

### Steps

1. **Project.** In Vercel: Add New → Project → import the GitHub repo. Framework: Next.js (auto). Leave the build command alone: `vercel.json` sets it to `npm run vercel-build`, which writes the Postgres schema, creates or updates the tables (`prisma db push`, never drops data) and builds. Don't deploy yet if it asks; the first build fails without a database.
2. **Database.** Project → Storage → Create Database → **Neon** (Marketplace) → Free plan, region near your users → Connect to the project for Production, Preview and Development. This adds `DATABASE_URL` (and `DATABASE_URL_UNPOOLED`, used for the schema step).
3. **Files.** Project → Storage → Create → **Blob** → connect to the project. This adds `BLOB_READ_WRITE_TOKEN`; the app then stores everything in Blob on its own.
4. **Google sign-in.** In Google Cloud Console → APIs & Services:
   1. OAuth consent screen: External, app name "Book by the People", your email. Scopes: only email and profile (these need no Google review). Then **Publish app**, so anyone can sign in, not just test users.
   2. Credentials → Create credentials → OAuth client ID → Web application. Authorised redirect URI: `https://<your-project>.vercel.app/api/auth/google/callback`.
   3. Copy the client ID and secret into the Vercel variables below.
5. **Variables.** Project → Settings → Environment Variables (Production):

   ```
   APP_URL=https://<your-project>.vercel.app
   AI_KEY_SECRET=<run: openssl rand -base64 32>   # encrypts saved Meta keys; keep it, or saved keys stop working
   SITE_ADMIN_EMAILS=you@gmail.com                # who may feature a book on the home page
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   AUTH_DEV_EXPOSE_LINKS=false
   ```

   Optional, for sign-in links by email and "your book is out" emails:

   ```
   SMTP_URL=smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465
   EMAIL_FROM=Book by the People <you@gmail.com>
   ```

   Make the app password at myaccount.google.com → Security → 2-Step Verification → App passwords. Write `@` in the address as `%40`. Without `SMTP_URL` the sign-in page shows only "Continue with Google".

   Set automatically, leave alone: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN`, `VERCEL` (turns on the built-in voice, turns off local models and skips the film).
6. **Deploy.** Deployments → Redeploy (or push to the main branch). The build log shows `prisma db push` creating the tables.
7. **Check.** Open `https://<your-project>.vercel.app/api/health?deep=1`. It should show `"database": true`, `"databaseKind": "postgres"`, `"storage": {"ok": true, "driver": "blob"}` and `"canSaveKeys": true`.
8. **Start a book.** Sign in with Google, go to Start your own book, paste the Meta API key in "AI for this book", and share the add-voice link. After release the audiobook is narrated in the background (about a minute); the book page shows it when it is ready.

### How it runs on Vercel

- Pages and API routes run as functions. Release work (writing the book, narrating it) runs after the response with `after()`, inside the same 300-second limit; a book narration takes a few seconds.
- Released audio and video are served straight from Blob (the media route redirects there), so the 4.5 MB response limit doesn't apply to them. Blob files sit under a long random folder name.
- Sign-in and voice rate limits are kept in memory per function instance, so they are looser than on one server. Fine for a launch; add a shared store (for example Upstash Redis, which has a free tier) if you see abuse.

## Paid option: Railway (always-on server, about $5–8 a month)

| Piece | Pick | Why | Cost to start |
| --- | --- | --- | --- |
| App server | **Railway** (Docker) | Runs the Dockerfile as an always-on server. The audiobook and video are made inside the server after a release, in an always-on server with ffmpeg, so the film is made too. | Hobby plan **$5/month**, which includes $5 of usage. This app at 0.5–1 GB RAM usually fits in $5–8/month. |
| Database | **Neon** Postgres | Managed Postgres with backups and restore. | **Free**: 1 GB storage, 100 compute hours a month, sleeps when idle. Enough for thousands of voices. |
| Audio & video files | **Cloudflare R2** | S3-compatible, no download (egress) fees, so people can stream audiobooks and videos for free. | **Free**: 10 GB a month, then $0.015 per GB. |
| Sign-in email | **Resend** | Sends the magic sign-in links. | **Free**: 3,000 emails a month, 100 a day. |
| Sign in with Google (optional) | Google Cloud OAuth client | One-tap sign-in. | Free. |
| Domain (optional) | Any registrar | Your own address instead of `*.up.railway.app`. | About $10–15 a year. |

**Expected total: about $5–8 a month** plus a domain if you want one. AI cost is separate: each book uses the Meta key pasted into it, so it is billed to that key's account.

Other hosts that also work with the same Dockerfile:

- **Render**: the Starter web service is $7/month (0.5 CPU, 512 MB). The free tier sleeps after 15 minutes and wipes local files, so it isn't good for this app.
- **Fly.io**: no free tier for new accounts. A 1 GB machine costs about $6.70 per 30 days.
- **Supabase** works as the database too: use its Postgres connection string (the "Session pooler" URL) as `DATABASE_URL`.

### Accounts you need

1. Railway (sign in with GitHub). A card is needed for the Hobby plan.
2. Neon (no card for the free plan).
3. Cloudflare (R2 asks for a payment method even for the free 10 GB, and has to be turned on in the dashboard).
4. Resend (free). You also need a domain you can add DNS records to, so mail comes from your own address. Without a domain, use Google sign-in instead.
5. Optional: Google Cloud, for Google sign-in.

### Steps

1. **Database.** In Neon, create a project in the region closest to your users. Copy the connection string (`postgresql://…?sslmode=require`).
2. **Storage.** In Cloudflare, go to R2, create a bucket (for example `bbtp-media`), then create an R2 API token with "Object Read & Write" on that bucket. Note the Account ID, Access Key ID and Secret Access Key. The endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
3. **Email.** In Resend, add your domain, add the DNS records it shows, and create an API key.
4. **App.** In Railway, create a project from the GitHub repo. Railway finds the `Dockerfile` and `railway.json` on its own. Then:
   - In Variables, add the values below.
   - Under Settings → Networking, click "Generate domain", or add your own domain.
   - Set `APP_URL` to that address.
5. **Deploy.** Railway builds the image. When it starts, the container creates or updates the tables (`prisma db push`, which never drops data) and serves on `$PORT`. The health check is `/api/health`.
6. **Check.** Open `https://<your-domain>/api/health?deep=1`. It should show:
   - `"ok": true`, `"database": true` and `"databaseKind": "postgres"`
   - `"storage": {"ok": true, "driver": "s3"}`
   - `"ffmpeg": true` and `"speech": "espeak-ng"`
   - `"canSaveKeys": true`
7. **Start a book.**
   1. Sign in at `/sign-in`, then go to Start your own book.
   2. Paste the Meta API key in "AI for this book" (or later in Book settings → AI for this book).
   3. Share the add-voice link.
   4. To put the book first on the home page, sign in with an email listed in `SITE_ADMIN_EMAILS` and use Book settings → Home page → Feature on the home page.

#### Variables

Required:

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DB?sslmode=require
APP_URL=https://your-domain
AI_KEY_SECRET=<run: openssl rand -base64 32>   # encrypts saved Meta keys; keep it, or saved keys stop working
SITE_ADMIN_EMAILS=you@example.com              # who may feature a book on the home page
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=bbtp-media
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
RESEND_API_KEY=...
EMAIL_FROM=Book by the People <hello@your-domain>
```

Already set in the Dockerfile (leave as is):

- `NODE_ENV=production`
- `LOCAL_MODELS=off`: a hosted server doesn't download local models.
- `AUTH_DEV_EXPOSE_LINKS=false`: sign-in links only go by email.
- `FFMPEG_PATH=/usr/bin/ffmpeg`

Optional:

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: Google sign-in. The redirect URI is `https://your-domain/api/auth/google/callback`.
- `META_API_KEY`: one server-wide key. If you set it, every book runs on your key and your bill. Leave it empty so each creator pastes their own key per book.
- `AI_SERVER_CAP_USD`: one spend cap in dollars across every book on the server.

### Limits on Railway

- **Run one instance.** Sign-in and voice rate limits are kept in memory per server, and media is made in-process. One Railway instance easily handles a launch. Scaling out needs a shared limiter (Redis) and a job queue first.
- **Media size.** Audio and video are streamed with range requests, but each request loads the file from storage. That is fine for book-length audio and short videos.
- **Backups.** Neon keeps a restore window (6 hours on the free plan; longer on paid plans). R2 has no versioning by default; turn on bucket lifecycle and versioning if you need it.

## How the Meta key works on the live site

- A creator pastes the key when starting a book, or later in Book settings → AI for this book.
- The key is encrypted at rest with `AI_KEY_SECRET` (AES-256-GCM). It is never sent back to the browser; the Studio shows only the last 4 characters.
- That book then uses:
  - `https://api.meta.ai/v1` for transcription (`muse-voice-transcribe-1.0`)
  - the same address for writing (`muse-spark-1.3`)
- No server-wide key is needed. A book with no key runs in demo mode, using only the browser's own transcript.
- Production refuses to save keys without `AI_KEY_SECRET`, because a generated file would be lost on redeploy.

## Local development (unchanged)

`npm install`, then `npm run dev`. Local development uses SQLite in `data/bbtp.db` and files in `data/audio`. A `postgres://` `DATABASE_URL` switches Prisma to `prisma/postgres/schema.prisma`, which `npm run build` (or `npm run prisma:schema`) writes from `prisma/schema.prisma`.

To try the production image on a computer with Docker:

```
docker build -t bbtp .
docker run -p 3000:3000 --env-file .env.production bbtp
```
