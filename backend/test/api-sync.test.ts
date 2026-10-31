// ORAKL P1 — Fastify API Synchronization Metadata & Read Model Freshness tests (TICKET-04).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";

import { makePrisma, type PrismaDb } from "../src/db.js";
import { buildServer } from "../src/api/server.js";
import { wipeChain } from "./harness.js";

const CHAIN_ID = 31337;
const HASH_50 = "0x" + "a".repeat(64);
const HASH_50_ALT = "0x" + "b".repeat(64);

describe("Fastify API Synchronization Metadata & Read Model Freshness (TICKET-04 / ADR-0007)", () => {
  let prisma: PrismaDb;
  let app: FastifyInstance;
  let mockReferenceHead: bigint | null = 51n;

  beforeAll(async () => {
    prisma = makePrisma();
    await wipeChain(prisma, CHAIN_ID);

    // Seed checkpoint at block 50
    await prisma.indexerCheckpoint.create({
      data: {
        chainId: CHAIN_ID,
        contractAddress: "0x1111111111111111111111111111111111111111",
        lastProcessedBlock: 50n,
        lastProcessedBlockHash: HASH_50,
        eventsIndexed: 10n,
      },
    });

    // Seed matching canonical block
    await prisma.indexedBlock.create({
      data: {
        chainId: CHAIN_ID,
        blockNumber: 50n,
        blockHash: HASH_50,
        parentHash: "0x" + "0".repeat(64),
        timestamp: 1700000000n,
      },
    });

    // Seed test user
    await prisma.user.upsert({
      where: { walletAddress: "0x3333333333333333333333333333333333333333" },
      update: {},
      create: { walletAddress: "0x3333333333333333333333333333333333333333" },
    });

    // Seed test category
    await prisma.category.upsert({
      where: { slug: "crypto" },
      update: {},
      create: { name: "Crypto", slug: "crypto" },
    });

    // Seed market 0 with large financial value (10^50)
    await prisma.market.create({
      data: {
        chainId: CHAIN_ID,
        onchainMarketId: 0n,
        contractAddress: "0x2222222222222222222222222222222222222222",
        creatorAddress: "0x3333333333333333333333333333333333333333",
        metadataHash: "0x" + "c".repeat(64),
        metadataURI: "ipfs://local-metadata",
        question: "Will ETH reach 10k?",
        status: "OPEN",
        finalOutcome: "UNRESOLVED",
        totalChallengeStake: "2000000000000000000",
        closeTime: 1800000000n,
        resolutionTime: 1850000000n,
        maxResolutionTime: 1900000000n,
        createdAtBlock: 10n,
      },
    });

    // Seed a position with 10^50 to test exact decimal string serialization (ADR-0001)
    await prisma.user.upsert({
      where: { walletAddress: "0x4444444444444444444444444444444444444444" },
      update: {},
      create: { walletAddress: "0x4444444444444444444444444444444444444444" },
    });
    const market = await prisma.market.findUniqueOrThrow({ where: { onchainMarketId: 0n } });
    await prisma.marketPosition.create({
      data: {
        marketId: market.id,
        walletAddress: "0x4444444444444444444444444444444444444444",
        yesContribution: "100000000000000000000000000000000000000000000000000", // 10^50
        noContribution: "5000000000000000000",
        updatedBlock: 20n,
      },
    });

    app = await buildServer({
      prisma: prisma as unknown as PrismaClient,
      getReferenceHead: async () => mockReferenceHead,
    });
  });

  afterAll(async () => {
    if (prisma) {
      await wipeChain(prisma, CHAIN_ID);
      await prisma.$disconnect();
    }
    if (app) await app.close();
  });

  it("1. valid synchronized checkpoint attaches sync metadata matching persisted checkpoint", async () => {
    mockReferenceHead = 51n; // lag = 1 <= 5
    const res = await app.inject({ method: "GET", url: "/api/v1/markets" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.simulationOnly).toBe(true);
    expect(body.sync).toBeDefined();
    expect(body.sync.lastProcessedBlock).toBe("50");
    expect(body.sync.lastProcessedBlockHash).toBe(HASH_50);
    expect(body.sync.chainId).toBe(CHAIN_ID);
    expect(body.sync.status).toBe("SYNCHRONIZED");
    expect(body.sync.referenceHead).toBe("51");
    expect(body.sync.lag).toBe("1");
    expect(body.data.items).toHaveLength(1);
  });

  it("2. missing checkpoint yields UNAVAILABLE status without fabricating metadata", async () => {
    // Temporarily delete checkpoint
    await prisma.indexerCheckpoint.deleteMany({ where: { chainId: CHAIN_ID } });
    const res = await app.inject({ method: "GET", url: "/api/v1/markets" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sync).toBeDefined();
    expect(body.sync.status).toBe("UNAVAILABLE");
    expect(body.sync.lastProcessedBlock).toBeNull();
    expect(body.sync.lastProcessedBlockHash).toBeNull();
    expect(body.sync.updatedAt).toBeNull();

    // Restore checkpoint for subsequent tests
    await prisma.indexerCheckpoint.create({
      data: {
        chainId: CHAIN_ID,
        contractAddress: "0x1111111111111111111111111111111111111111",
        lastProcessedBlock: 50n,
        lastProcessedBlockHash: HASH_50,
        eventsIndexed: 10n,
      },
    });
  });

  it("3. stale checkpoint (> 5 blocks behind verified reference head) yields LAGGING status", async () => {
    mockReferenceHead = 65n; // diff = 15 > 5
    const res = await app.inject({ method: "GET", url: "/api/v1/markets" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sync.status).toBe("LAGGING");
    expect(body.sync.lastProcessedBlock).toBe("50");
    expect(body.sync.referenceHead).toBe("65");
    expect(body.sync.lag).toBe("15");
  });

  it("4. checkpoint hash mismatch against canonical block store yields LAGGING status", async () => {
    mockReferenceHead = 51n;
    // Update indexedBlock to have a different blockHash than checkpoint
    await prisma.indexedBlock.update({
      where: { chainId_blockNumber: { chainId: CHAIN_ID, blockNumber: 50n } },
      data: { blockHash: HASH_50_ALT },
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/markets" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sync.status).toBe("LAGGING");

    // Restore matching blockHash
    await prisma.indexedBlock.update({
      where: { chainId_blockNumber: { chainId: CHAIN_ID, blockNumber: 50n } },
      data: { blockHash: HASH_50 },
    });
  });

  it("5. chain ID mismatch in x-chain-id header is rejected with 400 WRONG_CHAIN", async () => {
    const resWrong = await app.inject({
      method: "GET",
      url: "/api/v1/markets",
      headers: { "x-chain-id": "1893" }, // legacy QIE testnet ID
    });
    expect(resWrong.statusCode).toBe(400);
    const bodyWrong = resWrong.json();
    expect(bodyWrong.code).toBe("WRONG_CHAIN");
    expect(typeof bodyWrong.error).toBe("string");
    expect(typeof bodyWrong.requestId).toBe("string");

    const resCorrect = await app.inject({
      method: "GET",
      url: "/api/v1/markets",
      headers: { "x-chain-id": "31337" },
    });
    expect(resCorrect.statusCode).toBe(200);
  });

  it("6. incomplete projection returns clean nulls/arrays without 500 error", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets/0" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.id).toBe("0");
    expect(body.data.resolution).toBeNull();
    expect(body.data.settlement).toBeNull();
    expect(body.data.challengeStakes).toEqual([]);
    expect(body.sync.lastProcessedBlock).toBe("50");
  });

  it("7. large uint256 financial values serialize as exact non-exponential base-10 strings", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets/0" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const pos = body.data.positions[0];
    expect(pos).toBeDefined();

    // Must be exact digits matching /^(0|[1-9]\d*)$/ without scientific notation like 1e+50
    expect(pos.yesContribution).toMatch(/^(0|[1-9]\d*)$/);
    expect(pos.yesContribution).toBe("100000000000000000000000000000000000000000000000000");
    expect(pos.noContribution).toBe("5000000000000000000");
  });

  it("8. missing or malformed read-model parameters return standard 404 / 400 envelopes", async () => {
    const resNotFound = await app.inject({ method: "GET", url: "/api/v1/markets/999999" });
    expect(resNotFound.statusCode).toBe(404);
    const bodyNotFound = resNotFound.json();
    expect(bodyNotFound.code).toBe("NOT_FOUND");
    expect(typeof bodyNotFound.error).toBe("string");
    expect(typeof bodyNotFound.requestId).toBe("string");

    const resBadId = await app.inject({ method: "GET", url: "/api/v1/markets/invalid-id" });
    expect(resBadId.statusCode).toBe(400);
    const bodyBadId = resBadId.json();
    expect(bodyBadId.code).toBe("INVALID_PARAM");
    expect(typeof bodyBadId.error).toBe("string");
    expect(typeof bodyBadId.requestId).toBe("string");

    const resBadAddr = await app.inject({ method: "GET", url: "/api/v1/portfolio/not-an-address" });
    expect(resBadAddr.statusCode).toBe(400);
    const bodyBadAddr = resBadAddr.json();
    expect(bodyBadAddr.code).toBe("INVALID_PARAM");
    expect(typeof bodyBadAddr.error).toBe("string");
    expect(typeof bodyBadAddr.requestId).toBe("string");
  });

  it("9. empty market query results return total 0 and items [] with valid sync metadata", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets?q=nonexistent-term-xyz" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.total).toBe(0);
    expect(body.data.items).toEqual([]);
    expect(body.sync.lastProcessedBlock).toBe("50");
  });

  it("10. consistency across related API endpoints (all expose matching sync metadata)", async () => {
    mockReferenceHead = 50n;
    const urls = [
      "/api/v1/markets",
      "/api/v1/markets/0",
      "/api/v1/markets/0/activity",
      "/api/v1/markets/0/challenges",
      "/api/v1/markets/0/settlement",
      "/api/v1/exposure",
      "/api/v1/indexer/status",
    ];

    for (const url of urls) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sync).toBeDefined();
      expect(body.sync.lastProcessedBlock).toBe("50");
      expect(body.sync.lastProcessedBlockHash).toBe(HASH_50);
      expect(body.sync.chainId).toBe(CHAIN_ID);
      expect(body.sync.status).toBe("SYNCHRONIZED");
    }
  });

  it("clamps pageSize to maxPageSize = 100 when pageSize=1000 is requested", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets?pageSize=1000" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.pageSize).toBe(100);
  });
});
