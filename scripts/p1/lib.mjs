/** Shared helpers for the P1 LOCAL selected-protocol tooling.
 *
 *  Scope: isolated Anvil only. Every entry point refuses any chain id other than
 *  31337 and never holds, prints or derives a private key. Transactions are sent
 *  through Anvil's unlocked development accounts using eth_sendTransaction.
 */
import {createPublicClient, createWalletClient, custom, defineChain, encodeFunctionData} from 'viem';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export const LOCAL_CHAIN_ID = 31337;
export const LOCAL_RPC_URL = process.env.ORAKL_LOCAL_RPC_URL ?? 'http://127.0.0.1:8546';
export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
export const RELEASE_LABEL = 'ORAKL-P1-LOCAL-ONLY; no production approval';

/** Anvil development accounts. These are the public, deterministic Anvil fixtures,
 *  never used against a public network. Addresses only — no keys are stored here. */
export const DEV_ACCOUNTS = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
  '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
  '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
  '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
  '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720',
  '0x5B83f39285145284524b5a49d952616823253D3F',
  '0x689C5601518080d1C9d1395480F9E9dF7315473b',
  '0x31Ee73d637B619dE33079010a658558a6e81d7D8',
  '0x8328cfC17479F3247d695219084B49E4A989738F',
  '0x997F452d54C4f7F9B4a20c46BfB3d7d7d7C6b4C8',
];

/** Role assignment for the local fixture. Owner sets are pairwise disjoint, as
 *  required by ProtocolConfig._disjoint. The guardian is not an owner anywhere. */
export const LOCAL_ROLES = {
  deployer: DEV_ACCOUNTS[0],
  governanceOwners: [DEV_ACCOUNTS[1], DEV_ACCOUNTS[2]],
  complianceOwners: [DEV_ACCOUNTS[3], DEV_ACCOUNTS[4]],
  arbitratorOwners: [DEV_ACCOUNTS[5], DEV_ACCOUNTS[6]],
  guardian: DEV_ACCOUNTS[7],
  creator: DEV_ACCOUNTS[8],
  yesParticipant: DEV_ACCOUNTS[9],
  noParticipant: DEV_ACCOUNTS[10],
  proposer: DEV_ACCOUNTS[11],
  challengerA: DEV_ACCOUNTS[12],
  challengerB: DEV_ACCOUNTS[13],
  spare: DEV_ACCOUNTS[14],
};

/** Selected-v1 economics. Every value is re-validated on chain by
 *  SelectedMarketFactory._validateTerms, so a typo cannot silently deploy. */
export const LOCAL_PARAMETERS = {
  feeBps: 200,
  creationBond: 10n ** 18n, // 1 ether
  proposalBond: 10n * 10n ** 18n, // 10 ether
  challengeBond: 10n ** 18n, // 1 ether
  minContribution: 10n ** 16n, // 0.01 ether
  poolCap: 100n * 10n ** 18n, // 100 ether
  challengePeriod: 48 * 3600,
  arbitrationPeriod: 96 * 3600,
};

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function fail(message) {
  throw new Error(message);
}

export const localChain = defineChain({
  id: LOCAL_CHAIN_ID,
  name: 'ORAKL Local Selected (Anvil)',
  nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
  rpcUrls: {default: {http: [LOCAL_RPC_URL]}},
  testnet: true,
});

function rawRpc(url = LOCAL_RPC_URL) {
  let id = 0;
  /** Accepts both viem's transport shape `({method, params})` and the
   *  positional `(method, params)` shape used by the local helper calls. */
  return async (methodOrArgs, maybeParams) => {
    const method = typeof methodOrArgs === 'string' ? methodOrArgs : methodOrArgs?.method;
    const params = (typeof methodOrArgs === 'string' ? maybeParams : methodOrArgs?.params) ?? [];
    if (typeof method !== 'string') throw new Error('RPC request is missing a method name');
    const response = await fetch(url, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params}),
    });
    if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`${method}: ${body.error.message} (${body.error.code})`);
    return body.result;
  };
}

export function makeClients(url = LOCAL_RPC_URL) {
  const request = rawRpc(url);
  const transport = custom({request});
  const publicClient = createPublicClient({chain: localChain, transport});
  const walletClient = createWalletClient({chain: localChain, transport});
  return {publicClient, walletClient, request};
}

