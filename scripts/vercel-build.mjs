// Build for Vercel: write the Postgres schema, create or update the tables, then build Next.
// `prisma db push` only adds what is missing; it never drops data (it stops if a change would).
import { execSync } from "node:child_process";

const url = process.env.DATABASE_URL ?? "";
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error("vercel-build: DATABASE_URL must be a Postgres URL (add Neon from the Vercel Marketplace).");
  process.exit(1);
}
const run = (command, env = {}) => execSync(command, { stdio: "inherit", env: { ...process.env, ...env } });
run("node scripts/prisma-schema.mjs");
run("npx prisma generate");
// Schema changes go over a direct (unpooled) connection when Neon provides one.
const direct = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || url;
run("npx prisma db push --skip-generate", { DATABASE_URL: direct });
run("npx next build");
