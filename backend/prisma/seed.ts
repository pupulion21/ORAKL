// ORAKL P1 — seed: role wallets from the local deployment manifest + the
// default category taxonomy. LOCAL SIMULATION ONLY (Anvil master accounts).
import { readFile } from "node:fs/promises";
import path from "node:path";

import { makePrisma } from "../src/db.ts";

type Manifest = {
  roles: Record<string, string>;
  status: string;
  mode: string;
};

const CATEGORIES = [
  { slug: "crypto", name: "Crypto Markets", sortOrder: 10 },
  { slug: "sports", name: "Sports", sortOrder: 20 },
  { slug: "world", name: "World Events", sortOrder: 30 },
  { slug: "economy", name: "Economy & Finance", sortOrder: 40 },
];

const prisma = makePrisma();
const manifest: Manifest = JSON.parse(
  await readFile(path.resolve(process.cwd(), "deployments/local-selected.json"), "utf8"),
);
if (manifest.status !== "LOCAL_SIMULATION" || manifest.mode !== "local-selected") {
  throw new Error("seed refuses to run against a non-local manifest");
}

for (const [role, wallet] of Object.entries(manifest.roles)) {
  await prisma.user.upsert({
    where: { walletAddress: wallet.toLowerCase() },
    update: { displayName: role },
    create: { walletAddress: wallet.toLowerCase(), displayName: role },
  });
}

for (const c of CATEGORIES) {
  await prisma.category.upsert({ where: { slug: c.slug }, update: {}, create: c });
}

console.log("[seed] users + categories ensured (local simulation only)");
await prisma.$disconnect();
