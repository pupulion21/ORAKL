// ORAKL P1 — unit tests for bounded reorg recovery (ADR-0002).
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { detectReorg, type Header } from "../src/indexer/reorg.js";

function makeMockPrisma(blocks: { blockNumber: bigint; blockHash: string; parentHash: string; timestamp: bigint }[]): PrismaClient {
  return {
    indexedBlock: {
      findMany: async (args?: { take?: number }) => {
        const take = args?.take ?? 4096;
        return [...blocks]
          .sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : 1))
          .slice(0, take);
      },
    },
  } as unknown as PrismaClient;
}

describe("Bounded Reorg Detection (ADR-0002)", () => {
  it("returns none when the stored tip matches the canonical live chain", async () => {
    const blocks = [
      { blockNumber: 100n, blockHash: "0x100", parentHash: "0x99", timestamp: 1000n },
      { blockNumber: 99n, blockHash: "0x99", parentHash: "0x98", timestamp: 990n },
    ];
    const prisma = makeMockPrisma(blocks);
    const getLiveHead = async (): Promise<Header> => ({
      blockNumber: 100n,
      blockHash: "0x100",
      parentHash: "0x99",
      timestamp: 1000n,
    });
    const getLiveHeader = async (n: bigint): Promise<Header | null> => {
      if (n === 100n) return { blockNumber: 100n, blockHash: "0x100", parentHash: "0x99", timestamp: 1000n };
      if (n === 99n) return { blockNumber: 99n, blockHash: "0x99", parentHash: "0x98", timestamp: 990n };
      return null;
    };

    const verdict = await detectReorg(prisma, 31337, getLiveHeader, getLiveHead, 4096);
    expect(verdict).toEqual({ kind: "none" });
  });

  it("locates common ancestor across a 10-block fork and identifies exact rollback range", async () => {
    // Blocks 100..110 stored in DB from an orphaned fork.
    // Common ancestor is block 100 ("0x100").
    // Stored blocks 101..110 have hashes "0xfork101" .. "0xfork110".
    const blocks = [{ blockNumber: 100n, blockHash: "0x100", parentHash: "0x99", timestamp: 1000n }];
    for (let i = 101n; i <= 110n; i++) {
      blocks.push({
        blockNumber: i,
        blockHash: `0xfork${i}`,
        parentHash: `0xfork${i - 1n}`,
        timestamp: 1000n + i,
      });
    }
    const prisma = makeMockPrisma(blocks);

    const getLiveHead = async (): Promise<Header> => ({
      blockNumber: 110n,
      blockHash: "0xcanonical110",
      parentHash: "0xcanonical109",
      timestamp: 2000n,
    });

    const getLiveHeader = async (n: bigint): Promise<Header | null> => {
      if (n === 100n) return { blockNumber: 100n, blockHash: "0x100", parentHash: "0x99", timestamp: 1000n };
      if (n >= 101n && n <= 110n) {
        return {
          blockNumber: n,
          blockHash: `0xcanonical${n}`,
          parentHash: `0xcanonical${n - 1n}`,
          timestamp: 2000n + n,
        };
      }
      return null;
    };

    const verdict = await detectReorg(prisma, 31337, getLiveHeader, getLiveHead, 4096);
    expect(verdict.kind).toBe("rollback");
    if (verdict.kind === "rollback") {
      expect(verdict.fromBlock).toBe(110n); // highest orphaned block
      expect(verdict.toBlock).toBe(101n); // lowest orphaned block (toBlock - 1n = 100n is common ancestor)
      expect(verdict.ancestorHash).toBe("0x100");
    }
  });

  it("detects retracted chain above live head and rolls back to live head", async () => {
    const blocks = [
      { blockNumber: 105n, blockHash: "0x105", parentHash: "0x104", timestamp: 1050n },
      { blockNumber: 104n, blockHash: "0x104", parentHash: "0x103", timestamp: 1040n },
      { blockNumber: 103n, blockHash: "0x103", parentHash: "0x102", timestamp: 1030n },
      { blockNumber: 102n, blockHash: "0x102", parentHash: "0x101", timestamp: 1020n },
    ];
    const prisma = makeMockPrisma(blocks);

    // Live head retracted to 102
    const getLiveHead = async (): Promise<Header> => ({
      blockNumber: 102n,
      blockHash: "0x102",
      parentHash: "0x101",
      timestamp: 1020n,
    });
    const getLiveHeader = async (n: bigint): Promise<Header | null> => {
      if (n === 102n) return { blockNumber: 102n, blockHash: "0x102", parentHash: "0x101", timestamp: 1020n };
      return null;
    };

    const verdict = await detectReorg(prisma, 31337, getLiveHeader, getLiveHead, 4096);
    expect(verdict.kind).toBe("rollback");
    if (verdict.kind === "rollback") {
      expect(verdict.fromBlock).toBe(105n);
      expect(verdict.toBlock).toBe(103n);
      expect(verdict.ancestorHash).toBe("0x102");
    }
  });

  it("fails closed when fork divergence exceeds maximum rollback depth (ADR-0002)", async () => {
    // 50 blocks stored, depth is set to 20. None of the 20 match live chain.
    const blocks: { blockNumber: bigint; blockHash: string; parentHash: string; timestamp: bigint }[] = [];
    for (let i = 1n; i <= 50n; i++) {
      blocks.push({
        blockNumber: i,
        blockHash: `0xfork${i}`,
        parentHash: `0xfork${i - 1n}`,
        timestamp: 1000n + i,
      });
    }
    const prisma = makeMockPrisma(blocks);

    const getLiveHead = async (): Promise<Header> => ({
      blockNumber: 50n,
      blockHash: "0xcanonical50",
      parentHash: "0xcanonical49",
      timestamp: 2000n,
    });
    const getLiveHeader = async (n: bigint): Promise<Header | null> => ({
      blockNumber: n,
      blockHash: `0xcanonical${n}`,
      parentHash: `0xcanonical${n - 1n}`,
      timestamp: 2000n + n,
    });

    // With depth = 20, no ancestor is found within 20 blocks.
    await expect(detectReorg(prisma, 31337, getLiveHeader, getLiveHead, 20)).rejects.toThrow(
      /fork divergence exceeds maximum rollback depth/i,
    );
  });

  it("fails passive when live RPC returns null (node unreachable / network split)", async () => {
    const blocks = [{ blockNumber: 100n, blockHash: "0x100", parentHash: "0x99", timestamp: 1000n }];
    const prisma = makeMockPrisma(blocks);

    const getLiveHead = async (): Promise<Header | null> => null;
    const getLiveHeader = async (): Promise<Header | null> => null;

    const verdict = await detectReorg(prisma, 31337, getLiveHeader, getLiveHead, 4096);
    expect(verdict).toEqual({ kind: "none" });
  });
});