/** Refuse to run against anything except the isolated development chain. */
export async function requireLocalChain(request = rawRpc()) {
  const hex = await request('eth_chainId');
  const id = Number.parseInt(hex, 16);
  assert(id === LOCAL_CHAIN_ID, `Refusing to run: eth_chainId ${id} != ${LOCAL_CHAIN_ID}`);
  return id;
}

export function artifact(name) {
  const path = resolve(REPO_ROOT, 'contracts', 'out', `${name}.sol`, `${name}.json`);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  assert(parsed.metadata?.compiler?.version === '0.8.37+commit.f401782d', `${name}: compiler identity mismatch`);
  return parsed;
}

export function sha256(bytes) {
  return `0x${createHash('sha256').update(bytes).digest('hex')}`;
}

export function hexToBytes(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  assert(clean.length % 2 === 0, 'odd-length hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

/** Deployed runtime verification that accounts for immutables.
 *
 *  The compiler template carries zeros where immutable values are patched in.
 *  We know every immutable value independently (constructor inputs and the
 *  SelectedMarketFactory cap derivations), so we search for the assignment of
 *  those known values onto the artifact's immutable reference ids that reproduces
 *  the deployed code exactly. A blind template comparison would always fail; an
 *  unverified comparison would prove nothing.
 */
export function verifyRuntimeCode(name, deployedHex, knownValues) {
  const art = artifact(name);
  const template = hexToBytes(art.deployedBytecode.object);
  const deployed = hexToBytes(deployedHex);
  assert(template.length === deployed.length, `${name}: runtime length ${deployed.length} != template ${template.length}`);

  const ids = Object.keys(art.deployedBytecode.immutableReferences ?? {});
  const slots = ids.map((id) => art.deployedBytecode.immutableReferences[id]);
  assert(knownValues.length === ids.length, `${name}: expected ${ids.length} immutable values, got ${knownValues.length}`);

  for (const permutation of permutations(knownValues)) {
    const patched = Uint8Array.from(template);
    let ok = true;
    for (let i = 0; i < ids.length && ok; i += 1) {
      const word = permutation[i];
      for (const range of slots[i]) {
        for (let b = 0; b < range.length; b += 1) {
          const byte = Number((word >> BigInt(8 * (range.length - 1 - b))) & 0xffn);
          if (patched[range.start + b] !== byte) {
            patched[range.start + b] = byte;
          }
        }
      }
    }
    if (ok) {
      for (let i = 0; i < deployed.length; i += 1) {
        if (patched[i] !== deployed[i]) {
          ok = false;
          break;
        }
      }
    }
    if (ok) {
      return {
        name,
        immutableIds: ids,
        immutableAssignment: permutation.map((value) => `0x${value.toString(16).padStart(64, '0')}`),
        runtimeBytes: deployed.length,
        matches: true,
      };
    }
  }
  fail(`${name}: deployed runtime does not equal the template patched with any assignment of the expected immutable values`);
}

function* permutations(values) {
  if (values.length <= 1) {
    yield values;
    return;
  }
  for (let i = 0; i < values.length; i += 1) {
    const rest = values.slice(0, i).concat(values.slice(i + 1));
    for (const tail of permutations(rest)) yield [values[i], ...tail];
  }
}

/** Run an N-of-M LocalRoleMock call. The mock only executes once `threshold`
 *  distinct owners have confirmed the same (target, data, nonce) key, so this
 *  helper confirms from each owner in turn and stops as soon as the observed
 *  state predicate holds. */
export async function multisigExecute({walletClient, publicClient, mock, owners, to, data, value = 0n, observed}) {
  const calldata = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'execute',
        stateMutability: 'payable',
        inputs: [
          {name: 'target', type: 'address'},
          {name: 'data', type: 'bytes'},
        ],
        outputs: [{name: 'result', type: 'bytes'}],
      },
    ],
    functionName: 'execute',
    args: [to, data],
  });

  let before = await observed();
  for (const owner of owners) {
    const hash = await walletClient.sendTransaction({
      account: owner,
      to: mock,
      data: calldata,
      value,
      chain: localChain,
    });
    await publicClient.waitForTransactionReceipt({hash});
    const after = await observed();
    if (after !== before) return {hash, executed: true, by: owner};
    before = after;
  }
  return {hash: null, executed: false, by: null};
}

export function log(step, detail = '') {
  process.stdout.write(`[p1-local] ${step}${detail ? ` ${detail}` : ''}\n`);
}
