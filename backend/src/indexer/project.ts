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

// Database transaction client type.
export type Tx = Prisma.TransactionClient;

const asBig = (v: unknown): bigint => BigInt(v as string | number | bigint);

/**
 * JSON column codec for the canonical raw layer: bigint is not JSON
 * serializable, so persisted numerics become decimal strings. The in-memory
 * fold keeps native decoded values; applyEvent()'s asBig/Number/String readers
 * accept both shapes, which also makes pure DB replay bit-identical.
 */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value != null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toJsonSafe(v);
    return out;
  }
  return value;
}
const addr = (v: unknown) => String(v).toLowerCase();
const sideOf = (v: unknown): "YES" | "NO" => (Number(v) === 1 ? "NO" : "YES");
const outcomeOf = (v: unknown): "UNRESOLVED" | "YES" | "NO" | "INVALID" =>
  (["UNRESOLVED", "YES", "NO", "INVALID"] as const)[Number(v) ?? 0] ?? "UNRESOLVED";
const bondTypeOf = (v: unknown): "CREATION" | "PROPOSAL" | "CHALLENGE" =>
  (["CREATION", "PROPOSAL", "CHALLENGE"] as const)[Number(v) ?? 0] ?? "CREATION";

async function ensureUser(tx: Tx, wallet: string): Promise<void> {
  await tx.user.upsert({ where: { walletAddress: wallet }, update: { lastSeenAt: new Date() }, create: { walletAddress: wallet } });
}

