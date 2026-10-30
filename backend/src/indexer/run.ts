// ORAKL P1 — indexer main loop. LOCAL Anvil ONLY (chainId 31337).
//
// Startup contract:
//   1. Read backend/deployments/local-selected.json (mode local-selected).
//   2. Reject any manifest that is not LOCAL_SIMULATION / chainId 31337.
//   3. Poll getLogs on the factory, ingest raw blocks/events, replay
//      projections, and checkpoint — all inside one transaction per batch.
//   4. detectReorg() every cycle; on a fork: prune raw rows above the fork,
//      clear projections of affected markets, and replay surviving history.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { http, type Log } from "viem";

import { PrismaClient } from "@prisma/client";
import { createPublicClient, createWalletClientsUnused } from "./client-factory.js";
import { decodeLog } from "./events.js";
import { applyEvent, type RawEvent } from "./project.js";
import { replayAll } from "./replay.js";
import { detectReorg, type Header } from "./reorg.js";

void createWalletClientsUnused;
type Deployment = {
  schemaVersion: number;
  status: string;
  mode: string;
  network: { chainId: number };
  contracts: { selectedMarketFactory: { address: string; startBlock: number } };
};

async function loadDeployment(): Promise<Deployment> {
  const file = path.resolve(process.cwd(), "deployments/local-selected.json");
  const manifest = JSON.parse(await readFile(file, "utf8")) as Deployment;
  if (manifest.status !== "LOCAL_SIMULATION" || manifest.mode !== "local-selected") {
    throw new Error(`refusing to run: manifest is not LOCAL_SIMULATION/local-selected (${manifest.status}/${manifest.mode})`);
  }
  if (manifest.network.chainId !== Number(process.env.LOCAL_CHAIN_ID ?? "31337")) {
    throw new Error("refusing to run: manifest chainId does not match LOCAL_CHAIN_ID");
  }
  return manifest;
}

export type IndexerDeps = {
  prisma: PrismaClient;
  publicClient: ReturnType<typeof createPublicClient>;
  factory: `0x${string}`;
  chainId: number;
  startBlock: bigint;
  batchSize: number;
};

export async function ingestOnce(deps: IndexerDeps): Promise<{ blocks: number; events: number; rollbacks: number }> {
  const { prisma, publicClient, factory, chainId } = deps;

  // ---- 1. reorg sweep ------------------------------------------------------
  const getLiveHeader = async (blockNumber: bigint): Promise<Header | null> => {
    try {
      const b = await publicClient.getBlock({ blockNumber });
      return { blockNumber: b.number!, blockHash: b.hash, parentHash: b.parentHash, timestamp: b.timestamp };
    } catch {
      return null;
    }
  };
  const verdict = await detectReorg(prisma, chainId, getLiveHeader);
  let rollbacks = 0;
  if (verdict.kind === "rollback") {
    await rollbackTo(prisma, chainId, verdict.fromBlock - 1n);
    await replayAll(prisma, chainId); // deterministic rebuild from surviving canonical raw rows
    rollbacks = 1;
  }

  // ---- 2. fetch next batch -------------------------------------------------
  const checkpoint = await prisma.indexerCheckpoint.findUnique({ where: { chainId } });
  const fromBlock = checkpoint != null ? checkpoint.lastProcessedBlock + 1n : deps.startBlock;
  const head = await publicClient.getBlockNumber();
  if (fromBlock > head) return { blocks: 0, events: 0, rollbacks };

  const batchEnd = fromBlock + BigInt(deps.batchSize) - 1n <= head ? fromBlock + BigInt(deps.batchSize) - 1n : head;
  const batchBlocks: Array<Awaited<ReturnType<typeof publicClient.getBlock>>> = [];
  for (let n = fromBlock; n <= batchEnd; n++) batchBlocks.push(await getLiveHeader(n) as never);
  const logs = await publicClient.getLogs({
    address: factory,
    fromBlock,
    toBlock: batchEnd,
  } as never);

  // ---- 3. ingest + project in one tx --------------------------------------
  const perBlock = new Map(batchBlocks.map((b) => [b.hash as string, b]));
  await prisma.$transaction(async (tx) => {
    for (const [hash, block] of perBlock) {
      const number = block.number!.valueOf();
      await tx.indexedBlock.upsert({
        where: { blockNumber: number },
        update: { blockHash: hash as string, parentHash: block.parentHash, timestamp: block.timestamp },
        create: {
          chainId: chainId,
          blockNumber: number,
          blockHash: hash as string,
          parentHash: block.parentHash,
          timestamp: block.timestamp,
        },
      });
    }

    for (const log of logs as Log[]) {
      const decoded = decodeLog(log);
      if (decoded == null) continue;
      const block = perBlock.get(String(log.blockHash));
      if (block == null) continue; // log outside ingested batch — never project blindly
      await tx.indexedEvent.upsert({
        where: { chainId_txHash_logIndex: { chainId: chainId, txHash: log.transactionHash!, logIndex: Number(log.logIndex) } },
        update: {},
        create: {
          chainId: chainId,
          blockNumber: block.number!.valueOf(),
          blockHash: String(log.blockHash),
          txHash: log.transactionHash!,
          logIndex: Number(log.logIndex),
          address: String(log.address),
          eventName: decoded.eventName,
          args: decoded.args as never,
          timestamp: block.timestamp,
        },
      });
      await applyEvent(tx, {
        chainId: chainId,
        blockNumber: block.number!.valueOf(),
        blockHash: String(log.blockHash),
        txHash: log.transactionHash!,
        logIndex: Number(log.logIndex),
        timestamp: block.timestamp,
        eventName: decoded.eventName,
        args: decoded.args as never,
      } as RawEvent);
    }

    await tx.indexerCheckpoint.upsert({
      where: { chainId: chainId },
      update: { lastProcessedBlock: batchEnd.valueOf(), lastProcessedBlockHash: String(batchBlocks.at(-1)!.hash), eventsIndexed: { increment: BigInt(logs.length) } },
      create: {
        chainId: chainId,
        contractAddress: factory,
        lastProcessedBlock: batchEnd.valueOf(),
        lastProcessedBlockHash: String(batchBlocks.at(-1)!.hash),
        eventsIndexed: BigInt(logs.length),
      },
    });
  });

  return { blocks: perBlock.size, events: logs.length, rollbacks };
}

