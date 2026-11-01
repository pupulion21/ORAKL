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
});
