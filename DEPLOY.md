# Deploying Book by the People

Prepared October 28, 2026. Prices below were read from each provider's pricing page that day; check them again before you sign up.

## What to use

| Piece | Pick | Why | Cost to start |
| --- | --- | --- | --- |
| App server | **Railway** (Docker) | Runs the Dockerfile as an always-on server. The audiobook and video are made inside the server after a release, so it can't run on serverless functions (that rules out Vercel). | Hobby plan **$5/month**, which includes $5 of usage. This app at 0.5–1 GB RAM usually fits in $5–8/month. |
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

## Accounts you need

1. Railway (sign in with GitHub). A card is needed for the Hobby plan.
2. Neon (no card for the free plan).
3. Cloudflare (no card for R2's free tier, but R2 has to be turned on in the dashboard).
4. Resend (free). You also need a domain you can add DNS records to, so mail comes from your own address. Without a domain, use Google sign-in instead.
5. Optional: Google Cloud, for Google sign-in.

## Steps

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

### Variables

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

## How the Meta key works on the live site

- A creator pastes the key when starting a book, or later in Book settings → AI for this book.
- The key is encrypted at rest with `AI_KEY_SECRET` (AES-256-GCM). It is never sent back to the browser; the Studio shows only the last 4 characters.
- That book then uses:
  - `https://api.meta.ai/v1` for transcription (`muse-voice-transcribe-1.0`)
  - the same address for writing (`muse-spark-1.3`)
- No server-wide key is needed. A book with no key runs in demo mode, using only the browser's own transcript.
- Production refuses to save keys without `AI_KEY_SECRET`, because a generated file would be lost on redeploy.

## Limits to know

- **Run one instance.** Sign-in and voice rate limits are kept in memory per server, and media is made in-process. One Railway instance easily handles a launch. Scaling out needs a shared limiter (Redis) and a job queue first.
- **Media size.** Audio and video are streamed with range requests, but each request loads the file from storage. That is fine for book-length audio and short videos.
- **Backups.** Neon keeps a restore window (6 hours on the free plan; longer on paid plans). R2 has no versioning by default; turn on bucket lifecycle and versioning if you need it.

## Local development (unchanged)

`npm install`, then `npm run dev`. Local development uses SQLite in `data/bbtp.db` and files in `data/audio`. A `postgres://` `DATABASE_URL` switches Prisma to `prisma/postgres/schema.prisma`, which `npm run build` (or `npm run prisma:schema`) writes from `prisma/schema.prisma`.

To try the production image on a computer with Docker:

```
docker build -t bbtp .
docker run -p 3000:3000 --env-file .env.production bbtp
```