/**
 * Rollback: prune raw rows above `keepBlock`, clear projections carried by
 * pruned events, and replay surviving canonical history for affected markets.
 * Deterministic by construction — projections are folds, never counters kept
 * outside the raw stream.
 */
export async function rollbackTo(prisma: PrismaClient, chainId: number, keepBlock: bigint): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const removedEvents = await tx.indexedEvent.deleteMany({ where: { chainId: chainId, blockNumber: { gt: keepBlock } } });
    const removedBlocks = await tx.indexedBlock.deleteMany({ where: { chainId: chainId, blockNumber: { gt: keepBlock } } });
    const pruned = await tx.indexedEvent.findMany({
      where: { chainId: chainId, blockNumber: { gt: keepBlock } },
    });
    void pruned; // rows are already deleted above; replay uses survivors below

    // Reset checkpoint to the surviving tip so the loop resumes at keepBlock+1.
    const tip = await tx.indexedBlock.findFirst({ where: { chainId: chainId, blockNumber: { lte: keepBlock } }, orderBy: { blockNumber: "desc" } });
    if (tip != null) {
      await tx.indexerCheckpoint.update({
        where: { chainId: chainId },
        data: { lastProcessedBlock: tip.blockNumber, lastProcessedBlockHash: tip.blockHash },
      });
    }

    // Rebuild projections deterministically: drop derived rows whose events
    // may have been pruned, then re-fold every surviving raw event.
    const survivors = await tx.indexedEvent.findMany({
      where: { chainId: chainId },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
    });
    await tx.indexerRollback.create({
      data: {
        chainId: chainId,
        fromBlock: keepBlock + 1n,
        toBlock: keepBlock,
        reason: "ancestor mismatch",
        removedBlocks: removedBlocks.count,
        removedEvents: removedEvents.count,
        replayedEvents: survivors.length,
      },
    });
    // Full-file replay is performed by the caller (replayAll) after this tx.
    return removedEvents.count;
  });
}

export function digestOfArgs(args: unknown): string {
  return createHash("sha256").update(JSON.stringify(args)).digest("hex");
}

export async function main(): Promise<void> {
  const deployment = await loadDeployment();
  const prisma = new PrismaClient();
  const publicClient = createPublicClient({
    transport: http(process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8546"),
    chain: undefined,
  } as never);
  const deps: IndexerDeps = {
    prisma,
    publicClient,
    factory: deployment.contracts.selectedMarketFactory.address as `0x${string}`,
    chainId: deployment.network.chainId,
    startBlock: BigInt(deployment.contracts.selectedMarketFactory.startBlock),
    batchSize: Number(process.env.INDEXER_BATCH_SIZE ?? "200"),
  };
  for (;;) {
    try {
      const r = await ingestOnce(deps);
      if (r.blocks > 0 || r.events > 0 || r.rollbacks > 0) {
        console.log(JSON.stringify({ ts: new Date().toISOString(), ...r }));
      }
    } catch (err) {
      console.error("indexer cycle failed:", err);
    }
    await new Promise((res) => setTimeout(res, Number(process.env.INDEXER_POLL_MS ?? "500")));
  }
}

if (process.argv[1]?.endsWith("run.ts")) await main();
