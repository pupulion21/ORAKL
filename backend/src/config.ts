// ORAKL P1 — backend runtime configuration. LOCAL SIMULATION ONLY.
// This service reads the isolated Anvil chain and its own PostgreSQL database.
// It never holds keys, never signs transactions and never custodies funds.
export type BackendConfig = {
  port: number;
  host: string;
  rpcUrl: string;
  chainId: number;
  databaseUrl: string;
  indexerBatchSize: number;
  indexerConfirmations: number;
  indexerPollMs: number;
  allowedOrigins: string[];
  evidenceContentMaxBytes: number;
  evidenceManifestMaxBytes: number;
  evidencePublishPerWindow: number;
  evidencePublishWindowMs: number;
  trustedFactory?: string;
  allowTestFactoryOverride?: boolean;
  requireDbDeploymentRecord?: boolean;
  deploymentManifestPath?: string;
  expectedFactoryCodehash?: string;
  deploymentCacheTtlMs?: number;
};

const DEFAULT_ORIGINS = [
  "http://127.0.0.1:5176",
  "http://localhost:5176",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const nodeEnv = env.NODE_ENV ?? process.env.NODE_ENV ?? "development";
  const chainId = Number(env.LOCAL_CHAIN_ID ?? "31337");
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error(`bad LOCAL_CHAIN_ID: ${env.LOCAL_CHAIN_ID}`);
  const rpcUrl = env.LOCAL_RPC_URL ?? "http://127.0.0.1:8546";
  if (!/^http:\/\/127\.0\.0\.1(:\d+)?$|^http:\/\/localhost(:\d+)?$/i.test(rpcUrl)) {
    // Fail closed: this backend only ever talks to a loopback-isolated dev chain.
    throw new Error(`refusing non-loopback RPC URL: ${rpcUrl}`);
  }
  if (env.TRUSTED_FACTORY && nodeEnv !== "test") {
    throw new Error("SECURITY_ERROR: TRUSTED_FACTORY shortcut is forbidden outside NODE_ENV=test");
  }

  const isTest = nodeEnv === "test";

  return {
    port: Number(env.PORT ?? "4310"),
    host: env.HOST ?? "127.0.0.1",
    rpcUrl,
    chainId,
    databaseUrl: env.DATABASE_URL ?? "",
    indexerBatchSize: Math.max(1, Number(env.INDEXER_BATCH_SIZE ?? "200")),
    indexerConfirmations: Math.max(0, Number(env.INDEXER_CONFIRMATIONS ?? "0")),
    indexerPollMs: Math.max(100, Number(env.INDEXER_POLL_MS ?? "500")),
    allowedOrigins: (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",") : DEFAULT_ORIGINS).map((o) => o.trim()),
    evidenceContentMaxBytes: 64 * 1024,
    evidenceManifestMaxBytes: 16 * 1024,
    evidencePublishPerWindow: 30,
    evidencePublishWindowMs: 60_000,
    trustedFactory: isTest ? env.TRUSTED_FACTORY : undefined,
    allowTestFactoryOverride: isTest && (env.ALLOW_TEST_FACTORY_OVERRIDE === "true" || env.TRUSTED_FACTORY !== undefined),
    requireDbDeploymentRecord: env.REQUIRE_DB_DEPLOYMENT === "true",
    deploymentManifestPath: env.DEPLOYMENT_MANIFEST,
    expectedFactoryCodehash: env.EXPECTED_FACTORY_CODEHASH,
    deploymentCacheTtlMs: env.DEPLOYMENT_CACHE_TTL_MS ? Number(env.DEPLOYMENT_CACHE_TTL_MS) : 5000,
  };
}
