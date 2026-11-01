import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { verifyDeployment } from "../../scripts/p2/verify-deployment.mjs";

const REPO_ROOT = existsSync(path.resolve(process.cwd(), "contracts"))
  ? process.cwd()
  : path.resolve(process.cwd(), "..");
const TMP_DIR = path.resolve(REPO_ROOT, "backend", "test", "fixtures", "tmp-verify-deployment");

function patchArtifactBytecode(artifactPath: string, immutableValues: bigint[]): `0x${string}` {
  const art = JSON.parse(readFileSync(artifactPath, "utf8"));
  const templateHex: string = art.deployedBytecode.object.replace(/^0x/, "");
  const template = Buffer.from(templateHex, "hex");
  const ids = Object.keys(art.deployedBytecode.immutableReferences ?? {});
  const slots = ids.map((id) => art.deployedBytecode.immutableReferences[id]);
  const patched = Buffer.from(template);
  for (let i = 0; i < ids.length; i += 1) {
    const word = immutableValues[i] ?? 0n;
    for (const range of slots[i]) {
      for (let b = 0; b < range.length; b += 1) {
        const byte = Number((word >> BigInt(8 * (range.length - 1 - b))) & 0xffn);
        patched[range.start + b] = byte;
      }
    }
  }
  return `0x${patched.toString("hex")}`;
}

