import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

/** The share card: dark page, red mark, the question in big type. */
export function ogCard({ kicker, title, foot }: { kicker: string; title: string; foot: string }) {
  const size = title.length > 90 ? 52 : title.length > 50 ? 64 : 78;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "radial-gradient(circle at 85% 20%, #3a1214 0%, #0b0c0f 55%)",
          color: "#f0ede5",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 22, height: 22, borderRadius: 11, background: "#e5383b" }} />
          <div style={{ fontSize: 30, letterSpacing: 4, fontWeight: 700 }}>BOOK BY THE PEOPLE</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 28, color: "#ff6b66", letterSpacing: 3, textTransform: "uppercase" }}>{kicker}</div>
          <div style={{ fontSize: size, lineHeight: 1.08, fontWeight: 700, maxWidth: 1050 }}>{title}</div>
        </div>
        <div style={{ fontSize: 28, color: "#a9a49a" }}>{foot}</div>
      </div>
    ),
    OG_SIZE,
  );
}
