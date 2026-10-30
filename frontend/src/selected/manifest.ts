/** Strict validation of the LOCAL selected deployment manifest.
 *
 *  The manifest is the only bridge between the local Anvil deployment and this
 *  frontend. Validation is deliberately paranoid: chain id must be 31337, the
 *  safety block must disclaim public deployment and production approval, every
 *  address/hash must be well-formed, and the runtime bytecode keccak-256 in the
 *  manifest must match the code actually deployed on the local chain. A
 *  mismatch fails closed: the UI never reads or writes an unverified contract.
 */

import type {Abi} from 'viem';
import {SELECTED_FACTORY_ABI, SELECTED_CONFIG_ABI} from './abi.ts';

export const LOCAL_CHAIN_ID = 31337;
export const LOCAL_CHAIN_NAME = 'ORAKL Local Selected (Anvil)';
export const LOCAL_NATIVE_SYMBOL = 'ETH';
export const LOCAL_NATIVE_DECIMALS = 18;
export const LOCAL_RPC_DEFAULT = 'http://127.0.0.1:8546';
export const LOCAL_DEPLOYMENT_URL = '/deployments/local-selected.json';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export interface LocalParameters {
  feeBps: number;
  creationBond: bigint;
  proposalBond: bigint;
  challengeBond: bigint;
  minContribution: bigint;
  poolCap: bigint;
  challengePeriod: number;
  arbitrationPeriod: number;
  globalUnresolvedCap: bigint;
  perArbitratorUnresolvedCap: bigint;
}

export interface LocalSelectedManifest {
  schemaVersion: 1;
  status: 'LOCAL_SIMULATION';
  mode: 'local-selected';
  safety: {publicDeployment: false; productionApproval: false; realFunds: false; note: string};
  network: {name: string; chainId: number; rpcUrl: string; nativeSymbol: string; nativeDecimals: number};
  release: {
    label: string;
    digest: string;
    recoveryDelaySeconds: number;
    activationAfter: number;
    activatedAt: string;
  };
  contracts: {
    selectedMarketFactory: {address: string; startBlock: number; runtimeCodeKeccak256: string};
    protocolConfig: {address: string; startBlock: number; runtimeCodeKeccak256: string};
  };
  roleMocks: {
    note: string;
    governance: {address: string; owners: string[]; threshold: number};
    compliance: {address: string; owners: string[]; threshold: number};
    arbitrator: {address: string; owners: string[]; threshold: number};
  };
  roles: Record<string, string>;
  parameters: {
    feeBps: number;
    creationBond: string;
    proposalBond: string;
    challengeBond: string;
    minContribution: string;
    poolCap: string;
    challengePeriod: number;
    arbitrationPeriod: number;
    globalUnresolvedCap: string;
    perArbitratorUnresolvedCap: string;
  };
  state: {financialActive: boolean; paused: boolean; activityEpoch: number; marketCount: number};
  verification: Record<string, boolean | string>;
}

export type LocalManifestLoad =
  | {kind: 'ACTIVE'; manifest: LocalSelectedManifest}
  | {kind: 'NOT_DEPLOYED'}
  | {kind: 'INVALID'; reason: string}
  | {kind: 'ERROR'; reason: string};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isAddress(value: unknown): value is string {
  return typeof value === 'string' && ADDRESS_RE.test(value);
}
function isHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_RE.test(value);
}
function isUintString(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
}

/** Parse and validate the manifest JSON. Any deviation returns INVALID and is
 *  never coerced into an ACTIVE deployment. */
