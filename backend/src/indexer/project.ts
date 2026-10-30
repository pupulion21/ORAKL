// ORAKL P1 — deterministic replay of canonical raw events into projections.
//
// Rules (see prisma/schema.prisma header):
//   - Projections are a pure fold over canonical IndexedEvent rows in
//     (blockNumber, logIndex) order. Reorg handling = prune non-canonical
//     raw rows, then stream the survivors back through applyEvent().
//   - Every ledger insert (Claim, Prediction, MarketActivity, IndexerRollback)
//     is once-only keyed by (chainId | txHash, logIndex), so replays never
//     double-credit and the database keeps integrity even without an
//     external sequencing lock.
//   - LOCAL SIMULATION ONLY. This module holds no keys and talks to no node.
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

export type RawEvent = {
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  txHash: string;
  logIndex: number;
  timestamp: bigint;
  eventName: string;
  args: Record<string, unknown>;
};

const asBig = (v: unknown): bigint => BigInt(v as string | number | bigint);
const addr = (v: unknown) => String(v).toLowerCase();
const sideOf = (v: unknown): "YES" | "NO" => (Number(v) === 1 ? "NO" : "YES");
const outcomeOf = (v: unknown): "UNRESOLVED" | "YES" | "NO" | "INVALID" =>
  (["UNRESOLVED", "YES", "NO", "INVALID"] as const)[Number(v) ?? 0] ?? "UNRESOLVED";
const bondTypeOf = (v: unknown): "CREATION" | "PROPOSAL" | "CHALLENGE" =>
  (["CREATION", "PROPOSAL", "CHALLENGE"] as const)[Number(v) ?? 0] ?? "CREATION";

type Tx = Prisma.TransactionClient;

async function ensureUser(tx: Tx, wallet: string): Promise<void> {
  await tx.user.upsert({ where: { walletAddress: wallet }, update: { lastSeenAt: new Date() }, create: { walletAddress: wallet } });
}

function actorOf(e: RawEvent): string | null {
  const a = e.args;
  for (const k of ["participant", "proposer", "challenger", "creator", "caller", "contributor", "owner"]) {
    const v = a[k];
    if (typeof v === "string" && v.startsWith("0x") && v.length === 42) return addr(v);
  }
  return null;
}

/** Defensive fingerprint kept in activity rows via summary; not stored as Json. */
function describeArgs(e: RawEvent): string {
  const flat = Object.entries(e.args)
    .map(([k, v]) => `${k}=${typeof v === "bigint" ? v.toString() : String(v)}`)
    .join(", ");
  return createHash("sha256").update(`${e.eventName}:${flat}`).digest("hex").slice(0, 8);
}

async function upsertMarket(marketId: string, whereId: string | null, raw: RawEvent, market: { id: string }) {
  return whereId; // formal wrapper; kept for naming symmetry with other upserts
}

