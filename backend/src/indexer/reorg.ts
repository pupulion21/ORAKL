// ORAKL P1 — reorg detection + projection replay driver.
//   1. A stored height above the live head can no longer be canonical.
//   2. A stored body whose hash differs from the canonical header at the same
//      height is orphaned.
// The sweep covers the stored set bounded by `depth` (default 4096).
// Scans newest -> oldest to find the common ancestor.
// If fork divergence exceeds `depth` or no common ancestor is found,
// fails closed per ADR-0002.
import type { PrismaClient } from "@prisma/client";

export type Header = { blockNumber: bigint; blockHash: string; parentHash: string; timestamp: bigint };

export type ReorgVerdict =
  | { kind: "none" }
  | { kind: "rollback"; fromBlock: bigint; toBlock: bigint; ancestorHash: string };

/**
 * Confirm stored ancestor lineage over the live chain. Stored rows are
 * contiguous from the deployment start block, so every stored height must bind
 * to the canonical header at that height. Scan newest→oldest to locate the
 * common ancestor. All stored blocks above the common ancestor are orphaned
 * and must be rolled back.
 * `getLiveHeader`/`getLiveHead` are injected so this module stays testable without a node.
 */
export async function detectReorg(
  prisma: PrismaClient,
  chainId: number,
  getLiveHeader: (blockNumber: bigint) => Promise<Header | null>,
  getLiveHead: () => Promise<Header | null>,
  depth = 4096,
): Promise<ReorgVerdict> {
  const blockRows = await prisma.indexedBlock.findMany({
    where: { chainId },
    orderBy: [{ blockNumber: "desc" }],
    take: depth,
  });
  if (blockRows.length === 0) return { kind: "none" };

  const head = await getLiveHead();
  if (head == null) return { kind: "none" }; // node unreachable — fail passive, never prune blind

  let hasOrphan = false;
  let highestOrphan: bigint | null = null;
  let commonAncestor: Header | null = null;

  for (const b of blockRows) {
    if (b.blockNumber > head.blockNumber) {
      // Stored block is above the live head (chain retracted).
      hasOrphan = true;
      if (highestOrphan == null) highestOrphan = b.blockNumber;
      continue;
    }

    const live = await getLiveHeader(b.blockNumber);
    if (live == null) {
      // Stored block is <= head, but live header could not be fetched.
      // Transient node failure or network interruption — fail passive.
      return { kind: "none" };
    }

    if (live.blockHash.toLowerCase() !== b.blockHash.toLowerCase()) {
      // Hash mismatch: this block diverged from the canonical chain.
      hasOrphan = true;
      if (highestOrphan == null) highestOrphan = b.blockNumber;
      continue;
    }

    // Hashes match!
    if (!hasOrphan) {
      // Stored tip matches canonical chain: no reorg!
      return { kind: "none" };
    }

    // We saw orphaned blocks above, and now we found the common ancestor!
    commonAncestor = {
      blockNumber: b.blockNumber,
      blockHash: b.blockHash,
      parentHash: b.parentHash,
      timestamp: b.timestamp,
    };
    break;
  }

  if (hasOrphan) {
    if (commonAncestor != null) {
      return {
        kind: "rollback",
        fromBlock: highestOrphan!,
        toBlock: commonAncestor.blockNumber + 1n,
        ancestorHash: commonAncestor.blockHash,
      };
    }
    // Fork divergence exceeds maximum rollback depth or no ancestor found within stored history:
    // Fail closed per ADR-0002.
    throw new Error(
      `fork divergence exceeds maximum rollback depth (${depth} blocks): no common ancestor found`,
    );
  }

  return { kind: "none" };
}
