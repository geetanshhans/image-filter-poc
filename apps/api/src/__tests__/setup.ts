import { readFileSync } from "node:fs";
import { join } from "node:path";

const envPath = join(import.meta.dir, "../../.env.test");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq);
  const val = trimmed.slice(eq + 1);
  process.env[key] = val;
}
