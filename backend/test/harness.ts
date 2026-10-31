// ORAKL P1 — REAL integration harness.
// Dedicated Anvil (chainId 31337) on an ephemeral port, the real deployment
// pipeline via scripts/p1/deploy-local-selected.mjs, and the shared local
// PostgreSQL. No keys ever live in this file: every transaction is an
// unlocked-account eth_sendTransaction against the local dev chain, and the
// arbitrator/etc. role actions go through the deployed LocalRoleMock execute()
// exactly like production governance would.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  http,
  toHex,
  type Abi,
  type PublicClient,
} from "viem";

import { makePrisma } from "../src/db.js";
import { CONFIG_ABI, FACTORY_ABI, decodeLog } from "../src/indexer/events.js";
import type { DeploymentManifest } from "../src/indexer/manifest.js";

/** Deterministic Anvil dev fixtures (PUBLIC fixed addresses, no keys). The
 *  deployment pipeline re-verifies every role binding on chain, so a drift
 *  between this table and scripts/p1/lib.mjs fails loudly during deploy. */
export const DEV_ACCOUNTS = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
  "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
  "0x5b83F39285145284524B5a49d952616823253d3F",
  "0x689c5601518080d1c9d1395480F9e9dF7315473b",
  "0x31EE73D637B619De33079010a658558A6e81D7D8",
  "0x8328cFc17479F3247d695219084b49E4a989738F",
  "0x997F452d54C4f7f9B4a20c46bFb3D7d7D7c6b4c8",
];

export const LOCAL_ROLES = {
  deployer: DEV_ACCOUNTS[0]!,
  governanceOwners: [DEV_ACCOUNTS[1]!, DEV_ACCOUNTS[2]!],
  complianceOwners: [DEV_ACCOUNTS[3]!, DEV_ACCOUNTS[4]!],
  arbitratorOwners: [DEV_ACCOUNTS[5]!, DEV_ACCOUNTS[6]!],
  guardian: DEV_ACCOUNTS[7]!,
  creator: DEV_ACCOUNTS[8]!,
  yesParticipant: DEV_ACCOUNTS[9]!,
  noParticipant: DEV_ACCOUNTS[10]!,
  proposer: DEV_ACCOUNTS[11]!,
  challengerA: DEV_ACCOUNTS[12]!,
  challengerB: DEV_ACCOUNTS[13]!,
};

export const LOCAL_PARAMETERS = {
  feeBps: 200,
  creationBond: 10n ** 18n,
  proposalBond: 10n * 10n ** 18n,
  challengeBond: 10n ** 18n,
  minContribution: 10n ** 16n,
  poolCap: 100n * 10n ** 18n,
  challengePeriod: 48 * 3600,
  arbitrationPeriod: 96 * 3600,
};

export const CHAIN = 31337;

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export { CONFIG_ABI, FACTORY_ABI, decodeLog };

export type AnvilEnv = { proc: ChildProcess; rpcUrl: string; port: number };
export type Client = ReturnType<typeof createPublicClient>;

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Boot an isolated Anvil with the standard deterministic settings. */
export async function startAnvil(rpcDir: string): Promise<AnvilEnv> {
  mkdirSync(rpcDir, { recursive: true });
  const port = randomInt(20000, 41000);
  const proc = spawn(
    "anvil",
    [
      "--chain-id", "31337",
      "--port", String(port),
      "--host", "127.0.0.1",
      "--accounts", "20",
      "--balance", "10000",
      "--gas-limit", "60000000",
      "--code-size-limit", "100000",
      "--auto-impersonate",
      "--silent",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const rpcUrl = `http://127.0.0.1:${port}`;
  const pc = makeClient(rpcUrl);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if ((await pc.getChainId()) === 31337) {
        // Deterministic dev signers only cover the first 10 derived accounts.
        // Fixture addresses beyond index 9 are not mnemonic derivations: they
        // send through auto-impersonation and therefore need explicit balances
        // for gas and value.
        for (const [i, account] of DEV_ACCOUNTS.entries()) {
          if (i >= 10) {
            await pc.request({
              method: "anvil_setBalance",
              params: [account, toHex(10_000n * 10n ** 18n)],
            });
          }
        }
        return { proc, rpcUrl, port };
      }
    } catch {
      // not up yet
    }
    if (proc.exitCode != null) throw new Error(`anvil exited early (code ${proc.exitCode})`);
    await sleep(120);
  }
  proc.kill("SIGKILL");
  throw new Error("anvil startup timeout");
}

export async function stopAnvil(env: AnvilEnv): Promise<void> {
  env.proc.kill("SIGTERM");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && env.proc.exitCode == null) await sleep(100);
  if (env.proc.exitCode == null) env.proc.kill("SIGKILL");
}

