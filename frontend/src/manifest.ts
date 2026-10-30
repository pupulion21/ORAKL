/** Deployment manifest schema + pure validation.
 *
 *  The manifest is the only bridge between a deployment and the frontend. It is
 *  deliberately strict: the frontend will not read a contract unless the manifest
 *  names chain 1983, the exact artifact hashes it was built with, and a deployment
 *  transaction that produced the expected runtime bytecode.
 */

import {QIE_PREDICTION_MARKET_ARTIFACT} from './abi.ts';
import {QIE_CHAIN_ID, QIE_CHAIN_NAME} from './constants.ts';

export interface DeploymentArtifactHashes {
  creationBytecodeKeccak256: string;
  runtimeBytecodeKeccak256: string;
  sourceKeccak256: string;
  settingsKeccak256: string;
  artifactSha256: string;
  abiSha256: string;
  compiler: string;
  evmVersion: string;
  optimizer: boolean;
  bytecodeHash: string;
}

export interface DeploymentManifest {
  schemaVersion: 1;
  status: 'ACTIVE';
  network: {name: string; chainId: number};
  address: string;
  deployment: {
    txHash: string;
    blockNumber: string;
    blockHash: string;
    deployer: string;
    deployedAt: string;
  };
  artifact: DeploymentArtifactHashes;
  verification: {
    runtimeCodeMatches: boolean;
    marketCountReadable: boolean;
    marketCount: string;
    verifiedAt: string;
    verifier: string;
  };
}

export interface NotDeployedManifest {
  schemaVersion: 1;
  status: 'NOT_DEPLOYED';
  network: {name: string; chainId: number};
  artifact: DeploymentArtifactHashes;
}

export type ManifestParseResult =
  | {kind: 'NOT_DEPLOYED'; value: NotDeployedManifest}
  | {kind: 'ACTIVE'; manifest: DeploymentManifest}
  | {kind: 'INVALID'; reason: string};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isAddress(value: unknown): value is string {
  return isString(value) && ADDRESS_RE.test(value);
}

function isHash(value: unknown): value is string {
  return isString(value) && HASH_RE.test(value);
}

function artifactMatches(value: unknown): value is DeploymentArtifactHashes {
  if (!isObject(value)) return false;
  const expected = QIE_PREDICTION_MARKET_ARTIFACT;
  return (
    value.creationBytecodeKeccak256 === expected.creationBytecodeKeccak256 &&
    value.runtimeBytecodeKeccak256 === expected.runtimeBytecodeKeccak256 &&
    value.sourceKeccak256 === expected.sourceKeccak256 &&
    value.settingsKeccak256 === expected.settingsKeccak256 &&
    value.artifactSha256 === expected.artifactSha256 &&
    value.abiSha256 === expected.abiSha256 &&
    value.compiler === expected.compiler &&
    value.evmVersion === expected.evmVersion &&
    value.optimizer === expected.optimizer &&
    value.bytecodeHash === expected.bytecodeHash
  );
}

function networkMatches(value: unknown): value is {name: string; chainId: number} {
  if (!isObject(value)) return false;
  return value.chainId === QIE_CHAIN_ID && isString(value.name) && value.name.length > 0;
}

function normalizeBlockNumber(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) return value;
  return null;
}

export function parseManifestJson(raw: string): ManifestParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {kind: 'INVALID', reason: 'Manifest is not valid JSON'};
  }
  if (!isObject(value)) return {kind: 'INVALID', reason: 'Manifest is not a JSON object'};
  if (value.schemaVersion !== 1) return {kind: 'INVALID', reason: 'Manifest schemaVersion must be 1'};
  if (!networkMatches(value.network)) {
    return {kind: 'INVALID', reason: `Manifest is not for ${QIE_CHAIN_NAME} (chain ${QIE_CHAIN_ID})`};
  }
  if (value.status === 'NOT_DEPLOYED') {
    if (!artifactMatches(value.artifact)) {
      return {kind: 'INVALID', reason: 'The NOT_DEPLOYED manifest artifact hashes do not match the frontend build'};
    }
    return {kind: 'NOT_DEPLOYED', value: value as unknown as NotDeployedManifest};
  }
  if (value.status !== 'ACTIVE') return {kind: 'INVALID', reason: 'Manifest status is not ACTIVE'};

  if (!isAddress(value.address)) return {kind: 'INVALID', reason: 'Invalid contract address'};
  if (value.address.toLowerCase() === ZERO_ADDRESS) return {kind: 'INVALID', reason: 'Contract address is the zero address'};
  if (!artifactMatches(value.artifact)) {
    return {kind: 'INVALID', reason: 'Manifest artifact hashes do not match the frontend build'};
  }

  if (!isObject(value.deployment)) return {kind: 'INVALID', reason: 'Manifest is missing deployment data'};
  const deployment = value.deployment;
  if (!isHash(deployment.txHash)) return {kind: 'INVALID', reason: 'Invalid deployment txHash'};
  const blockNumber = normalizeBlockNumber(deployment.blockNumber);
  if (blockNumber === null) return {kind: 'INVALID', reason: 'Invalid deployment blockNumber'};
  if (!isHash(deployment.blockHash)) return {kind: 'INVALID', reason: 'Invalid deployment blockHash'};
  if (!isAddress(deployment.deployer)) return {kind: 'INVALID', reason: 'Invalid deployer'};
  if (!isString(deployment.deployedAt) || Number.isNaN(Date.parse(deployment.deployedAt))) {
    return {kind: 'INVALID', reason: 'deployedAt is not a valid ISO timestamp'};
  }

  if (!isObject(value.verification)) return {kind: 'INVALID', reason: 'Manifest is missing verification data'};
  const verification = value.verification;
  if (verification.runtimeCodeMatches !== true) {
    return {kind: 'INVALID', reason: 'Manifest reports a runtime code mismatch'};
  }
  if (verification.marketCountReadable !== true) {
    return {kind: 'INVALID', reason: 'Manifest reports marketCount as unreadable'};
  }
  if (!isString(verification.marketCount) || !/^(0|[1-9]\d*)$/.test(verification.marketCount)) {
    return {kind: 'INVALID', reason: 'Invalid manifest marketCount'};
  }
  if (!isString(verification.verifiedAt) || Number.isNaN(Date.parse(verification.verifiedAt))) {
    return {kind: 'INVALID', reason: 'verifiedAt is not a valid ISO timestamp'};
  }
  if (!isString(verification.verifier) || verification.verifier.length === 0) {
    return {kind: 'INVALID', reason: 'Verifier is missing'};
  }

  return {
    kind: 'ACTIVE',
    manifest: {
      schemaVersion: 1,
      status: 'ACTIVE',
      network: {name: value.network.name, chainId: QIE_CHAIN_ID},
      address: value.address,
      deployment: {
        txHash: deployment.txHash,
        blockNumber,
        blockHash: deployment.blockHash,
        deployer: deployment.deployer,
        deployedAt: deployment.deployedAt,
      },
      artifact: value.artifact as DeploymentArtifactHashes,
      verification: {
        runtimeCodeMatches: true,
        marketCountReadable: true,
        marketCount: verification.marketCount,
        verifiedAt: verification.verifiedAt,
        verifier: verification.verifier,
      },
    },
  };
}

export function artifactHashes(): DeploymentArtifactHashes {
  return {...QIE_PREDICTION_MARKET_ARTIFACT};
}

export function isSameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
