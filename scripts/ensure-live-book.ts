import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({ where: { email: "demo@bookbythepeople.dev" } });
  if (!user) throw new Error("Demo user is missing.");
  const slug = "book-by-the-people";
  const existing = await prisma.book.findUnique({ where: { slug } });
  if (!existing) {
    const book = await prisma.book.create({
      data: {
        slug,
        title: "Book by the People",
        question: "Is AI making you smarter or lazier?",
        type: "OPEN",
        status: "COLLECTING",
        closesAt: new Date("2026-10-25T18:30:00.000Z"),
        creatorId: user.id,
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
    console.log(book.id);
    return;
  }
  console.log(existing.id);
}

main().finally(async () => {
  await prisma.$disconnect();
});
