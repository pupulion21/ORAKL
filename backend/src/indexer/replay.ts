// ORAKL P1 — full deterministic replay driver (referenced from schema docs).
//
// After a rollback the affected projection rows are wiped and rebuilt by
// streaming every surviving canonical event back through applyEvent().
// This is the same code path the forward indexer uses, so replay
// correctness and live indexing cannot drift apart.
import type { PrismaClient } from "@prisma/client";

import { applyEvent, type RawEvent } from "./project.js";

/**
 * Rebuild every projection from canonical raw events for `chainId`.
 * Called right after rollbackTo(). Markets created by pruned events are
 * removed with cascade; markets created by surviving events are re-derived
 * from the raw stream alone.
 */
export async function replayAll(prisma: PrismaClient, chainId: number): Promise<number> {
  await prisma.$transaction(async (tx) => {
    // Derived-layer wipe (order matters for FKs; raw tables are untouched).
    await tx.marketActivity.deleteMany({ where: { market: { chainId } } });
    await tx.prediction.deleteMany({ where: { market: { chainId } } });
    await tx.contribution.deleteMany({ where: { market: { chainId } } });
    await tx.marketPosition.deleteMany({ where: { market: { chainId } } });
    await tx.bond.deleteMany({ where: { market: { chainId } } });
    await tx.claim.deleteMany({ where: { market: { chainId } } });
    await tx.dispute.deleteMany({ where: { market: { chainId } } });
    await tx.resolution.deleteMany({ where: { market: { chainId } } });
    await tx.evidenceRecord.deleteMany({ where: { market: { chainId } } });
    await tx.moderationReport.deleteMany({ where: { market: { chainId } } });
    await tx.market.deleteMany({ where: { chainId } });
  });

  const events = await prisma.indexedEvent.findMany({
    where: { chainId },
    orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
  });

  for (const e of events) {
    const raw: RawEvent = {
      chainId: e.chainId,
      blockNumber: e.blockNumber,
      blockHash: e.blockHash,
      txHash: e.txHash,
      logIndex: e.logIndex,
      timestamp: e.timestamp,
      eventName: e.eventName,
      args: e.args as RawEvent["args"],
    };
    await prisma.$transaction(async (tx) => {
      await applyEvent(tx, raw);
    });
  }
  return events.length;
}
