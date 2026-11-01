#!/usr/bin/env node
/**
 * ORAKL P2 On-Chain & Local Artifact Deployment Verification Tool
 *
 * Explicit Modes:
 * 1. 'artifact-only': Validates local artifacts against compiled Foundry outputs,
 *    manifest self-consistency, safety boundaries, immutable linkages, and independent trust anchors.
 *    Clearly reports status as ONCHAIN_UNVERIFIED. Does NOT claim full deployment success.
 * 2. 'onchain-required': Enforces RPC access, chain ID match, nonempty runtime bytecode,
 *    runtime codehashes against independent trust anchors, approved ABI identity,
 *    dynamically derived function selectors, and mutual factory-ProtocolConfig linkage.
 *    Any failure or offline RPC exits with a non-zero exit code.
 *
 * Usage:
 *   node scripts/p2/verify-deployment.mjs --mode <artifact-only|onchain-required> [--manifest <path>] [--rpc <url>]
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

export const CANONICAL_TRUST_ANCHORS = Object.freeze({
  31337: Object.freeze({
    chainId: 31337,
    approvedFactoryAbiSha256: "0x6c2afa5a7277da5962e6e9364aa6bd66fd289ada21fcc229d336023ffe3c7fdc",
    approvedConfigAbiSha256: "0xc9cfb7dbff2c16fe6f1b8aa5b0be64e355f164e052f7af3aaf4fa04a6e176b8d",
    expectedFactoryCodehash: "0xb8a5bfea3c87dd1a6ff557e0c389166d8fe799efeba166edad200f1669f4a21a",
    expectedConfigCodehash: "0x418d1b9ebdf9fcdf2ce444d4bd898042aad86651aebb21d3f56b98c8c9950b5e",
    description: "Local Anvil Chain 31337 Pinned SelectedMarketFactory & ProtocolConfig Trust Anchor",
  }),
});

export function sha256Hex(bufferOrStr) {
  return '0x' + createHash('sha256').update(bufferOrStr).digest('hex');
}

export async function rpcCall(endpoint, method, params = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyDeployment(options = {}) {
  const { keccak256, toFunctionSelector } = await import('viem');
  const mode = options.mode || 'onchain-required';
  const manifestPath = options.manifestPath || resolve(REPO_ROOT, 'backend/deployments/local-selected.json');
  const rpcUrl = options.rpcUrl || 'http://127.0.0.1:8546';
  const silent = !!options.silent;

  if (mode !== 'artifact-only' && mode !== 'onchain-required') {
    throw new Error(`Invalid verification mode: ${mode}. Expected 'artifact-only' or 'onchain-required'.`);
  }

  const log = (...args) => {
    if (!silent) console.log(...args);
  };
  const errLog = (...args) => {
    if (!silent) console.error(...args);
  };

  log('=== ORAKL P2 Deployment & Artifact Verification ===');
  log(`Mode: ${mode}`);
  log(`Manifest Path: ${manifestPath}`);

  if (!existsSync(manifestPath)) {
    errLog(`FAIL: Manifest not found: ${manifestPath}`);
    return {
      success: false,
      mode,
      onchainStatus: 'FAILED',
      checks: [{ name: 'manifest-exists', passed: false, detail: `Manifest not found: ${manifestPath}` }],
      errors: [`Manifest not found: ${manifestPath}`],
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    errLog(`FAIL: Manifest JSON invalid: ${err.message}`);
    return {
      success: false,
      mode,
      onchainStatus: 'FAILED',
      checks: [{ name: 'manifest-json', passed: false, detail: err.message }],
      errors: [err.message],
    };
  }

  const checks = [];
  const record = (name, passed, detail) => {
    checks.push({ name, passed, detail });
    log(`[${passed ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  };

  // 1. Manifest Schema & Boundaries
  const chainId = manifest.network?.chainId;
  record('manifest-schema', manifest.schemaVersion === 1, `schemaVersion=${manifest.schemaVersion}`);
  record('manifest-status', manifest.status === 'LOCAL_SIMULATION', `status=${manifest.status}`);
  record('manifest-mode', manifest.mode === 'local-selected', `mode=${manifest.mode}`);
  record('manifest-safety-public', manifest.safety?.publicDeployment === false, `publicDeployment=${manifest.safety?.publicDeployment}`);

  // Resolve Independent Trust Anchor
  const canonicalAnchor = CANONICAL_TRUST_ANCHORS[chainId];
  const trustAnchor = {
    ...canonicalAnchor,
    ...(options.trustAnchor || {}),
  };

  const hasTrustAnchor = Boolean(
    trustAnchor.approvedFactoryAbiSha256 &&
    trustAnchor.approvedConfigAbiSha256 &&
    trustAnchor.expectedFactoryCodehash &&
    trustAnchor.expectedConfigCodehash
  );

  record(
    'trust-anchor-available',
    hasTrustAnchor,
    hasTrustAnchor
      ? `Independent trust anchor available for chainId ${chainId}`
      : `Missing or incomplete independent trust anchor for chainId ${chainId}`
  );

  // 2. Compiled Foundry Artifacts vs Manifest ABI Hashes
  const factoryArtifactPath = resolve(REPO_ROOT, 'contracts/out/SelectedMarketFactory.sol/SelectedMarketFactory.json');
  const configArtifactPath = resolve(REPO_ROOT, 'contracts/out/ProtocolConfig.sol/ProtocolConfig.json');

  let factoryArt = null;
  let configArt = null;

  if (existsSync(factoryArtifactPath)) {
    factoryArt = JSON.parse(readFileSync(factoryArtifactPath, 'utf8'));
    const factoryAbiSha = sha256Hex(JSON.stringify(factoryArt.abi));
    const manifestFactoryAbiSha = manifest.contracts?.selectedMarketFactory?.abiSha256;
    record(
      'factory-abi-hash',
      factoryAbiSha.toLowerCase() === manifestFactoryAbiSha?.toLowerCase(),
      `compiled=${factoryAbiSha.slice(0, 18)}... manifest=${manifestFactoryAbiSha?.slice(0, 18)}...`,
    );

    // Verify against independent trust anchor (mandatory)
    record(
      'trust-anchor-factory-abi',
      Boolean(trustAnchor.approvedFactoryAbiSha256 && manifestFactoryAbiSha?.toLowerCase() === trustAnchor.approvedFactoryAbiSha256.toLowerCase()),
      `manifest=${manifestFactoryAbiSha?.slice(0, 18)}... anchor=${trustAnchor.approvedFactoryAbiSha256?.slice(0, 18)}...`,
    );
  } else {
    record('factory-artifact', false, `artifact missing at ${factoryArtifactPath}`);
  }

  if (existsSync(configArtifactPath)) {
    configArt = JSON.parse(readFileSync(configArtifactPath, 'utf8'));
    const configAbiSha = sha256Hex(JSON.stringify(configArt.abi));
    const manifestConfigAbiSha = manifest.contracts?.protocolConfig?.abiSha256;
    record(
      'config-abi-hash',
      configAbiSha.toLowerCase() === manifestConfigAbiSha?.toLowerCase(),
      `compiled=${configAbiSha.slice(0, 18)}... manifest=${manifestConfigAbiSha?.slice(0, 18)}...`,
    );

    // Verify against independent trust anchor (mandatory)
    record(
      'trust-anchor-config-abi',
      Boolean(trustAnchor.approvedConfigAbiSha256 && manifestConfigAbiSha?.toLowerCase() === trustAnchor.approvedConfigAbiSha256.toLowerCase()),
      `manifest=${manifestConfigAbiSha?.slice(0, 18)}... anchor=${trustAnchor.approvedConfigAbiSha256?.slice(0, 18)}...`,
    );
  } else {
    record('config-artifact', false, `artifact missing at ${configArtifactPath}`);
  }

  // 3. Manifest Immutable Linkage
  const factoryAddr = manifest.contracts?.selectedMarketFactory?.address?.toLowerCase();
  const configAddr = manifest.contracts?.protocolConfig?.address?.toLowerCase();
  const immutables = manifest.contracts?.selectedMarketFactory?.immutableAssignment;
  let linkageOk = false;
  if (Array.isArray(immutables) && immutables.length > 0) {
    const boundConfig = `0x${immutables[0].slice(-40)}`.toLowerCase();
    linkageOk = boundConfig === configAddr;
  }
  record('manifest-immutable-linkage', linkageOk, `boundConfig=${immutables?.[0]} expected=${configAddr}`);

  // Check if any artifact validation failed
  const artifactFailures = checks.filter((c) => !c.passed);
  if (artifactFailures.length > 0) {
    errLog(`\nARTIFACT VERIFICATION FAILED: ${artifactFailures.length} check(s) failed.`);
    return {
      success: false,
      mode,
      onchainStatus: mode === 'artifact-only' ? 'UNVERIFIED' : 'FAILED',
      checks,
      errors: artifactFailures.map((c) => `${c.name}: ${c.detail}`),
    };
  }

  // Handle 'artifact-only' mode
  if (mode === 'artifact-only') {
    record(
      'onchain-unverified',
      true,
      'Mode is artifact-only. On-chain deployment verification was skipped.',
    );
    log('\nSTATUS: ONCHAIN_UNVERIFIED');
    log('Artifact checks passed. On-chain deployment identity is UNVERIFIED.');
    return {
      success: true,
      mode,
      onchainStatus: 'ONCHAIN_UNVERIFIED',
      checks,
      errors: [],
    };
  }

  // Handle 'onchain-required' mode
  log(`\nConnecting to RPC: ${rpcUrl} (required)...`);
  let onchainSuccess = true;
  try {
    const liveChainIdHex = await rpcCall(rpcUrl, 'eth_chainId');
    const liveChainId = parseInt(liveChainIdHex, 16);
    record('rpc-connectivity', true, `RPC ${rpcUrl} active with chainId ${liveChainId}`);
    record('chain-id-match', liveChainId === chainId, `live=${liveChainId} manifest=${chainId}`);
    if (liveChainId !== chainId) onchainSuccess = false;

    // Factory Code & Codehash (verified against independent trust anchor)
    const factoryBytecode = await rpcCall(rpcUrl, 'eth_getCode', [factoryAddr, 'latest']);
    const factoryHasCode = factoryBytecode && factoryBytecode !== '0x';
    record('onchain-factory-code', factoryHasCode, factoryHasCode ? `bytecode length=${factoryBytecode.length}` : 'bytecode is empty (0x)');
    if (!factoryHasCode) onchainSuccess = false;

    const factoryCodehash = factoryHasCode ? keccak256(factoryBytecode) : null;
    const manifestFactoryCodehash = manifest.contracts?.selectedMarketFactory?.runtimeCodeKeccak256?.toLowerCase();
    const expectedFactoryCodehash = trustAnchor.expectedFactoryCodehash?.toLowerCase();
    
    const factoryHashMatchesManifest = Boolean(manifestFactoryCodehash && factoryCodehash?.toLowerCase() === manifestFactoryCodehash);
    const factoryHashMatchesAnchor = Boolean(expectedFactoryCodehash && factoryCodehash?.toLowerCase() === expectedFactoryCodehash);
    const factoryHashMatch = factoryHashMatchesManifest && factoryHashMatchesAnchor;
    
    record(
      'onchain-factory-codehash',
      factoryHashMatch,
      `live=${factoryCodehash?.slice(0, 18)}... expectedAnchor=${expectedFactoryCodehash?.slice(0, 18)}...`,
    );
    if (!factoryHashMatch) onchainSuccess = false;

    // Config Code & Codehash (verified against independent trust anchor)
    const configBytecode = await rpcCall(rpcUrl, 'eth_getCode', [configAddr, 'latest']);
    const configHasCode = configBytecode && configBytecode !== '0x';
    record('onchain-config-code', configHasCode, configHasCode ? `bytecode length=${configBytecode.length}` : 'bytecode is empty (0x)');
    if (!configHasCode) onchainSuccess = false;

    const configCodehash = configHasCode ? keccak256(configBytecode) : null;
    const manifestConfigCodehash = manifest.contracts?.protocolConfig?.runtimeCodeKeccak256?.toLowerCase();
    const expectedConfigCodehash = trustAnchor.expectedConfigCodehash?.toLowerCase();

    const configHashMatchesManifest = Boolean(manifestConfigCodehash && configCodehash?.toLowerCase() === manifestConfigCodehash);
    const configHashMatchesAnchor = Boolean(expectedConfigCodehash && configCodehash?.toLowerCase() === expectedConfigCodehash);
    const configHashMatch = configHashMatchesManifest && configHashMatchesAnchor;

    record(
      'onchain-config-codehash',
      configHashMatch,
      `live=${configCodehash?.slice(0, 18)}... expectedAnchor=${expectedConfigCodehash?.slice(0, 18)}...`,
    );
    if (!configHashMatch) onchainSuccess = false;

    // Derive Function Selectors dynamically from approved compiled ABIs (Requirement 6)
    let protocolConfigSelector = '0xf5efbb4f';
    if (factoryArt?.abi) {
      const fn = factoryArt.abi.find((x) => x.type === 'function' && x.name === 'protocolConfig');
      if (fn) {
        protocolConfigSelector = toFunctionSelector(fn);
        record('factory-protocolConfig-selector-derived', true, `derived selector ${protocolConfigSelector} from compiled ABI`);
      } else {
        record('factory-protocolConfig-selector-derived', false, 'protocolConfig() not found in factory ABI');
        onchainSuccess = false;
      }
    }

    let factorySelector = '0xc45a0155';
    if (configArt?.abi) {
      const fn = configArt.abi.find((x) => x.type === 'function' && x.name === 'factory');
      if (fn) {
        factorySelector = toFunctionSelector(fn);
        record('config-factory-selector-derived', true, `derived selector ${factorySelector} from compiled ABI`);
      } else {
        record('config-factory-selector-derived', false, 'factory() not found in config ABI');
        onchainSuccess = false;
      }
    }

    // Call factory.protocolConfig() via derived selector
    const protocolConfigCall = await rpcCall(rpcUrl, 'eth_call', [
      { to: factoryAddr, data: protocolConfigSelector },
      'latest',
    ]);
    const liveBoundConfig = `0x${protocolConfigCall.slice(-40)}`.toLowerCase();
    const factoryLinkageMatch = liveBoundConfig === configAddr;
    record(
      'onchain-factory-linkage',
      factoryLinkageMatch,
      `factory.protocolConfig()=${liveBoundConfig} expected=${configAddr}`,
    );
    if (!factoryLinkageMatch) onchainSuccess = false;

    // Call config.factory() via derived selector
    const factoryCall = await rpcCall(rpcUrl, 'eth_call', [
      { to: configAddr, data: factorySelector },
      'latest',
    ]);
    const liveBoundFactory = `0x${factoryCall.slice(-40)}`.toLowerCase();
    const configLinkageMatch = liveBoundFactory === factoryAddr;
    record(
      'onchain-config-linkage',
      configLinkageMatch,
      `config.factory()=${liveBoundFactory} expected=${factoryAddr}`,
    );
    if (!configLinkageMatch) onchainSuccess = false;

  } catch (err) {
    record('rpc-connectivity', false, `RPC offline or call failed: ${err.message}`);
    onchainSuccess = false;
  }

  const failedChecks = checks.filter((c) => !c.passed);
  if (failedChecks.length > 0 || !onchainSuccess) {
    errLog(`\nVERIFICATION FAILED: ${failedChecks.length} check(s) failed in onchain-required mode.`);
    return {
      success: false,
      mode,
      onchainStatus: 'FAILED',
      checks,
      errors: failedChecks.map((c) => `${c.name}: ${c.detail}`),
    };
  }

  log(`\nVERIFICATION PASSED: All ${checks.length} deployment and on-chain identity checks passed.`);
  return {
    success: true,
    mode,
    onchainStatus: 'VERIFIED',
    checks,
    errors: [],
  };
}

// CLI Execution Entry Point
if (process.argv[1]?.endsWith('verify-deployment.mjs')) {
  const args = process.argv.slice(2);
  const modeIdx = args.indexOf('--mode');
  const mode = modeIdx >= 0 ? args[modeIdx + 1] : 'onchain-required';
  const manifestArgIdx = args.indexOf('--manifest');
  const manifestPath = manifestArgIdx >= 0 ? resolve(process.cwd(), args[manifestArgIdx + 1]) : undefined;
  const rpcArgIdx = args.indexOf('--rpc');
  const rpcUrl = rpcArgIdx >= 0 ? args[rpcArgIdx + 1] : undefined;

  verifyDeployment({ mode, manifestPath, rpcUrl })
    .then((res) => {
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal error during deployment verification:', err);
      process.exit(1);
    });
}
