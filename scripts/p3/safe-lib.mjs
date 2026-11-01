/**
 * ORAKL Protocol — Official Safe v1.4.1 Deployment & Execution Library
 *
 * Provides deployment, configuration, transaction signing, and verification
 * for genuine official Safe Global smart contracts on isolated Anvil chain 31337.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  decodeEventLog,
  keccak256,
  getAddress,
  parseAbi,
} from 'viem';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

// Load Canonical Official Safe v1.4.1 Artifacts
export const SAFE_SINGLETON_ARTIFACT = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'contracts/p3-safe/canonical/Safe.json'), 'utf8')
);
export const SAFE_PROXY_FACTORY_ARTIFACT = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'contracts/p3-safe/canonical/SafeProxyFactory.json'), 'utf8')
);
export const SAFE_PROXY_ARTIFACT = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'contracts/p3-safe/canonical/SafeProxy.json'), 'utf8')
);

export const CANONICAL_SAFE_CODEHASH = '0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4';
export const CANONICAL_FACTORY_CODEHASH = '0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317';

export const GUARD_STORAGE_SLOT = '0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8';
export const FALLBACK_HANDLER_STORAGE_SLOT = '0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5';

/**
 * Deploy official Safe singleton and proxy factory with on-chain bytecode verification.
 */
export async function deploySafeInfrastructure(walletClient, publicClient) {
  // 1. Deploy Singleton
  const safeHash = await walletClient.deployContract({
    abi: SAFE_SINGLETON_ARTIFACT.abi,
    bytecode: SAFE_SINGLETON_ARTIFACT.bytecode,
  });
  const safeReceipt = await publicClient.waitForTransactionReceipt({ hash: safeHash });
  if (safeReceipt.status !== 'success') {
    throw new Error(`Safe singleton deployment failed: ${safeHash}`);
  }
  const singletonAddress = safeReceipt.contractAddress;

  // On-chain bytecode verification against pinned canonical identity
  const singletonCode = await publicClient.getBytecode({ address: singletonAddress });
  if (!singletonCode || singletonCode === '0x') {
    throw new Error(`Safe singleton at ${singletonAddress} has empty runtime bytecode`);
  }
  const actualSingletonCodehash = keccak256(singletonCode);
  if (actualSingletonCodehash.toLowerCase() !== CANONICAL_SAFE_CODEHASH.toLowerCase()) {
    throw new Error(
      `Safe singleton codehash mismatch: got ${actualSingletonCodehash}, expected ${CANONICAL_SAFE_CODEHASH}`
    );
  }

  // 2. Deploy Factory
  const factoryHash = await walletClient.deployContract({
    abi: SAFE_PROXY_FACTORY_ARTIFACT.abi,
    bytecode: SAFE_PROXY_FACTORY_ARTIFACT.bytecode,
  });
  const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: factoryHash });
  if (factoryReceipt.status !== 'success') {
    throw new Error(`SafeProxyFactory deployment failed: ${factoryHash}`);
  }
  const factoryAddress = factoryReceipt.contractAddress;

  // On-chain bytecode verification against pinned canonical identity
  const factoryCode = await publicClient.getBytecode({ address: factoryAddress });
  if (!factoryCode || factoryCode === '0x') {
    throw new Error(`SafeProxyFactory at ${factoryAddress} has empty runtime bytecode`);
  }
  const actualFactoryCodehash = keccak256(factoryCode);
  if (actualFactoryCodehash.toLowerCase() !== CANONICAL_FACTORY_CODEHASH.toLowerCase()) {
    throw new Error(
      `SafeProxyFactory codehash mismatch: got ${actualFactoryCodehash}, expected ${CANONICAL_FACTORY_CODEHASH}`
    );
  }

  return { singletonAddress, factoryAddress };
}

/**
 * Deploy a genuine Safe proxy with specified owners and threshold via SafeProxyFactory.
 * Validates proxy initialization, owners, threshold, mastercopy pointer, and absence of modules/guards.
 */