/** Run the REAL deploy pipeline against the harness Anvil. */
export async function deploySelected(
  rpcUrl: string,
  manifestPath: string,
): Promise<DeploymentManifest> {
  const res = spawnSync(
    "node",
    [path.join(REPO_ROOT, "scripts", "p1", "deploy-local-selected.mjs")],
    {
      env: { ...process.env, ORAKL_LOCAL_RPC_URL: rpcUrl, ORAKL_MANIFEST_OUT: manifestPath },
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  if (res.status !== 0) {
    throw new Error(`deploy pipeline failed (exit ${res.status}):\n${res.stdout}\n${res.stderr}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as DeploymentManifest;
  if (manifest.status !== "LOCAL_SIMULATION" || manifest.mode !== "local-selected") {
    throw new Error(`deploy produced unexpected manifest status (${manifest.status})`);
  }
  return manifest;
}

export function makeClient(rpcUrl: string): Client {
  return createPublicClient({ cacheTime: 0, transport: http(rpcUrl, { timeout: 10_000 }), chain: undefined });
}

export type TxOpts = { from: string; to: string; data?: `0x${string}`; value?: bigint };

export async function sendTx(pc: Client, opts: TxOpts): Promise<`0x${string}`> {
  return (await pc.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: opts.from,
        to: opts.to,
        data: opts.data ?? "0x",
        ...(opts.value != null ? { value: toHex(opts.value) } : {}),
      },
    ],
  })) as `0x${string}`;
}

export type Receipt = Awaited<ReturnType<Client["waitForTransactionReceipt"]>>;

export async function waitOk(pc: Client, hash: `0x${string}`): Promise<Receipt> {
  const receipt = await pc.waitForTransactionReceipt({ hash, pollingInterval: 50 });
  if (receipt.status !== "success") {
    throw new Error(`tx reverted ${hash}`);
  }
  return receipt;
}

export async function sendOk(pc: Client, opts: TxOpts): Promise<Receipt> {
  return waitOk(pc, await sendTx(pc, opts));
}

/** Expect a contract revert; returns the receipt instead of throwing. */
export async function sendRevert(pc: Client, opts: TxOpts): Promise<Receipt> {
  const hash = await sendTx(pc, opts);
  const receipt = await pc.waitForTransactionReceipt({ hash, pollingInterval: 50 });
  if (receipt.status !== "reverted") throw new Error(`expected revert, got status ${receipt.status}`);
  return receipt;
}

/** Decoded catalog event args from a receipt (order preserved). */
export function decodedEvents(receipt: Receipt): Array<{ name: string; args: Record<string, unknown> }> {
  const out: Array<{ name: string; args: Record<string, unknown> }> = [];
  for (const log of receipt.logs) {
    const decoded = decodeLog(log as never);
    if (decoded) out.push({ name: decoded.eventName, args: decoded.args });
  }
  return out;
}

export function encode(abi: Abi, name: string, args: unknown[]): `0x${string}` {
  return encodeFunctionData({ abi, functionName: name as never, args: args as never });
}

export async function readCall<T = unknown>(
  pc: Client,
  address: string,
  abi: Abi,
  name: string,
  args: unknown[],
): Promise<T> {
  const data = encode(abi, name, args);
  const raw = (await pc.request({
    method: "eth_call",
    params: [{ to: address, data }, "latest"],
  })) as `0x${string}`;
  return decodeFunctionResult({ abi, functionName: name as never, data: raw }) as T;
}

/** N-of-M LocalRoleMock action: confirm from every owner until the observed
 *  state flips, exactly like scripts/p1/lib.mjs' multisigExecute. */
export async function mockExecute(
  pc: Client,
  opts: { mock: string; owners: string[]; to: string; data: `0x${string}`; observed: () => Promise<string> },
): Promise<{ executedBy: string }> {
  const calldata = encode(
    [
      {
        type: "function",
        name: "execute",
        stateMutability: "payable",
        inputs: [
          { name: "target", type: "address" },
          { name: "data", type: "bytes" },
        ],
        outputs: [{ name: "result", type: "bytes" }],
      },
    ] as Abi,
    "execute",
    [opts.to, opts.data],
  );
  const before = await opts.observed();
  for (const owner of opts.owners) {
    const hash = await sendTx(pc, { from: owner, to: opts.mock, data: calldata });
    await waitOk(pc, hash);
    const now = await opts.observed();
    if (now !== before) return { executedBy: owner };
  }
  throw new Error("LocalRoleMock never reached threshold");
}

/** Fast-forward the local chain clock (Anvil only). */
export async function advance(pc: Client, seconds: number): Promise<void> {
  await pc.request({ method: "evm_increaseTime", params: [seconds] });
  await pc.request({ method: "evm_mine", params: [] });
}

export async function liveTimestamp(pc: Client): Promise<bigint> {
  const b = await pc.getBlock();
  return b.timestamp;
}

/** Wipe every row this test suite created for the local chain. */
export async function wipeChain(prisma: ReturnType<typeof makePrisma>, chainId: number = CHAIN): Promise<void> {
  await prisma.protocolFeeAccrual.deleteMany({ where: { chainId } });
  await prisma.accountingSnapshot.deleteMany({ where: { chainId } });
  await prisma.market.deleteMany({ where: { chainId } });
  await prisma.indexedEvent.deleteMany({ where: { chainId } });
  await prisma.indexedBlock.deleteMany({ where: { chainId } });
  await prisma.indexerRollback.deleteMany({ where: { chainId } });
  await prisma.indexerCheckpoint.deleteMany({ where: { chainId } });
  await prisma.transactionRecord.deleteMany({ where: { chainId } });
  await prisma.contractDeployment.deleteMany({ where: { chainId } });
  await prisma.marketMetadata.deleteMany({ where: { chainId } });
  await prisma.evidenceArtifact.deleteMany({ where: { chainId } });
}