export function parseLocalManifest(raw: string): LocalManifestLoad {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {kind: 'INVALID', reason: 'Manifest is not valid JSON'};
  }
  if (!isObject(value)) return {kind: 'INVALID', reason: 'Manifest is not a JSON object'};
  if (value.schemaVersion !== 1) return {kind: 'INVALID', reason: 'schemaVersion must be 1'};
  if (value.status !== 'LOCAL_SIMULATION') return {kind: 'INVALID', reason: 'status must be LOCAL_SIMULATION'};
  if (value.mode !== 'local-selected') return {kind: 'INVALID', reason: 'mode must be local-selected'};

  const safety = value.safety;
  if (!isObject(safety)) return {kind: 'INVALID', reason: 'missing safety block'};
  if (safety.publicDeployment !== false) return {kind: 'INVALID', reason: 'manifest claims publicDeployment'};
  if (safety.productionApproval !== false) return {kind: 'INVALID', reason: 'manifest claims productionApproval'};
  if (safety.realFunds !== false) return {kind: 'INVALID', reason: 'manifest claims realFunds'};

  const network = value.network;
  if (!isObject(network)) return {kind: 'INVALID', reason: 'missing network block'};
  if (network.chainId !== LOCAL_CHAIN_ID) {
    return {kind: 'INVALID', reason: `network.chainId must be ${LOCAL_CHAIN_ID}`};
  }
  if (typeof network.rpcUrl !== 'string' || network.rpcUrl.length === 0) {
    return {kind: 'INVALID', reason: 'network.rpcUrl missing'};
  }
  if (network.nativeSymbol !== LOCAL_NATIVE_SYMBOL || network.nativeDecimals !== LOCAL_NATIVE_DECIMALS) {
    return {kind: 'INVALID', reason: 'native currency mismatch'};
  }

  const release = value.release;
  if (!isObject(release)) return {kind: 'INVALID', reason: 'missing release block'};
  if (!isHash(release.digest)) return {kind: 'INVALID', reason: 'invalid release digest'};
  if (typeof release.recoveryDelaySeconds !== 'number' || release.recoveryDelaySeconds <= 0) {
    return {kind: 'INVALID', reason: 'invalid recoveryDelaySeconds'};
  }
  if (typeof release.activationAfter !== 'number') return {kind: 'INVALID', reason: 'invalid activationAfter'};

  const contracts = value.contracts;
  if (!isObject(contracts)) return {kind: 'INVALID', reason: 'missing contracts block'};
  const factory = contracts.selectedMarketFactory;
  const config = contracts.protocolConfig;
  if (!isObject(factory) || !isAddress(factory.address) || !isHash(factory.runtimeCodeKeccak256)) {
    return {kind: 'INVALID', reason: 'invalid selectedMarketFactory block'};
  }
  if (!isObject(config) || !isAddress(config.address) || !isHash(config.runtimeCodeKeccak256)) {
    return {kind: 'INVALID', reason: 'invalid protocolConfig block'};
  }
  if (factory.address.toLowerCase() === config.address.toLowerCase()) {
    return {kind: 'INVALID', reason: 'factory and config addresses are identical'};
  }

  const params = value.parameters;
  if (!isObject(params)) return {kind: 'INVALID', reason: 'missing parameters block'};
  for (const key of ['creationBond', 'proposalBond', 'challengeBond', 'minContribution', 'poolCap', 'globalUnresolvedCap', 'perArbitratorUnresolvedCap']) {
    if (!isUintString(params[key])) return {kind: 'INVALID', reason: `parameters.${key} must be a decimal string`};
  }
  if (typeof params.feeBps !== 'number' || params.feeBps < 0 || params.feeBps > 10_000) {
    return {kind: 'INVALID', reason: 'parameters.feeBps out of range'};
  }
  if (typeof params.challengePeriod !== 'number' || params.challengePeriod <= 0) {
    return {kind: 'INVALID', reason: 'invalid challengePeriod'};
  }
  if (typeof params.arbitrationPeriod !== 'number' || params.arbitrationPeriod <= 0) {
    return {kind: 'INVALID', reason: 'invalid arbitrationPeriod'};
  }

  const state = value.state;
  if (!isObject(state)) return {kind: 'INVALID', reason: 'missing state block'};
  if (state.financialActive !== true) return {kind: 'INVALID', reason: 'manifest state.financialActive is not true'};
  if (state.paused !== false) return {kind: 'INVALID', reason: 'manifest reports the protocol as paused'};

  const roleMocks = value.roleMocks;
  if (!isObject(roleMocks)) return {kind: 'INVALID', reason: 'missing roleMocks block'};
  for (const role of ['governance', 'compliance', 'arbitrator'] as const) {
    const mock = roleMocks[role];
    if (!isObject(mock) || !isAddress(mock.address)) return {kind: 'INVALID', reason: `invalid roleMocks.${role}`};
    if (typeof mock.threshold !== 'number' || mock.threshold < 2) {
      return {kind: 'INVALID', reason: `roleMocks.${role}.threshold must be >= 2`};
    }
  }

  const roles = value.roles;
  if (!isObject(roles) || !isAddress(roles.guardian)) return {kind: 'INVALID', reason: 'invalid roles block'};

  return {kind: 'ACTIVE', manifest: value as unknown as LocalSelectedManifest};
}

/** Fetch the manifest with no-store semantics. A missing file is NOT_DEPLOYED;
 *  an SPA HTML fallback is never accepted as a manifest. */
export async function loadLocalManifest(url = LOCAL_DEPLOYMENT_URL): Promise<LocalManifestLoad> {
  let response: Response;
  try {
    response = await fetch(url, {cache: 'no-store'});
  } catch (error) {
    return {kind: 'ERROR', reason: `Could not load manifest: ${error instanceof Error ? error.message : String(error)}`};
  }
  if (!response.ok) {
    if (response.status === 404) return {kind: 'NOT_DEPLOYED'};
    return {kind: 'ERROR', reason: `manifest HTTP ${response.status}`};
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return {kind: 'NOT_DEPLOYED'};
  }
  let raw: string;
  try {
    raw = await response.text();
  } catch (error) {
    return {kind: 'ERROR', reason: `Could not read manifest: ${error instanceof Error ? error.message : String(error)}`};
  }
  return parseLocalManifest(raw);
}

export function localParameters(manifest: LocalSelectedManifest): LocalParameters {
  const p = manifest.parameters;
  return {
    feeBps: p.feeBps,
    creationBond: BigInt(p.creationBond),
    proposalBond: BigInt(p.proposalBond),
    challengeBond: BigInt(p.challengeBond),
    minContribution: BigInt(p.minContribution),
    poolCap: BigInt(p.poolCap),
    challengePeriod: p.challengePeriod,
    arbitrationPeriod: p.arbitrationPeriod,
    globalUnresolvedCap: BigInt(p.globalUnresolvedCap),
    perArbitratorUnresolvedCap: BigInt(p.perArbitratorUnresolvedCap),
  };
}

export const SELECTED_FACTORIES: {
  factory: Abi;
  config: Abi;
} = {
  factory: SELECTED_FACTORY_ABI as unknown as Abi,
  config: SELECTED_CONFIG_ABI as unknown as Abi,
};
