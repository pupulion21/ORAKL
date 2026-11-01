import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { verifyDeployment } from "../../scripts/p2/verify-deployment.mjs";

const TMP_DIR = path.resolve(process.cwd(), "test", "fixtures", "tmp-verify-deployment");

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
});
