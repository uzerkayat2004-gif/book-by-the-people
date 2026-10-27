import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
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
