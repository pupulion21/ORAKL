// ORAKL P1 — Fastify API for the local backend. Binds 127.0.0.1:4310 only.
//
// LOCAL SIMULATION ONLY. The API is consumed by the selected frontend entry
// point; it never exposes private keys and never relays signed anything.
// When no deployment manifest exists yet the CATALOG routes surface
// ` shim unavailable ` and return 503 so the frontend renders a clean state.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import FastifyFactory, { type FastifyInstance, type FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";

export type ApiDeps = { prisma: PrismaClient };

export const MANIFEST_DIR = "deployments";
const VITE_PROXY_PORT = Number(process.env.VITE_PROXY_PORT ?? "4310");

type ManifestSummary = {
  chainId: number;
  contractsCount: number;
  digestMiss: boolean;
};

export type { FastifyReply };

export async function buildServer(deps: ApiDeps): Promise<FastifyInstance> {
  const app = FastifyFactory({ logger: false, trustProxy: false });

  app.get("/api/health", async () => ({
    ok: true,
    service: "orakl-p1-backend",
    mode: "local-selected",
    simulationOnly: true,
  }));

  app.get("/api/chain/manifests", async () => {
    const files = (await readdir(path.resolve(process.cwd(), MANIFEST_DIR))).filter((f) => f.endsWith(".json"));
    const out: ManifestSummary[] = [];
    for (const file of files) {
      const manifest = JSON.parse(await readFile(path.join(process.cwd(), MANIFEST_DIR, file), "utf8")) as never as {
        status?: string;
        mode?: string;
        network?: { chainId: number };
        contracts?: Record<string, unknown>;
      };
      out.push({
        chainId: manifest.network?.chainId ?? 0,
        contractsCount: Object.keys(manifest.contracts ?? {}).length,
        digestMiss: manifest.status !== "LOCAL_SIMULATION",
      });
    }
    return { manifests: out, simulationOnly: true };
  });

  app.get("/api/markets", async (request, reply) => {
    void request;
    const markets = await deps.prisma.market.findMany({
      orderBy: { onchainMarketId: "asc" },
      include: { contributions: true },
    });
    if (markets.length === 0) {
      reply.code(503);
      return { error: "Market registries offline", simulationOnly: true };
    }
    return {
      simulationOnly: true,
      proxyPort: VITE_PROXY_PORT,
      markets: markets.map((m) => ({
        onchainMarketId: m.onchainMarketId.toString(),
        metadataURI: m.metadataURI,
        closeTime: m.closeTime.toString(),
        status: m.status,
        contributions: m.contributions.map((c) => ({
          side: c.side,
          amount: c.amount.toString(),
          walletAddress: c.walletAddress,
        })),
      })),
    };
  });

  app.get("/api/markets/:id/positions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const market = await deps.prisma.market.findUnique({
      where: { onchainMarketId: BigInt(id) },
    });
    if (market == null) {
      reply.code(404);
      return { error: "No Such Market", simulationOnly: true };
    }
    const positions = await deps.prisma.marketPosition.findMany({ where: { marketId: market.id } });
    return {
      simulationOnly: true,
      positions: positions.map((p) => ({
        walletAddress: p.walletAddress,
        yesContribution: p.yesContribution.toString(),
        noContribution: p.noContribution.toString(),
      })),
    };
  });

  return app;
}

if (process.argv[1]?.endsWith("server.ts")) {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const app = await buildServer({ prisma: prisma as unknown as PrismaClient });
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? "4310");
  await app.listen({ host, port });
  console.log(`[orakl-p1-backend] listening on http://${host}:${port} (LOCAL SIMULATION ONLY)`);
}

export type { FastifyInstance as AppInstance };
