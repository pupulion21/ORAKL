// ORAKL P1 — indexer + PostgreSQL integration suite (REAL flow).
// Dedicated Anvil 31337 + the real deploy pipeline + real PostgreSQL, events
// folded through the production indexer. Money rails are asserted with exact
// BigInt integers, everything is locally signed, no keys are committed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { keccak256, toHex } from "viem";

import { makePrisma, type PrismaDb } from "../src/db.js";
import {
  FACTORY_ABI,
  LOCAL_PARAMETERS,
  LOCAL_ROLES,
  advance,
  decodedEvents,
  deploySelected,
  encode,
  liveTimestamp,
  makeClient,
  mockExecute,
  readCall,
  sendOk,
  sendRevert,
  startAnvil,
  stopAnvil,
  wipeChain,
  type AnvilEnv,
  type Client,
} from "./harness.js";
import {
  ingestOnce,
  verifyChainIdentity,
  type IndexerDeps,
  type IngestResult,
} from "../src/indexer/run.js";
import { readDeploymentManifest } from "../src/indexer/manifest.js";

const CHAIN_ID = 31337;
const CP = BigInt(LOCAL_PARAMETERS.challengePeriod); // 48h in seconds
const AP = BigInt(LOCAL_PARAMETERS.arbitrationPeriod); // 96h in seconds
const CP_S = LOCAL_PARAMETERS.challengePeriod;
const AP_S = LOCAL_PARAMETERS.arbitrationPeriod;
const ETH = 10n ** 18n;

const ev = (label: string) => keccak256(toHex(`orakl-p1-it:${label}`));

let workDir = "";
let anvil: AnvilEnv = null as never;
let pc: Client = null as never;
let prisma: PrismaDb = null as never;
let manifest: import("../src/indexer/manifest.js").DeploymentManifest = null as never;
let deps: IndexerDeps = null as never;

const factory = () => manifest.contracts.selectedMarketFactory.address as `0x${string}`;
const config = () => manifest.contracts.protocolConfig.address as `0x${string}`;

async function ingest(): Promise<IngestResult> {
  return ingestOnce(deps);
}

async function marketRow(onchainMarketId: bigint) {
  return prisma.market.findUnique({ where: { onchainMarketId } });
}

type Named = { name: string; args: Record<string, unknown> };

type CreatedMarket = { id: bigint; uri: string; metaHash: `0x${string}` };

async function createMarket(label: string, creator: string): Promise<CreatedMarket & { events: Named[] }> {
  const now = await liveTimestamp(pc);
  const close = now + 300n;
  const res = now + 600n;
  const maxRes = res + CP + AP + CP; // validated floor: res + CP + AP (+48h)
  const metaHash = ev(`metadata:${label}`);
  const uri = `ipfs://local-artifact/${metaHash.slice(2)}`; // local fake-ipfs scheme
  const receipt = await sendOk(pc, {
    from: creator,
    to: factory(),
    data: encode(FACTORY_ABI, "createMarket", [metaHash, uri, close, res, maxRes]),
    value: LOCAL_PARAMETERS.creationBond,
  });
  console.log("createMarket mined at block:", receipt.blockNumber);
  const id = BigInt(await readCall<bigint>(pc, factory(), FACTORY_ABI as never, "marketCount", [])) - 1n;
  return { id, uri, metaHash, events: decodedEvents(receipt) };
}

async function predict(from: string, id: bigint, side: 0 | 1, value: bigint): Promise<Named[]> {
  const receipt = await sendOk(pc, {
    from,
    to: factory(),
    data: encode(FACTORY_ABI, "predict", [id, side]),
    value,
  });
  console.log("predict mined at block:", receipt.blockNumber);
  return decodedEvents(receipt);
}

async function propose(from: string, id: bigint, outcome: 1 | 2 | 3, evidence: `0x${string}`): Promise<Named[]> {
  const receipt = await sendOk(pc, {
    from,
    to: factory(),
    data: encode(FACTORY_ABI, "proposeResult", [id, outcome, evidence]),
    value: LOCAL_PARAMETERS.proposalBond,
  });
  return decodedEvents(receipt);
}

