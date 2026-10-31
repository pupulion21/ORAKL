// ORAKL P1 — Fastify API for the local backend. Binds 127.0.0.1 only.
//
// LOCAL SIMULATION ONLY. This service is a read-only projection of the
// isolated Anvil chain (chainId 31337) plus bounded, explicitly signed local
// discovery stores for evidence and market metadata. It never exposes private
// keys, never signs financial transactions, never custodies funds and never
// settles markets. Financial writes always route through the user's wallet
// directly to the verified contracts.
//
// Versioned API surface (spec §20):
//   GET  /api/v1/health
//   GET  /api/v1/network
//   GET  /api/v1/deployment
//   GET  /api/v1/indexer/status
//   GET  /api/v1/markets
//   GET  /api/v1/markets/:id
//   GET  /api/v1/markets/:id/activity
//   GET  /api/v1/markets/:id/challenges
//   GET  /api/v1/markets/:id/evidence
//   GET  /api/v1/markets/:id/settlement
//   GET  /api/v1/markets/:id/metadata
//   GET  /api/v1/evidence/:commitment
//   GET  /api/v1/metadata/:commitment
//   GET  /api/v1/portfolio/:address
//   GET  /api/v1/transactions/:hash
//   GET  /api/v1/exposure
//   POST /api/v1/evidence            (signed artifact publication, rate limited)
//   POST /api/v1/markets/metadata    (signed metadata publication, rate limited)
//
// Response shapes: success = { simulationOnly: true, data };
// error = { error: { code, message }, statusCode }. All uint256 values are
// serialized as exact base-10 strings — never JS floating point.
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";

import FastifyFactory, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { verifyMessage, keccak256, stringToBytes, stringToBytes as strToBytes, createPublicClient, http } from "viem";
import type { PrismaClient } from "@prisma/client";

import { loadConfig, type BackendConfig } from "../config.js";
import { serialize, sanitizeText, redactSecrets, HttpError, parsePagination, requireBigintParam, requireAddressParam } from "../lib/format.js";
import { parseStrictJson } from "../evidence/strict-json.js";
import {
  EVIDENCE_KINDS,
  validateEvidenceManifest,
  canonicalizeEvidence,
  evidenceCommitment,
  evidenceContentHash,
  type EvidenceManifest,
} from "../evidence/evidence.js";

export type SyncStatus = "SYNCHRONIZED" | "LAGGING" | "UNAVAILABLE";

export type SyncMetadata = {
  lastProcessedBlock: string | null;
  lastProcessedBlockHash: string | null;
  chainId: number;
  status: SyncStatus;
  updatedAt: string | null;
  referenceHead?: string | null;
  lag?: string | null;
};

export type ApiDeps = {
  prisma: PrismaClient;
  config?: BackendConfig;
  getReferenceHead?: () => Promise<bigint | null>;
};

export async function getSyncMetadata(
  prisma: PrismaClient,
  chainId: number,
  getReferenceHead?: () => Promise<bigint | null>,
): Promise<SyncMetadata> {
  const checkpoint = await prisma.indexerCheckpoint.findUnique({
    where: { chainId },
  });
  if (checkpoint == null) {
    return {
      lastProcessedBlock: null,
      lastProcessedBlockHash: null,
      chainId,
      status: "UNAVAILABLE",
      updatedAt: null,
      referenceHead: null,
      lag: null,
    };
  }

  let hashMismatch = false;
  if (checkpoint.lastProcessedBlock > 0n && checkpoint.lastProcessedBlockHash) {
    const storedBlock = await prisma.indexedBlock.findUnique({
      where: { chainId_blockNumber: { chainId, blockNumber: checkpoint.lastProcessedBlock } },
      select: { blockHash: true },
    });
    if (storedBlock != null && storedBlock.blockHash.toLowerCase() !== checkpoint.lastProcessedBlockHash.toLowerCase()) {
      hashMismatch = true;
    }
  }

  let referenceHead: bigint | null = null;
  if (getReferenceHead != null) {
    try {
      referenceHead = await getReferenceHead();
    } catch {
      referenceHead = null;
    }
  }

  const lastBlock = checkpoint.lastProcessedBlock;
  let status: SyncStatus = "LAGGING";
  let lag: string | null = null;

  if (hashMismatch) {
    status = "LAGGING";
  } else if (referenceHead != null) {
    const diff = referenceHead - lastBlock;
    lag = diff.toString();
    if (diff <= 5n && diff >= 0n) {
      status = "SYNCHRONIZED";
    } else {
      status = "LAGGING";
    }
  } else {
    // Phase B requirement 5: Do not label as fully synchronized without a verified reference head.
    status = "LAGGING";
  }

  return {
    lastProcessedBlock: lastBlock.toString(),
    lastProcessedBlockHash: checkpoint.lastProcessedBlockHash,
    chainId,
    status,
    updatedAt: checkpoint.updatedAt.toISOString(),
    referenceHead: referenceHead != null ? referenceHead.toString() : null,
    lag,
  };
}

export const MANIFEST_DIR = "deployments";
const VITE_PROXY_PORT = Number(process.env.VITE_PROXY_PORT ?? "4310");
const EVIDENCE_HASH_KEY_EVENTS = ["MarketOutcomeProposed", "MarketChallenged", "DisputeEvidenceSubmitted", "DisputeSettled"];

export type { FastifyReply, FastifyRequest as ApiRequest };

