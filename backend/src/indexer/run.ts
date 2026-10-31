// ORAKL P1 — indexer main loop. LOCAL Anvil ONLY (chainId 31337).
//
// Invariants:
//   1. Manifest gate: refuses to start unless deployments/local-selected.json is
//      LOCAL_SIMULATION for the configured chain id.
//   2. Chain identity gate: live eth_chainId must match the manifest, fail-closed.
//   3. Canonical-only store: blocks/logs above a detected fork are pruned, then
//      projections are rebuilt by deterministic replay of surviving raw events.
//   4. Read-only: this indexer never holds keys and never signs transactions.
//   5. Idempotent: every upsert key makes reprocessing safe (resume + restart).
import { createPublicClient, http, type Log } from "viem";

import { makePrisma, type PrismaDb } from "../db.js";
import { decodeLog } from "./events.js";
import { applyCanonical, toJsonSafe, type RawEvent } from "./project.js";
import { detectReorg, type Header } from "./reorg.js";
import { readDeploymentManifest, type DeploymentManifest } from "./manifest.js";

export type IndexerDeps = {
  prisma: PrismaDb;
  publicClient: ReturnType<typeof createPublicClient>;
  chainId: number;
  factory: `0x${string}`;
  configContract: `0x${string}`;
  startBlock: bigint;
  batchSize: number;
  confirmations: number;
  maxReorgDepth?: number;
};

export type IngestResult = {
  blocks: number;
  events: number;
  rollbacks: number;
  transactions: number;
};

async function fetchHeader(
  publicClient: ReturnType<typeof createPublicClient>,
  blockNumber: bigint,
): Promise<Header | null> {
  try {
    const b = await publicClient.getBlock({ blockNumber });
    return { blockNumber: b.number as bigint, blockHash: b.hash, parentHash: b.parentHash, timestamp: b.timestamp };
  } catch {
    return null;
  }
}

async function fetchHead(publicClient: ReturnType<typeof createPublicClient>): Promise<Header | null> {
  try {
    const b = await publicClient.getBlock();
    return { blockNumber: b.number as bigint, blockHash: b.hash, parentHash: b.parentHash, timestamp: b.timestamp };
  } catch {
    return null;
  }
}

/** Verify the deployment manifestRegister and the live chain identity. Fail closed. */
export async function verifyChainIdentity(
  publicClient: ReturnType<typeof createPublicClient>,
  manifest: DeploymentManifest,
  expectedChainId: number,
): Promise<void> {
  if (manifest.status !== "LOCAL_SIMULATION" || manifest.mode !== "local-selected") {
    throw new Error(
      `refusing to run: manifest is not LOCAL_SIMULATION/local-selected (${manifest.status}/${manifest.mode})`,
    );
  }
  if (manifest.network.chainId !== expectedChainId) {
    throw new Error(`refusing to run: manifest chainId ${manifest.network.chainId} != configured ${expectedChainId}`);
  }
  const liveChainId = await publicClient.getChainId();
  if (liveChainId !== expectedChainId) {
    throw new Error(`refusing to run: live chain id ${liveChainId} != expected ${expectedChainId}`);
  }
}

