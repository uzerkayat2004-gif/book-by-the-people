import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const database = path.join(process.cwd(), "data", "bbtp.db");

if (!existsSync(database)) {
  mkdirSync(path.dirname(database), { recursive: true });
  execSync("npx prisma db push", { stdio: "inherit" });
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
}
