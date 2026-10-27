import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");
const database = path.join(dataDir, "bbtp.db");
const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
const hash = createHash("sha256").update(schema).digest("hex");
const marker = path.join(dataDir, ".schema-hash");
const client = path.join(process.cwd(), "src", "generated", "prisma");

mkdirSync(dataDir, { recursive: true });
const fresh = !existsSync(database);
const changed = !existsSync(marker) || readFileSync(marker, "utf8").trim() !== hash;

if (fresh || changed || !existsSync(client)) {
  // Adds new tables and columns (for example AI models) without touching existing rows.
  execSync("npx prisma db push", { stdio: "inherit" });
  writeFileSync(marker, hash);
}
if (fresh) execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