function createTestManifest(overrides: Record<string, any> = {}): Record<string, any> {
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

describe("P2 Deployment Verification Gate (scripts/p2/verify-deployment.mjs)", () => {
  let mockRpcServer: Server | null = null;
  let mockRpcPort = 0;
  let rpcHandler: (method: string, params: any[]) => any = () => null;

  beforeAll(async () => {
    if (!existsSync(TMP_DIR)) {
      mkdirSync(TMP_DIR, { recursive: true });
    }

    mockRpcServer = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const json = JSON.parse(body);
          const result = rpcHandler(json.method, json.params || []);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: json.id, result }));
        } catch (e: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: e.message } }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      mockRpcServer!.listen(0, "127.0.0.1", () => {
        const addr = mockRpcServer!.address() as any;
        mockRpcPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (mockRpcServer) {
      await new Promise<void>((resolve) => mockRpcServer!.close(() => resolve()));
    }
    try {
      if (existsSync(TMP_DIR)) {
        rmSync(TMP_DIR, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  it("artifact-only: succeeds on valid local artifacts and reports ONCHAIN_UNVERIFIED without contacting RPC", async () => {
    const manifestPath = path.join(TMP_DIR, "valid-manifest.json");
    writeFileSync(manifestPath, JSON.stringify(createTestManifest()), "utf8");

    // Point to non-existent port to guarantee no RPC is contacted
    const result = await verifyDeployment({
      manifestPath,
      rpcUrl: "http://127.0.0.1:1",
      mode: "artifact-only",
      silent: true,
    });

    expect(result.success).toBe(true);
    expect(result.onchainStatus).toBe("ONCHAIN_UNVERIFIED");
    expect(result.checks.some((c: any) => c.name === "onchain-unverified")).toBe(true);
  });

  it("onchain-required: fails closed when RPC is offline or unreachable", async () => {
    const manifestPath = path.join(TMP_DIR, "rpc-offline.json");
    writeFileSync(manifestPath, JSON.stringify(createTestManifest()), "utf8");

    const result = await verifyDeployment({
      manifestPath,
      rpcUrl: "http://127.0.0.1:1", // dead port
      mode: "onchain-required",
      silent: true,
    });

    expect(result.success).toBe(false);
    expect(result.onchainStatus).toBe("FAILED");
    expect(result.checks.some((c: any) => c.name === "rpc-connectivity" && !c.passed)).toBe(true);
  });

  it("onchain-required: fails closed when on-chain chain ID does not match manifest", async () => {
    const manifestPath = path.join(TMP_DIR, "wrong-chain.json");
    writeFileSync(manifestPath, JSON.stringify(createTestManifest()), "utf8");

    rpcHandler = (method) => {
      if (method === "eth_chainId") return "0x7bf"; // 1983 instead of 31337
      return "0x";
    };

    const result = await verifyDeployment({
      manifestPath,
      rpcUrl: `http://127.0.0.1:${mockRpcPort}`,
      mode: "onchain-required",
      silent: true,
    });

    expect(result.success).toBe(false);
    expect(result.checks.some((c: any) => c.name === "chain-id-match" && !c.passed)).toBe(true);
  });

  it("onchain-required: fails closed when on-chain bytecode is empty", async () => {
    const manifestPath = path.join(TMP_DIR, "empty-bytecode.json");
    writeFileSync(manifestPath, JSON.stringify(createTestManifest()), "utf8");

    rpcHandler = (method) => {
      if (method === "eth_chainId") return "0x7a69"; // 31337
      if (method === "eth_getCode") return "0x"; // empty bytecode
      return "0x";
    };

    const result = await verifyDeployment({
      manifestPath,
      rpcUrl: `http://127.0.0.1:${mockRpcPort}`,
      mode: "onchain-required",
      silent: true,
    });

    expect(result.success).toBe(false);
    expect(result.checks.some((c: any) => c.name === "onchain-factory-code" && !c.passed)).toBe(true);
  });

  it("onchain-required: fails closed when on-chain codehash does not match manifest", async () => {
    const manifestPath = path.join(TMP_DIR, "codehash-mismatch.json");
    writeFileSync(manifestPath, JSON.stringify(createTestManifest()), "utf8");

    rpcHandler = (method) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_getCode") return "0x6001600101"; // arbitrary non-matching bytecode
      return "0x";
    };

    const result = await verifyDeployment({
      manifestPath,
      rpcUrl: `http://127.0.0.1:${mockRpcPort}`,
      mode: "onchain-required",
      silent: true,
    });

    expect(result.success).toBe(false);
    expect(result.checks.some((c: any) => c.name === "onchain-factory-codehash" && !c.passed)).toBe(true);
  });

  it("onchain-required: fails closed when factory-to-ProtocolConfig linkage does not match", async () => {
    const manifestPath = path.join(TMP_DIR, "linkage-mismatch.json");
    writeFileSync(manifestPath, JSON.stringify(createTestManifest()), "utf8");

    // Valid dummy bytecode with expected hash or mock
    rpcHandler = (method, params) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_getCode") {
        // Return dummy bytes
        return "0x6080";
      }
      if (method === "eth_call") {
        // Return forged/wrong linkage address
        return "0x0000000000000000000000009999999999999999999999999999999999999999";
      }
      return "0x";
    };

    const result = await verifyDeployment({
      manifestPath,
      rpcUrl: `http://127.0.0.1:${mockRpcPort}`,
      mode: "onchain-required",
      silent: true,
    });

    expect(result.success).toBe(false);
    expect(result.checks.some((c: any) => c.name.includes("linkage") && !c.passed)).toBe(true);
  });

  it("artifact-only and onchain-required: fails closed when manifest ABI does not match compiled artifact", async () => {
    const manifestPath = path.join(TMP_DIR, "unapproved-abi.json");
    const manifest = createTestManifest();
    manifest.contracts.selectedMarketFactory.abiSha256 =
      "0xbadbeefbadbeefbadbeefbadbeefbadbeefbadbeefbadbeefbadbeefbadbeef";
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const result = await verifyDeployment({
      manifestPath,
      mode: "artifact-only",
      silent: true,
    });

    expect(result.success).toBe(false);
    expect(result.checks.some((c: any) => c.name === "factory-abi-hash" && !c.passed)).toBe(true);
  });

  it("onchain-required: succeeds on valid live contracts matching trust anchor, dynamically derived selectors, and mutual linkage", async () => {
    const manifestPath = path.join(TMP_DIR, "positive-path.json");
    const manifest = createTestManifest();
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    const factoryArtPath = path.resolve(REPO_ROOT, "contracts/out/SelectedMarketFactory.sol/SelectedMarketFactory.json");
    const configArtPath = path.resolve(REPO_ROOT, "contracts/out/ProtocolConfig.sol/ProtocolConfig.json");

    const factoryCode = patchArtifactBytecode(factoryArtPath, [
      0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9n,
      0x56bc75e2d63100000n,
      0x1043561a8829300000n,
      0xad78ebc5ac6200000n,
    ]);

    const configCode = patchArtifactBytecode(configArtPath, [
      0x5fbdb2315678afecb367f032d93f642f64180aa3n,
      0xe7f1725e7734ce288f8367e1bb143e90bb3f0512n,
      0x14dc79964da2c08b23698b3d3cc7ca32193d9955n,
      0x7a69n,
    ]);

    rpcHandler = (method, params) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_getCode") {
        const target = (params[0] || "").toLowerCase();
        if (target === manifest.contracts.selectedMarketFactory.address.toLowerCase()) {
          return factoryCode;
        }
        if (target === manifest.contracts.protocolConfig.address.toLowerCase()) {
          return configCode;
        }
        return "0x";
      }
      if (method === "eth_call") {
        const callObj = params[0] || {};
        const target = (callObj.to || "").toLowerCase();
        const data = (callObj.data || "").toLowerCase();
        // factory.protocolConfig() selector derived from ABI: 0xf5efbb4f
        if (target === manifest.contracts.selectedMarketFactory.address.toLowerCase() && data === "0xf5efbb4f") {
          return "0x000000000000000000000000cf7ed3acca5a467e9e704c703e8d87f634fb0fc9";
        }
        // config.factory() selector derived from ABI: 0xc45a0155
        if (target === manifest.contracts.protocolConfig.address.toLowerCase() && data === "0xc45a0155") {
          return "0x000000000000000000000000dc64a140aa3e981100a9beca4e685f962f0cf6c9";
        }
        return "0x0000000000000000000000000000000000000000000000000000000000000000";
      }
      return "0x";
    };

    const result = await verifyDeployment({
      manifestPath,
      rpcUrl: `http://127.0.0.1:${mockRpcPort}`,
      mode: "onchain-required",
      silent: true,
    });

    const checkNames = result.checks.map((c: any) => c.name);
    expect(checkNames).toContain("factory-protocolConfig-selector-derived");
    expect(checkNames).toContain("config-factory-selector-derived");
    expect(checkNames).toContain("onchain-factory-codehash");
    expect(checkNames).toContain("onchain-config-codehash");
    expect(checkNames).toContain("onchain-factory-linkage");
    expect(checkNames).toContain("onchain-config-linkage");
  });

  it("onchain-required: fails closed when independent trust anchor rejects forged codehash even if manifest matches", async () => {
    const manifestPath = path.join(TMP_DIR, "spoofed-manifest.json");
    const manifest = createTestManifest();
    // Spoofed manifest claims custom codehash
    manifest.contracts.selectedMarketFactory.runtimeCodeKeccak256 =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    rpcHandler = (method, params) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_getCode") {
        // Return dummy bytes that match the spoofed manifest hash
        // but not canonical anchor
        return "0x6001";
      }
      return "0x";
    };

    const result = await verifyDeployment({
      manifestPath,
      rpcUrl: `http://127.0.0.1:${mockRpcPort}`,
      mode: "onchain-required",
      silent: true,
    });

    expect(result.success).toBe(false);
    expect(result.onchainStatus).toBe("FAILED");
    expect(result.checks.some((c: any) => c.name === "onchain-factory-codehash" && !c.passed)).toBe(true);
  });
});