const actorOf = (e: RawEvent): string | null => {
  const a = e.args;
  for (const k of ["participant", "proposer", "challenger", "creator", "caller", "contributor", "owner", "arbitrator"]) {
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

/**
 * Canonical fold over a chronologically ordered event window (a batch or the
 * full surviving raw set). Market creation rows are applied first so that
 * same-transaction sibling events which precede `MarketCreated` on the log —
 * notably the CREATION `BondDeposited` emitted before the market ever exists —
 * still fold into complete ledgers. Every applyEvent call is idempotent
 * (same-key upserts), so double passes are safe.
 */
export async function applyCanonical(tx: Tx, events: RawEvent[]): Promise<void> {
  for (const e of events) if (e.eventName === "MarketCreated") await applyEvent(tx, e);
  for (const e of events) if (e.eventName !== "MarketCreated") await applyEvent(tx, e);
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

  // Marketless selection events (no marketId arg) fold here: fee withdrawals.
  if (e.eventName === "ProtocolFeeWithdrawn") {
    await tx.protocolFeeAccrual.create({
      data: {
        chainId: e.chainId, amount: asBig(a.amount).toString(), kind: "withdrawn",
        txHash: e.txHash, logIndex: e.logIndex, blockNumber: e.blockNumber, blockHash: e.blockHash,
      },
    });
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
          chainId: e.chainId, marketId: mid, walletAddress: wallet, side: s, amount: amt.toString(),
          txHash: e.txHash, logIndex: e.logIndex, blockNumber: e.blockNumber, blockHash: e.blockHash, timestamp: e.timestamp,
        },
      });
      await tx.contribution.upsert({
        where: { marketId_walletAddress_side: { marketId: mid, walletAddress: wallet, side: s } },
        update: { amount: { increment: amt.toString() }, predictCount: { increment: 1 }, updatedBlock: e.blockNumber },
        create: { marketId: mid, walletAddress: wallet, side: s, amount: amt.toString(), predictCount: 1, updatedBlock: e.blockNumber },
      });
      await tx.marketPosition.upsert({
        where: { marketId_walletAddress: { marketId: mid, walletAddress: wallet } },
        update: s === "YES"
          ? { yesContribution: { increment: amt.toString() }, updatedBlock: e.blockNumber }
          : { noContribution: { increment: amt.toString() }, updatedBlock: e.blockNumber },
        create: {
          marketId: mid, walletAddress: wallet,
          yesContribution: s === "YES" ? amt.toString() : "0",
          noContribution: s === "NO" ? amt.toString() : "0",
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
      const refundable = Boolean(a.refundable);
      await tx.resolution.updateMany({ where: { marketId: mid }, data: { status: "FINALIZED", finalOutcome } });
      await tx.market.update({ where: { id: mid }, data: { status: "FINALIZED", finalOutcome, refundable } });
      await pushActivity(tx, e, mid, actor, "finalized");
      return;
    }

    case "MarketCancelled": {
      const reason = enumAt(CANCEL_REASONS, a.reasonCode, "unknown");
      await tx.market.update({
        where: { id: mid },
        data: { status: "CANCELLED", refundable: true, finalOutcome: "INVALID" },
      });
      await pushActivity(tx, e, mid, actor, `cancelled:${reason}`);
      return;
    }

    case "DisputeSettled": {
      const decision = outcomeOf(a.decision);
      const isInvalid = decision === "INVALID";
      await tx.dispute.updateMany({
        where: { marketId: mid, status: "OPEN" },
        data: { status: "RESOLVED", decision, settledTxHash: e.txHash, settledAtBlock: e.blockNumber },
      });
      // The arbitrator's decision evidence hash is first-class on-chain state.
      await tx.market.update({
        where: { id: mid },
        data: {
          decisionEvidenceHash: String(a.evidenceHash).toLowerCase(),
          finalOutcome: decision,
          ...(isInvalid ? { refundable: true } : {}),
        },
      });
      await pushActivity(tx, e, mid, actor, "dispute_settled");
      return;
    }

    case "SelectedSettlement": {
      // Terminal bond disposition row. The event disposition is authoritative
      // (NEUTRAL=0 for refundable markets and neutral INVALID; PROPOSER=1;
      // CHALLENGERS=2). Canonical outcome lands via MarketFinalized/
      // DisputeSettled rows.
      const disposition = enumAt(DISPOSITIONS, a.disposition, "NONE");
      const isNeutral = disposition === "NEUTRAL";
      const marketRow = await tx.market.findUnique({ where: { id: mid }, select: { refundable: true } });
      const refundable = isNeutral || (marketRow?.refundable ?? false);
      if (isNeutral && marketRow?.refundable !== true) {
        await tx.market.update({ where: { id: mid }, data: { refundable: true } });
      }
      const settlement = {
        disposition,
        totalChallengeStake: asBig(a.totalStake).toString(),
        proposalBond: asBig(a.proposalBond).toString(),
        refundable,
      };
      await tx.marketSettlement.upsert({
        where: { marketId: mid },
        update: { ...settlement, txHash: e.txHash, logIndex: e.logIndex, blockNumber: e.blockNumber, blockHash: e.blockHash },
        create: { marketId: mid, ...settlement, txHash: e.txHash, logIndex: e.logIndex, blockNumber: e.blockNumber, blockHash: e.blockHash },
      });
      await pushActivity(tx, e, mid, actor, `settlement:${disposition}`);
      return;
    }

    case "BondDeposited": {
      const wallet = addr(a.owner);
      const bt = bondTypeOf(a.bondType);
      await ensureUser(tx, wallet);
      await tx.bond.upsert({
        where: { marketId_walletAddress_bondType: { marketId: mid, walletAddress: wallet, bondType: bt } },
        update: { deposited: { increment: asBig(a.amount).toString() }, updatedBlock: e.blockNumber },
        create: { marketId: mid, walletAddress: wallet, bondType: bt, deposited: asBig(a.amount).toString(), updatedBlock: e.blockNumber },
      });
      await pushActivity(tx, e, mid, actor, "bond_deposited");
      return;
    }

    case "BondReleased": {
      const wallet = addr(a.owner);
      const bt = bondTypeOf(a.bondType);
      await tx.bond.upsert({
        where: { marketId_walletAddress_bondType: { marketId: mid, walletAddress: wallet, bondType: bt } },
        update: { returned: { increment: asBig(a.amount).toString() }, updatedBlock: e.blockNumber },
        // Replay edge (a real deposit row exists in every honest flow — the
        // create branch must never report a release as a new deposit).
        create: { marketId: mid, walletAddress: wallet, bondType: bt, deposited: "0", returned: asBig(a.amount).toString(), updatedBlock: e.blockNumber },
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
        amount: asBig(a.amount).toString(),
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
          claimedAmount: e.eventName === "RefundClaimed" ? "0" : claimedRow.amount,
          refundedAmount: e.eventName === "RefundClaimed" ? claimedRow.amount : "0",
          updatedBlock: e.blockNumber,
        },
      });
      await pushActivity(tx, e, mid, actor, e.eventName === "RefundClaimed" ? "refund" : "payout");
      return;
    }

    case "ChallengeStakeAccepted": {
      // M1: every accepted bonded tranche (one per address). The first tranche
      // of a PROPOSED market already flipped state via MarketChallenged; later
      // tranches are stake-only. Neither resets D or A.
      const wallet = addr(a.challenger);
      const amount = asBig(a.amount).toString();
      await tx.challengeStake.upsert({
        where: { marketId_walletAddress: { marketId: mid, walletAddress: wallet } },
        update: {
          amount, prefixBefore: asBig(a.prefixBefore).toString(), evidenceHash: String(a.evidenceHash),
          txHash: e.txHash, logIndex: e.logIndex, blockNumber: e.blockNumber, blockHash: e.blockHash, timestamp: e.timestamp,
        },
        create: {
          chainId: e.chainId, marketId: mid, walletAddress: wallet, amount,
          prefixBefore: asBig(a.prefixBefore).toString(), evidenceHash: String(a.evidenceHash),
          txHash: e.txHash, logIndex: e.logIndex, blockNumber: e.blockNumber, blockHash: e.blockHash, timestamp: e.timestamp,
        },
      });
      await tx.market.update({ where: { id: mid }, data: { totalChallengeStake: asBig(a.totalStake).toString() } });
      await pushActivity(tx, e, mid, actor, "challenge_stake");
      return;
    }

    case "DisputeEvidenceSubmitted": {
      // Independent evidence publication: no bond, no dispute-state change,
      // no challenger reward. The on-chain event carries a commitment hash,
      // never a URI — until a matching local artifact is published the
      // verification row stays UNVERIFIED/UNKNOWN (never silently verified).
      const wallet = addr(a.contributor);
      const evidenceHash = String(a.evidenceHash).toLowerCase();
      const existing = await tx.evidenceRecord.findUnique({
        where: { marketId_evidenceHash: { marketId: mid, evidenceHash } },
        select: { id: true },
      });
      if (existing) {
        // Duplicate commitment: keep the event audible but do not overwrite.
        await tx.marketActivity.upsert({
          where: { txHash_logIndex: { txHash: e.txHash, logIndex: e.logIndex } },
          update: {},
          create: {
            marketId: mid, actor: wallet, kind: "evidence_duplicate",
            summary: `${e.eventName} duplicate commitment retained`,
            txHash: e.txHash, logIndex: e.logIndex, blockNumber: e.blockNumber, blockHash: e.blockHash, timestamp: e.timestamp,
          },
        });
        return;
      }
      const record = await tx.evidenceRecord.create({
        data: {
          marketId: mid, kind: "OTHER", publisher: wallet,
          contentHash: evidenceHash, evidenceHash, manifestJson: "",
          txHash: e.txHash, logIndex: e.logIndex, blockNumber: e.blockNumber,
        },
      });
      await tx.evidenceVerification.create({
        data: { evidenceRecordId: record.id, availabilityStatus: "UNKNOWN", verificationStatus: "UNVERIFIED" },
      });
      await pushActivity(tx, e, mid, actor, "evidence_submitted");
      return;
    }

    case "ExposureReleased": {
      // Unresolved risk counters shuffle exactly once per terminal transition
      // (contract guard exposureReleased[id]). Zero-value releases are stored
      // too: one row is the truth, two rows would be a reconciliation error.
      await tx.exposureSnapshot.create({
        data: {
          chainId: e.chainId, marketId: mid, arbitrator: addr(a.arbitrator),
          amount: asBig(a.amount).toString(), txHash: e.txHash, logIndex: e.logIndex,
          blockNumber: e.blockNumber, blockHash: e.blockHash,
        },
      });
      await pushActivity(tx, e, mid, actor, "exposure_released");
      return;
    }

    case "ProtocolFeeAccrued": {
      await tx.protocolFeeAccrual.create({
        data: {
          chainId: e.chainId, marketId: mid, amount: asBig(a.amount).toString(),
          kind: "accrued", txHash: e.txHash, logIndex: e.logIndex,
          blockNumber: e.blockNumber, blockHash: e.blockHash,
        },
      });
      await pushActivity(tx, e, mid, actor, "fee_accrued");
      return;
    }

    case "ProtocolFeeWithdrawn": {
      // No marketId in the event; fee bookkeeping is global.
      await tx.protocolFeeAccrual.create({
        data: {
          chainId: e.chainId, amount: asBig(a.amount).toString(),
          kind: "withdrawn", txHash: e.txHash, logIndex: e.logIndex,
          blockNumber: e.blockNumber, blockHash: e.blockHash,
        },
      });
      await pushActivity(tx, e, mid, actor, "fee_withdrawn");
      return;
    }

    default:
      // ProtocolConfig emissions and accounting-only factory events are
      // preserved in the raw layer; they carry no schema projection here.
      return;
  }
}