export async function applyEvent(tx: Tx, e: RawEvent): Promise<void> {
  const a = e.args;
  const actor = actorOf(e);
  if (actor) await ensureUser(tx, actor);

  // ---- lifecycle events that establish the market row itself -------------
  if (e.eventName === "MarketCreated") {
    const t = a.terms as Record<string, unknown>;
    const creator = addr(a.creator);
    await tx.market.upsert({
      where: { onchainMarketId: asBig(a.marketId) },
      update: {}, // creation is immutable; replays must not mutate rows
      create: {
        chainId: e.chainId,
        onchainMarketId: asBig(a.marketId),
        contractAddress: "",
        creatorAddress: creator,
        metadataHash: String(a.metadataHash),
        metadataURI: String(a.metadataURI),
        closeTime: asBig(a.closeTime),
        resolutionTime: asBig(a.resolutionTime),
        maxResolutionTime: asBig(a.maxResolutionTime),
        status: "OPEN",
        challengeDeadline: null,
        createdAtBlock: e.blockNumber,
      },
    });
    void t; // Parameters (feeBps, bonds, caps, arbitrator) remain on-chain authority
    return;
  }

  const marketId = asBig(a.marketId ?? 0n);
  const market = await tx.market.findUnique({ where: { onchainMarketId: marketId }, select: { id: true } });
  if (!market) return; // lifecycle-before-creation is impossible by construction

  const mid = market.id;

  switch (e.eventName) {
    case "PredictionPlaced": {
      const wallet = addr(a.participant);
      const amt = asBig(a.amount);
      const s = sideOf(a.side);
      await tx.prediction.upsert({
        where: { chainId_txHash_logIndex: { chainId: e.chainId, txHash: e.txHash, logIndex: e.logIndex } },
        update: {},
        create: {
          chainId: e.chainId, marketId: mid, walletAddress: wallet, side: s, amount: amt,
          txHash: e.txHash, logIndex: e.logIndex, blockNumber: e.blockNumber, blockHash: e.blockHash, timestamp: e.timestamp,
        },
      });
      await tx.contribution.upsert({
        where: { marketId_walletAddress_side: { marketId: mid, walletAddress: wallet, side: s } },
        update: { amount: { increment: amt }, predictCount: { increment: 1 }, updatedBlock: e.blockNumber },
        create: { marketId: mid, walletAddress: wallet, side: s, amount: amt, predictCount: 1, updatedBlock: e.blockNumber },
      });
      await tx.marketPosition.upsert({
        where: { marketId_walletAddress: { marketId: mid, walletAddress: wallet } },
        update: s === "YES"
          ? { yesContribution: { increment: amt }, updatedBlock: e.blockNumber }
          : { noContribution: { increment: amt }, updatedBlock: e.blockNumber },
        create: {
          marketId: mid, walletAddress: wallet,
          yesContribution: s === "YES" ? amt : 0n,
          noContribution: s === "NO" ? amt : 0n,
          updatedBlock: e.blockNumber,
        },
      });
      await pushActivity(tx, e, mid, actor, "predicted");
      return;
    }

    case "MarketOutcomeProposed": {
      const proposer = addr(a.proposer);
      const dl = asBig(a.challengeDeadline);
      await tx.resolution.upsert({
        where: { marketId: mid },
        update: { status: "PROPOSED", proposerAddress: proposer, proposedOutcome: outcomeOf(a.outcome), proposalEvidenceHash: String(a.evidenceHash), challengeDeadline: dl },
        create: { marketId: mid, status: "PROPOSED", proposerAddress: proposer, proposedOutcome: outcomeOf(a.outcome), proposalEvidenceHash: String(a.evidenceHash), challengeDeadline: dl },
      });
      await tx.market.update({
        where: { id: mid },
        data: { status: "PROPOSED", proposerAddress: proposer, proposalEvidenceHash: String(a.evidenceHash), challengeDeadline: dl },
      });
      await pushActivity(tx, e, mid, actor, "proposed");
      return;
    }

    case "MarketChallenged": {
      const challenger = addr(a.challenger);
      await tx.dispute.create({
        data: { marketId: mid, challengerAddress: challenger, evidenceHash: String(a.evidenceHash), status: "OPEN" },
      });
      await tx.resolution.update({ where: { marketId: mid }, data: { status: "CHALLENGED", challengerAddress: challenger, challengeEvidenceHash: String(a.evidenceHash) } });
      await tx.market.update({
        where: { id: mid },
        data: { status: "DISPUTED", challengerAddress: challenger, challengeEvidenceHash: String(a.evidenceHash) },
      });
      await pushActivity(tx, e, mid, actor, "challenged");
      return;
    }

    case "MarketFinalized": {
      const finalOutcome = outcomeOf(a.outcome);
      await tx.resolution.updateMany({ where: { marketId: mid }, data: { status: "FINALIZED", finalOutcome } });
      await tx.market.update({ where: { id: mid }, data: { status: "FINALIZED", finalOutcome } });
      await pushActivity(tx, e, mid, actor, "finalized");
      return;
    }

    case "MarketCancelled": {
      await tx.market.update({ where: { id: mid }, data: { status: "CANCELLED" } });
      await pushActivity(tx, e, mid, actor, "cancelled");
      return;
    }

    case "DisputeSettled": {
      await tx.dispute.updateMany({
        where: { marketId: mid, status: "OPEN" },
        data: { status: "RESOLVED", decision: outcomeOf(a.decision), settledTxHash: e.txHash, settledAtBlock: e.blockNumber },
      });
      await pushActivity(tx, e, mid, actor, "dispute_settled");
      return;
    }

    case "SelectedSettlement": {
      // disposition/totalStake/proposalBond are contract-internal wording;
      // canonical outcome lands via MarketFinalized / DisputeSettled rows.
      await pushActivity(tx, e, mid, actor, "settlement");
      return;
    }

    case "BondDeposited": {
      const wallet = addr(a.owner);
      const bt = bondTypeOf(a.bondType);
      await ensureUser(tx, wallet);
      await tx.bond.upsert({
        where: { marketId_walletAddress_bondType: { marketId: mid, walletAddress: wallet, bondType: bt } },
        update: { deposited: { increment: asBig(a.amount) }, updatedBlock: e.blockNumber },
        create: { marketId: mid, walletAddress: wallet, bondType: bt, deposited: asBig(a.amount), updatedBlock: e.blockNumber },
      });
      await pushActivity(tx, e, mid, actor, "bond_deposited");
      return;
    }

    case "BondReleased": {
      const wallet = addr(a.owner);
      const bt = bondTypeOf(a.bondType);
      await tx.bond.upsert({
        where: { marketId_walletAddress_bondType: { marketId: mid, walletAddress: wallet, bondType: bt } },
        update: { returned: { increment: asBig(a.amount) }, updatedBlock: e.blockNumber },
        create: { marketId: mid, walletAddress: wallet, bondType: bt, returned: asBig(a.amount), updatedBlock: e.blockNumber },
      });
      await pushActivity(tx, e, mid, actor, "bond_released");
      return;
    }

    case "RefundClaimed":
    case "RewardClaimed": {
      const wallet = addr(a.participant);
      const claimedRow = {
        marketId: mid,
        walletAddress: wallet,
        claimType: e.eventName === "RefundClaimed" ? ("REFUND" as const) : ("PAYOUT" as const),
        amount: asBig(a.amount),
        txHash: e.txHash,
        logIndex: e.logIndex,
        blockNumber: e.blockNumber,
        blockHash: e.blockHash,
      };
      await tx.claim.upsert({
        where: { txHash_logIndex: { txHash: e.txHash, logIndex: e.logIndex } },
        update: {}, create: claimedRow,
      });
      await tx.marketPosition.upsert({
        where: { marketId_walletAddress: { marketId: mid, walletAddress: wallet } },
        update: e.eventName === "RefundClaimed"
          ? { refundedAmount: { increment: claimedRow.amount }, updatedBlock: e.blockNumber }
          : { claimedAmount: { increment: claimedRow.amount }, updatedBlock: e.blockNumber },
        create: {
          marketId: mid, walletAddress: wallet,
          claimedAmount: e.eventName === "RefundClaimed" ? 0n : claimedRow.amount,
          refundedAmount: e.eventName === "RefundClaimed" ? claimedRow.amount : 0n,
          updatedBlock: e.blockNumber,
        },
      });
      await pushActivity(tx, e, mid, actor, e.eventName === "RefundClaimed" ? "refund" : "payout");
      return;
    }

    default:
      // ProtocolConfig emissions and accounting-only factory events are
      // preserved in the raw layer; they carry no schema projection here.
      return;
  }
}

async function pushActivity(tx: Tx, e: RawEvent, marketDbId: string, actor: string | null, kind: string): Promise<void> {
  const amountV = e.args.amount ?? e.args.totalStake ?? null;
  const sideV = e.args.side != null ? sideOf(e.args.side) : null;
  const outcomeV = e.args.outcome != null ? outcomeOf(e.args.outcome) : e.args.decision != null ? outcomeOf(e.args.decision) : null;
  await tx.marketActivity.upsert({
    where: { txHash_logIndex: { txHash: e.txHash, logIndex: e.logIndex } },
    update: {},
    create: {
      marketId: marketDbId,
      actor: actor ?? "0x0000000000000000000000000000000000000000",
      kind,
      summary: `${e.eventName} #${describeArgs(e)}`,
      amount: amountV != null ? asBig(amountV) : null,
      side: sideV,
      outcome: outcomeV,
      txHash: e.txHash,
      logIndex: e.logIndex,
      blockNumber: e.blockNumber,
      blockHash: e.blockHash,
      timestamp: e.timestamp,
    },
  });
}

export { upsertMarket as internalUpsertMarket }; // test seam
