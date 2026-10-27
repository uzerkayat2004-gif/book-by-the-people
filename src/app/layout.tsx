import type { Metadata } from "next";
import { Motion, SiteFooter, TopBar } from "@/components/site-chrome";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import "./globals.css";
import "@/styles/fonts.css";
import "@/styles/proto/styles.css";
import "@/styles/proto/v4.css";
import "@/styles/proto/v5.css";
import "@/styles/proto/v6.css";
import "@/styles/proto/v7.css";
import "@/styles/proto/v8.css";
import "@/styles/bridge.css";
import "@/styles/studio-fit.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Book by the People",
    template: "%s · Book by the People",
  },
  description: "One question. Everyone answers by voice. A real book, in people's exact words.",
  icons: { icon: "/favicon.png", apple: "/apple-touch-icon.png" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const featured = await prisma.book.findFirst({
    where: { featured: true },
    select: { slug: true, status: true, question: true, closesAt: true },
  });
  const voiceHref = "/speak";
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Motion />
        <TopBar
          user={user ? { name: user.name || user.email } : null}
          featuredStatus={featured?.status ?? null}
          closesAt={featured?.closesAt?.toISOString() ?? null}
        />
        {children}
        <SiteFooter question={featured?.question ?? null} voiceHref={voiceHref} />
      </body>
    </html>
  );
}