/** One bounded ingest cycle: reorg sweep + batched log ingestion + projections + checkpoint. */
export async function ingestOnce(deps: IndexerDeps): Promise<IngestResult> {
  const { prisma, chainId, factory, configContract } = deps;
  const publicClient = deps.publicClient!;

  // ---- 1. reorg sweep ------------------------------------------------------
  const verdict = await detectReorg(
    prisma,
    chainId,
    (n) => fetchHeader(publicClient, n),
    () => fetchHead(publicClient),
    deps.maxReorgDepth ?? 4096,
  );
  let rollbacks = 0;
  if (verdict.kind === "rollback") {
    await recoverFromFork(deps, verdict.toBlock - 1n);
    rollbacks = 1;
  }

  // ---- 2. fetch next batch -------------------------------------------------
  const checkpoint = await prisma.indexerCheckpoint.findUnique({ where: { chainId } });
  const fromBlock =
    checkpoint != null ? checkpoint.lastProcessedBlock + 1n : deps.startBlock;
  const head = await publicClient.getBlockNumber({ cacheTime: 0 });
  const safeHead = deps.confirmations > 0 ? head - BigInt(deps.confirmations) : head;
  if (fromBlock > safeHead) return { blocks: 0, events: 0, rollbacks, transactions: 0 };
  if (fromBlock < deps.startBlock) {
    // Checkpoint pre-dates the manifest start block: resume from startBlock.
    await prisma.indexerCheckpoint.update({
      where: { chainId },
      data: { lastProcessedBlock: deps.startBlock - 1n, lastProcessedBlockHash: "" },
    });
    return { blocks: 0, events: 0, rollbacks, transactions: 0 };
  }

  const batchEnd = fromBlock + BigInt(deps.batchSize) - 1n <= safeHead
    ? fromBlock + BigInt(deps.batchSize) - 1n
    : safeHead;

  const headers = new Map<bigint, Header>();
  for (let n = fromBlock; n <= batchEnd; n++) {
    const h = await fetchHeader(publicClient, n);
    if (h == null) throw new Error(`RPC did not deliver header ${n}`);
    headers.set(n, h);
  }

  const logs = await publicClient.getLogs({
    address: [factory, configContract],
    fromBlock,
    toBlock: batchEnd,
  });

  // ---- 3. ingest + project + checkpoint in one transaction -----------------
  let eventsStored = 0;
  const txHashes = new Set<string>();
  const kindsByTx = new Map<string, string>();
  const batchEvents: RawEvent[] = [];
  await prisma.$transaction(async (tx) => {
    for (const [n, h] of headers) {
      await tx.indexedBlock.upsert({
        where: { chainId_blockNumber: { chainId, blockNumber: n } },
        update: { blockHash: h.blockHash, parentHash: h.parentHash, timestamp: h.timestamp },
        create: {
          chainId, blockNumber: n, blockHash: h.blockHash,
          parentHash: h.parentHash, timestamp: h.timestamp,
        },
      });
    }
    for (const log of logs as Log[]) {
      const decoded = decodeLog(log);
      if (decoded == null) continue;
      const bn = (log.blockNumber ?? 0n) as bigint;
      const bh = (log.blockHash ?? "") as string;
      const header = headers.get(bn);
      if (header == null) continue; // log outside ingested batch — never project blindly
      if (header.blockHash !== bh) continue; // stale cross-check guard
      await tx.indexedEvent.upsert({
        where: {
          chainId_txHash_logIndex: {
            chainId, txHash: log.transactionHash as string, logIndex: Number(log.logIndex),
          },
        },
        update: {},
        create: {
          chainId,
          blockNumber: bn,
          blockHash: String(log.blockHash),
          txHash: log.transactionHash as string,
          logIndex: Number(log.logIndex),
          address: String(log.address).toLowerCase(),
          eventName: decoded.eventName,
          args: toJsonSafe(decoded.args) as never,
          timestamp: header.timestamp,
        },
      });
      batchEvents.push({
        chainId,
        blockNumber: bn,
        blockHash: String(log.blockHash),
        txHash: log.transactionHash as string,
        logIndex: Number(log.logIndex),
        timestamp: header.timestamp,
        eventName: decoded.eventName,
        args: decoded.args as never,
      } as RawEvent);
      if (log.transactionHash) txHashes.add(log.transactionHash);
      if (!kindsByTx.has(log.transactionHash as string)) kindsByTx.set(log.transactionHash as string, decoded.eventName);
      eventsStored += 1;
    }
    // Canonical fold AFTER the raw layer is stored: market creations lead the
    // pass so same-tx sibling events (e.g. the CREATION bond deposit emitted
    // before MarketCreated's log index) fold into complete ledgers.
    await applyCanonical(tx, batchEvents);
    await tx.indexerCheckpoint.upsert({
      where: { chainId },
      update: {
        lastProcessedBlock: batchEnd,
        lastProcessedBlockHash: headers.get(batchEnd)!.blockHash,
        eventsIndexed: { increment: BigInt(eventsStored) },
      },
      create: {
        chainId,
        contractAddress: factory,
        lastProcessedBlock: batchEnd,
        lastProcessedBlockHash: headers.get(batchEnd)!.blockHash,
        eventsIndexed: BigInt(eventsStored),
      },
    });
  }, { timeout: 60_000, maxWait: 10_000 });

  // ---- 4. receipt backfill for tx history (outside the projection tx) ------
  let transactions = 0;
  for (const txHash of txHashes) {
    const known = await prisma.transactionRecord.findUnique({ where: { txHash }, select: { id: true } });
    if (known) continue;
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
      const txData = await publicClient.getTransaction({ hash: txHash as `0x${string}` });
      await prisma.transactionRecord.create({
        data: {
          chainId,
          txHash,
          blockNumber: receipt.blockNumber,
          blockHash: receipt.blockHash,
          txIndex: receipt.transactionIndex,
          fromAddress: txData.from.toLowerCase(),
          toAddress: (txData.to ?? null)?.toLowerCase() ?? null,
          value: txData.value.toString(),
          gasUsed: receipt.gasUsed.toString(),
          status: Number(receipt.status ?? 0),
          kind: kindsByTx.get(txHash) ?? "unknown",
        },
      });
      transactions += 1;
    } catch {
      // Receipt may be missing transiently; the next cycle retries this tx.
    }
  }

  return { blocks: headers.size, events: eventsStored, rollbacks, transactions };
}

