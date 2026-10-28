import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // The voice page records from the microphone on this site only.
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // data/ holds the database, recordings and downloaded models (several GB). The server reads it at run
  // time, so the build must not trace or copy it.
  // The built-in voice (eSpeak NG in WebAssembly) loads its .wasm next to its own file, so it stays a
  // plain node_modules package and its files ship with every server function (Vercel included).
  serverExternalPackages: ["espeak-ng"],
  outputFileTracingIncludes: {
    "*": ["./node_modules/espeak-ng/dist/**/*", "./src/generated/prisma/*.node"],
  },
  outputFileTracingExcludes: {
    "*": ["./data/**/*", "./.tmp/**/*", "./test-results/**/*", "./playwright-report/**/*"],
  },
  // Sessions, live voice counts, and drafts are request data. Cache Components
  // would try to prerender a shell around a database that changes every voice,
  // so this app stays dynamic. Partial prefetching requires that flag.
  experimental: {
    serverActions: {
      bodySizeLimit: "32mb",
    },
    proxyClientMaxBodySize: "32mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