export async function deployRoleSafe(walletClient, publicClient, {
  factoryAddress,
  singletonAddress,
  owners,
  threshold = 3n,
  saltNonce = 1n,
  fallbackHandler = '0x0000000000000000000000000000000000000000',
}) {
  if (owners.length < 2 || owners.length > 32) {
    throw new Error(`Invalid owners count: ${owners.length}`);
  }
  if (threshold < 1n || threshold > BigInt(owners.length)) {
    throw new Error(`Invalid threshold: ${threshold} for ${owners.length} owners`);
  }

  const normalizedOwners = owners.map((a) => getAddress(a));

  const initializer = encodeFunctionData({
    abi: SAFE_SINGLETON_ARTIFACT.abi,
    functionName: 'setup',
    args: [
      normalizedOwners,
      BigInt(threshold),
      '0x0000000000000000000000000000000000000000',
      '0x',
      fallbackHandler,
      '0x0000000000000000000000000000000000000000',
      0n,
      '0x0000000000000000000000000000000000000000',
    ],
  });

  const txHash = await walletClient.writeContract({
    address: factoryAddress,
    abi: SAFE_PROXY_FACTORY_ARTIFACT.abi,
    functionName: 'createProxyWithNonce',
    args: [singletonAddress, initializer, BigInt(saltNonce)],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`Safe proxy creation failed: ${txHash}`);
  }

  // Find ProxyCreation event
  let proxyAddress = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: SAFE_PROXY_FACTORY_ARTIFACT.abi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'ProxyCreation') {
        proxyAddress = getAddress(decoded.args.proxy);
        break;
      }
    } catch {
      // not factory event
    }
  }

  if (!proxyAddress) {
    throw new Error('ProxyCreation event not found in receipt logs');
  }

  // Immediate fail-closed verification of deployed proxy state
  await verifySafeInstance(publicClient, proxyAddress, normalizedOwners, threshold, {
    expectedSingletonAddress: singletonAddress,
    expectedFallbackHandler: fallbackHandler,
  });

  return proxyAddress;
}

/**
 * Verify on-chain state and safety constraints of a deployed Safe proxy instance.
 * Enforces correct owners, threshold, mastercopy pointer, empty modules, and zero guards.
 */
export async function verifySafeInstance(publicClient, proxyAddress, expectedOwners, expectedThreshold, options = {}) {
  const proxy = getAddress(proxyAddress);

  // Read and verify mastercopy implementation slot (slot 0) first, before attempting proxy contract calls
  const masterCopyStorage = await publicClient.getStorageAt({
    address: proxy,
    slot: '0x0000000000000000000000000000000000000000000000000000000000000000',
  });
  const boundMasterCopy = `0x${masterCopyStorage?.slice(-40)}`.toLowerCase();
  if (options.expectedSingletonAddress) {
    const expMaster = getAddress(options.expectedSingletonAddress).toLowerCase();
    if (boundMasterCopy !== expMaster) {
      throw new Error(`Safe proxy mastercopy mismatch: expected ${expMaster}, got ${boundMasterCopy}`);
    }
  }

  const owners = await publicClient.readContract({
    address: proxy,
    abi: SAFE_SINGLETON_ARTIFACT.abi,
    functionName: 'getOwners',
  });
  const threshold = await publicClient.readContract({
    address: proxy,
    abi: SAFE_SINGLETON_ARTIFACT.abi,
    functionName: 'getThreshold',
  });
  const nonce = await publicClient.readContract({
    address: proxy,
    abi: SAFE_SINGLETON_ARTIFACT.abi,
    functionName: 'nonce',
  });

  const normalizedExpected = expectedOwners.map((a) => getAddress(a).toLowerCase());
  const normalizedActual = owners.map((a) => getAddress(a).toLowerCase());

  const ownersMatch =
    normalizedExpected.length === normalizedActual.length &&
    normalizedExpected.every((a) => normalizedActual.includes(a));
  if (!ownersMatch) {
    throw new Error(
      `Safe proxy owners mismatch: expected [${normalizedExpected.join(', ')}], got [${normalizedActual.join(', ')}]`
    );
  }

  const thresholdMatch = BigInt(threshold) === BigInt(expectedThreshold);
  if (!thresholdMatch) {
    throw new Error(`Safe proxy threshold mismatch: expected ${expectedThreshold}, got ${threshold}`);
  }

  // Verify unexpected modules (must be empty array)
  const [modules] = await publicClient.readContract({
    address: proxy,
    abi: SAFE_SINGLETON_ARTIFACT.abi,
    functionName: 'getModulesPaginated',
    args: ['0x0000000000000000000000000000000000000001', 10n],
  });
  if (modules && modules.length > 0) {
    throw new Error(`Unexpected modules enabled on Safe proxy ${proxy}: ${modules.join(', ')}`);
  }

  // Verify unexpected guard (slot 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8)
  const guardStorage = await publicClient.getStorageAt({
    address: proxy,
    slot: GUARD_STORAGE_SLOT,
  });
  const boundGuard = `0x${(guardStorage || '0x').slice(-40)}`.toLowerCase();
  if (boundGuard !== '0x0000000000000000000000000000000000000000') {
    throw new Error(`Unexpected guard enabled on Safe proxy ${proxy}: ${boundGuard}`);
  }

  // Verify fallback handler (slot 0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5)
  const fallbackStorage = await publicClient.getStorageAt({
    address: proxy,
    slot: FALLBACK_HANDLER_STORAGE_SLOT,
  });
  const boundFallback = `0x${(fallbackStorage || '0x').slice(-40)}`.toLowerCase();
  const expectedFallback = (options.expectedFallbackHandler || '0x0000000000000000000000000000000000000000').toLowerCase();
  if (boundFallback !== expectedFallback) {
    throw new Error(
      `Safe proxy fallback handler mismatch on ${proxy}: expected ${expectedFallback}, got ${boundFallback}`
    );
  }

  return {
    proxyAddress: proxy,
    owners: normalizedActual,
    threshold: Number(threshold),
    nonce: Number(nonce),
    ownersMatch,
    thresholdMatch,
    boundMasterCopy,
    modules: modules || [],
    guard: boundGuard,
    fallbackHandler: boundFallback,
  };
}