// ----------------------------------------------------------- small helpers

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function rateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  namespace: string,
  limit: number,
  windowMs: number,
): void {
  const ip = request.ip || "unknown";
  const key = `${namespace}:${ip}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (bucket == null || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.count >= limit) {
    throw new HttpError(429, "RATE_LIMITED", `too many publications, retry after ${Math.ceil((bucket.resetAt - now) / 1000)}s`);
  }
  bucket.count += 1;
  if (buckets.size > 1000) for (const [k, b] of buckets) if (b.resetAt <= Date.now()) buckets.delete(k);
}

const ok = (data: unknown, sync?: SyncMetadata | null) => ({
  simulationOnly: true,
  ...(sync != null ? { sync } : {}),
  data: serialize(data),
});

function requireHashParam(value: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new HttpError(400, "INVALID_PARAM", "commitment must be a 0x-prefixed 64 hex character hash");
  }
  return value.toLowerCase();
}

function requireTxHashParam(value: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new HttpError(400, "INVALID_PARAM", "txHash must be a 0x-prefixed 64 hex character hash");
  }
  return value.toLowerCase();
}

/** Reject JSON that carries duplicate keys or numbers (the evidence profile). */
function parseManifestPayload(raw: unknown, field: string): unknown {
  const parsed = typeof raw === "string" ? parseStrictJson(raw) : raw;
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "INVALID_MANIFEST", `${field} must be a JSON object without duplicate keys or numbers`);
  }
  return parsed;
}

async function verifyArtifactSignature(
  message: string,
  signature: unknown,
  publisher: string,
): Promise<void> {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new HttpError(401, "INVALID_SIGNATURE", "signature must be a 0x-prefixed EIP-191 hex signature");
  }
  let valid = false;
  try {
    valid = await verifyMessage({ address: publisher as `0x${string}`, message, signature: signature as `0x${string}` });
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new HttpError(401, "INVALID_SIGNATURE", `signature does not verify for the declared publisher (${publisher})`);
  }
}

const artifactMessage = (schema: string, commitment: string, publisher: string): string =>
  `ORAKL LOCAL ARTIFACT\nschema: ${schema}\ncommitment: ${commitment}\npublisher: ${publisher}`;

// ------------------------------------------------- market metadata profile v1

const METADATA_SCHEMA = "orakl-market-metadata-v1";
const METADATA_MAX_BYTES = 16 * 1024;
const SENDER_URI_SCHEMES = ["ipfs://", "https://", "http://", "ar://"] as const;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const TEXT_CONTROL_RE = /[\u0000-\u0008\u000e-\u001f\u007f]/;

type MetadataManifest = {
  schema: string;
  chainId: string;
  factory: string;
  question: string;
  description: string;
  category: string;
  resolutionCriteria: string;
  sources: string[];
  creator: string;
  createdAt: string;
};

const METADATA_FIELDS = [
  "schema",
  "chainId",
  "factory",
  "question",
  "description",
  "category",
  "resolutionCriteria",
  "sources",
  "creator",
  "createdAt",
] as const;

function validateMetadataManifest(input: unknown): { ok: boolean; errors: string[]; value?: MetadataManifest } {
  const errors: string[] = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["metadata must be a JSON object"] };
  }
  const v = input as Record<string, unknown>;
  for (const f of METADATA_FIELDS) if (!(f in v)) errors.push(`missing required field: ${f}`);
  for (const key of Object.keys(v)) if (!(METADATA_FIELDS as readonly string[]).includes(key)) errors.push(`unknown field: ${key}`);
  if (errors.length > 0) return { ok: false, errors };

  const errFor = (m: string) => errors.push(m);
  if (v.schema !== METADATA_SCHEMA) errFor(`schema must be "${METADATA_SCHEMA}"`);
  if (typeof v.chainId !== "string" || !/^(0|[1-9]\d*)$/.test(v.chainId)) errFor("chainId must be a uint string");
  if (typeof v.factory !== "string" || !/^0x[0-9a-f]{40}$/.test(v.factory)) errFor("factory must be a lowercase 0x address");
  if (typeof v.creator !== "string" || !/^0x[0-9a-f]{40}$/.test(v.creator)) errFor("creator must be a lowercase 0x address");
  if (typeof v.createdAt !== "string" || !/^(0|[1-9]\d*)$/.test(v.createdAt)) errFor("createdAt must be a uint string seconds");
  for (const [field, min, max] of [
    ["question", 1, 256],
    ["description", 1, 4000],
    ["category", 1, 32],
    ["resolutionCriteria", 1, 4000],
  ] as const) {
    const value = v[field];
    if (typeof value !== "string" || value.length < min || value.length > max || TEXT_CONTROL_RE.test(value)) {
      errFor(`${field} must be a string of ${min}..${max} printable characters`);
    }
  }
  if (typeof v.category === "string" && !SLUG_RE.test(v.category)) errFor("category must be a slug like 'crypto'");
  if (!Array.isArray(v.sources) || v.sources.length > 16 || v.sources.some((s) => typeof s !== "string" || s.length > 512 || (s.length > 0 && !SENDER_URI_SCHEMES.some((p) => s.startsWith(p))))) {
    errFor(`sources must be up to 16 strings starting with ${SENDER_URI_SCHEMES.join(", ")}`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors,
    value: {
      schema: METADATA_SCHEMA,
      chainId: v.chainId as string,
      factory: (v.factory as string).toLowerCase(),
      question: v.question as string,
      description: v.description as string,
      category: v.category as string,
      resolutionCriteria: v.resolutionCriteria as string,
      sources: v.sources as string[],
      creator: (v.creator as string).toLowerCase(),
      createdAt: v.createdAt as string,
    },
  };
}

// JCS canonicalization for the metadata profile mirrors the evidence module.
function jcsString(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === '"') out += '\\"';
    else if (char === "\\") out += "\\\\";
    else if (code === 0x08) out += "\\b";
    else if (code === 0x09) out += "\\t";
    else if (code === 0x0a) out += "\\n";
    else if (code === 0x0c) out += "\\f";
    else if (code === 0x0d) out += "\\r";
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += char;
  }
  return `${out}"`;
}

function sortKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
      const diff = a.charCodeAt(i) - b.charCodeAt(i);
      if (diff !== 0) return diff;
    }
    return a.length - b.length;
  });
}

function jcsValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return jcsString(value);
  if (Array.isArray(value)) return `[${value.map(jcsValue).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${sortKeys(record).map((key) => `${jcsString(key)}:${jcsValue(record[key])}`).join(",")}}`;
  }
  throw new Error("metadata profile v1 does not allow JSON numbers");
}

function canonicalizeMetadata(manifest: MetadataManifest): Uint8Array {
  const validation = validateMetadataManifest(manifest);
  if (!validation.ok || validation.value == null) {
    throw new HttpError(400, "INVALID_METADATA", `invalid metadata manifest: ${validation.errors.join("; ")}`);
  }
  return stringToBytes(jcsValue(validation.value));
}

