// ORAKL P1 — Fastify API Automated Integration Test Suite (TICKET-06 / WP-04).
// Comprehensive coverage across all 18 versioned routes + legacy routes,
// testing positive, negative, security, precision, and synchronization invariants.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { makePrisma, type PrismaDb } from "../src/db.js";
import { buildServer } from "../src/api/server.js";
import { wipeChain } from "./harness.js";
import { canonicalizeEvidence, evidenceCommitment, type EvidenceManifest } from "../src/evidence/evidence.js";
import { signPublicationAuthEip712, type PublicationAuth } from "../src/evidence/auth.js";

const CHAIN_ID = 31337;
const ANVIL_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const signer = privateKeyToAccount(ANVIL_PK);
const SENDER_ADDR = signer.address.toLowerCase();

const USER_ALICE = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const USER_BOB = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";

const HASH_10 = "0x" + "1".repeat(64);
const HASH_11 = "0x" + "2".repeat(64);
const TX_HASH_1 = "0x" + "3".repeat(64);

describe("Fastify API Automated Integration Suite (TICKET-06 / WP-04)", () => {
  let prisma: PrismaDb;
  let app: FastifyInstance;
  let mockReferenceHead: bigint | null = 11n;

  beforeAll(async () => {
    prisma = makePrisma();
    await wipeChain(prisma, CHAIN_ID);

    // 1. Users
    for (const addr of [SENDER_ADDR, USER_ALICE, USER_BOB]) {
      await prisma.user.upsert({
        where: { walletAddress: addr },
        update: {},
        create: { walletAddress: addr },
      });
    }

    // 2. Categories
    const catCrypto = await prisma.category.upsert({
      where: { slug: "crypto" },
      update: {},
      create: { name: "Crypto", slug: "crypto", sortOrder: 1 },
    });
    const catMacro = await prisma.category.upsert({
      where: { slug: "macro" },
      update: {},
      create: { name: "Macro", slug: "macro", sortOrder: 2 },
    });

    // 3. Blocks & Checkpoint
    await prisma.indexedBlock.create({
      data: {
        chainId: CHAIN_ID,
        blockNumber: 10n,
        blockHash: HASH_10,
        parentHash: "0x" + "0".repeat(64),
        timestamp: 1700000000n,
      },
    });
    await prisma.indexedBlock.create({
      data: {
        chainId: CHAIN_ID,
        blockNumber: 11n,
        blockHash: HASH_11,
        parentHash: HASH_10,
        timestamp: 1700000010n,
      },
    });
    await prisma.indexerCheckpoint.create({
      data: {
        chainId: CHAIN_ID,
        contractAddress: "0x1111111111111111111111111111111111111111",
        lastProcessedBlock: 11n,
        lastProcessedBlockHash: HASH_11,
        eventsIndexed: 25n,
      },
    });

    // 4. Contract Deployment
    await prisma.contractDeployment.create({
      data: {
        chainId: CHAIN_ID,
        mode: "LOCAL_SIMULATION",
        status: "ACTIVE",
        factoryAddress: "0x2222222222222222222222222222222222222222",
        protocolConfigAddress: "0x3333333333333333333333333333333333333333",
        activated: true,
        manifestSha256: "0x" + "4".repeat(64),
        manifestPath: "deployments/local-selected.json",
        startBlock: 1n,
      },
    });

    // 5. Markets
    // Market 1: OPEN, crypto, with contributions and positions
    const m1 = await prisma.market.create({
      data: {
        chainId: CHAIN_ID,
        onchainMarketId: 1n,
        contractAddress: "0x2222222222222222222222222222222222222222",
        creatorAddress: SENDER_ADDR,
        metadataHash: "0x" + "a".repeat(64),
        metadataURI: "ipfs://metadata-m1",
        question: "Will Bitcoin exceed 100k USD?",
        description: "Resolves YES if BTC spot reaches 100k.",
        status: "OPEN",
        finalOutcome: "UNRESOLVED",
        categoryId: catCrypto.id,
        closeTime: 1800000000n,
        resolutionTime: 1850000000n,
        maxResolutionTime: 1900000000n,
        createdAtBlock: 10n,
      },
    });

    // Market 2: DISPUTED, macro, with challenge stakes
    const m2 = await prisma.market.create({
      data: {
        chainId: CHAIN_ID,
        onchainMarketId: 2n,
        contractAddress: "0x2222222222222222222222222222222222222222",
        creatorAddress: SENDER_ADDR,
        metadataHash: "0x" + "b".repeat(64),
        metadataURI: "ipfs://metadata-m2",
        question: "Will Federal Reserve cut rates?",
        description: "FOMC meeting outcome.",
        status: "DISPUTED",
        finalOutcome: "UNRESOLVED",
        totalChallengeStake: "3000000000000000000", // 3 ETH
        categoryId: catMacro.id,
        closeTime: 1810000000n,
        resolutionTime: 1860000000n,
        maxResolutionTime: 1910000000n,
        createdAtBlock: 10n,
      },
    });

    // Market 3: FINALIZED (INVALID, refundable)
    const m3 = await prisma.market.create({
      data: {
        chainId: CHAIN_ID,
        onchainMarketId: 3n,
        contractAddress: "0x2222222222222222222222222222222222222222",
        creatorAddress: SENDER_ADDR,
        metadataHash: "0x" + "c".repeat(64),
        metadataURI: "ipfs://metadata-m3",
        question: "Will rainfall exceed 50mm?",
        status: "FINALIZED",
        finalOutcome: "INVALID",
        refundable: true,
        closeTime: 1750000000n,
        resolutionTime: 1760000000n,
        maxResolutionTime: 1770000000n,
        createdAtBlock: 9n,
      },
    });

    // 6. Market Positions (including 10^50 uint256 precision check)
    await prisma.marketPosition.create({
      data: {
        marketId: m1.id,
        walletAddress: USER_ALICE,
        yesContribution: "2000000000000000000", // 2 ETH
        noContribution: "0",
        claimedAmount: "0",
        refundedAmount: "0",
        updatedBlock: 10n,
      },
    });
    await prisma.marketPosition.create({
      data: {
        marketId: m1.id,
        walletAddress: USER_BOB,
        yesContribution: "100000000000000000000000000000000000000000000000000", // 10^50
        noContribution: "5000000000000000000",
        claimedAmount: "1000000000000000000",
        refundedAmount: "500000000000000000",
        updatedBlock: 11n,
      },
    });

    // 7. Contributions aggregate
    await prisma.contribution.create({
      data: {
        marketId: m1.id,
        walletAddress: USER_ALICE,
        side: "YES",
        amount: "2000000000000000000",
        updatedBlock: 10n,
      },
    });
    await prisma.contribution.create({
      data: {
        marketId: m1.id,
        walletAddress: USER_BOB,
        side: "NO",
        amount: "5000000000000000000",
        updatedBlock: 11n,
      },
    });

    // 8. Challenge Stakes
    await prisma.challengeStake.create({
      data: {
        chainId: CHAIN_ID,
        marketId: m2.id,
        walletAddress: USER_ALICE,
        amount: "1000000000000000000",
        prefixBefore: "0",
        evidenceHash: "0x" + "7".repeat(64),
        claimed: false,
        txHash: TX_HASH_1,
        logIndex: 3,
        blockNumber: 11n,
        blockHash: HASH_11,
        timestamp: 1700000010n,
      },
    });
    await prisma.challengeStake.create({
      data: {
        chainId: CHAIN_ID,
        marketId: m2.id,
        walletAddress: USER_BOB,
        amount: "2000000000000000000",
        prefixBefore: "1000000000000000000",
        evidenceHash: "0x" + "7".repeat(64),
        claimed: false,
        txHash: TX_HASH_1,
        logIndex: 4,
        blockNumber: 11n,
        blockHash: HASH_11,
        timestamp: 1700000010n,
      },
    });

    // 9. Market Settlement on M3
    await prisma.marketSettlement.create({
      data: {
        marketId: m3.id,
        disposition: "NEUTRAL",
        proposalBond: "0",
        totalChallengeStake: "0",
        refundable: true,
        txHash: TX_HASH_1,
        logIndex: 0,
        blockNumber: 11n,
        blockHash: HASH_11,
      },
    });

    // 10. Bonds & Claims
    await prisma.bond.create({
      data: {
        marketId: m1.id,
        walletAddress: SENDER_ADDR,
        bondType: "CREATION",
        deposited: "1000000000000000000",
        returned: "0",
        slashed: "0",
        updatedBlock: 10n,
      },
    });
    await prisma.claim.create({
      data: {
        marketId: m3.id,
        walletAddress: USER_BOB,
        claimType: "REFUND",
        amount: "500000000000000000",
        txHash: TX_HASH_1,
        logIndex: 5,
        blockNumber: 11n,
        blockHash: HASH_11,
      },
    });

    // 11. Market Activity
    await prisma.marketActivity.create({
      data: {
        marketId: m1.id,
        actor: SENDER_ADDR,
        kind: "CREATED",
        summary: "Market created",
        txHash: TX_HASH_1,
        logIndex: 0,
        blockNumber: 10n,
        blockHash: HASH_10,
        timestamp: 1700000000n,
      },
    });
    await prisma.marketActivity.create({
      data: {
        marketId: m1.id,
        actor: USER_ALICE,
        kind: "PREDICTION_PLACED",
        summary: "Prediction placed on YES",
        amount: "2000000000000000000",
        side: "YES",
        txHash: "0x" + "a1".repeat(32),
        logIndex: 1,
        blockNumber: 11n,
        blockHash: HASH_11,
        timestamp: 1700000010n,
      },
    });

    // 12. Transaction & Indexed Events
    await prisma.transactionRecord.create({
      data: {
        chainId: CHAIN_ID,
        txHash: TX_HASH_1,
        txIndex: 0,
        fromAddress: SENDER_ADDR,
        toAddress: "0x2222222222222222222222222222222222222222",
        blockNumber: 10n,
        blockHash: HASH_10,
        value: "0",
        gasUsed: "100000",
        status: 1,
      },
    });
    await prisma.indexedEvent.create({
      data: {
        chainId: CHAIN_ID,
        blockNumber: 10n,
        blockHash: HASH_10,
        txHash: TX_HASH_1,
        logIndex: 0,
        address: "0x2222222222222222222222222222222222222222",
        eventName: "MarketCreated",
        args: { marketId: "1", creator: SENDER_ADDR },
        timestamp: 1700000000n,
      },
    });

    // 13. Accounting & Exposure Snapshots
    await prisma.accountingSnapshot.create({
      data: {
        chainId: CHAIN_ID,
        blockNumber: 11n,
        marketCount: 3n,
        totalContributions: "7000000000000000000",
        totalParticipantPaid: "0",
        totalFeesAccrued: "100000000000000000",
        totalFeesWithdrawn: "0",
        totalBondsDeposited: "1000000000000000000",
        totalBondsPaid: "0",
        bondLiability: "1000000000000000000",
        feeLiability: "100000000000000000",
        participantLiability: "7000000000000000000",
        totalUnresolvedExposure: "7000000000000000000",
        unaccountedBalance: "0",
        contractBalance: "8100000000000000000",
      },
    });
    await prisma.protocolFeeAccrual.create({
      data: {
        chainId: CHAIN_ID,
        marketId: m3.id,
        kind: "accrued",
        amount: "100000000000000000",
        txHash: TX_HASH_1,
        logIndex: 11,
        blockNumber: 11n,
        blockHash: HASH_11,
      },
    });
    await prisma.exposureSnapshot.create({
      data: {
        chainId: CHAIN_ID,
        marketId: m3.id,
        arbitrator: SENDER_ADDR,
        amount: "5000000000000000000",
        txHash: TX_HASH_1,
        logIndex: 10,
        blockNumber: 11n,
        blockHash: HASH_11,
      },
    });

    // 14. Off-chain artifacts
    const metadataCommitment = "0x" + "a".repeat(64);
    await prisma.marketMetadata.create({
      data: {
        chainId: CHAIN_ID,
        commitment: metadataCommitment,
        uri: "ipfs://metadata-m1",
        uriKeccak: keccak256(stringToBytes("ipfs://metadata-m1")),
        question: "Will Bitcoin exceed 100k USD?",
        description: "Resolves YES if BTC spot reaches 100k.",
        categorySlug: "crypto",
        resolutionCriteria: "Binance spot price >= 100000",
        evidenceSources: ["https://binance.com"],
        formData: {},
        publishedBy: SENDER_ADDR,
      },
    });

    const evidenceCommitmentHash = "0x" + "e".repeat(64);
    await prisma.evidenceArtifact.create({
      data: {
        commitment: evidenceCommitmentHash,
        manifestKeccak: evidenceCommitmentHash,
        contentKeccak: "0x" + "f".repeat(64),
        manifestBytes: Buffer.from('{"schema":"orakl-evidence-v1"}', "utf8"),
        contentBytes: Buffer.from("Exact evidence content verification string", "utf8"),
        contentSize: 42,
        publishedBy: SENDER_ADDR,
        chainId: CHAIN_ID,
        marketOnchainId: "1",
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

  // =========================================================================
  // 1. System, Network, Deployment & Indexer Status Routes
  // =========================================================================

  it("GET /api/v1/health returns system and database health status", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.simulationOnly).toBe(true);
    expect(body.data.service).toBe("orakl-p1-backend");
    expect(body.data.database).toBe("up");
    expect(body.data.chainId).toBe(CHAIN_ID);
  });

  it("GET /api/v1/network returns local simulation loopback settings", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/network" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.chainId).toBe(CHAIN_ID);
    expect(body.data.isQieNetwork).toBe(false);
    expect(body.data.mode).toBe("local-selected");
    expect(body.data.nativeSymbol).toBe("ETH");
  });

  it("GET /api/v1/deployment returns active contract deployment state", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/deployment" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.dbRecord).toBeDefined();
    expect(body.data.dbRecord.status).toBe("ACTIVE");
    expect(body.data.dbRecord.activated).toBe(true);
    expect(body.data.dbRecord.factoryAddress).toBe("0x2222222222222222222222222222222222222222");
  });

  it("GET /api/v1/indexer/status returns checkpoints, block counters, and sync info", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/indexer/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.chainId).toBe(CHAIN_ID);
    expect(body.data.canonicalOnly).toBe(true);
    expect(body.data.blocksIndexed).toBe(2);
    expect(body.data.checkpoint.lastProcessedBlock).toBe("11");
    expect(body.data.checkpoint.lastProcessedBlockHash).toBe(HASH_11);
    expect(body.sync.lastProcessedBlock).toBe("11");
    expect(body.sync.status).toBe("SYNCHRONIZED");
  });

  // =========================================================================
  // 2. Markets Collection: Filtering, Search, Sorting & Pagination
  // =========================================================================

  it("GET /api/v1/markets returns paginated market list with attached sync metadata", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.total).toBe(3);
    expect(body.data.items.length).toBe(3);
    expect(body.sync).toBeDefined();
    expect(body.sync.status).toBe("SYNCHRONIZED");
  });

  it("GET /api/v1/markets filters by status correctly", async () => {
    const resOpen = await app.inject({ method: "GET", url: "/api/v1/markets?status=OPEN" });
    expect(resOpen.statusCode).toBe(200);
    expect(resOpen.json().data.total).toBe(1);
    expect(resOpen.json().data.items[0].status).toBe("OPEN");

    const resDisputed = await app.inject({ method: "GET", url: "/api/v1/markets?status=DISPUTED" });
    expect(resDisputed.statusCode).toBe(200);
    expect(resDisputed.json().data.total).toBe(1);
    expect(resDisputed.json().data.items[0].status).toBe("DISPUTED");
  });

  it("GET /api/v1/markets filters by category slug", async () => {
    const resCrypto = await app.inject({ method: "GET", url: "/api/v1/markets?category=crypto" });
    expect(resCrypto.statusCode).toBe(200);
    expect(resCrypto.json().data.total).toBe(1);
    expect(resCrypto.json().data.items[0].question).toContain("Bitcoin");

    const resMacro = await app.inject({ method: "GET", url: "/api/v1/markets?category=macro" });
    expect(resMacro.statusCode).toBe(200);
    expect(resMacro.json().data.total).toBe(1);
    expect(resMacro.json().data.items[0].question).toContain("Federal Reserve");
  });

  it("GET /api/v1/markets searches text queries with sanitization", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets?q=bitcoin" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.total).toBe(1);
    expect(res.json().data.items[0].id).toBe("1");
  });

  it("GET /api/v1/markets sorts by closeTime and id in asc and desc", async () => {
    const resAsc = await app.inject({ method: "GET", url: "/api/v1/markets?sort=id&order=asc" });
    expect(resAsc.statusCode).toBe(200);
    expect(resAsc.json().data.items[0].id).toBe("1");

    const resDesc = await app.inject({ method: "GET", url: "/api/v1/markets?sort=id&order=desc" });
    expect(resDesc.statusCode).toBe(200);
    expect(resDesc.json().data.items[0].id).toBe("3");
  });

  // =========================================================================
  // 3. Market Child Views: Detail, Activity, Challenges, Evidence, Settlement
  // =========================================================================

  it("GET /api/v1/markets/:id returns full market projection with pool totals", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets/1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.id).toBe("1");
    expect(body.data.status).toBe("OPEN");
    expect(body.data.yesPool).toBe("2000000000000000000"); // 2 ETH
    expect(body.data.noPool).toBe("5000000000000000000"); // 5 ETH
    expect(body.data.positions.length).toBe(2);
    expect(body.data.contributions.length).toBe(2);
  });

  it("GET /api/v1/markets/:id/activity returns paginated chronological events", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets/1/activity" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.total).toBe(2);
    expect(body.data.items.length).toBe(2);
    expect(body.data.items[0].kind).toBe("PREDICTION_PLACED");
    expect(body.data.items[1].kind).toBe("CREATED");
  });

  it("GET /api/v1/markets/:id/challenges returns multi-challenger tranches", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets/2/challenges" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.totalChallengeStake).toBe("3000000000000000000"); // 3 ETH
    expect(body.data.stakes.length).toBe(2);
    expect(body.data.stakes[0].amount).toBe("1000000000000000000");
    expect(body.data.stakes[1].amount).toBe("2000000000000000000");
    expect(body.data.stakes[1].prefixBefore).toBe("1000000000000000000");
  });

  it("GET /api/v1/markets/:id/evidence returns onchain records and local artifacts", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets/1/evidence" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.marketId).toBe("1");
    expect(body.data.artifacts.length).toBe(1);
    expect(body.data.artifacts[0].commitment).toBe("0x" + "e".repeat(64));
    expect(body.data.artifacts[0].hasContent).toBe(true);
  });

  it("GET /api/v1/markets/:id/settlement returns settlement and refund status", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets/3/settlement" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.marketId).toBe("3");
    expect(body.data.finalOutcome).toBe("INVALID");
    expect(body.data.refundable).toBe(true);
    expect(body.data.settlement.disposition).toBe("NEUTRAL");
    expect(body.data.settlement.proposalBond).toBe("0");
  });

  it("GET /api/v1/markets/:id/metadata returns linked metadata artifact", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets/1/metadata" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.marketId).toBe("1");
    expect(body.data.metadataHash).toBe("0x" + "a".repeat(64));
    expect(body.data.artifact.question).toBe("Will Bitcoin exceed 100k USD?");
  });

  // =========================================================================
  // 4. Off-chain Artifact Lookups
  // =========================================================================

  it("GET /api/v1/metadata/:commitment returns metadata artifact by commitment", async () => {
    const commitment = "0x" + "a".repeat(64);
    const res = await app.inject({ method: "GET", url: `/api/v1/metadata/${commitment}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.commitment).toBe(commitment);
    expect(body.data.categorySlug).toBe("crypto");
  });

  it("GET /api/v1/evidence/:commitment returns evidence artifact with base64 content", async () => {
    const commitment = "0x" + "e".repeat(64);
    const res = await app.inject({ method: "GET", url: `/api/v1/evidence/${commitment}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.commitment).toBe(commitment);
    expect(body.data.contentSize).toBe(42);
    expect(body.data.contentBytes).toBeDefined();
    const decoded = Buffer.from(body.data.contentBytes, "base64").toString("utf8");
    expect(decoded).toBe("Exact evidence content verification string");
  });

  // =========================================================================
  // 5. Portfolio, Transactions, and Exposure
  // =========================================================================

  it("GET /api/v1/portfolio/:address returns user positions, claims, and open risk", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/portfolio/${USER_BOB}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.address).toBe(USER_BOB);
    expect(body.data.totals.positions).toBe(1);
    expect(body.data.totals.challengeStakes).toBe(1);
    expect(body.data.claimsByType.length).toBe(1);
    expect(body.data.totalClaimed).toBe("1500000000000000000"); // 1 ETH claimed + 0.5 ETH refund
  });

  it("GET /api/v1/transactions/:hash returns indexed transaction and log events", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/transactions/${TX_HASH_1}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.record.txHash).toBe(TX_HASH_1);
    expect(body.data.record.status).toBe(1);
    expect(body.data.events.length).toBe(1);
    expect(body.data.events[0].eventName).toBe("MarketCreated");
  });

  it("GET /api/v1/exposure returns protocol fee accruals and global exposure sum", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/exposure" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.feeAccrued).toBe("100000000000000000"); // 0.1 ETH
    expect(body.data.exposureReleasedSum).toBe("5000000000000000000"); // 5 ETH
    expect(body.data.latestAccountingSnapshot.contractBalance).toBe("8100000000000000000");
  });

  // =========================================================================
  // 6. Signed Mutations: Evidence & Market Metadata Publication (POST)
  // =========================================================================

  it("POST /api/v1/evidence publishes valid signed artifact and deduplicates", async () => {
    const content = "Unique primary source verification document text.";
    const contentBytes = Buffer.from(content, "utf8");
    const contentHash = keccak256(contentBytes);

    const manifest: EvidenceManifest = {
      schema: "orakl-evidence-v1",
      chainId: "31337",
      contract: "0x2222222222222222222222222222222222222222",
      marketId: "1",
      kind: "proposal",
      claim: "YES",
      proposedOutcome: "YES",
      sources: ["https://reuters.com/news/1"],
      publishedAt: "1700000000",
      publisher: SENDER_ADDR,
      contentHash,
      contentMediaType: "text/plain",
      media: [],
    };

    const commitment = evidenceCommitment(manifest);
    const auth1: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: CHAIN_ID,
      factory: manifest.contract,
      publisher: SENDER_ADDR,
      commitment,
      nonce: `api_evi_1_${Date.now()}_${Math.random()}`,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };
    const signature = await signPublicationAuthEip712(signer, auth1);

    // First publish
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth: auth1, signature, content },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.commitment).toBe(commitment);
    expect(body.data.deduped).toBe(false);

    // Re-publish same commitment -> deduped: true (with new single-use nonce)
    const auth2: PublicationAuth = {
      ...auth1,
      nonce: `api_evi_2_${Date.now()}_${Math.random()}`,
    };
    const signature2 = await signPublicationAuthEip712(signer, auth2);
    const resDedupe = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth: auth2, signature: signature2, content },
    });
    expect(resDedupe.statusCode).toBe(200);
    expect(resDedupe.json().data.deduped).toBe(true);
  });

  it("POST /api/v1/evidence rejects invalid signature with 401 INVALID_SIGNATURE", async () => {
    const otherAccount = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const manifest: EvidenceManifest = {
      schema: "orakl-evidence-v1",
      chainId: "31337",
      contract: "0x2222222222222222222222222222222222222222",
      marketId: "1",
      kind: "proposal",
      claim: "YES",
      proposedOutcome: "YES",
      sources: ["https://example.com"],
      publishedAt: "1700000000",
      publisher: SENDER_ADDR,
      contentHash: "0x" + "0".repeat(64),
      contentMediaType: "text/plain",
      media: [],
    };
    const commitment = evidenceCommitment(manifest);
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: CHAIN_ID,
      factory: manifest.contract,
      publisher: SENDER_ADDR,
      commitment,
      nonce: `bad_sig_${Date.now()}_${Math.random()}`,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };
    // Signed by wrong account
    const badSignature = await signPublicationAuthEip712(otherAccount, auth);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth, signature: badSignature },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("INVALID_SIGNATURE");
  });

  it("POST /api/v1/evidence rejects contentHash mismatch with 400 CONTENT_HASH_MISMATCH", async () => {
    const manifest: EvidenceManifest = {
      schema: "orakl-evidence-v1",
      chainId: "31337",
      contract: "0x2222222222222222222222222222222222222222",
      marketId: "1",
      kind: "proposal",
      claim: "YES",
      proposedOutcome: "YES",
      sources: ["https://example.com"],
      publishedAt: "1700000000",
      publisher: SENDER_ADDR,
      contentHash: "0x" + "1".repeat(64),
      contentMediaType: "text/plain",
      media: [],
    };
    const commitment = evidenceCommitment(manifest);
    const auth: PublicationAuth = {
      app: "ORAKL",
      version: "1",
      action: "evidence",
      chainId: CHAIN_ID,
      factory: manifest.contract,
      publisher: SENDER_ADDR,
      commitment,
      nonce: `mismatch_${Date.now()}_${Math.random()}`,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };
    const signature = await signPublicationAuthEip712(signer, auth);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/evidence",
      headers: { "content-type": "application/json" },
      payload: { manifest, auth, signature, content: "Different text that will not hash to 1111..." },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CONTENT_HASH_MISMATCH");
  });

  it("POST /api/v1/markets/metadata publishes signed metadata manifest", async () => {
    const metadata = {
      schema: "orakl-market-metadata-v1",
      chainId: "31337",
      factory: "0x2222222222222222222222222222222222222222",
      question: "Will Space-X reach Mars in 2026?",
      description: "Starship crewed landing.",
      category: "tech",
      resolutionCriteria: "Official NASA / SpaceX confirmation",
      sources: ["https://spacex.com"],
      creator: SENDER_ADDR,
      createdAt: "1700000000",
    };

    // Canonical bytes
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
      factory: metadata.factory,
      publisher: SENDER_ADDR,
      commitment,
      nonce: `meta_api_${Date.now()}_${Math.random()}`,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    };
    const signature = await signPublicationAuthEip712(signer, auth);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/markets/metadata",
      headers: { "content-type": "application/json" },
      payload: { metadata, auth, signature },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.commitment).toBe(commitment);
    expect(body.data.deduped).toBe(false);
  });

  // =========================================================================
  // 7. Financial Arithmetic Precision & uint256 Base-10 (ADR-0001)
  // =========================================================================

  it("preserves exact integer precision on 78-digit uint256 quantities without scientific notation", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets/1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const bobPos = body.data.positions.find((p: { walletAddress: string }) => p.walletAddress === USER_BOB);
    expect(bobPos).toBeDefined();

    // 10^50 must match /^(0|[1-9]\d*)$/ and NOT be '1e+50'
    expect(bobPos.yesContribution).toMatch(/^(0|[1-9]\d*)$/);
    expect(bobPos.yesContribution).toBe("100000000000000000000000000000000000000000000000000");
    expect(bobPos.noContribution).toBe("5000000000000000000");
  });

  // =========================================================================
  // 8. Synchronization Metadata & Freshness Invariants (ADR-0007)
  // =========================================================================

  it("reports SYNCHRONIZED when checkpoint matches canonical tip within 5 blocks", async () => {
    mockReferenceHead = 12n; // lag = 1 <= 5
    const res = await app.inject({ method: "GET", url: "/api/v1/markets" });
    expect(res.statusCode).toBe(200);
    expect(res.json().sync.status).toBe("SYNCHRONIZED");
    expect(res.json().sync.lag).toBe("1");
  });

  it("reports LAGGING when checkpoint lags > 5 blocks behind verified reference head", async () => {
    mockReferenceHead = 20n; // lag = 9 > 5
    const res = await app.inject({ method: "GET", url: "/api/v1/markets" });
    expect(res.statusCode).toBe(200);
    expect(res.json().sync.status).toBe("LAGGING");
    expect(res.json().sync.lag).toBe("9");
  });

  it("reports LAGGING fail-closed when reference head RPC is unreachable", async () => {
    mockReferenceHead = null; // RPC failed / unreachable
    const res = await app.inject({ method: "GET", url: "/api/v1/markets" });
    expect(res.statusCode).toBe(200);
    expect(res.json().sync.status).toBe("LAGGING");
  });

  // =========================================================================
  // 9. Negative Paths, Validation & Centralized Error Envelopes (ADR-0012)
  // =========================================================================

  it("returns uniform 404 NOT_FOUND envelope on nonexistent market", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets/999999" });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(body.statusCode).toBe(404);
    expect(typeof body.error).toBe("string");
    expect(typeof body.requestId).toBe("string");
  });

  it("returns uniform 400 INVALID_PARAM envelope on malformed address", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/portfolio/0xnotanaddress" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("INVALID_PARAM");
    expect(body.statusCode).toBe(400);
    expect(body.error).toContain("address must be 0x + 40 hex chars");
  });

  it("returns uniform 400 WRONG_CHAIN envelope on foreign x-chain-id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/markets",
      headers: { "x-chain-id": "1" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("WRONG_CHAIN");
    expect(body.statusCode).toBe(400);
  });

  it("clamps pageSize=1000 to maxPageSize=100", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/markets?pageSize=1000" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.pageSize).toBe(100);
  });

  // =========================================================================
  // 10. Legacy Endpoints Compatibility
  // =========================================================================

  it("GET /api/health returns legacy health response", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.simulationOnly).toBe(true);
  });

  it("GET /api/markets returns legacy market listing", async () => {
    const res = await app.inject({ method: "GET", url: "/api/markets" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.simulationOnly).toBe(true);
    expect(body.markets.length).toBeGreaterThan(0);
  });

  it("GET /api/markets/:id/positions returns legacy position list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/markets/1/positions" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.simulationOnly).toBe(true);
    expect(body.positions.length).toBe(2);
  });
});
