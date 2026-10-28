-- Many books: unlisted books, guest contributor keys, and indexes for /books and the Library.
-- Additive only: two new columns with defaults and seven new indexes. Nothing is dropped or rewritten.
-- Applied on deploy by `prisma db push` (scripts/vercel-build.mjs), which stops instead of losing data.
-- Kept here for review (generated with `prisma migrate diff`).

-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "unlisted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Voice" ADD COLUMN     "guestKey" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Book_status_type_unlisted_createdAt_idx" ON "Book"("status", "type", "unlisted", "createdAt");

-- CreateIndex
CREATE INDEX "Book_status_unlisted_publishedAt_idx" ON "Book"("status", "unlisted", "publishedAt");

-- CreateIndex
CREATE INDEX "Book_language_idx" ON "Book"("language");

-- CreateIndex
CREATE INDEX "Book_creatorId_createdAt_idx" ON "Book"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "Book_featured_idx" ON "Book"("featured");

-- CreateIndex
CREATE INDEX "Voice_bookId_status_hidden_idx" ON "Voice"("bookId", "status", "hidden");

-- CreateIndex
CREATE INDEX "Voice_userId_idx" ON "Voice"("userId");