// ------------------------------------------------------------------ server
export async function buildServer(deps: ApiDeps): Promise<FastifyInstance> {
  const config = deps.config ?? loadConfig();
  const app = FastifyFactory({
    logger: false,
    trustProxy: false,
    bodyLimit: 256 * 1024,
    requestIdHeader: false,
    genReqId: (req) => {
      const raw = req.headers["x-request-id"] || req.headers["request-id"];
      const id = Array.isArray(raw) ? raw[0] : raw;
      if (typeof id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
        return id;
      }
      return `req-${Math.random().toString(36).slice(2, 10)}`;
    },
  });

  const sendError = (
    reply: FastifyReply,
    status: number,
    code: string,
    message: string,
    requestId: string,
  ) => {
    reply.header("x-request-id", requestId);
    return reply.code(status).send({
      error: message,
      code,
      statusCode: status,
      requestId,
    });
  };

  let getReferenceHead = deps.getReferenceHead;
  if (!getReferenceHead && config.rpcUrl) {
    let cachedHead: { value: bigint; timestamp: number } | null = null;
    const client = createPublicClient({
      transport: http(config.rpcUrl, { timeout: 2000 }),
    });
    getReferenceHead = async () => {
      const now = Date.now();
      if (cachedHead != null && (now - cachedHead.timestamp) < 1000) {
        return cachedHead.value;
      }
      try {
        const head = await client.getBlockNumber({ cacheTime: 0 });
        cachedHead = { value: head, timestamp: now };
        return head;
      } catch {
        return null;
      }
    };
  }

  const fetchSync = () => getSyncMetadata(deps.prisma, config.chainId, getReferenceHead);

  // Centralized error handler enforcing ADR-0012.
  app.setErrorHandler((err, request, reply) => {
    const reqId = request.id || `req-${Math.random().toString(36).slice(2, 10)}`;

    // Known HttpError explicitly thrown by application domain logic
    if (err instanceof HttpError) {
      const safeMessage = sanitizeText(redactSecrets(err.message), 400) || "request failed";
      return sendError(reply, err.status, err.code, safeMessage, reqId);
    }

    const typed = err as { statusCode?: number; message?: string; validation?: unknown; code?: string };

    // Fastify payload size limit exceeded (413)
    if (typed.statusCode === 413 || typed.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return sendError(reply, 413, "PAYLOAD_TOO_LARGE", "request payload exceeds the 256KB limit", reqId);
    }

    // Fastify JSON syntax / body parse error (400)
    if (err instanceof SyntaxError || typed.statusCode === 400 || typed.validation != null) {
      return sendError(reply, 400, "INVALID_PAYLOAD", "malformed request payload", reqId);
    }

    // Route not found (404)
    if (typed.statusCode === 404) {
      return sendError(reply, 404, "NOT_FOUND", "resource not found", reqId);
    }

    // Origin forbidden (403)
    if (typed.statusCode === 403) {
      return sendError(reply, 403, "ORIGIN_FORBIDDEN", "origin not allowed", reqId);
    }

    // Rate limited (429)
    if (typed.statusCode === 429) {
      return sendError(reply, 429, "RATE_LIMITED", "rate limit exceeded", reqId);
    }

    // Unhandled / database / RPC exceptions: status 500 INTERNAL_ERROR.
    // Suppress internal stack traces, DB strings, SQL and secrets from client responses.
    const errStack = err instanceof Error ? err.stack : undefined;
    const errMessage = err instanceof Error ? err.message : String(err);
    console.error(`[API ERROR ${reqId}] ${request.method} ${request.url}:`, redactSecrets(errStack ?? errMessage));
    return sendError(reply, 500, "INTERNAL_ERROR", "an internal server error occurred", reqId);
  });

  app.setNotFoundHandler((request, reply) => {
    const reqId = request.id || `req-${Math.random().toString(36).slice(2, 10)}`;
    return sendError(reply, 404, "NOT_FOUND", `no route: ${request.method} ${request.url}`, reqId);
  });

  // Attach x-request-id header to every response
  app.addHook("onSend", (request, reply, payload, done) => {
    reply.header("x-request-id", request.id);
    done();
  });

  // Restricted CORS: configured local origins only, no wildcard ever.
  app.addHook("onRequest", (request, reply, done) => {
    const reqId = request.id || `req-${Math.random().toString(36).slice(2, 10)}`;
    const headerChain = request.headers["x-chain-id"];
    if (headerChain != null) {
      const parsed = Number(headerChain);
      if (!Number.isInteger(parsed) || parsed !== config.chainId) {
        sendError(reply, 400, "WRONG_CHAIN", `chain id ${headerChain} does not match configured chain ${config.chainId}`, reqId);
        return;
      }
    }

    const origin = request.headers.origin;
    if (origin != null) {
      if (config.allowedOrigins.includes(origin)) {
        reply.header("Access-Control-Allow-Origin", origin);
        reply.header("Vary", "Origin");
      } else if (request.method !== "GET" && request.method !== "OPTIONS") {
        sendError(reply, 403, "ORIGIN_FORBIDDEN", "origin not allowed", reqId);
        return;
      }
    }
    if (request.method === "OPTIONS") {
      reply
        .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        .header("Access-Control-Allow-Headers", "content-type, x-chain-id, x-request-id")
        .header("Access-Control-Max-Age", "600")
        .code(204)
        .send();
      return;
    }
    done();
  });

  // ------------------------------------------------------- read-only routes

  app.get("/api/v1/health", async () => {
    let dbUp = false;
    try {
      await deps.prisma.$queryRaw`SELECT 1`;
      dbUp = true;
    } catch {
      dbUp = false;
    }
    return ok({
      service: "orakl-p1-backend",
      mode: "local-selected",
      simulationOnly: true,
      chainId: config.chainId,
      database: dbUp ? "up" : "down",
    });
  });

  app.get("/api/v1/network", async () => {
    const manifest = await readManifestSafe();
    return ok({
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
      mode: "local-selected",
      simulationOnly: true,
      name: manifest?.network?.name ?? "ORAKL Local Selected (Anvil)",
      nativeSymbol: manifest?.network?.nativeSymbol ?? "ETH",
      isQieNetwork: false,
      note: "development-only loopback chain; not QIE Testnet/Mainnet",
    });
  });

  app.get("/api/v1/deployment", async () => {
    const manifest = await readManifestSafe();
    const verification = await readVerificationSafe();
    const latestRow = await deps.prisma.contractDeployment.findFirst({ orderBy: { createdAt: "desc" } });
    return ok({
      manifestPath: manifest == null ? null : manifest._file,
      status: manifest?.status ?? null,
      mode: manifest?.mode ?? null,
      chainId: manifest?.network?.chainId ?? null,
      factory: manifest?.contracts?.selectedMarketFactory?.address ?? null,
      protocolConfig: manifest?.contracts?.protocolConfig?.address ?? null,
      startBlock: manifest?.contracts?.selectedMarketFactory?.startBlock ?? null,
      release: manifest?.release ?? null,
      roleMocks: manifest?.roleMocks ?? null,
      parameters: manifest?.parameters ?? null,
      safety: manifest?.safety ?? null,
      verification: verification?.checksList ? { allPassed: verification.allPassed, checks: verification.checksList } : null,
      dbRecord: latestRow
        ? {
            mode: latestRow.mode,
            status: latestRow.status,
            factoryAddress: latestRow.factoryAddress,
            protocolConfigAddress: latestRow.protocolConfigAddress,
            activated: latestRow.activated,
            manifestSha256: latestRow.manifestSha256,
          }
        : null,
    });
  });

  app.get("/api/v1/indexer/status", async () => {
    const chainId = config.chainId;
    const sync = await fetchSync();
    const [checkpoint, blockCount, eventCount, latestEvents, rollbacks, latestBlock] = await Promise.all([
      deps.prisma.indexerCheckpoint.findUnique({ where: { chainId } }),
      deps.prisma.indexedBlock.count({ where: { chainId } }),
      deps.prisma.indexedEvent.count({ where: { chainId } }),
      deps.prisma.indexedEvent
        .groupBy({ by: ["eventName"], where: { chainId }, _count: { _all: true }, orderBy: { eventName: "asc" }, take: 16 }),
      deps.prisma.indexerRollback.findMany({ where: { chainId }, orderBy: { detectedAt: "desc" }, take: 5 }),
      deps.prisma.indexedBlock.findFirst({ where: { chainId }, orderBy: { blockNumber: "desc" } }),
    ]);
    return ok({
      chainId,
      canonicalOnly: true,
      pendingMemPoolTrigger: false,
      checkpoint: checkpoint
        ? {
            lastProcessedBlock: checkpoint.lastProcessedBlock,
            lastProcessedBlockHash: checkpoint.lastProcessedBlockHash,
            eventsIndexed: checkpoint.eventsIndexed,
            updatedAt: checkpoint.updatedAt,
          }
        : null,
      blocksIndexed: blockCount,
      eventsIndexed: eventCount,
      eventsByName: latestEvents,
      latestCanonicalBlock: latestBlock ? { blockNumber: latestBlock.blockNumber, blockHash: latestBlock.blockHash, timestamp: latestBlock.timestamp } : null,
      rollbacks: rollbacks.map((r) => ({
        fromBlock: r.fromBlock,
        toBlock: r.toBlock,
        reason: r.reason,
        removedBlocks: r.removedBlocks,
        removedEvents: r.removedEvents,
        replayedEvents: r.replayedEvents,
        detectedAt: r.detectedAt,
      })),
    }, sync);
  });

  app.get("/api/v1/markets", async (request, reply) => {
    const sync = await fetchSync();
    const query = request.query as Record<string, string | undefined>;
    const { page, pageSize, skip, take } = parsePagination(new URLSearchParams(query as Record<string, string>));

    const statusList = ["OPEN", "CLOSED", "PROPOSED", "DISPUTED", "FINALIZED", "CANCELLED"] as const;
    const where: Record<string, unknown> = {};
    if (query.status != null && query.status.length > 0) {
      const needed = query.status.split(",").map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0);
      const bad = needed.filter((s) => !(statusList as readonly string[]).includes(s));
      if (bad.length > 0) throw new HttpError(400, "INVALID_PARAM", `unknown status: ${bad.join(",")}`);
      where.status = needed.length === 1 ? needed[0] : { in: needed };
    }
    if (query.category != null && query.category !== "") {
      const bySlug = await deps.prisma.category.findUnique({ where: { slug: query.category }, select: { id: true } });
      if (bySlug == null) {
        throw new HttpError(404, "INVALID_PARAM", `unknown category: ${query.category}`);
      }
      where.categoryId = bySlug.id;
    }
    if (query.q != null && query.q.trim() !== "") {
      const needle = sanitizeText(query.q, 128).replace(/[%_\\]/g, "\\$&");
      where.OR = [
        { question: { contains: needle, mode: "insensitive" } },
        { description: { contains: needle, mode: "insensitive" } },
        { metadataURI: { contains: needle, mode: "insensitive" } },
      ];
    }
    const sortField = query.sort === "closeTime" || query.sort === "id" ? query.sort : "createdAtBlock";
    const order = query.order === "asc" ? "asc" : "desc";
    const idKey = sortField === "id" ? "onchainMarketId" : sortField === "closeTime" ? "closeTime" : "createdAtBlock";

    const [rows, total] = await Promise.all([
      deps.prisma.market.findMany({ where, orderBy: { [idKey]: order }, skip, take }),
      deps.prisma.market.count({ where }),
    ]);
    const withMeta = await attachMetadata(deps.prisma, rows);
    const pools = await poolTotals(deps.prisma, rows.map((m) => m.onchainMarketId));
    return ok({
      page,
      pageSize,
      total,
      items: rows.map((m) => marketListItem(m, withMeta.get(m.onchainMarketId.toString()), pools.get(m.onchainMarketId.toString()))),
    }, sync);
  });

  app.get("/api/v1/markets/:id/activity", async (request) => {
    const sync = await fetchSync();
    const { id } = request.params as { id: string };
    const market = await deps.prisma.market.findUnique({ where: { onchainMarketId: requireBigintParam(id, "marketId") } });
    if (market == null) throw new HttpError(404, "NOT_FOUND", "market not indexed");
    const { page, pageSize, skip, take } = parsePagination(new URLSearchParams(request.query as Record<string, string>));
    const [rows, total] = await Promise.all([
      deps.prisma.marketActivity.findMany({
        where: { marketId: market.id },
        orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
        skip, take,
      }),
      deps.prisma.marketActivity.count({ where: { marketId: market.id } }),
    ]);
    return ok({ page, pageSize, total, items: rows }, sync);
  });

  app.get("/api/v1/markets/:id/challenges", async (request) => {
    const sync = await fetchSync();
    const { id } = request.params as { id: string };
    const market = await deps.prisma.market.findUnique({
      where: { onchainMarketId: requireBigintParam(id, "marketId") },
      include: { settlement: true },
    });
    if (market == null) throw new HttpError(404, "NOT_FOUND", "market not indexed");
    const stakes = await deps.prisma.challengeStake.findMany({
      where: { marketId: market.id },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
    });
    return ok({
      totalChallengeStake: market.totalChallengeStake,
      disposition: market.settlement?.disposition ?? null,
      refundable: market.refundable,
      stakes, // ordered tranche list; one per address (contract enforces)
    }, sync);
  });

  app.get("/api/v1/markets/:id/evidence", async (request) => {
    const sync = await fetchSync();
    const { id } = request.params as { id: string };
    const market = await deps.prisma.market.findUnique({ where: { onchainMarketId: requireBigintParam(id, "marketId") } });
    if (market == null) throw new HttpError(404, "NOT_FOUND", "market not indexed");
    const records = await deps.prisma.evidenceRecord.findMany({
      where: { marketId: market.id },
      orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
      include: { evidenceVerifications: { orderBy: { observedAt: "desc" }, take: 1 } },
    });
    // Local artifacts published for this market (discovery channel).
    const artifacts = await deps.prisma.evidenceArtifact.findMany({
      where: { chainId: market.chainId, marketOnchainId: market.onchainMarketId.toString() },
      orderBy: { createdAt: "asc" },
    });
    return ok({
      marketId: market.onchainMarketId,
      onChainEvents: records.map((r) => ({
        publisher: r.publisher,
        evidenceHash: r.evidenceHash,
        kind: r.kind,
        txHash: r.txHash,
        logIndex: r.logIndex,
        blockNumber: r.blockNumber,
        verification: r.evidenceVerifications[0]
          ? { availabilityStatus: r.evidenceVerifications[0].availabilityStatus, verificationStatus: r.evidenceVerifications[0].verificationStatus }
          : null,
      })),
      artifacts: artifacts.map((a) => ({
        commitment: a.commitment,
        contentKeccak: a.contentKeccak,
        contentSize: a.contentSize,
        publishedBy: a.publishedBy,
        hasContent: a.contentBytes.length > 0,
        createdAt: a.createdAt,
      })),
      note: "an evidenceHash alone does not prove availability; verification below reflects the local discovery channel only",
    }, sync);
  });

  app.get("/api/v1/markets/:id/settlement", async (request) => {
    const sync = await fetchSync();
    const { id } = request.params as { id: string };
    const market = await deps.prisma.market.findUnique({
      where: { onchainMarketId: requireBigintParam(id, "marketId") },
      include: { settlement: true, exposureReleases: true, feeAccruals: true },
    });
    if (market == null) throw new HttpError(404, "NOT_FOUND", "market not indexed");
    return ok({
      marketId: market.onchainMarketId,
      status: market.status,
      finalOutcome: market.finalOutcome,
      refundable: market.refundable,
      totalChallengeStake: market.totalChallengeStake,
      settlement: market.settlement,
      exposureReleases: market.exposureReleases,
      feeAccruals: market.feeAccruals,
    }, sync);
  });

  app.get("/api/v1/markets/:id/metadata", async (request) => {
    const sync = await fetchSync();
    const { id } = request.params as { id: string };
    const market = await deps.prisma.market.findUnique({
      where: { onchainMarketId: requireBigintParam(id, "marketId") },
      select: { onchainMarketId: true, metadataHash: true, metadataURI: true, chainId: true },
    });
    if (market == null) throw new HttpError(404, "NOT_FOUND", "market not indexed");
    const artifact = await deps.prisma.marketMetadata.findUnique({
      where: { commitment: market.metadataHash.toLowerCase() },
    });
    return ok({
      marketId: market.onchainMarketId,
      metadataHash: market.metadataHash,
      metadataURI: market.metadataURI,
      artifact,
    }, sync);
  });

  app.get("/api/v1/markets/:id", async (request) => {
    const sync = await fetchSync();
    const { id } = request.params as { id: string };
    const market = await deps.prisma.market.findUnique({
      where: { onchainMarketId: requireBigintParam(id, "marketId") },
      include: {
        settlement: true,
        positions: true,
        contributions: true,
        challengeStakes: true,
        resolutions: true,
      },
    });
    if (market == null) throw new HttpError(404, "NOT_FOUND", "market not indexed");
    const withMeta = await attachMetadata(deps.prisma, [market]);
    const pools = await poolTotals(deps.prisma, [market.onchainMarketId]);
    const claims = await deps.prisma.claim.groupBy({
      by: ["claimType"],
      where: { marketId: market.id },
      _count: { _all: true },
    });
    const resolution = market.resolutions[0] ?? null;
    return ok({
      ...(marketListItem(
        market,
        withMeta.get(market.onchainMarketId.toString()),
        pools.get(market.onchainMarketId.toString()),
      ) as Record<string, unknown>),
      resolution,
      positions: market.positions,
      contributions: market.contributions,
      challengeStakes: market.challengeStakes,
      settlement: market.settlement,
      claimsByType: claims,
    }, sync);
  });

  app.get("/api/v1/portfolio/:address", async (request) => {
    const sync = await fetchSync();
    const address = requireAddressParam((request.params as { address: string }).address);
    const [positions, stakes, bonds, claimsGroup] = await Promise.all([
      deps.prisma.marketPosition.findMany({
        where: { walletAddress: address },
        include: { market: { select: { onchainMarketId: true, status: true, finalOutcome: true, refundable: true, closeTime: true } } },
      }),
      deps.prisma.challengeStake.findMany({
        where: { walletAddress: address },
        include: { market: { select: { onchainMarketId: true, status: true, finalOutcome: true, settlement: { select: { disposition: true } } } } },
      }),
      deps.prisma.bond.findMany({
        where: { walletAddress: address },
        include: { market: { select: { onchainMarketId: true, status: true, finalOutcome: true, settlement: { select: { disposition: true } } } } },
      }),
      deps.prisma.claim.groupBy({ by: ["claimType"], where: { walletAddress: address }, _count: { _all: true } }),
    ]);
    // Unresolved projection risk: not terminal => capital still committed.
    const openRisk = positions
      .filter((p) => p.market.status === "OPEN" || p.market.status === "CLOSED" || p.market.status === "PROPOSED" || p.market.status === "DISPUTED")
      .reduce((acc, p) => acc + BigInt(p.yesContribution.toString()) + BigInt(p.noContribution.toString()), 0n);
    const totalClaimed = positions.reduce((acc, p) => acc + BigInt(p.claimedAmount.toString()) + BigInt(p.refundedAmount.toString()), 0n);
    const txs = await deps.prisma.transactionRecord.findMany({
      where: { fromAddress: address },
      orderBy: { blockNumber: "desc" },
      take: 50,
    });
    return ok({
      address,
      projectionOnly: true,
      note: "values are indexer projections; the final authority is the verified contract's read set",
      openRisk,
      totalClaimed,
      totals: {
        positions: positions.length,
        challengeStakes: stakes.length,
        bonds: bonds.length,
      },
      positions,
      challengeStakes: stakes,
      bonds,
      claimsByType: claimsGroup,
      recentTransactions: txs,
    }, sync);
  });

  app.get("/api/v1/transactions/:hash", async (request) => {
    const sync = await fetchSync();
    const txHash = requireTxHashParam((request.params as { hash: string }).hash);
    const record = await deps.prisma.transactionRecord.findUnique({ where: { txHash } });
    if (record == null) throw new HttpError(404, "NOT_FOUND", "transaction not indexed");
    const events = await deps.prisma.indexedEvent.findMany({
      where: { txHash, chainId: record.chainId },
      orderBy: { logIndex: "asc" },
    });
    return ok({ record, events, canonicalOnly: true }, sync);
  });

  app.get("/api/v1/exposure", async () => {
    const sync = await fetchSync();
    const chainId = config.chainId;
    const latest = await deps.prisma.accountingSnapshot.findFirst({ orderBy: { blockNumber: "desc" } });
    const feeAccrued = await deps.prisma.protocolFeeAccrual.aggregate({ _sum: { amount: true }, where: { chainId, kind: "accrued" } });
    const feeWithdrawn = await deps.prisma.protocolFeeAccrual.aggregate({ _sum: { amount: true }, where: { chainId, kind: "withdrawn" } });
    const exposure = await deps.prisma.exposureSnapshot.aggregate({ _sum: { amount: true }, where: { chainId } });
    return ok({
      projectionOnly: true,
      note: "caps live on-chain; the frontend reconciles cap usage via verified contract reads",
      latestAccountingSnapshot: latest,
      feeAccrued: feeAccrued._sum.amount,
      feeWithdrawn: feeWithdrawn._sum.amount,
      exposureReleasedSum: exposure._sum.amount,
    }, sync);
  });

  app.get("/api/v1/metadata/:commitment", async (request) => {
    const commitment = requireHashParam((request.params as { commitment: string }).commitment);
    const artifact = await deps.prisma.marketMetadata.findUnique({ where: { commitment } });
    if (artifact == null) throw new HttpError(404, "NOT_FOUND", "metadata artifact not found");
    return ok(artifact);
  });

  app.get("/api/v1/evidence/:commitment", async (request) => {
    const commitment = requireHashParam((request.params as { commitment: string }).commitment);
    const artifact = await deps.prisma.evidenceArtifact.findUnique({ where: { commitment } });
    if (artifact == null) throw new HttpError(404, "NOT_FOUND", "evidence artifact not found");
    return ok({
      commitment: artifact.commitment,
      manifestBytes: Buffer.from(artifact.manifestBytes as Uint8Array).toString("utf8"),
      contentBytes: artifact.contentSize > 0 ? Buffer.from(artifact.contentBytes as Uint8Array).toString("base64") : null,
      contentSize: artifact.contentSize,
      contentKeccak: artifact.contentKeccak,
      publishedBy: artifact.publishedBy,
      marketOnchainId: artifact.marketOnchainId,
      linkedEventTx: artifact.linkedEventTx,
      externalPinning: "UNVERIFIED",
      createdAt: artifact.createdAt,
    });
  });

  // ---------------------------------------------------------- write-ish routes

  app.post("/api/v1/evidence", async (request, reply) => {
    rateLimit(request, reply, "artifact", config.evidencePublishPerWindow, config.evidencePublishWindowMs);
    const body = request.body as { manifest?: unknown; signature?: unknown; content?: unknown } | null;
    if (body == null || typeof body !== "object") throw new HttpError(400, "INVALID_MANIFEST", "body must be a JSON object");
    const em = parseManifestPayload(body.manifest, "manifest") as unknown as EvidenceManifest;
    const validation = validateEvidenceManifest(em);
    if (!validation.ok) {
      throw new HttpError(400, "INVALID_MANIFEST", `invalid evidence manifest: ${validation.errors.join("; ")}`);
    }
    const chainId = Number(em.chainId);
    if (chainId !== config.chainId) {
      throw new HttpError(400, "WRONG_CHAIN", `manifest chainId ${chainId} is not the configured local chain ${config.chainId}`);
    }
    const publisher = em.publisher.toLowerCase();
    const canonical = canonicalizeEvidence(em);
    if (Buffer.byteLength(manifestBytesOf(body.manifest), "utf8") > config.evidenceManifestMaxBytes) {
      throw new HttpError(400, "PAYLOAD_TOO_LARGE", "manifest exceeds the local size cap");
    }
    const commitment = evidenceCommitment(em);
    await verifyArtifactSignature(artifactMessage("orakl-evidence-v1", commitment, publisher), body.signature, publisher);

    // Optional exact content storage (local discovery channel only).
    let contentBytes = Buffer.alloc(0);
    if (typeof body.content === "string" && body.content.length > 0) {
      contentBytes = Buffer.from(body.content, "utf8");
      if (contentBytes.length > config.evidenceContentMaxBytes) {
        throw new HttpError(400, "PAYLOAD_TOO_LARGE", "content exceeds the local size cap");
      }
      if (evidenceContentHash(contentBytes) !== em.contentHash) {
        throw new HttpError(400, "CONTENT_HASH_MISMATCH", "content does not hash to the manifest contentHash");
      }
    }

    const dedupe = await deps.prisma.evidenceArtifact.findUnique({ where: { commitment: commitment.toLowerCase() } });
    if (dedupe != null) {
      reply.code(200);
      return ok({ commitment: dedupe.commitment, deduped: true, externalPinning: "UNVERIFIED" });
    }

    const link = await linkToMarketEvent(deps.prisma, config.chainId, em.marketId, commitment);
    const created = await deps.prisma.evidenceArtifact.create({
      data: {
        commitment: commitment.toLowerCase(),
        manifestKeccak: commitment,
        contentKeccak: evidenceContentHash(contentBytes),
        manifestBytes: canonical as never,
        contentBytes: contentBytes as never,
        contentSize: contentBytes.length,
        publishedBy: publisher,
        chainId: config.chainId,
        marketOnchainId: link.marketId,
        linkedEventTx: link.txHash,
        linkedEventLogIndex: link.logIndex,
      },
    });
    // Availability note: this store is local; external pinning is NOT verified.
    if (link.evidenceRecordId != null) {
      await deps.prisma.evidenceVerification.create({
        data: {
          evidenceRecordId: link.evidenceRecordId,
          availabilityStatus: contentBytes.length > 0 ? "AVAILABLE" : "UNKNOWN",
          verificationStatus: "HASH_VERIFIED",
          observer: "backend-local",
          reason: `local artifact ${commitment} matched an on-chain commitment`,
        },
      });
    }
    return ok({
      commitment: created.commitment,
      deduped: false,
      hasContent: contentBytes.length > 0,
      marketLinked: link.marketId != null,
      externalPinning: "UNVERIFIED",
    });
  });

  app.post("/api/v1/markets/metadata", async (request, reply) => {
    rateLimit(request, reply, "artifact", config.evidencePublishPerWindow, config.evidencePublishWindowMs);
    const body = request.body as { metadata?: unknown; signature?: unknown } | null;
    if (body == null || typeof body !== "object") throw new HttpError(400, "INVALID_METADATA", "body must be a JSON object");
    const validated = validateMetadataManifest(parseManifestPayload(body.metadata, "metadata"));
    if (!validated.ok || validated.value == null) {
      throw new HttpError(400, "INVALID_METADATA", `invalid metadata manifest: ${validated.errors.join("; ")}`);
    }
    const manifest = validated.value;
    if (Number(manifest.chainId) !== config.chainId) {
      throw new HttpError(400, "WRONG_CHAIN", `metadata chainId ${manifest.chainId} is not the configured local chain ${config.chainId}`);
    }
    const canonical = canonicalizeMetadata(manifest);
    if (canonical.length > METADATA_MAX_BYTES) {
      throw new HttpError(400, "PAYLOAD_TOO_LARGE", "metadata exceeds the local size cap");
    }
    const commitmentBytes = { keccak256, stringToBytes };
    const commitment = keccak256(canonical as never);
    await verifyArtifactSignature(artifactMessage(METADATA_SCHEMA, commitment, manifest.creator), body.signature, manifest.creator);

    const uri = `ipfs://orakl-local-remote/${commitment.slice(2)}`.replace("orakl-local-remote", "orakl-local-artifact");
    const existing = await deps.prisma.marketMetadata.findUnique({ where: { commitment } });
    if (existing != null) {
      reply.code(200);
      return ok({ commitment, uri: existing.uri, deduped: true });
    }
    await deps.prisma.marketMetadata.create({
      data: {
        chainId: config.chainId,
        commitment,
        uriKeccak: keccak256(stringToBytes(uri)),
        uri,
        question: manifest.question,
        description: manifest.description,
        categorySlug: manifest.category,
        resolutionCriteria: manifest.resolutionCriteria,
        evidenceSources: manifest.sources as never,
        formData: manifest as never,
        publishedBy: manifest.creator,
      },
    });
    return ok({ commitment, uri, deduped: false });
  });

  // -------------------------------------------------------- legacy API kept

  app.get("/api/health", async () => ({
    ok: true,
    service: "orakl-p1-backend",
    mode: "local-selected",
    simulationOnly: true,
  }));

  app.get("/api/chain/manifests", async () => {
    const files = (await readdirSafe(path.resolve(process.cwd(), MANIFEST_DIR))).filter((f) => f.endsWith(".json"));
    const out: ManifestSummary[] = [];
    for (const file of files) {
      const manifest = JSON.parse(await readFile(path.join(process.cwd(), MANIFEST_DIR, file), "utf8")) as never as {
        status?: string;
        mode?: string;
        network?: { chainId: number };
        contracts?: Record<string, unknown>;
      };
      out.push({
        chainId: manifest.network?.chainId ?? 0,
        contractsCount: Object.keys(manifest.contracts ?? {}).length,
        digestMiss: manifest.status !== "LOCAL_SIMULATION",
      });
    }
    return { manifests: out, simulationOnly: true };
  });

  app.get("/api/markets", async (request, reply) => {
    void request;
    const markets = await deps.prisma.market.findMany({
      orderBy: { onchainMarketId: "asc" },
      include: { contributions: true },
    });
    if (markets.length === 0) {
      throw new HttpError(503, "SERVICE_UNAVAILABLE", "Market registries offline");
    }
    return {
      simulationOnly: true,
      proxyPort: VITE_PROXY_PORT,
      markets: markets.map((m) => ({
        onchainMarketId: m.onchainMarketId.toString(),
        metadataURI: m.metadataURI,
        closeTime: m.closeTime.toString(),
        status: m.status,
        contributions: m.contributions.map((c) => ({
          side: c.side,
          amount: c.amount.toString(),
          walletAddress: c.walletAddress,
        })),
      })),
    };
  });

  app.get("/api/markets/:id/positions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const market = await deps.prisma.market.findUnique({
      where: { onchainMarketId: BigInt(id) },
    });
    if (market == null) {
      throw new HttpError(404, "NOT_FOUND", "No Such Market");
    }
    const positions = await deps.prisma.marketPosition.findMany({ where: { marketId: market.id } });
    return {
      simulationOnly: true,
      positions: positions.map((p) => ({
        walletAddress: p.walletAddress,
        yesContribution: p.yesContribution.toString(),
        noContribution: p.noContribution.toString(),
      })),
    };
  });

  return app;
}

