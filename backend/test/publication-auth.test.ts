import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToBytes } from "viem";
import { buildServer } from "../src/api/server.js";
import { makePrisma } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { wipeChain } from "./harness.js";
import {
  createPublicationAuth,
  signPublicationAuthEip712,
  signPublicationAuthEip191,
  type PublicationAuth,
} from "../src/evidence/auth.js";
import { evidenceCommitment, type EvidenceManifest } from "../src/evidence/evidence.js";

const TEST_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OTHER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const signer = privateKeyToAccount(TEST_PK);
const otherSigner = privateKeyToAccount(OTHER_PK);

const CHAIN_ID = 31337;
const FACTORY = "0x2222222222222222222222222222222222222222";

function uniqueNonce(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

describe("Signed Publication Replay Protection (ISSUE P1-02)", () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let prisma: ReturnType<typeof makePrisma>;

  beforeAll(async () => {
    const config = loadConfig({
      ...process.env,
      PORT: "4399",
      LOCAL_CHAIN_ID: String(CHAIN_ID),
      TRUSTED_FACTORY: FACTORY,
    });
    prisma = makePrisma(config.databaseUrl);
    await wipeChain(prisma, CHAIN_ID);
    app = await buildServer({ config, prisma });
    await app.ready();
  });

  afterAll(async () => {
    await wipeChain(prisma, CHAIN_ID);
    await app.close();
    await prisma.$disconnect();
  });

  function makeEvidenceManifest(nonce = "test-nonce-1"): {
    manifest: EvidenceManifest;
    commitment: `0x${string}`;
    content: string;
  } {
    const content = `Verification evidence document text ${nonce}`;
    const contentBytes = Buffer.from(content, "utf8");
    const contentHash = keccak256(contentBytes);
    const manifest: EvidenceManifest = {
      schema: "orakl-evidence-v1",
      chainId: String(CHAIN_ID),
      contract: FACTORY,
      marketId: "1",
      kind: "proposal",
      claim: "YES",
      proposedOutcome: "YES",
      sources: ["https://example.com/source"],
      publishedAt: "1700000000",
      publisher: signer.address.toLowerCase(),
      contentHash,
      contentMediaType: "text/plain",
      media: [],
    };
    const commitment = evidenceCommitment(manifest);
    return { manifest, commitment, content };
  }

  it("accepts valid EIP-712 publication authorization", async () => {
    const { manifest, commitment, content } = makeEvidenceManifest("eip712-1");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: CHAIN_ID,
      factory: FACTORY,
      publisher: signer.address.toLowerCase() as `0x${string}`,
      commitment,
      nonce: uniqueNonce("eip712"),
      deadline,
    };
    const signature = await signPublicationAuthEip712(signer, auth);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth, signature, content },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.commitment).toBe(commitment);
    expect(body.data.deduped).toBe(false);
  });

  it("accepts valid rigorously bound EIP-191 publication authorization", async () => {
    const { manifest, commitment, content } = makeEvidenceManifest("eip191-1");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: CHAIN_ID,
      factory: FACTORY,
      publisher: signer.address.toLowerCase() as `0x${string}`,
      commitment,
      nonce: uniqueNonce("eip191"),
      deadline,
    };
    const signature = await signPublicationAuthEip191(signer, auth);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth, signature, content },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.commitment).toBe(commitment);
  });

  it("rejects wrong action with 400 WRONG_ACTION", async () => {
    const { manifest, commitment, content } = makeEvidenceManifest("wrong-action");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "metadata", // WRONG action for /api/v1/evidence
      chainId: CHAIN_ID,
      factory: FACTORY,
      publisher: signer.address.toLowerCase() as `0x${string}`,
      commitment,
      nonce: uniqueNonce("wrong_act"),
      deadline,
    };
    const signature = await signPublicationAuthEip712(signer, auth);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth, signature, content },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("WRONG_ACTION");
  });

  it("rejects wrong chain with 400 WRONG_CHAIN", async () => {
    const { manifest, commitment, content } = makeEvidenceManifest("wrong-chain");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: 1, // Mainnet chain ID, not 31337
      factory: FACTORY,
      publisher: signer.address.toLowerCase() as `0x${string}`,
      commitment,
      nonce: uniqueNonce("wrong_chain"),
      deadline,
    };
    const signature = await signPublicationAuthEip712(signer, auth);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth, signature, content },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("WRONG_CHAIN");
  });

  it("rejects wrong factory with 400 WRONG_FACTORY", async () => {
    const { manifest, commitment, content } = makeEvidenceManifest("wrong-factory");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: CHAIN_ID,
      factory: "0x9999999999999999999999999999999999999999", // WRONG factory
      publisher: signer.address.toLowerCase() as `0x${string}`,
      commitment,
      nonce: uniqueNonce("wrong_fact"),
      deadline,
    };
    const signature = await signPublicationAuthEip712(signer, auth);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth, signature, content },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("WRONG_FACTORY");
  });

  it("rejects expired signature with 401 EXPIRED_SIGNATURE", async () => {
    const { manifest, commitment, content } = makeEvidenceManifest("expired");
    const deadline = Math.floor(Date.now() / 1000) - 60; // 60 seconds in the past!
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: CHAIN_ID,
      factory: FACTORY,
      publisher: signer.address.toLowerCase() as `0x${string}`,
      commitment,
      nonce: uniqueNonce("expired"),
      deadline,
    };
    const signature = await signPublicationAuthEip712(signer, auth);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth, signature, content },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("EXPIRED_SIGNATURE");
  });

  it("rejects reused nonce with 409 REUSED_NONCE", async () => {
    const { manifest, commitment, content } = makeEvidenceManifest("reused-nonce-orig");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const sharedNonce = uniqueNonce("reused");
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: CHAIN_ID,
      factory: FACTORY,
      publisher: signer.address.toLowerCase() as `0x${string}`,
      commitment,
      nonce: sharedNonce,
      deadline,
    };
    const signature = await signPublicationAuthEip712(signer, auth);

    // First attempt should succeed
    const res1 = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth, signature, content },
    });
    expect(res1.statusCode).toBe(200);

    // Second attempt with exact same nonce (even on different payload) must be rejected
    const { manifest: m2, commitment: c2, content: cnt2 } = makeEvidenceManifest("reused-nonce-diff");
    const auth2: PublicationAuth = {
      ...auth,
      commitment: c2,
    };
    const sig2 = await signPublicationAuthEip712(signer, auth2);

    const res2 = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest: m2, auth: auth2, signature: sig2, content: cnt2 },
    });

    expect(res2.statusCode).toBe(409);
    expect(res2.json().code).toBe("REUSED_NONCE");
  });

  it("rejects modified payload with 400 PAYLOAD_MISMATCH", async () => {
    const { manifest, commitment, content } = makeEvidenceManifest("tampered");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const fakeCommitment = "0x" + "aa".repeat(32);
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: CHAIN_ID,
      factory: FACTORY,
      publisher: signer.address.toLowerCase() as `0x${string}`,
      commitment: fakeCommitment, // Does NOT match manifest commitment!
      nonce: uniqueNonce("tampered"),
      deadline,
    };
    const signature = await signPublicationAuthEip712(signer, auth);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth, signature, content },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("PAYLOAD_MISMATCH");
  });

  it("rejects unauthorized publisher signature with 401 INVALID_SIGNATURE", async () => {
    const { manifest, commitment, content } = makeEvidenceManifest("unauth-sig");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: CHAIN_ID,
      factory: FACTORY,
      publisher: signer.address.toLowerCase() as `0x${string}`, // claims to be signer
      commitment,
      nonce: uniqueNonce("unauth"),
      deadline,
    };
    // Signed by otherSigner instead of signer!
    const signature = await signPublicationAuthEip712(otherSigner, auth);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth, signature, content },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("INVALID_SIGNATURE");
  });

  it("safely handles concurrent duplicate submissions with the same nonce", async () => {
    const { manifest, commitment, content } = makeEvidenceManifest("concurrent-nonce");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: CHAIN_ID,
      factory: FACTORY,
      publisher: signer.address.toLowerCase() as `0x${string}`,
      commitment,
      nonce: uniqueNonce("concurrent"),
      deadline,
    };
    const signature = await signPublicationAuthEip712(signer, auth);

    // Fire two requests concurrently
    const [resA, resB] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/evidence",
        headers: { "content-type": "application/json" },
        payload: { manifest, auth, signature, content },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/evidence",
        headers: { "content-type": "application/json" },
        payload: { manifest, auth, signature, content },
      }),
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    // One must succeed (200) and one must be rejected (409)
    expect(statuses).toEqual([200, 409]);
  });

  it("P1-FINAL-01: rejects arbitrary rogue factory even when manifest and signature agree on rogue factory", async () => {
    const ROGUE_FACTORY = "0x9999999999999999999999999999999999999999";
    const { manifest, content } = makeEvidenceManifest("rogue-factory");
    // Attacker crafts manifest pointing to rogue factory
    manifest.contract = ROGUE_FACTORY;
    const rogueCommitment = evidenceCommitment(manifest);
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: CHAIN_ID,
      factory: ROGUE_FACTORY, // Agrees with manifest.contract!
      publisher: signer.address.toLowerCase() as `0x${string}`,
      commitment: rogueCommitment,
      nonce: uniqueNonce("rogue_fact"),
      deadline,
    };
    // Valid cryptographic signature for ROGUE_FACTORY
    const signature = await signPublicationAuthEip712(signer, auth);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth, signature, content },
    });

    // Currently, this passes 200 OK because the server blindly trusts em.contract!
    // It MUST be rejected with 400 WRONG_FACTORY!
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("WRONG_FACTORY");
  });

  it("P1-FINAL-02: invalid content does not burn nonce — nonce remains usable once content is corrected", async () => {
    const { manifest, commitment } = makeEvidenceManifest("atomic-nonce");
    const badContent = "Corrupt / mismatched content payload"; // Content hash won't match manifest!
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const atomicNonce = uniqueNonce("atomic_test");
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: CHAIN_ID,
      factory: FACTORY,
      publisher: signer.address.toLowerCase() as `0x${string}`,
      commitment,
      nonce: atomicNonce,
      deadline,
    };
    const signature = await signPublicationAuthEip712(signer, auth);

    // 1. Submit with bad content. Must fail validation with 400 CONTENT_HASH_MISMATCH.
    const res1 = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth, signature, content: badContent },
    });
    expect(res1.statusCode).toBe(400);
    expect(res1.json().code).toBe("CONTENT_HASH_MISMATCH");

    // 2. Client fixes content so hash matches manifest.
    // In buggy code: nonce was already burned in step 1, so step 2 gets 409 REUSED_NONCE!
    // In atomic code: nonce was NOT consumed in step 1, so step 2 succeeds with 200 OK!
    const correctContent = `Verification evidence document text atomic-nonce`;
    const res2 = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth, signature, content: correctContent },
    });

    expect(res2.statusCode).toBe(200);
    expect(res2.json().data.commitment).toBe(commitment);
  });

  it("P1-FINAL-01: fails closed with 503 DEPLOYMENT_UNAVAILABLE when deployment manifest is missing or invalid", async () => {
    // Spin up an app instance with a non-existent deployment manifest and no trusted factory
    const badConfig = loadConfig({
      ...process.env,
      PORT: "4398",
      LOCAL_CHAIN_ID: String(CHAIN_ID),
      DEPLOYMENT_MANIFEST: "/nonexistent/path/to/manifest.json",
      TRUSTED_FACTORY: "", // explicit empty to force manifest read
    });
    const badApp = await buildServer({ config: badConfig, prisma });
    await badApp.ready();

    try {
      const { manifest, commitment, content } = makeEvidenceManifest("missing-manifest");
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const auth: PublicationAuth = {
        app: "ORAKL",
        version: "1",
        action: "evidence",
        chainId: CHAIN_ID,
        factory: FACTORY,
        publisher: signer.address.toLowerCase() as `0x${string}`,
        commitment,
        nonce: uniqueNonce("missing_dep"),
        deadline,
      };
      const signature = await signPublicationAuthEip712(signer, auth);

      const res = await badApp.inject({
        method: "POST",
        url: "/api/v1/evidence",
        headers: { "content-type": "application/json" },
        payload: { manifest, auth, signature, content },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe("DEPLOYMENT_UNAVAILABLE");
    } finally {
      await badApp.close();
    }
  });

  it("P1-FINAL-02: database failure during artifact creation rolls back nonce", async () => {
    const { manifest, commitment, content } = makeEvidenceManifest("rollback-nonce");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const testNonce = uniqueNonce("rollback_tx");
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: CHAIN_ID,
      factory: FACTORY,
      publisher: signer.address.toLowerCase() as `0x${string}`,
      commitment,
      nonce: testNonce,
      deadline,
    };
    const signature = await signPublicationAuthEip712(signer, auth);

    // Mock $transaction so that tx.evidenceArtifact.create fails inside the transaction
    const origTx = prisma.$transaction;
    let failOnce = true;
    (prisma as any).$transaction = async (fn: any, ...rest: any[]) => {
      if (failOnce) {
        failOnce = false;
        return origTx.call(
          prisma,
          async (tx: any) => {
            const origCreate = tx.evidenceArtifact.create;
            tx.evidenceArtifact.create = async (...args: any[]) => {
              throw new Error("Simulated database failure during artifact persistence");
            };
            return fn(tx);
          },
          ...rest,
        );
      }
      return origTx.call(prisma, fn, ...rest);
    };

    try {
      // 1. Submit request that fails during DB insertion
      const res1 = await app.inject({
        method: "POST",
        url: "/api/v1/evidence",
        headers: { "content-type": "application/json" },
        payload: { manifest, auth, signature, content },
      });
      expect(res1.statusCode).toBe(500);

      // Check if nonce was persisted in DB: IT MUST NOT BE PERSISTED because the tx rolled back!
      const nonceRow = await prisma.authNonce.findUnique({
        where: { nonce: testNonce },
      });
      expect(nonceRow).toBeNull();

      // 2. Client retries the request with the SAME nonce now that DB is healthy
      const res2 = await app.inject({
        method: "POST",
        url: "/api/v1/evidence",
        headers: { "content-type": "application/json" },
        payload: { manifest, auth, signature, content },
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().data.commitment).toBe(commitment);
    } finally {
      (prisma as any).$transaction = origTx;
    }
  });

  it("P1-FINAL-01: metadata publication rejects arbitrary rogue factory even with valid signature", async () => {
    const ROGUE_FACTORY = "0x9999999999999999999999999999999999999999";
    const metadata = {
      schema: "orakl-market-metadata-v1",
      chainId: String(CHAIN_ID),
      factory: ROGUE_FACTORY,
      question: "Will rogue factory test pass?",
      description: "Testing rejection of rogue factory.",
      category: "tech",
      resolutionCriteria: "Strict criteria",
      sources: ["https://example.com"],
      creator: signer.address.toLowerCase(),
      createdAt: "1700000000",
    };
    const sortedFields = [
      `"category":"${metadata.category}"`,
      `"chainId":"${metadata.chainId}"`,
      `"createdAt":"${metadata.createdAt}"`,
      `"creator":"${metadata.creator}"`,
      `"description":"${metadata.description}"`,
      `"factory":"${metadata.factory}"`,
      `"question":"${metadata.question}"`,
      `"resolutionCriteria":"${metadata.resolutionCriteria}"`,
      `"schema":"${metadata.schema}"`,
      `"sources":["${metadata.sources[0]}"]`,
    ];
    const canonicalString = `{${sortedFields.join(",")}}`;
    const commitment = keccak256(stringToBytes(canonicalString));

    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "metadata",
      chainId: CHAIN_ID,
      factory: ROGUE_FACTORY,
      publisher: signer.address.toLowerCase() as `0x${string}`,
      commitment,
      nonce: uniqueNonce("rogue_meta"),
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };
    const signature = await signPublicationAuthEip712(signer, auth);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/markets/metadata",
      headers: { "content-type": "application/json" },
      payload: { metadata, auth, signature },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("WRONG_FACTORY");
  });

  it("P1-FINAL-01: fails closed with 503 DEPLOYMENT_UNAVAILABLE when deployment manifest is tampered (bad chainId)", async () => {
    // Write a temporary tampered manifest to test fail-closed validation
    const tempManifestPath = `/tmp/tampered-manifest-${Date.now()}.json`;
    const { writeFile, unlink } = await import("node:fs/promises");
    await writeFile(
      tempManifestPath,
      JSON.stringify({
        schemaVersion: 1,
        status: "LOCAL_SIMULATION",
        mode: "local-selected",
        network: { chainId: 999999 }, // TAMPERED chain ID!
        contracts: {
          selectedMarketFactory: { address: FACTORY },
          protocolConfig: { address: "0x3333333333333333333333333333333333333333" },
        },
      }),
      "utf8",
    );

    const tamperedConfig = loadConfig({
      ...process.env,
      PORT: "4397",
      LOCAL_CHAIN_ID: String(CHAIN_ID),
      DEPLOYMENT_MANIFEST: tempManifestPath,
      TRUSTED_FACTORY: "", // Force reading the tampered manifest file
    });
    const tamperedApp = await buildServer({ config: tamperedConfig, prisma });
    await tamperedApp.ready();

    try {
      const { manifest, commitment, content } = makeEvidenceManifest("tampered-manifest");
      const auth: PublicationAuth = {
        app: "ORAKL",
        version: "1",
        action: "evidence",
        chainId: CHAIN_ID,
        factory: FACTORY,
        publisher: signer.address.toLowerCase() as `0x${string}`,
        commitment,
        nonce: uniqueNonce("tampered_man"),
        deadline: Math.floor(Date.now() / 1000) + 3600,
      };
      const signature = await signPublicationAuthEip712(signer, auth);

      const res = await tamperedApp.inject({
        method: "POST",
        url: "/api/v1/evidence",
        headers: { "content-type": "application/json" },
        payload: { manifest, auth, signature, content },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe("DEPLOYMENT_UNAVAILABLE");
    } finally {
      await tamperedApp.close();
      await unlink(tempManifestPath).catch(() => {});
    }
  });
});
