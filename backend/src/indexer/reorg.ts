// ORAKL P1 — reorg detection + projection replay driver.
// Raw log ingest never backfills plain-log pagination ordering: projected
// rows are derived from stored events by deterministic replay, so any
// ancestor change prunes children + rebuilds projections in one tx.
import type { PrismaClient } from "@prisma/client";

export type Header = { blockNumber: bigint; blockHash: string; parentHash: string; timestamp: bigint };

export type ReorgVerdict =
  | { kind: "none" }
  | { kind: "rollback"; fromBlock: bigint; toBlock: bigint; ancestorHash: string };

/**
 * Confirm stored ancestor lineage over the live chain. The live header at
 * each stored height must reproduce the stored hash; the first mismatch
 * is the fork point — everything stored above it is non-canonical.
 * `getLiveHeader` is injected so this module stays testable without a node.
 */
export async function detectReorg(
  prisma: PrismaClient,
  chainId: number,
  getLiveHeader: (blockNumber: bigint) => Promise<Header | null>,
): Promise<ReorgVerdict> {
  const blockRows = await prisma.indexedBlock.findMany({
    where: { chainId },
    orderBy: [{ blockNumber: "desc" }],
    take: 4,
  });
  if (blockRows.length === 0) return { kind: "none" };

  for (const b of blockRows) {
    const live = await getLiveHeader(b.blockNumber);
    if (live == null) continue; // block beyond head or node unavailable this pass
    if (live.blockHash.toLowerCase() !== b.blockHash.toLowerCase()) {
      return {
        kind: "rollback",
        fromBlock: b.blockNumber,
        toBlock: b.blockNumber,
        ancestorHash: b.blockHash,
      };
    }
  }

  // Parent linkage between contiguous stored heights (stored-order check).
  const ordered = [...blockRows].sort((a, z) => (a.blockNumber < z.blockNumber ? -1 : 1));
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!;
    const cur = ordered[i]!;
    if (prev.blockNumber === cur.blockNumber + 1n && prev.parentHash !== cur.blockHash) {
      return { kind: "rollback", fromBlock: prev.blockNumber, toBlock: prev.blockNumber, ancestorHash: prev.parentHash };
    }
  }
  return { kind: "none" };
}