async function challenge(
  from: string,
  id: bigint,
  evidence: `0x${string}`,
  expected: "ok" | "revert" = "ok",
): Promise<Named[] | null> {
  if (expected === "revert") {
    await sendRevert(pc, {
      from,
      to: factory(),
      data: encode(FACTORY_ABI, "challengeResult", [id, evidence]),
      value: LOCAL_PARAMETERS.challengeBond,
    });
    return null;
  }
  const receipt = await sendOk(pc, {
    from,
    to: factory(),
    data: encode(FACTORY_ABI, "challengeResult", [id, evidence]),
    value: LOCAL_PARAMETERS.challengeBond,
  });
  return decodedEvents(receipt);
}

async function submitEvidence(from: string, id: bigint, evidence: `0x${string}`): Promise<void> {
  await sendOk(pc, {
    from,
    to: factory(),
    data: encode(FACTORY_ABI, "submitEvidence", [id, evidence]),
  });
}

async function settleDisputeAsArbitrator(id: bigint, decision: 1 | 2 | 3, evidence: `0x${string}`): Promise<void> {
  await mockExecute(pc, {
    mock: manifest.roleMocks?.arbitrator?.address as string,
    owners: [...LOCAL_ROLES.arbitratorOwners],
    to: factory(),
    data: encode(FACTORY_ABI, "settleDispute", [id, decision, evidence]),
    observed: async () =>
      (await readCall<boolean>(pc, factory(), FACTORY_ABI as never, "exposureReleased", [id])).toString(),
  });
}

async function claim(from: string, id: bigint): Promise<Named[]> {
  const receipt = await sendOk(pc, { from, to: factory(), data: encode(FACTORY_ABI, "claim", [id]) });
  return decodedEvents(receipt);
}

async function claimRefund(from: string, id: bigint): Promise<Named[]> {
  const receipt = await sendOk(pc, { from, to: factory(), data: encode(FACTORY_ABI, "claimRefund", [id]) });
  return decodedEvents(receipt);
}

async function claimBond(from: string, id: bigint, kind: 0 | 1 | 2): Promise<Named[]> {
  const receipt = await sendOk(pc, {
    from,
    to: factory(),
    data: encode(FACTORY_ABI, "claimBond", [id, kind, from]),
  });
  return decodedEvents(receipt);
}

async function entitlement(id: bigint, kind: 0 | 1 | 2, owner: string): Promise<bigint> {
  return readCall<bigint>(pc, factory(), FACTORY_ABI as never, "getBondEntitlement", [id, kind, owner]);
}

async function countsOf() {
  const [events, predictions, claims, bonds, disputes, stakes, settlements, activity, markets, resolutions] =
    await Promise.all([
      prisma.indexedEvent.count(),
      prisma.prediction.count(),
      prisma.claim.count(),
      prisma.bond.count(),
      prisma.dispute.count(),
      prisma.challengeStake.count(),
      prisma.marketSettlement.count(),
      prisma.marketActivity.count(),
      prisma.market.count(),
      prisma.resolution.count(),
    ]);
  return { events, predictions, claims, bonds, disputes, stakes, settlements, activity, markets, resolutions };
}

beforeAll(async () => {
  workDir = mkdtempSync("/tmp/opencode/orakl-p1-it-");
  anvil = await startAnvil(workDir);
  pc = makeClient(anvil.rpcUrl);
  manifest = await deploySelected(anvil.rpcUrl, path.join(workDir, "manifest.json"));
  expect(manifest.network.chainId).toBe(CHAIN_ID);
  expect(manifest.state?.financialActive).toBe(true);

  prisma = makePrisma();
  await wipeChain(prisma);
  await verifyChainIdentity(pc, manifest, CHAIN_ID);
  deps = {
    prisma,
    publicClient: pc,
    chainId: CHAIN_ID,
    factory: factory(),
    configContract: config(),
    startBlock: BigInt(
      Math.min(
        Number(manifest.contracts.selectedMarketFactory.startBlock),
        Number(manifest.contracts.protocolConfig.startBlock),
      ),
    ),
    batchSize: 200,
    confirmations: 0,
  };
});

