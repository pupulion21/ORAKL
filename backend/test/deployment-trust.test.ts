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

  it("Layer 9: fails closed on database outage during deployment verification", async () => {
    const manifestPath = path.join(TMP_DIR, "db-outage.json");
    writeFileSync(manifestPath, JSON.stringify(createMockManifest()), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
    });

    const mockPrismaOutage = {
      contractDeployment: {
        findFirst: async () => {
          throw new Error("P1001: Can't reach database server at postgresql://localhost:5432");
        },
      },
    } as any;

    await expect(resolveTrustedDeployment(config, mockPrismaOutage)).rejects.toThrow(
      "database deployment verification failed due to database outage",
    );
  });

  it("Layer 9: fails closed on forged manifest when database record has different factory", async () => {
    const manifestPath = path.join(TMP_DIR, "db-mismatch.json");
    writeFileSync(manifestPath, JSON.stringify(createMockManifest()), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
    });

    const mockPrismaMismatch = {
      contractDeployment: {
        findFirst: async () => ({
          factoryAddress: "0x9999999999999999999999999999999999999999",
          protocolConfigAddress: "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9",
        }),
      },
    } as any;

    await expect(resolveTrustedDeployment(config, mockPrismaMismatch)).rejects.toThrow(
      "deployment manifest and database deployment record mismatch",
    );
  });

  it("Layer 9: accepts when database record matches manifest factory and config", async () => {
    const manifestPath = path.join(TMP_DIR, "db-match.json");
    writeFileSync(manifestPath, JSON.stringify(createMockManifest()), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
    });

    const mockPrismaMatch = {
      contractDeployment: {
        findFirst: async () => ({
          factoryAddress: "0xdc64a140aa3e981100a9beca4e685f962f0cf6c9",
          protocolConfigAddress: "0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9",
        }),
      },
    } as any;

    const trusted = await resolveTrustedDeployment(config, mockPrismaMatch);
    expect(trusted.factory).toBe("0xdc64a140aa3e981100a9beca4e685f962f0cf6c9");
  });

  it("Layer 9: fails closed when requireDbDeploymentRecord is true and record is missing", async () => {
    const manifestPath = path.join(TMP_DIR, "db-missing.json");
    writeFileSync(manifestPath, JSON.stringify(createMockManifest()), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
      REQUIRE_DB_DEPLOYMENT: "true",
    });

    const mockPrismaEmpty = {
      contractDeployment: {
        findFirst: async () => null,
      },
    } as any;

    await expect(resolveTrustedDeployment(config, mockPrismaEmpty)).rejects.toThrow(
      "missing required deployment record in database",
    );
  });

  it("Strict isolation: rejects trustedFactory when allowTestFactoryOverride is false", async () => {
    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      TRUSTED_FACTORY: "0x2222222222222222222222222222222222222222",
    });
    // Manually disable allowTestFactoryOverride
    config.allowTestFactoryOverride = false;

    await expect(resolveTrustedDeployment(config)).rejects.toThrow(
      "trustedFactory override shortcut is strictly prohibited outside isolated unit testing",
    );
  });

  it("Strict isolation: accepts trustedFactory when allowTestFactoryOverride is true in test environment", async () => {
    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      TRUSTED_FACTORY: "0x2222222222222222222222222222222222222222",
      ALLOW_TEST_FACTORY_OVERRIDE: "true",
    });

    const trusted = await resolveTrustedDeployment(config);
    expect(trusted.factory).toBe("0x2222222222222222222222222222222222222222");
  });

  it("Trust Anchor: rejects forged manifest with unapproved abiSha256 even if self-consistent", async () => {
    const manifestPath = path.join(TMP_DIR, "forged-abi.json");
    const manifest = createMockManifest();
    // Forged ABI sha256
    manifest.contracts.selectedMarketFactory.abiSha256 =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
    });

    await expect(resolveTrustedDeployment(config)).rejects.toThrow(
      "manifest failed trust anchor validation: manifest factory abiSha256",
    );
  });

  it("Trust Anchor: rejects forged manifest with spoofed factory runtime codehash", async () => {
    const manifestPath = path.join(TMP_DIR, "spoofed-codehash.json");
    const manifest = createMockManifest();
    // Spoofed codehash
    manifest.contracts.selectedMarketFactory.runtimeCodeKeccak256 =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
    });

    await expect(resolveTrustedDeployment(config)).rejects.toThrow(
      "manifest failed trust anchor validation: manifest factory runtimeCodeKeccak256",
    );
  });

  it("Deployment Cache: refreshes after deployment identity changes via forceRefresh or TTL expiry", async () => {
    const manifestPath = path.join(TMP_DIR, "cache-identity-change.json");
    const manifest1 = createMockManifest();
    writeFileSync(manifestPath, JSON.stringify(manifest1), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
      DEPLOYMENT_CACHE_TTL_MS: "50",
    });

    const first = await resolveTrustedDeployment(config);
    expect(first.factory).toBe("0xdc64a140aa3e981100a9beca4e685f962f0cf6c9");

    // Identity changes on disk (e.g. forged manifest with unapproved ABI)
    const manifest2 = createMockManifest();
    manifest2.contracts.selectedMarketFactory.abiSha256 =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    writeFileSync(manifestPath, JSON.stringify(manifest2), "utf8");

    // Immediate forceRefresh detects the changed identity and fails closed
    await expect(
      resolveTrustedDeployment(config, undefined, { forceRefresh: true }),
    ).rejects.toThrow("manifest failed trust anchor validation");

    // Wait for TTL to expire: normal resolveTrustedDeployment now refreshes and rejects
    await new Promise((r) => setTimeout(r, 60));
    await expect(resolveTrustedDeployment(config)).rejects.toThrow(
      "manifest failed trust anchor validation",
    );
  });

  it("Deployment Cache: forceRefresh bypasses cache and re-validates identity", async () => {
    const manifestPath = path.join(TMP_DIR, "cache-forcerefresh-test.json");
    const manifest = createMockManifest();
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const config = loadConfig({
      LOCAL_CHAIN_ID: "31337",
      DEPLOYMENT_MANIFEST: manifestPath,
      DEPLOYMENT_CACHE_TTL_MS: "60000",
    });

    const first = await resolveTrustedDeployment(config);
    expect(first.factory).toBe("0xdc64a140aa3e981100a9beca4e685f962f0cf6c9");

    // Call with forceRefresh
    const refreshed = await resolveTrustedDeployment(config, undefined, { forceRefresh: true });
    expect(refreshed.factory).toBe(first.factory);
    expect(refreshed.verifiedAt).toBeGreaterThanOrEqual(first.verifiedAt);
  });
});