/**
 * Fork recovery: prune every raw row above keepBlock within one transaction,
 * then rebuild ALL projections by streaming the surviving canonical events
 * through the same fold used at ingest. Rollback audit rows survive this.
 */
export async function recoverFromFork(deps: IndexerDeps, keepBlock: bigint): Promise<number> {
  const { prisma, chainId } = deps;
  return prisma.$transaction(async (tx) => {
    const oldTip = await tx.indexedBlock.findFirst({
      where: { chainId },
      orderBy: { blockNumber: "desc" },
    });

    const removedEvents = await tx.indexedEvent.deleteMany({ where: { chainId, blockNumber: { gt: keepBlock } } });
    const removedBlocks = await tx.indexedBlock.deleteMany({ where: { chainId, blockNumber: { gt: keepBlock } } });

    // Deterministic projection reset: every derived row is folded from events.
    // Scope every wipe to this chain — never touch other chains' projections.
    await tx.protocolFeeAccrual.deleteMany({ where: { chainId } });
    await tx.accountingSnapshot.deleteMany({ where: { chainId } });
    await tx.market.deleteMany({ where: { chainId } }); // cascades the market-scoped projections

    const survivors = await tx.indexedEvent.findMany({
      where: { chainId },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
    });
    // Canonical fold (market creations lead the pass) of every surviving event.
    await applyCanonical(
      tx,
      survivors.map((e) => ({
        chainId: e.chainId,
        blockNumber: e.blockNumber,
        blockHash: e.blockHash,
        txHash: e.txHash,
        logIndex: e.logIndex,
        timestamp: e.timestamp,
        eventName: e.eventName,
        args: e.args as never,
      } as RawEvent)),
    );

    const tip = await tx.indexedBlock.findFirst({
      where: { chainId },
      orderBy: { blockNumber: "desc" },
    });
    if (tip != null) {
      await tx.indexerCheckpoint.update({
        where: { chainId },
        data: { lastProcessedBlock: tip.blockNumber, lastProcessedBlockHash: tip.blockHash },
      });
    } else {
      await tx.indexerCheckpoint.update({
        where: { chainId },
        data: { lastProcessedBlock: deps.startBlock - 1n, lastProcessedBlockHash: "" },
      });
    }
    await tx.indexerRollback.create({
      data: {
        chainId,
        fromBlock: keepBlock + 1n,
        toBlock: oldTip != null ? oldTip.blockNumber : keepBlock,
        reason: "ancestor mismatch (reorg detected)",
        removedBlocks: removedBlocks.count,
        removedEvents: removedEvents.count,
        replayedEvents: survivors.length,
      },
    });
    return 1;
  }, { timeout: 60_000, maxWait: 10_000 });
}