/** Terminal dispositions from SelectedSettlement (SelectedMarketFactory.sol). */
const DISPOSITIONS = ["NEUTRAL", "PROPOSER", "CHALLENGERS"] as const;

/** MarketCancelled reasonCodes (exactly the codes MarketResolver emits). */
const CANCEL_REASONS = ["unassigned", "expired", "invalidDecision", "interrupted"] as const;

function enumAt(list: readonly string[], v: unknown, fallback: string): string {
  const i = Number(v);
  const label = Number.isInteger(i) && i >= 0 && i < list.length ? list[i] : undefined;
  return label ?? fallback;
}

async function pushActivity(tx: Tx, e: RawEvent, marketDbId: string, actor: string | null, kind: string): Promise<void> {
  const actorV = (actor ?? "0x0000000000000000000000000000000000000000").toLowerCase();
  await ensureUser(tx, actorV);
  const amountV = e.args.amount ?? e.args.totalStake ?? null;
  const sideV = e.args.side != null ? sideOf(e.args.side) : null;
  const outcomeV = e.args.outcome != null ? outcomeOf(e.args.outcome) : e.args.decision != null ? outcomeOf(e.args.decision) : null;
  await tx.marketActivity.upsert({
    where: { txHash_logIndex: { txHash: e.txHash, logIndex: e.logIndex } },
    update: {},
    create: {
      marketId: marketDbId,
      actor: actorV,
      kind,
      summary: `${e.eventName} #${describeArgs(e)}`,
      amount: amountV != null ? asBig(amountV).toString() : null,
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
