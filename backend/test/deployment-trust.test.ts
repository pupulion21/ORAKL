import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resolveTrustedDeployment, invalidateDeploymentCache, type TrustedDeployment } from "../src/api/server.js";
import { loadConfig } from "../src/config.js";
import { writeFileSync, unlinkSync, mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const TMP_DIR = path.resolve(process.cwd(), "test", "fixtures", "tmp-manifests");

function createMockManifest(overrides: Record<string, any> = {}): Record<string, any> {
  const base = {
    schemaVersion: 1,
    status: "LOCAL_SIMULATION",
    mode: "local-selected",
    safety: {
      publicDeployment: false,
      productionApproval: false,
      realFunds: false,
    },
    network: {
      chainId: 31337,
      rpcUrl: "http://127.0.0.1:8546",
    },
    contracts: {
      selectedMarketFactory: {
        address: "0xdc64a140aa3e981100a9beca4e685f962f0cf6c9",
        runtimeCodeKeccak256: "0xb8a5bfea3c87dd1a6ff557e0c389166d8fe799efeba166edad200f1669f4a21a",
        abiSha256: "0x6c2afa5a7277da5962e6e9364aa6bd66fd289ada21fcc229d336023ffe3c7fdc",
        immutableAssignment: [
          "0x000000000000000000000000cf7ed3acca5a467e9e704c703e8d87f634fb0fc9",
        ],
      },
      protocolConfig: {
        address: "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9",
        runtimeCodeKeccak256: "0x418d1b9ebdf9fcdf2ce444d4bd898042aad86651aebb21d3f56b98c8c9950b5e",
        abiSha256: "0xc9cfb7dbff2c16fe6f1b8aa5b0be64e355f164e052f7af3aaf4fa04a6e176b8d",
      },
    },
  };
  return { ...base, ...overrides };
}

describe("P2-04: Trusted Deployment 10-Layer Hardening & Caching", () => {
  beforeEach(() => {
    invalidateDeploymentCache();
    if (!existsSync(TMP_DIR)) {
      mkdirSync(TMP_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    try {
      if (existsSync(TMP_DIR)) {
        rmSync(TMP_DIR, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it("passes all 10 layers for a valid local simulation manifest", async () => {
    const manifestPath = path.join(TMP_DIR, "valid.json");
    writeFileSync(manifestPath, JSON.stringify(createMockManifest()), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
    });

    const trusted = await resolveTrustedDeployment(config);
    expect(trusted.chainId).toBe(31337);
    expect(trusted.factory).toBe("0xdc64a140aa3e981100a9beca4e685f962f0cf6c9");
    expect(trusted.protocolConfig).toBe("0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9");
    expect(trusted.runtimeCodeKeccak256).toBe("0xb8a5bfea3c87dd1a6ff557e0c389166d8fe799efeba166edad200f1669f4a21a");
  });

  it("Layer 1: rejects when manifest file is missing or unreadable", async () => {
    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: path.join(TMP_DIR, "nonexistent.json"),
    });

    await expect(resolveTrustedDeployment(config)).rejects.toThrow("trusted deployment manifest missing or unreadable");
  });

  it("Layer 2: rejects when chainId does not match server config", async () => {
    const manifestPath = path.join(TMP_DIR, "wrong-chain.json");
    const manifest = createMockManifest({ network: { chainId: 1983 } });
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
    });

    await expect(resolveTrustedDeployment(config)).rejects.toThrow("does not match server chainId");
  });

  it("Layer 3 & 4: rejects when factory or protocolConfig address is zero or invalid", async () => {
    const manifestPath = path.join(TMP_DIR, "bad-addr.json");
    const manifest = createMockManifest();
    manifest.contracts.selectedMarketFactory.address = "0x0000000000000000000000000000000000000000";
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
    });

    await expect(resolveTrustedDeployment(config)).rejects.toThrow("manifest missing valid selectedMarketFactory address");
  });

  it("Layer 5: rejects when immutable binding does not match protocolConfig", async () => {
    const manifestPath = path.join(TMP_DIR, "linkage-mismatch.json");
    const manifest = createMockManifest();
    manifest.contracts.selectedMarketFactory.immutableAssignment = [
      "0x0000000000000000000000001111111111111111111111111111111111111111",
    ];
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
    });

    await expect(resolveTrustedDeployment(config)).rejects.toThrow("selectedMarketFactory immutable binding does not match protocolConfig");
  });

  it("Layer 6: rejects when factory runtime codehash does not match expected codehash", async () => {
    const manifestPath = path.join(TMP_DIR, "codehash-mismatch.json");
    const manifest = createMockManifest();
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
      EXPECTED_FACTORY_CODEHASH: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });

    await expect(resolveTrustedDeployment(config)).rejects.toThrow("factory runtime bytecode codehash mismatch");
  });

  it("Layer 6: accepts when factory runtime codehash matches expected codehash", async () => {
    const manifestPath = path.join(TMP_DIR, "codehash-match.json");
    const manifest = createMockManifest();
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
      EXPECTED_FACTORY_CODEHASH: "0xb8a5bfea3c87dd1a6ff557e0c389166d8fe799efeba166edad200f1669f4a21a",
    });

    const trusted = await resolveTrustedDeployment(config);
    expect(trusted.runtimeCodeKeccak256).toBe("0xb8a5bfea3c87dd1a6ff557e0c389166d8fe799efeba166edad200f1669f4a21a");
  });

  it("Layer 7: rejects when abiSha256 is missing or invalid", async () => {
    const manifestPath = path.join(TMP_DIR, "bad-abi.json");
    const manifest = createMockManifest();
    delete manifest.contracts.selectedMarketFactory.abiSha256;
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
    });

    await expect(resolveTrustedDeployment(config)).rejects.toThrow("manifest missing valid abiSha256");
  });

  it("Layer 8: rejects manifest with publicDeployment=true in local simulation mode", async () => {
    const manifestPath = path.join(TMP_DIR, "safety-violation.json");
    const manifest = createMockManifest({ safety: { publicDeployment: true } });
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
    });

    await expect(resolveTrustedDeployment(config)).rejects.toThrow("refusing manifest with publicDeployment=true");
  });

  it("caches trusted deployment and honors freshness TTL and invalidation", async () => {
    const manifestPath = path.join(TMP_DIR, "cache-test.json");
    const manifest = createMockManifest();
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
      DEPLOYMENT_CACHE_TTL_MS: "100",
    });

    const first = await resolveTrustedDeployment(config);

    // Overwrite manifest with invalid content
    writeFileSync(manifestPath, "invalid-json", "utf8");

    // Second call within TTL should return cached object without reading the corrupted file
    const second = await resolveTrustedDeployment(config);
    expect(second).toBe(first);

    // Explicitly invalidate cache
    invalidateDeploymentCache();

    // Now it must reload and fail because file is corrupted
    await expect(resolveTrustedDeployment(config)).rejects.toThrow("trusted deployment manifest contains invalid JSON");
  });
});