export async function main(): Promise<void> {
  const manifest = await readDeploymentManifest();
  if (!manifest.contracts.protocolConfig) {
    throw new Error("refusing to run: manifest is missing the protocolConfig contract identity");
  }
  const chainId = Number(process.env.LOCAL_CHAIN_ID ?? String(manifest.network.chainId));
  const prisma = makePrisma();
  const publicClient = createPublicClient({
    transport: http(process.env.LOCAL_RPC_URL ?? manifest.network.rpcUrl, { timeout: 10_000 }),
    chain: undefined,
  });
  await verifyChainIdentity(publicClient, manifest, chainId);
  // Registry bookkeeping for /api/v1/deployment (idempotent).
  void (async () => {
    try {
      await prisma.contractDeployment.upsert({
        where: {
          chainId_factoryAddress_manifestSha256: {
            chainId,
            factoryAddress: manifest.contracts.selectedMarketFactory.address.toLowerCase(),
            manifestSha256: manifest.release?.digest ?? "local",
          },
        },
        update: { updatedAt: new Date(), status: "LOCAL_SIMULATION" },
        create: {
          chainId,
          mode: manifest.mode,
          status: manifest.status,
          factoryAddress: manifest.contracts.selectedMarketFactory.address.toLowerCase(),
          protocolConfigAddress: manifest.contracts.protocolConfig.address.toLowerCase(),
          roleMockAddress: manifest.roleMocks?.arbitrator?.address ?? null,
          startBlock: BigInt(Math.min(manifest.contracts.selectedMarketFactory.startBlock, manifest.contracts.protocolConfig.startBlock)),
          manifestPath: process.env.DEPLOYMENT_MANIFEST ?? "deployments/local-selected.json",
          manifestSha256: manifest.release?.digest ?? "local",
          activated: Boolean(manifest.state?.financialActive),
        },
      });
    } catch (error) {
      console.error("deployment registry upsert failed:", error instanceof Error ? error.message : error);
    }
  })();
  const deps: IndexerDeps = {
    prisma,
    publicClient,
    chainId,
    factory: manifest.contracts.selectedMarketFactory.address as `0x${string}`,
    configContract: manifest.contracts.protocolConfig.address as `0x${string}`,
    startBlock: BigInt(
      Math.min(manifest.contracts.selectedMarketFactory.startBlock, manifest.contracts.protocolConfig.startBlock),
    ),
    batchSize: Math.max(1, Number(process.env.INDEXER_BATCH_SIZE ?? "200")),
    confirmations: Math.max(0, Number(process.env.INDEXER_CONFIRMATIONS ?? "0")),
  };
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      msg: "indexer started",
      chainId,
      factory: manifest.contracts.selectedMarketFactory.address,
      contractsConfig: manifest.contracts.protocolConfig.address,
      startBlock: manifest.contracts.selectedMarketFactory.startBlock,
    }),
  );
  let stopping = false;
  for (const signal of ["SIGINT" as const, "SIGTERM" as const]) {
    process.on(signal, () => {
      stopping = true;
    });
  }
  while (!stopping) {
    try {
      const r = await ingestOnce(deps);
      if (r.blocks > 0 || r.events > 0 || r.rollbacks > 0 || r.transactions > 0) {
        console.log(JSON.stringify({ ts: new Date().toISOString(), ...r }));
      }
    } catch (err) {
      console.error("indexer cycle failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((res) => setTimeout(res, Math.max(100, Number(process.env.INDEXER_POLL_MS ?? "500"))));
  }
  await prisma.$disconnect();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