// ------------------------------------------------------------- read helpers

type ManifestSummary = {
  chainId: number;
  contractsCount: number;
  digestMiss: boolean;
};

type ManifestLike = {
  status: string;
  mode: string;
  _file?: string;
  network: { name?: string; chainId: number; rpcUrl: string; nativeSymbol?: string };
  contracts: { selectedMarketFactory: { address: string; startBlock: number }; protocolConfig: { address: string; startBlock: number } };
  release?: unknown;
  roleMocks?: unknown;
  parameters?: unknown;
  safety?: unknown;
};

async function readManifestSafe(): Promise<ManifestLike & { _file?: string } | null> {
  try {
    const file = process.env.DEPLOYMENT_MANIFEST ?? path.resolve(process.cwd(), MANIFEST_DIR, "local-selected.json");
    const manifest = JSON.parse(await readFile(file, "utf8")) as ManifestLike;
    if (manifest.status !== "LOCAL_SIMULATION" || manifest.mode !== "local-selected") return null;
    manifest._file = file;
    return manifest as never;
  } catch {
    return null;
  }
}

async function readVerificationSafe(): Promise<{ allPassed: boolean; checksList: unknown[] } | null> {
  try {
    const dir = path.resolve(process.cwd(), "..", "docs", "p1", "evidence");
    const verification = JSON.parse(await readFile(path.join(dir, "local-deployment-verification.json"), "utf8")) as {
      allPassed: boolean;
      checks: unknown[];
    };
    return { allPassed: verification.allPassed, checksList: verification.checks };
  } catch {
    return null;
  }
}