afterAll(async () => {
  if (prisma) {
    await wipeChain(prisma);
    await prisma.$disconnect();
  }
  if (anvil) await stopAnvil(anvil);
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe("ORAKL P1 indexer — REAL chain ingest", () => {
  it("seeds a checkpoint over the live deployment chain", async () => {
    const head = await pc.getBlockNumber();
    const r = await ingest();
    expect(r.blocks).toBeGreaterThan(0);
    expect(r.events).toBeGreaterThan(0); // config/role events from the deploy txs
    expect(r.rollbacks).toBe(0);
    const cp = await prisma.indexerCheckpoint.findUnique({ where: { chainId: CHAIN_ID } });
    expect(cp?.lastProcessedBlock).toBe(head);
    expect(cp?.lastProcessedBlockHash?.length).toBe(66);
    expect(cp?.contractAddress.toLowerCase()).toBe(factory().toLowerCase());
  });

  it("folds market creation + two predictions with exact BigInt rows", async () => {
    const m = await createMarket("basic", LOCAL_ROLES.creator);
    expect(m.id).toBe(0n);
    const mk = m.events.find((x) => x.name === "MarketCreated");
    const created = m.events.find((x) => x.name === "BondDeposited");
    expect(mk?.args.marketId).toBe(0n);
    expect(created?.args.amount).toBe(1n * ETH);

    await predict(LOCAL_ROLES.yesParticipant, 0n, 0, 5n * ETH);
    await predict(LOCAL_ROLES.noParticipant, 0n, 1, 3n * ETH);

    const r = await ingest();
    expect(r.events).toBe(4); // BondDeposited + MarketCreated + 2 PredictionPlaced

    const row = await marketRow(0n);
    expect(row).not.toBeNull();
    expect(row!.chainId).toBe(CHAIN_ID);
    expect(row!.creatorAddress).toBe(LOCAL_ROLES.creator.toLowerCase());
    expect(row!.metadataHash).toBe(m.metaHash);
    expect(row!.metadataURI).toBe(m.uri);
    expect(row!.status).toBe("OPEN");
    expect(row!.totalChallengeStake).toBe(0n);

    const preds = await prisma.prediction.findMany({ orderBy: [{ blockNumber: "asc" }] });
    expect(preds).toHaveLength(2);
    expect(preds.map((p) => `${p.walletAddress}:${p.side}:${p.amount.toString()}`).sort()).toEqual(
      [
        `${LOCAL_ROLES.noParticipant.toLowerCase()}:NO:3000000000000000000`,
        `${LOCAL_ROLES.yesParticipant.toLowerCase()}:YES:5000000000000000000`,
      ].sort(),
    );

    const contribs = await prisma.contribution.findMany();
    expect(contribs).toHaveLength(2);
    const yes = contribs.find((c) => c.walletAddress === LOCAL_ROLES.yesParticipant.toLowerCase());
    const no = contribs.find((c) => c.walletAddress === LOCAL_ROLES.noParticipant.toLowerCase());
    expect(yes?.amount).toBe(5n * ETH);
    expect(no?.amount).toBe(3n * ETH);

    const yesPosition = await prisma.marketPosition.findUnique({
      where: { marketId_walletAddress: { marketId: row!.id, walletAddress: LOCAL_ROLES.yesParticipant.toLowerCase() } },
    });
    expect(yesPosition?.yesContribution).toBe(5n * ETH);
    expect(yesPosition?.noContribution).toBe(0n);

    // CREATION bond deposit arrives BEFORE MarketCreated in the same tx — the
    // canonical two-pass fold must still produce a complete ledger row.
    const creationBond = await prisma.bond.findFirst({
      where: { bondType: "CREATION", walletAddress: LOCAL_ROLES.creator.toLowerCase() },
    });
    expect(creationBond?.deposited).toBe(1n * ETH);
    expect(creationBond?.returned).toBe(0n);
  });

  it("is idempotent on immediate re-ingestion", async () => {
    const before = await countsOf();
    const cpBefore = await prisma.indexerCheckpoint.findUnique({ where: { chainId: CHAIN_ID } });
    const r = await ingest();
    expect(r.blocks).toBe(0);
    expect(r.events).toBe(0);
    expect(await countsOf()).toEqual(before);
    const cpAfter = await prisma.indexerCheckpoint.findUnique({ where: { chainId: CHAIN_ID } });
    expect(cpAfter).toEqual(cpBefore);
  });

  it("recovers idempotent from a totally fresh process (checkpoint restart)", async () => {
    const before = await countsOf();
    const prisma2 = makePrisma();
    const deps2: IndexerDeps = { ...deps, prisma: prisma2 };
    const r = await ingestOnce(deps2);
    expect(r.events).toBe(0);
    expect(r.blocks).toBe(0);
    expect(await countsOf()).toEqual(before);
    await prisma2.$disconnect();
  });

  it("folds the proposal with the exact challenge deadline from the event", async () => {
    await advance(pc, 700); // now > resolutionTime (600)
    const evidence = ev("proposal-basic-YES");
    const events = await propose(LOCAL_ROLES.proposer, 0n, 1, evidence);
    await ingest();

    const proposal = events.find((x) => x.name === "MarketOutcomeProposed");
    expect(proposal).toBeTruthy();
    const row = await marketRow(0n);
    expect(row!.status).toBe("PROPOSED");
    expect(row!.proposerAddress).toBe(LOCAL_ROLES.proposer.toLowerCase());
    expect(row!.proposalEvidenceHash).toBe(evidence);
    expect(row!.challengeDeadline).toBe(proposal!.args.challengeDeadline as bigint);
    expect((proposal!.args.outcome as number)).toBe(1); // YES

    const resolution = await prisma.resolution.findUnique({ where: { marketId: row!.id } });
    expect(resolution?.status).toBe("PROPOSED");
    expect(resolution?.proposedOutcome).toBe("YES");
    expect(resolution?.challengeDeadline).toBe(proposal!.args.challengeDeadline as bigint);

    const proposalBond = await prisma.bond.findFirst({
      where: { bondType: "PROPOSAL", walletAddress: LOCAL_ROLES.proposer.toLowerCase() },
    });
    expect(proposalBond?.deposited).toBe(10n * ETH);
  });

  it("rejects proposals for non-existent markets without storing anything", async () => {
    const before = await countsOf();
    await sendRevert(pc, {
      from: LOCAL_ROLES.proposer,
      to: factory(),
      data: encode(FACTORY_ABI, "proposeResult", [999n, 1, ev("ghost")]),
      value: LOCAL_PARAMETERS.proposalBond,
    });
    expect(await countsOf()).toEqual(before);
  });

  it("admits multi-challenger tranches with exact prefix/total and rejects duplicate stakes", async () => {
    const a = await challenge(LOCAL_ROLES.challengerA, 0n, ev("challenge-A"));
    expect(a!.find((x) => x.name === "ChallengeStakeAccepted")?.args.totalStake).toBe(1n * ETH);
    await challenge(LOCAL_ROLES.challengerA, 0n, ev("challenge-A-dup"), "revert");
    const b = await challenge(LOCAL_ROLES.challengerB, 0n, ev("challenge-B"));
    expect(b!.find((x) => x.name === "ChallengeStakeAccepted")?.args.prefixBefore).toBe(1n * ETH);
    await ingest();

    const row = await marketRow(0n);
    expect(row!.status).toBe("DISPUTED");
    expect(row!.totalChallengeStake).toBe(2n * ETH);

    const stakes = await prisma.challengeStake.findMany({ orderBy: [{ blockNumber: "asc" }] });
    expect(stakes).toHaveLength(2);
    const sA = stakes.find((s) => s.walletAddress === LOCAL_ROLES.challengerA.toLowerCase());
    const sB = stakes.find((s) => s.walletAddress === LOCAL_ROLES.challengerB.toLowerCase());
    expect(sA?.amount).toBe(1n * ETH);
    expect(sA?.prefixBefore).toBe(0n);
    expect(sA?.evidenceHash).toBe(ev("challenge-A"));
    expect(sB?.amount).toBe(1n * ETH);
    expect(sB?.prefixBefore).toBe(1n * ETH);
    expect(sB?.evidenceHash).toBe(ev("challenge-B"));

    // one dispute row; later tranches are stake-only and never mint duplicates
    const disputes = await prisma.dispute.findMany();
    expect(disputes).toHaveLength(1);
    expect(disputes[0]!.status).toBe("OPEN");
    expect(disputes[0]!.challengerAddress).toBe(LOCAL_ROLES.challengerA.toLowerCase());
  });

  it("stores independent evidence as UNVERIFIED/UNKNOWN and dedupes commitments", async () => {
    const c1 = ev("evidence-1");
    await submitEvidence(LOCAL_ROLES.guardian, 0n, c1);
    await submitEvidence(LOCAL_ROLES.guardian, 0n, c1); // duplicate commitment
    const c2 = ev("evidence-2");
    await submitEvidence(LOCAL_ROLES.challengerA, 0n, c2);
    await ingest();

    const records = await prisma.evidenceRecord.findMany();
    expect(records).toHaveLength(2);
    expect(records.filter((r) => r.evidenceHash === c1)).toHaveLength(1);
    const verifications = await prisma.evidenceVerification.findMany();
    expect(verifications).toHaveLength(2);
    for (const v of verifications) {
      expect(v.verificationStatus).toBe("UNVERIFIED");
      expect(v.availabilityStatus).toBe("UNKNOWN");
    }
    const dupActivities = await prisma.marketActivity.findMany({ where: { kind: "evidence_duplicate" } });
    expect(dupActivities).toHaveLength(1);
  });

  it("INVALID settlement → NEUTRAL disposition, full refunds, no fee", async () => {
    const m = await createMarket("invalid", LOCAL_ROLES.creator);
    expect(m.id).toBe(1n);
    await predict(LOCAL_ROLES.yesParticipant, 1n, 0, 2n * ETH);
    await predict(LOCAL_ROLES.noParticipant, 1n, 1, 5n * ETH);
    await ingest();
    await advance(pc, 700);
    await propose(LOCAL_ROLES.proposer, 1n, 2, ev("proposal-1-NO"));
    await ingest();
    await challenge(LOCAL_ROLES.challengerA, 1n, ev("challenge-1-A"));
    await ingest();

    await advance(pc, CP_S + 300); // inside [challengeDeadline, arbitrationDeadline)
    await settleDisputeAsArbitrator(1n, 3, ev("decision-1-INVALID"));
    const r = await ingest();
    expect(r.events).toBeGreaterThanOrEqual(4); // DisputeSettled, MarketCancelled, ExposureReleased, SelectedSettlement

    const row = await marketRow(1n);
    expect(row!.status).toBe("CANCELLED");
    expect(row!.finalOutcome).toBe("INVALID");
    expect(row!.refundable).toBe(true);
    expect(row!.decisionEvidenceHash).toBe(ev("decision-1-INVALID"));

    const settlement = await prisma.marketSettlement.findUnique({ where: { marketId: row!.id } });
    expect(settlement?.disposition).toBe("NEUTRAL");
    expect(settlement?.totalChallengeStake).toBe(1n * ETH);
    expect(settlement?.proposalBond).toBe(10n * ETH);

    const exposures = await prisma.exposureSnapshot.findMany({ where: { market: { onchainMarketId: 1n } } });
    expect(exposures).toHaveLength(1);
    expect(exposures[0]!.amount).toBe(7n * ETH);

    const fees = await prisma.protocolFeeAccrual.findMany({ where: { kind: "accrued" } });
    expect(fees).toHaveLength(0);

    // pre-claim entitlements are exact integers
    expect(await entitlement(1n, 2, LOCAL_ROLES.challengerA)).toBe(1n * ETH);
    expect(await entitlement(1n, 1, LOCAL_ROLES.proposer)).toBe(10n * ETH);
    expect(await entitlement(1n, 0, LOCAL_ROLES.creator)).toBe(1n * ETH);

    await claimRefund(LOCAL_ROLES.yesParticipant, 1n);
    await claimRefund(LOCAL_ROLES.noParticipant, 1n);
    await claimBond(LOCAL_ROLES.challengerA, 1n, 2);
    await claimBond(LOCAL_ROLES.proposer, 1n, 1);
    await claimBond(LOCAL_ROLES.creator, 1n, 0);
    const r2 = await ingest();
    expect(r2.events).toBe(5); // 2 RefundClaimed + 3 BondReleased

    const claimRows = await prisma.claim.findMany({ include: { market: true } });
    const refunds1 = claimRows.filter((c) => c.market.onchainMarketId === 1n && c.claimType === "REFUND");
    expect(refunds1.map((c) => `${c.walletAddress}\u0000${c.amount.toString()}`).sort()).toEqual(
      [
        `${LOCAL_ROLES.yesParticipant.toLowerCase()}\u0000${(2n * ETH).toString()}`,
        `${LOCAL_ROLES.noParticipant.toLowerCase()}\u0000${(5n * ETH).toString()}`,
      ].sort(),
    );

    const bonds = await prisma.bond.findMany({ include: { market: true } });
    for (const b of bonds.filter((b) => b.market.onchainMarketId === 1n)) {
      expect(BigInt(b.deposited.toString()) > 0n).toBe(true);
      expect(BigInt(b.returned.toString())).toBe(BigInt(b.deposited.toString())); // NEUTRAL: everyone made whole
    }
  });

  it("NO reversal → CHALLENGERS disposition, 2% fee, exact payout math", async () => {
    const m = await createMarket("reversal", LOCAL_ROLES.creator);
    expect(m.id).toBe(2n);
    await predict(LOCAL_ROLES.yesParticipant, 2n, 0, 5n * ETH);
    await predict(LOCAL_ROLES.noParticipant, 2n, 1, 3n * ETH);
    await ingest();
    await advance(pc, 700);
    await propose(LOCAL_ROLES.proposer, 2n, 1, ev("proposal-2-YES"));
    await ingest();
    await challenge(LOCAL_ROLES.challengerA, 2n, ev("challenge-2-A"));
    await challenge(LOCAL_ROLES.challengerB, 2n, ev("challenge-2-B"));
    await ingest();

    await advance(pc, CP_S + 300);
    await settleDisputeAsArbitrator(2n, 2, ev("decision-2-NO"));
    const r = await ingest();
    expect(r.events).toBeGreaterThanOrEqual(5); // DisputeSettled, ProtocolFeeAccrued, MarketFinalized, ExposureReleased, SelectedSettlement

    const row = await marketRow(2n);
    expect(row!.status).toBe("FINALIZED");
    expect(row!.finalOutcome).toBe("NO");
    expect(row!.refundable).toBe(false);

    const settlement = await prisma.marketSettlement.findUnique({ where: { marketId: row!.id } });
    expect(settlement?.disposition).toBe("CHALLENGERS");
    expect(settlement?.totalChallengeStake).toBe(2n * ETH);
    expect(settlement?.proposalBond).toBe(10n * ETH);

    const exposures = await prisma.exposureSnapshot.findMany({ where: { market: { onchainMarketId: 2n } } });
    expect(exposures).toHaveLength(1);
    expect(exposures[0]!.amount).toBe(8n * ETH);

    const fees = await prisma.protocolFeeAccrual.findMany({ where: { kind: "accrued" } });
    expect(fees).toHaveLength(1);
    expect(fees[0]!.amount).toBe((8n * ETH * 200n) / 10_000n); // 0.16 ETH

    // getClaimable → exact pari-mutuel payout for the NO winner
    const payout = await readCall<[bigint, bigint]>(pc, factory(), FACTORY_ABI as never, "getClaimable", [
      2n,
      LOCAL_ROLES.noParticipant,
    ]);
    expect(payout[0]).toBe((784n * ETH) / 100n);

    await claim(LOCAL_ROLES.noParticipant, 2n);
    const r2 = await ingest();
    expect(r2.events).toBe(1);
    const claimRows = await prisma.claim.findMany({ include: { market: true } });
    const noClaims = claimRows.filter((c) => c.market.onchainMarketId === 2n && c.claimType === "PAYOUT");
    expect(noClaims).toHaveLength(1);
    expect(noClaims[0]!.amount).toBe((784n * ETH) / 100n);

    const yesClaims = claimRows.filter(
      (c) => c.market.onchainMarketId === 2n && c.walletAddress === LOCAL_ROLES.yesParticipant.toLowerCase(),
    );
    expect(yesClaims).toHaveLength(0); // losing side never gets a payout row
  });

  it("pays CHALLENGER entitlements exactly and acknowledges zero-entitlement claims", async () => {
    expect(await entitlement(2n, 2, LOCAL_ROLES.challengerA)).toBe(6n * ETH);
    expect(await entitlement(2n, 2, LOCAL_ROLES.challengerB)).toBe(6n * ETH);
    expect(await entitlement(2n, 1, LOCAL_ROLES.proposer)).toBe(0n);

    await claimBond(LOCAL_ROLES.challengerA, 2n, 2);
    await claimBond(LOCAL_ROLES.challengerB, 2n, 2);
    await claimBond(LOCAL_ROLES.proposer, 2n, 1); // zero-entitlement acknowledgment path
    await claimBond(LOCAL_ROLES.creator, 2n, 0);
    const r = await ingest();
    expect(r.events).toBe(4);

    await sendRevert(pc, {
      from: LOCAL_ROLES.challengerA,
      to: factory(),
      data: encode(FACTORY_ABI, "claimBond", [2n, 2, LOCAL_ROLES.challengerA]),
    });

    const bonds = await prisma.bond.findMany({ include: { market: true } });
    const byKey = new Map(
      bonds.filter((b) => b.market.onchainMarketId === 2n).map((b) => [`${b.walletAddress}/${b.bondType}`, b]),
    );
    expect(byKey.get(`${LOCAL_ROLES.challengerA.toLowerCase()}/CHALLENGE`)?.returned).toBe(6n * ETH);
    expect(byKey.get(`${LOCAL_ROLES.challengerB.toLowerCase()}/CHALLENGE`)?.returned).toBe(6n * ETH);
    const proposalBond = byKey.get(`${LOCAL_ROLES.proposer.toLowerCase()}/PROPOSAL`);
    expect(proposalBond?.deposited).toBe(10n * ETH);
    expect(proposalBond?.returned).toBe(0n); // forfeited on genuine reversal
    const creationBond = byKey.get(`${LOCAL_ROLES.creator.toLowerCase()}/CREATION`);
    expect(creationBond?.deposited).toBe(1n * ETH);
    expect(creationBond?.returned).toBe(1n * ETH);
  });

  it("reconciles direct contract reads against the folded projections", async () => {
    expect(await readCall<bigint>(pc, factory(), FACTORY_ABI as never, "marketCount", [])).toBe(3n);
    const stake = await readCall<{ amount: bigint; prefixBefore: bigint; claimed: boolean } | [bigint, bigint, boolean]>(
      pc,
      factory(),
      FACTORY_ABI as never,
      "getChallengeStake",
      [2n, LOCAL_ROLES.challengerA],
    );
    const amount = Array.isArray(stake) ? stake[0] : (stake as { amount: bigint }).amount;
    const prefixBefore = Array.isArray(stake) ? stake[1] : (stake as { prefixBefore: bigint }).prefixBefore;
    const claimed = Array.isArray(stake) ? stake[2] : (stake as { claimed: boolean }).claimed;
    expect(amount).toBe(1n * ETH);
    expect(prefixBefore).toBe(0n);
    expect(claimed).toBe(true); // claimed on-chain

    expect(await readCall<bigint>(pc, factory(), FACTORY_ABI as never, "totalChallengeStake", [2n])).toBe(2n * ETH);
    const row = await marketRow(2n);
    expect(row!.totalChallengeStake).toBe(2n * ETH);

    // Market 0 remains disputed/unresolved (5 ETH + 3 ETH), while markets 1 & 2 released.
    expect(await readCall<bigint>(pc, factory(), FACTORY_ABI as never, "totalUnresolvedExposure", [])).toBe(8n * ETH);
    const feeAccruals = await prisma.protocolFeeAccrual.findMany({ where: { kind: "accrued" } });
    expect(feeAccruals.map((f) => f.amount)).toEqual([(16n * ETH) / 100n]);
  });

  it("rolls back a fork and replays the canonical branch without duplicates", async () => {
    const snapId = (await pc.request({ method: "evm_snapshot", params: [] })) as string;
    expect(snapId).toBeTruthy();

    // ---- branch 1: market 3 with decisive activity -------------------------
    await createMarket("branch1", LOCAL_ROLES.creator); // id 3
    await predict(LOCAL_ROLES.challengerB, 3n, 0, 9n * ETH);
    await predict(LOCAL_ROLES.guardian, 3n, 1, 4n * ETH);
    await advance(pc, 700);
    await propose(LOCAL_ROLES.proposer, 3n, 1, ev("proposal-F1"));
    await challenge(LOCAL_ROLES.challengerA, 3n, ev("challenge-F1"));
    const r1 = await ingest();
    expect(r1.events).toBeGreaterThan(0);
    const eventsAtFork = BigInt(await prisma.indexedEvent.count());

    // ---- revert the fork, then build branch 2 over the same heights --------
    const ok = (await pc.request({ method: "evm_revert", params: [snapId] })) as boolean;
    expect(ok).toBe(true);
    await advance(pc, 5);

    await createMarket("branch2", LOCAL_ROLES.creator); // id 3 again — same on-chain id, other content
    await predict(LOCAL_ROLES.proposer, 3n, 0, (22n * ETH) / 10n);
    await predict(LOCAL_ROLES.guardian, 3n, 1, (17n * ETH) / 10n);

    const r2 = await ingest();
    expect(r2.rollbacks).toBe(1);

    const rbRows = await prisma.indexerRollback.findMany({ orderBy: { id: "asc" } });
    expect(rbRows).toHaveLength(1);
    const rb = rbRows[0]!;
    expect(rb.chainId).toBe(CHAIN_ID);
    expect(rb.removedEvents + rb.replayedEvents).toBe(Number(eventsAtFork));

    // orphaned branch-1 projections are gone; only branch-2 content remains
    expect(await prisma.dispute.count({ where: { market: { onchainMarketId: 3n } } })).toBe(0);
    expect(await prisma.resolution.count({ where: { market: { onchainMarketId: 3n } } })).toBe(0);
    expect(await prisma.challengeStake.count({ where: { market: { onchainMarketId: 3n } } })).toBe(0);
    expect(await prisma.marketSettlement.count({ where: { market: { onchainMarketId: 3n } } })).toBe(0);

    const preds = await prisma.prediction.findMany({ include: { market: true } });
    const onId3 = preds.filter((p) => p.market.onchainMarketId === 3n);
    expect(onId3).toHaveLength(2);
    expect(onId3.map((p) => `${p.walletAddress}:${p.side}:${p.amount.toString()}`).sort()).toEqual(
      [
        `${LOCAL_ROLES.proposer.toLowerCase()}:YES:${(22n * ETH / 10n).toString()}`,
        `${LOCAL_ROLES.guardian.toLowerCase()}:NO:${(17n * ETH / 10n).toString()}`,
      ].sort(),
    );

    // pre-reorg canonical markets kept their projected state through replay
    const m0 = await marketRow(0n);
    expect(m0!.status).toBe("DISPUTED");
    expect(m0!.totalChallengeStake).toBe(2n * ETH);
    const m2 = await marketRow(2n);
    expect(m2!.status).toBe("FINALIZED");
    const feeAccruals = await prisma.protocolFeeAccrual.findMany({ where: { kind: "accrued" } });
    expect(feeAccruals.map((f) => f.amount)).toEqual([(16n * ETH) / 100n]);

    // checkpoint follows the new canonical tip
    const cp = await prisma.indexerCheckpoint.findUnique({ where: { chainId: CHAIN_ID } });
    expect(cp?.lastProcessedBlock).toBe(await pc.getBlockNumber());

    // continuing on the canonical branch ingests cleanly afterwards
    await advance(pc, 700);
    await propose(LOCAL_ROLES.proposer, 3n, 1, ev("proposal-F2"));
    const r3 = await ingest();
    expect(r3.rollbacks).toBe(0);
    const resolution = await prisma.resolution.findFirst({ where: { market: { onchainMarketId: 3n } } });
    expect(resolution?.proposalEvidenceHash).toBe(ev("proposal-F2"));
  });

  it("never half-commits when the RPC connection dies mid-cycle", async () => {
    await advance(pc, 1);
    const before = await countsOf();
    const cpBefore = await prisma.indexerCheckpoint.findUnique({ where: { chainId: CHAIN_ID } });

    let fired = false;
    const flaky = new Proxy(pc as unknown as object, {
      get(target, prop, recv) {
        const original = Reflect.get(target, prop, recv);
        if (prop === "getLogs" && !fired) {
          return (...args: unknown[]) => {
            fired = true;
            throw new Error("connection reset (harness)");
          };
        }
        return original;
      },
    }) as unknown as Client;

    const depsFlaky: IndexerDeps = { ...deps, publicClient: flaky };
    await expect(ingestOnce(depsFlaky)).rejects.toThrow("connection reset (harness)");
    expect(await countsOf()).toEqual(before);
    expect(await prisma.indexerCheckpoint.findUnique({ where: { chainId: CHAIN_ID } })).toEqual(cpBefore);

    const r = await ingest();
    expect(r.rollbacks).toBe(0);
  });

  it("refuses foreign chain identities and non-loopback manifest RPCs", async () => {
    await expect(verifyChainIdentity(pc, manifest, 1)).rejects.toThrow(/chain\s*id/i);

    const bogus = { ...manifest, network: { ...manifest.network, rpcUrl: "http://10.1.2.3:8545" } };
    const file = path.join(workDir, "bogus.json");
    writeFileSync(file, JSON.stringify(bogus));
    await expect(
      readDeploymentManifest({ DEPLOYMENT_MANIFEST: file } as unknown as NodeJS.ProcessEnv),
    ).rejects.toThrow("rpcUrl is not loopback");

    const wrongStatus = { ...manifest, status: "PRODUCTION" };
    writeFileSync(file, JSON.stringify(wrongStatus));
    await expect(
      readDeploymentManifest({ DEPLOYMENT_MANIFEST: file } as unknown as NodeJS.ProcessEnv),
    ).rejects.toThrow("not LOCAL_SIMULATION");
  });
});
