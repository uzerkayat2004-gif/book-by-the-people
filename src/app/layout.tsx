import type { Metadata } from "next";
import { Motion, SiteFooter, TopBar } from "@/components/site-chrome";
import { getCurrentUser } from "@/lib/auth";
import { homeBookLite } from "@/lib/public-books";
import "./globals.css";
import { siteUrl } from "@/lib/site-url";
import "@/styles/fonts.css";
import "@/styles/proto/styles.css";
import "@/styles/proto/v4.css";
import "@/styles/proto/v5.css";
import "@/styles/proto/v6.css";
import "@/styles/proto/v7.css";
import "@/styles/proto/v8.css";
import "@/styles/live-base44.css";
import "@/styles/bridge.css";
import "@/styles/studio-fit.css";
import "@/styles/studio2.css";
import "@/styles/studio3.css";
import "@/styles/studio4.css";
import "@/styles/library.css";
import "@/styles/aisrc.css";
import "@/styles/multibook.css";
import "@/styles/v3.css";
import "@/styles/v4r.css";
import "@/styles/perf.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Book by the People",
    template: "%s · Book by the People",
  },
  description: "One question. Everyone answers in their own words. AI checks every voice and writes a real book from people's exact words.",
  metadataBase: new URL(siteUrl()),
  applicationName: "Book by the People",
  icons: { icon: "/favicon.png", apple: "/apple-touch-icon.png" },
  openGraph: {
    type: "website",
    siteName: "Book by the People",
    title: "Book by the People",
    description: "One question. Everyone answers in their own words. A real book, in people's exact words.",
  },
  twitter: { card: "summary_large_image", title: "Book by the People", description: "One question. Everyone answers. A real book in people's exact words." },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const featured = await homeBookLite();
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