async function readdirSafe(dir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

type MarketRowForList = {
  chainId: number;
  onchainMarketId: bigint;
  contractAddress: string;
  creatorAddress: string;
  metadataHash: string;
  metadataURI: string;
  question: string;
  description: string | null;
  categoryId: string | null;
  status: string;
  finalOutcome: string;
  proposerAddress: string | null;
  challengerAddress: string | null;
  proposalEvidenceHash: string | null;
  challengeEvidenceHash: string | null;
  decisionEvidenceHash: string | null;
  totalChallengeStake: bigint | unknown;
  refundable: boolean | null;
  challengeDeadline: bigint | null;
  createdAtBlock: bigint;
  closeTime: bigint;
  resolutionTime: bigint;
  maxResolutionTime: bigint;
};

function marketListItem(
  m: MarketRowForList,
  meta: { question: string; description: string | null | undefined; categorySlug: string | null; verified: boolean } | undefined,
  pools: { yes: bigint; no: bigint } | undefined,
): unknown {
  return {
    id: m.onchainMarketId,
    chainId: m.chainId,
    contractAddress: m.contractAddress,
    creator: m.creatorAddress,
    question: meta?.question || m.question,
    description: meta?.description ?? m.description,
    category: meta?.categorySlug ?? null,
    metadataHash: m.metadataHash,
    metadataURI: m.metadataURI,
    verifiedMetadata: meta?.verified ?? false,
    status: m.status,
    finalOutcome: m.finalOutcome,
    proposer: m.proposerAddress,
    challenger: m.challengerAddress,
    proposedOutcome: null,
    proposalEvidence: m.proposalEvidenceHash,
    challengeEvidence: m.challengeEvidenceHash,
    decisionEvidence: m.decisionEvidenceHash,
    yesPool: pools?.yes ?? 0n,
    noPool: pools?.no ?? 0n,
    totalChallengeStake: BigInt(m.totalChallengeStake?.toString() ?? "0"),
    refundable: m.refundable,
    challengeDeadline: m.challengeDeadline,
    closeTime: m.closeTime,
    resolutionTime: m.resolutionTime,
    maxResolutionTime: m.maxResolutionTime,
    createdAtBlock: m.createdAtBlock,
  };
}

async function attachMetadata(
  prisma: PrismaClient,
  rows: { chainId: number; onchainMarketId: bigint; metadataHash: string }[],
): Promise<Map<string, { question: string; description: string | null; categorySlug: string | null; verified: boolean }>> {
  const out = new Map<string, { question: string; description: string | null; categorySlug: string | null; verified: boolean }>();
  const hashes = [...new Set(rows.map((r) => r.metadataHash.toLowerCase()))];
  const artifacts = hashes.length
    ? await prisma.marketMetadata.findMany({ where: { chainId: { in: [...new Set(rows.map((r) => r.chainId))] }, commitment: { in: hashes } } })
    : [];
  const byHash = new Map(artifacts.filter((a) => a.chainId > 0).map((a) => [a.commitment, a] as const));
  for (const r of rows) {
    const a = byHash.get(r.metadataHash.toLowerCase());
    if (a != null) {
      out.set(r.onchainMarketId.toString(), {
        question: sanitizeText(a.question, 256),
        description: a.description != null ? sanitizeText(a.description, 4000) : null,
        categorySlug: a.categorySlug,
        verified: true,
      });
    }
  }
  return out;
}

async function poolTotals(
  prisma: PrismaClient,
  ids: bigint[],
): Promise<Map<string, { yes: bigint; no: bigint }>> {
  const out = new Map<string, { yes: bigint; no: bigint }>();
  for (const id of ids) out.set(id.toString(), { yes: 0n, no: 0n });
  if (ids.length === 0) return out;
  const markets = await prisma.market.findMany({
    where: { onchainMarketId: { in: ids } },
    select: { id: true, onchainMarketId: true },
  });
  const onchainFor = new Map(markets.map((m) => [m.id, m.onchainMarketId.toString()] as const));
  if (onchainFor.size === 0) return out;
  const rows = await prisma.contribution.groupBy({
    by: ["marketId", "side"],
    where: { marketId: { in: [...onchainFor.keys()] } },
    _sum: { amount: true },
  });
  for (const row of rows) {
    const onchain = onchainFor.get(row.marketId);
    if (onchain == null) continue;
    const pool = out.get(onchain) ?? { yes: 0n, no: 0n };
    const amount = BigInt(row._sum.amount?.toString() ?? "0");
    if (row.side === "YES") pool.yes += amount;
    else pool.no += amount;
    out.set(onchain, pool);
  }
  return out;
}

async function linkToMarketEvent(
  prisma: PrismaClient,
  chainId: number,
  marketId: string,
  commitment: string,
): Promise<{ marketId: string | null; txHash: string | null; logIndex: number | null; evidenceRecordId: string | null }> {
  const market = await prisma.market.findUnique({
    where: { onchainMarketId: BigInt(marketId) },
    select: { id: true },
  });
  if (market == null) return { marketId: null, txHash: null, logIndex: null, evidenceRecordId: null };
  const rows = await prisma.$queryRaw<{ txHash: string; logIndex: number }[]>`
    SELECT "txHash", "logIndex" FROM "IndexedEvent"
    WHERE "chainId" = ${chainId}
      AND "eventName" = ANY(${EVIDENCE_HASH_KEY_EVENTS}::text[])
      AND "args"->>'evidenceHash' = ${commitment}
    ORDER BY "blockNumber" ASC, "logIndex" ASC LIMIT 1`;
  const first = rows[0] ?? null;
  let evidenceRecordId: string | null = null;
  const record = await prisma.evidenceRecord.findUnique({
    where: { marketId_evidenceHash: { marketId: market.id, evidenceHash: commitment.toLowerCase() } },
    select: { id: true },
  });
  evidenceRecordId = record?.id ?? null;
  return { marketId: marketId, txHash: first?.txHash ?? null, logIndex: first?.logIndex ?? null, evidenceRecordId };
}

function manifestBytesOf(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

if (process.argv[1]?.endsWith("server.ts")) {
  const { makePrisma } = await import("../db.js");
  const prisma = makePrisma();
  const app = await buildServer({ prisma: prisma as unknown as PrismaClient });
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? "4310");
  await app.listen({ host, port });
  console.log(`[orakl-p1-backend] listening on http://${host}:${port} (LOCAL SIMULATION ONLY)`);
}

export type { FastifyInstance as AppInstance };