/**
 * Prepare, sign, and execute a Safe multisig transaction.
 * Decodes Safe ExecutionSuccess / ExecutionFailure events and tracks nonces before and after.
 */
export async function executeSafeTransaction(walletClient, publicClient, {
  safeAddress,
  to,
  value = 0n,
  data = '0x',
  operation = 0, // 0 = Call, 1 = DelegateCall
  safeTxGas = 0n,
  baseGas = 0n,
  gasPrice = 0n,
  gasToken = '0x0000000000000000000000000000000000000000',
  refundReceiver = '0x0000000000000000000000000000000000000000',
  signers, // Array of viem private key accounts
  customNonce = null,
}) {
  const safe = getAddress(safeAddress);
  const nonceBefore = customNonce !== null
    ? BigInt(customNonce)
    : await publicClient.readContract({
        address: safe,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'nonce',
      });

  const txHash = await publicClient.readContract({
    address: safe,
    abi: SAFE_SINGLETON_ARTIFACT.abi,
    functionName: 'getTransactionHash',
    args: [to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonceBefore],
  });

  // Sort signers strictly in ascending order of address
  const sortedSigners = [...signers].sort((a, b) =>
    a.address.toLowerCase().localeCompare(b.address.toLowerCase())
  );

  let signatures = '0x';
  for (const signer of sortedSigners) {
    const sig = await signer.sign({ hash: txHash });
    signatures += sig.slice(2);
  }

  const hash = await walletClient.writeContract({
    address: safe,
    abi: SAFE_SINGLETON_ARTIFACT.abi,
    functionName: 'execTransaction',
    args: [to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, signatures],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`execTransaction failed on-chain with tx hash: ${hash}`);
  }

  let executionSuccess = false;
  let executionFailure = false;
  let payment = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === safe.toLowerCase()) {
      try {
        const decoded = decodeEventLog({
          abi: SAFE_SINGLETON_ARTIFACT.abi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'ExecutionSuccess') {
          executionSuccess = true;
          payment = decoded.args.payment;
        } else if (decoded.eventName === 'ExecutionFailure') {
          executionFailure = true;
          payment = decoded.args.payment;
        }
      } catch {
        // non-safe log
      }
    }
  }

  const nonceAfter = await publicClient.readContract({
    address: safe,
    abi: SAFE_SINGLETON_ARTIFACT.abi,
    functionName: 'nonce',
  });

  return {
    txHash,
    receipt,
    signatures,
    nonceBefore,
    nonceAfter,
    executionSuccess,
    executionFailure,
    payment,
  };
}
