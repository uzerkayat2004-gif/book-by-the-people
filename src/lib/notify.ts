import { getConfig } from "./config";
import { prisma } from "./db";
import { canSendEmail, sendMail } from "./mailer";

export async function notifyReleased(bookId: string): Promise<{ sent: number; skipped: string | null }> {
  const cfg = getConfig();
  if (!canSendEmail()) return { sent: 0, skipped: "email" };
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { title: true, slug: true, question: true },
  });
  if (!book) return { sent: 0, skipped: null };
  const voices = await prisma.voice.findMany({
    where: { bookId, userId: { not: "" }, kind: "voice" },
    select: { userId: true },
  });
  const ids = [...new Set(voices.map((voice) => voice.userId))];
  if (ids.length === 0) return { sent: 0, skipped: null };
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { email: true } });
  const link = `${cfg.appUrl}/b/${book.slug}/read`;
  let sent = 0;
  for (const user of users) {
    // One bad address or a dropped connection does not stop the other emails.
    const ok = await sendMail({
      to: user.email,
      subject: `${book.title} is out`,
      text: `A book you spoke in is out.\n\n${book.question}\n\nRead it: ${link}\n`,
    });
    if (ok) sent += 1;
  }
  return { sent, skipped: null };
}
