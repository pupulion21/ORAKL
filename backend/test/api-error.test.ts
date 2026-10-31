// ORAKL P1 — Fastify API Centralized Error Envelopes & Security Hardening tests (TICKET-05 / ADR-0012).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";

import { makePrisma, type PrismaDb } from "../src/db.js";
import { buildServer } from "../src/api/server.js";
import { wipeChain } from "./harness.js";
import { redactSecrets, HttpError } from "../src/lib/format.js";

const CHAIN_ID = 31337;

describe("Fastify API Centralized Error Envelopes & Security Hardening (TICKET-05 / ADR-0012)", () => {
  let prisma: PrismaDb;
  let app: FastifyInstance;

  beforeAll(async () => {
    prisma = makePrisma();
    await wipeChain(prisma, CHAIN_ID);

    // Seed checkpoint at block 10
    await prisma.indexerCheckpoint.create({
      data: {
        chainId: CHAIN_ID,
        contractAddress: "0x1111111111111111111111111111111111111111",
        lastProcessedBlock: 10n,
        lastProcessedBlockHash: "0x" + "1".repeat(64),
        eventsIndexed: 5n,
      },
    });

    // Seed canonical block 10
    await prisma.indexedBlock.create({
      data: {
        chainId: CHAIN_ID,
        blockNumber: 10n,
        blockHash: "0x" + "1".repeat(64),
        parentHash: "0x" + "0".repeat(64),
        timestamp: 1700000000n,
      },
    });

    // Seed test category
    await prisma.category.upsert({
      where: { slug: "tech" },
      update: {},
      create: { name: "Tech", slug: "tech" },
    });

    // Seed user and market 1
    await prisma.user.upsert({
      where: { walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      update: {},
      create: { walletAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    });

    await prisma.market.create({
      data: {
        chainId: CHAIN_ID,
        onchainMarketId: 1n,
        contractAddress: "0x2222222222222222222222222222222222222222",
        creatorAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        metadataHash: "0x" + "a".repeat(64),
        metadataURI: "ipfs://test-manifest",
        question: "Will monad mainnet launch?",
        status: "OPEN",
        finalOutcome: "UNRESOLVED",
        totalChallengeStake: "1000000000000000000",
        closeTime: 1800000000n,
        resolutionTime: 1850000000n,
        maxResolutionTime: 1900000000n,
        createdAtBlock: 10n,
      },
    });

    app = await buildServer({
      prisma: prisma as unknown as PrismaClient,
      getReferenceHead: async () => 10n,
    });
  });

  afterAll(async () => {
    if (prisma) {
      await wipeChain(prisma, CHAIN_ID);
      await prisma.$disconnect();
    }
    if (app) await app.close();
  });

  // 1. Standard Error Envelope Structure
  it("standardizes error response shape across 404, 400, and includes requestId", async () => {
    const resNotFound = await app.inject({ method: "GET", url: "/api/v1/nonexistent-route" });
    expect(resNotFound.statusCode).toBe(404);
    const body404 = resNotFound.json();
    expect(body404).toHaveProperty("error");
    expect(body404).toHaveProperty("code", "NOT_FOUND");
    expect(body404).toHaveProperty("statusCode", 404);
    expect(body404).toHaveProperty("requestId");
    expect(typeof body404.error).toBe("string");
    expect(typeof body404.requestId).toBe("string");
    expect(body404.requestId.length).toBeGreaterThan(0);
    expect(resNotFound.headers["x-request-id"]).toBe(body404.requestId);
  });

  // 2. Request Correlation & Sanitization
  it("preserves client-provided x-request-id header when valid", async () => {
    const customId = "client-trace-abc-123";
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/markets/999999",
      headers: { "x-request-id": customId },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.requestId).toBe(customId);
    expect(res.headers["x-request-id"]).toBe(customId);
  });

  it("sanitizes malicious or invalid characters in x-request-id and replaces with safe ID", async () => {
    const badId = "bad-injection-<script>";
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/markets/999999",
      headers: { "x-request-id": badId },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.requestId).toBeDefined();
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId).not.toContain("<");
    expect(body.requestId).toMatch(/^req-[a-z0-9]+$/);
  });

  // 3. Chain ID Enforcement
  it("rejects mismatched chain ID with 400 WRONG_CHAIN and standard error envelope", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/markets",
      headers: { "x-chain-id": "1" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("WRONG_CHAIN");
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("chain id 1 does not match");
    expect(body.statusCode).toBe(400);
    expect(typeof body.requestId).toBe("string");
  });

  it("rejects non-integer chain ID with 400 WRONG_CHAIN", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/markets",
      headers: { "x-chain-id": "ethereum-mainnet" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("WRONG_CHAIN");
  });

  // 4. Input Parameter Validation
  it("rejects non-integer, negative, or floating point market IDs with 400 INVALID_PARAM", async () => {
    const badIds = ["abc", "-1", "1.5", "1e10", "0x1", "null"];
    for (const id of badIds) {
      const res = await app.inject({ method: "GET", url: `/api/v1/markets/${id}` });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("INVALID_PARAM");
      expect(body.error).toContain("must be a non-negative decimal integer");
      expect(typeof body.requestId).toBe("string");
    }
  });

  it("rejects malformed wallet address with 400 INVALID_PARAM", async () => {
    const badAddrs = ["not-an-address", "0x123", "0x" + "g".repeat(40), "0x" + "1".repeat(39)];
    for (const addr of badAddrs) {
      const res = await app.inject({ method: "GET", url: `/api/v1/portfolio/${addr}` });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("INVALID_PARAM");
      expect(body.error).toContain("address must be 0x + 40 hex chars");
    }
  });

  it("rejects malformed commitment hash with 400 INVALID_PARAM", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/evidence/0xshort" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("INVALID_PARAM");
    expect(body.error).toContain("must be a 0x-prefixed 64 hex character hash");
  });

  it("rejects invalid query status filter with 400 INVALID_PARAM", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets?status=BOGUS_STATUS" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("INVALID_PARAM");
    expect(body.error).toContain("unknown status");
  });

  // 5. CORS & Origin Enforcement
  it("rejects POST mutations from unauthorized Origin with 403 ORIGIN_FORBIDDEN", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: {
        origin: "http://malicious-website.com",
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe("ORIGIN_FORBIDDEN");
    expect(body.error).toBe("origin not allowed");
    expect(typeof body.requestId).toBe("string");
  });

  it("handles OPTIONS preflight cleanly with 204 and CORS headers", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/evidence",
      headers: { origin: "http://localhost:5176" },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5176");
    expect(res.headers["access-control-allow-methods"]).toBe("GET, POST, OPTIONS");
  });

  // 6. Malformed JSON Body Handling
  it("rejects malformed JSON payload with 400 INVALID_PAYLOAD without leaking parser internals", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: '{"manifest": { unclosed json',
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("INVALID_PAYLOAD");
    expect(body.error).toBe("malformed request payload");
    expect(typeof body.requestId).toBe("string");
    // Ensure no V8 SyntaxError or stack dump leaked
    expect(body.error).not.toContain("SyntaxError");
    expect(body.error).not.toContain("position");
  });

  // 7. Payload Size Boundary (256KB limit)
  it("rejects payload exceeding 256KB with 413 PAYLOAD_TOO_LARGE", async () => {
    const oversized = "x".repeat(300 * 1024);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ huge: oversized }),
    });
    expect(res.statusCode).toBe(413);
    const body = res.json();
    expect(body.code).toBe("PAYLOAD_TOO_LARGE");
    expect(body.statusCode).toBe(413);
    expect(typeof body.requestId).toBe("string");
  });

  // 8. Secret Redaction & Database Exception Suppression (ADR-0012)
  it("redacts database credentials, URLs, and secrets using redactSecrets helper", () => {
    const rawWithDb = "Failed to connect to postgresql://orakl:super_secret_pw@127.0.0.1:5432/orakl_p1 inside transaction";
    const redactedDb = redactSecrets(rawWithDb);
    expect(redactedDb).not.toContain("super_secret_pw");
    expect(redactedDb).not.toContain("orakl_p1");
    expect(redactedDb).toContain("[REDACTED_DATABASE_URL]");

    const rawWithRpc = "RPC error from https://rpc.chain.org/v1/auth?apikey=secret_rpc_token_9999 failed";
    const redactedRpc = redactSecrets(rawWithRpc);
    expect(redactedRpc).not.toContain("secret_rpc_token_9999");
    expect(redactedRpc).toContain("[REDACTED_RPC_URL]");

    const rawWithPrivKey = "Error: private_key: 0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789 is invalid";
    const redactedPriv = redactSecrets(rawWithPrivKey);
    expect(redactedPriv).not.toContain("0xabcdef0123456789");
    expect(redactedPriv).toContain("[REDACTED]");
  });

  it("suppresses internal database exceptions to 500 INTERNAL_ERROR with generic message", async () => {
    // Build a server with a failing prisma query
    const brokenPrisma = {
      ...prisma,
      market: {
        ...prisma.market,
        findMany: async () => {
          throw new Error("P1001: Can't reach database server at postgresql://postgres:password123@127.0.0.1:5432/orakl_p1");
        },
      },
    } as unknown as PrismaClient;

    const brokenApp = await buildServer({
      prisma: brokenPrisma,
      getReferenceHead: async () => 10n,
    });

    const res = await brokenApp.inject({ method: "GET", url: "/api/v1/markets" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.error).toBe("an internal server error occurred");
    expect(body.statusCode).toBe(500);
    expect(typeof body.requestId).toBe("string");
    // Verify ZERO credentials, SQL, or internal details were returned to client
    expect(JSON.stringify(body)).not.toContain("password123");
    expect(JSON.stringify(body)).not.toContain("postgresql");
    expect(JSON.stringify(body)).not.toContain("P1001");
    expect(JSON.stringify(body)).not.toContain("stack");

    await brokenApp.close();
  });

  // 9. Pagination Clamping and Safe Defaults
  it("safely bounds pagination: clamps pageSize=1000 to 100, negative to 1, page to 1", async () => {
    const resHuge = await app.inject({ method: "GET", url: "/api/v1/markets?pageSize=1000" });
    expect(resHuge.statusCode).toBe(200);
    expect(resHuge.json().data.pageSize).toBe(100);

    const resNeg = await app.inject({ method: "GET", url: "/api/v1/markets?pageSize=-10&page=-5" });
    expect(resNeg.statusCode).toBe(200);
    expect(resNeg.json().data.pageSize).toBe(1);
    expect(resNeg.json().data.page).toBe(1);

    const resNaN = await app.inject({ method: "GET", url: "/api/v1/markets?pageSize=bogus&page=invalid" });
    expect(resNaN.statusCode).toBe(200);
    expect(resNaN.json().data.pageSize).toBe(20);
    expect(resNaN.json().data.page).toBe(1);
  });

  // 10. Rate Limiting Error Envelope
  it("enforces rate limiting and formats 429 error envelope with RATE_LIMITED", async () => {
    // Send multiple requests beyond threshold (30) to trigger 429
    let lastRes;
    for (let i = 0; i < 35; i++) {
      lastRes = await app.inject({
        method: "POST",
        url: "/api/v1/evidence",
        headers: { "content-type": "application/json" },
        payload: { manifest: null },
      });
      if (lastRes.statusCode === 429) break;
    }
    expect(lastRes?.statusCode).toBe(429);
    const body = lastRes?.json();
    expect(body.code).toBe("RATE_LIMITED");
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("too many publications");
    expect(typeof body.requestId).toBe("string");
  });
});
