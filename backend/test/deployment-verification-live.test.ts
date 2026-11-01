import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  keccak256,
  defineChain,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { verifyDeployment, sha256Hex } from "../../scripts/p2/verify-deployment.mjs";
import {
  deploySafeInfrastructure,
  deployRoleSafe,
  executeSafeTransaction,
} from "../../scripts/p3/safe-lib.mjs";

const REPO_ROOT = existsSync(path.resolve(process.cwd(), "contracts"))
  ? process.cwd()
  : path.resolve(process.cwd(), "..");
const TMP_DIR = path.resolve(REPO_ROOT, "backend", "test", "fixtures", "tmp-verify-live");

const LIVE_PORT = 8549;
const LIVE_RPC_URL = `http://127.0.0.1:${LIVE_PORT}`;
const LIVE_CHAIN_ID = 31337;
const MNEMONIC = "test test test test test test test test test test test junk";

describe("P3 Live Deployment Verification Gate (Isolated Anvil)", () => {
  let anvilProc: ChildProcess | null = null;
  let manifestPath: string;
  let trustAnchor: any;
  let factoryAddress: `0x${string}`;
  let configAddress: `0x${string}`;

  beforeAll(async () => {
    if (!existsSync(TMP_DIR)) {
      mkdirSync(TMP_DIR, { recursive: true });
    }

    // 1. Start fresh isolated Anvil instance
    anvilProc = spawn(
      "/home/pupulion/.foundry/bin/anvil",
      [
        "--chain-id", String(LIVE_CHAIN_ID),
        "--port", String(LIVE_PORT),
        "--host", "127.0.0.1",
        "--accounts", "20",
        "--balance", "1000",
        "--gas-limit", "30000000",
        "--code-size-limit", "100000",
      ],
      { stdio: "ignore" }
    );

    const publicClient = createPublicClient({ transport: http(LIVE_RPC_URL) });

    // Wait for RPC to respond
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const id = await publicClient.getChainId();
        if (id === LIVE_CHAIN_ID) {
          ready = true;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (!ready) {
      if (anvilProc) (anvilProc as ChildProcess).kill("SIGKILL");
      throw new Error(`Failed to connect to Anvil on port ${LIVE_PORT}`);
    }

    // 2. Derive accounts and deploy genuine Safe infrastructure
    const deployer = mnemonicToAccount(MNEMONIC, { addressIndex: 0 });
    const govOwners = [1, 2, 3, 4, 5].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));
    const compOwners = [6, 7, 8, 9, 10].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));
    const arbOwners = [11, 12, 13, 14, 15].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));
    const guardian = mnemonicToAccount(MNEMONIC, { addressIndex: 16 });

    const localChain = defineChain({
      id: LIVE_CHAIN_ID,
      name: "Anvil Local",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [LIVE_RPC_URL] } },
    });

    const walletClient = createWalletClient({
      account: deployer,
      transport: http(LIVE_RPC_URL),
      chain: localChain,
    });

    const { singletonAddress, factoryAddress: safeFactoryAddress } =
      await deploySafeInfrastructure(walletClient, publicClient);

    const govSafeAddress = await deployRoleSafe(walletClient, publicClient, {
      factoryAddress: safeFactoryAddress,
      singletonAddress,
      owners: govOwners.map((o) => o.address),
      threshold: 3n,
      saltNonce: 101n,
    });

    const compSafeAddress = await deployRoleSafe(walletClient, publicClient, {
      factoryAddress: safeFactoryAddress,
      singletonAddress,
      owners: compOwners.map((o) => o.address),
      threshold: 3n,
      saltNonce: 102n,
    });

    const arbSafeAddress = await deployRoleSafe(walletClient, publicClient, {
      factoryAddress: safeFactoryAddress,
      singletonAddress,
      owners: arbOwners.map((o) => o.address),
      threshold: 3n,
      saltNonce: 103n,
    });

    // 3. Deploy genuine ProtocolConfig and SelectedMarketFactory
    const configArt = JSON.parse(
      readFileSync(path.resolve(REPO_ROOT, "contracts/out/ProtocolConfig.sol/ProtocolConfig.json"), "utf8")
    );
    const factoryArt = JSON.parse(
      readFileSync(path.resolve(REPO_ROOT, "contracts/out/SelectedMarketFactory.sol/SelectedMarketFactory.json"), "utf8")
    );

    const initialParameters = {
      feeBps: 200,
      creationBond: 1000000000000000000n, // 1 ETH
      proposalBond: 10000000000000000000n, // 10 ETH
      challengeBond: 1000000000000000000n, // 1 ETH
      minContribution: 10000000000000000n, // 0.01 ETH
      poolCap: 100000000000000000000n, // 100 ETH
      challengePeriod: 172800, // 48h
      arbitrationPeriod: 345600, // 96h
      arbitrator: arbSafeAddress,
    };

    const configTx = await walletClient.deployContract({
      abi: configArt.abi,
      bytecode: configArt.bytecode.object,
      args: [govSafeAddress, compSafeAddress, guardian.address, initialParameters],
    });
    const configReceipt = await publicClient.waitForTransactionReceipt({ hash: configTx });
    configAddress = configReceipt.contractAddress!;

    const factoryTx = await walletClient.deployContract({
      abi: factoryArt.abi,
      bytecode: factoryArt.bytecode.object,
      args: [configAddress],
    });
    const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: factoryTx });
    factoryAddress = factoryReceipt.contractAddress!;

    // 4. Bind factory to config via genuine Governance Safe 3-of-5 execution
    const bindCalldata = encodeFunctionData({
      abi: configArt.abi,
      functionName: "bindFactory",
      args: [factoryAddress],
    });

    await executeSafeTransaction(walletClient, publicClient, {
      safeAddress: govSafeAddress,
      to: configAddress,
      data: bindCalldata,
      signers: [govOwners[0], govOwners[1], govOwners[2]],
    });

    // 5. Retrieve on-chain runtime bytecodes and codehashes
    const factoryBytecode = await publicClient.getBytecode({ address: factoryAddress });
    const configBytecode = await publicClient.getBytecode({ address: configAddress });

    const factoryCodehash = keccak256(factoryBytecode!);
    const configCodehash = keccak256(configBytecode!);
    const factoryAbiSha = sha256Hex(JSON.stringify(factoryArt.abi));
    const configAbiSha = sha256Hex(JSON.stringify(configArt.abi));

    trustAnchor = Object.freeze({
      chainId: LIVE_CHAIN_ID,
      approvedFactoryAbiSha256: factoryAbiSha,
      approvedConfigAbiSha256: configAbiSha,
      expectedFactoryCodehash: factoryCodehash,
      expectedConfigCodehash: configCodehash,
      description: "Live Anvil Isolated Test Trust Anchor",
    });

    const manifest = {
      schemaVersion: 1,
      status: "LOCAL_SIMULATION",
      mode: "local-selected",
      safety: {
        publicDeployment: false,
        productionApproval: false,
        realFunds: false,
      },
      network: {
        chainId: LIVE_CHAIN_ID,
        rpcUrl: LIVE_RPC_URL,
      },
      contracts: {
        selectedMarketFactory: {
          address: factoryAddress,
          runtimeCodeKeccak256: factoryCodehash,
          abiSha256: factoryAbiSha,
          immutableAssignment: [
            `0x000000000000000000000000${configAddress.slice(2).toLowerCase()}`,
          ],
        },
        protocolConfig: {
          address: configAddress,
          runtimeCodeKeccak256: configCodehash,
          abiSha256: configAbiSha,
        },
      },
    };

    manifestPath = path.resolve(TMP_DIR, "live-manifest.json");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  }, 45000);

  afterAll(async () => {
    if (anvilProc) {
      anvilProc.kill("SIGKILL");
    }
    if (existsSync(TMP_DIR)) {
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  it("positively verifies live deployed contracts with onchain-required mode", async () => {
    const result = await verifyDeployment({
      mode: "onchain-required",
      manifestPath,
      rpcUrl: LIVE_RPC_URL,
      trustAnchor,
      silent: true,
    });

    expect(result.success).toBe(true);
    expect(result.onchainStatus).toBe("VERIFIED");
    expect(result.errors).toEqual([]);

    const checkNames = result.checks.map((c: any) => c.name);
    expect(checkNames).toContain("onchain-factory-codehash");
    expect(checkNames).toContain("onchain-config-codehash");
    expect(checkNames).toContain("onchain-factory-linkage");
    expect(checkNames).toContain("onchain-config-linkage");
    expect(checkNames).toContain("trust-anchor-available");
    expect(result.checks.every((c: any) => c.passed)).toBe(true);
  });

  it("fails closed when trust anchor is missing for chainId", async () => {
    const result = await verifyDeployment({
      mode: "onchain-required",
      manifestPath,
      rpcUrl: LIVE_RPC_URL,
      trustAnchor: {
        approvedFactoryAbiSha256: undefined,
        approvedConfigAbiSha256: undefined,
        expectedFactoryCodehash: undefined,
        expectedConfigCodehash: undefined,
      },
      silent: true,
    });

    expect(result.success).toBe(false);
    expect(result.onchainStatus).toBe("FAILED");
    const anchorCheck = result.checks.find((c: any) => c.name === "trust-anchor-available");
    expect(anchorCheck?.passed).toBe(false);
  });

  it("fails closed when on-chain bytecode does not match expected trust anchor codehash", async () => {
    const result = await verifyDeployment({
      mode: "onchain-required",
      manifestPath,
      rpcUrl: LIVE_RPC_URL,
      trustAnchor: {
        ...trustAnchor,
        expectedFactoryCodehash: "0x0000000000000000000000000000000000000000000000000000000000000001",
      },
      silent: true,
    });

    expect(result.success).toBe(false);
    expect(result.onchainStatus).toBe("FAILED");
    const codehashCheck = result.checks.find((c: any) => c.name === "onchain-factory-codehash");
    expect(codehashCheck?.passed).toBe(false);
  });

  it("fails closed when RPC endpoint is offline", async () => {
    const result = await verifyDeployment({
      mode: "onchain-required",
      manifestPath,
      rpcUrl: "http://127.0.0.1:9999",
      trustAnchor,
      silent: true,
    });

    expect(result.success).toBe(false);
    expect(result.onchainStatus).toBe("FAILED");
    const rpcCheck = result.checks.find((c: any) => c.name === "rpc-connectivity");
    expect(rpcCheck?.passed).toBe(false);
  });

  it("fails closed when live chain ID does not match manifest", async () => {
    const alteredManifestPath = path.resolve(TMP_DIR, "wrong-chain-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.network.chainId = 1;
    writeFileSync(alteredManifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const result = await verifyDeployment({
      mode: "onchain-required",
      manifestPath: alteredManifestPath,
      rpcUrl: LIVE_RPC_URL,
      trustAnchor,
      silent: true,
    });

    expect(result.success).toBe(false);
    expect(result.onchainStatus).toBe("FAILED");
    const chainCheck = result.checks.find((c: any) => c.name === "chain-id-match");
    expect(chainCheck?.passed).toBe(false);
  });
});
