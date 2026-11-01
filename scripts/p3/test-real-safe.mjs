#!/usr/bin/env node
/**
 * ORAKL Protocol — Real Safe v1.4.1 3-of-5 Governance Integration Test Suite
 *
 * Implements 28 comprehensive execution and safety scenarios against
 * genuine, unmodified official Safe Global v1.4.1 smart contracts
 * bound to ORAKL ProtocolConfig and SelectedMarketFactory.
 *
 * Strictly executes on isolated local Anvil chain ID 31337.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
  decodeEventLog,
  parseAbi,
  getAddress,
  keccak256,
  toHex,
  concat,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  deploySafeInfrastructure,
  deployRoleSafe,
  verifySafeInstance,
  executeSafeTransaction,
  SAFE_SINGLETON_ARTIFACT,
  SAFE_PROXY_FACTORY_ARTIFACT,
} from './safe-lib.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const ANVIL_PORT = 8547;
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const CHAIN_ID = 31337;

const MNEMONIC = 'test test test test test test test test test test test junk';

const ERROR_SELECTORS = {
  'Unauthorized': '0x82b42900',
  'InvalidMultisig': '0x07de2154',
  'ControlChanged': '0xe1eb243c',
  'NotApproved': '0xc19f17a9',
  'InvalidTimelock': '0xf8d10e82',
  'InvalidTime': '0x6f7eac26',
  'InvalidState': '0xbaf3f0f7',
  'FinancialActivityDisabled': '0xc2622a0e',
};

function log(testId, msg) {
  console.log(`[TEST ${String(testId).padStart(2, '0')}] ${msg}`);
}

function pass(testId, msg) {
  console.log(`[PASS ${String(testId).padStart(2, '0')}] ${msg}`);
}

function fail(testId, msg) {
  console.error(`[FAIL ${String(testId).padStart(2, '0')}] ${msg}`);
  throw new Error(`Test ${testId} failed: ${msg}`);
}

/**
 * Asserts that a caught error matches an expected revert reason or error selector.
 * Fails immediately if the error is a transport/RPC failure or unrelated revert.
 */
function assertRevertMatches(err, expectedPattern, testId, contextDesc) {
  if (!err) {
    fail(testId, `${contextDesc}: expected revert matching "${expectedPattern}", but no error was thrown`);
  }
  const errStr = String(err?.message || err?.details || err?.shortMessage || err);
  const selector = ERROR_SELECTORS[expectedPattern];
  const matched = errStr.includes(expectedPattern) || (selector && errStr.includes(selector));
  if (!matched) {
    fail(
      testId,
      `${contextDesc}: expected revert matching "${expectedPattern}" (selector: ${selector || 'N/A'}), but got unexpected error: ${errStr.slice(0, 300)}`
    );
  }
}

/**
 * Compute canonical Safe EIP-712 transaction digest for any chainId and Safe address.
 */
function computeSafeTransactionHash(safeAddress, chainId, txData) {
  const DOMAIN_SEPARATOR_TYPEHASH = '0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218';
  const SAFE_TX_TYPEHASH = '0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8';

  const domainSeparator = keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32, uint256, address'),
      [DOMAIN_SEPARATOR_TYPEHASH, BigInt(chainId), getAddress(safeAddress)]
    )
  );

  const safeTxHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32, address, uint256, bytes32, uint8, uint256, uint256, uint256, address, address, uint256'),
      [
        SAFE_TX_TYPEHASH,
        getAddress(txData.to),
        txData.value || 0n,
        keccak256(txData.data || '0x'),
        txData.operation || 0,
        txData.safeTxGas || 0n,
        txData.baseGas || 0n,
        txData.gasPrice || 0n,
        getAddress(txData.gasToken || '0x0000000000000000000000000000000000000000'),
        getAddress(txData.refundReceiver || '0x0000000000000000000000000000000000000000'),
        BigInt(txData.nonce || 0n),
      ]
    )
  );

  return keccak256(
    concat(['0x1901', domainSeparator, safeTxHash])
  );
}

/**
 * Collect and sort ECDSA signatures in strictly ascending address order.
 */
async function signHashWithSigners(hash, signersList) {
  const sorted = [...signersList].sort((a, b) =>
    a.address.toLowerCase().localeCompare(b.address.toLowerCase())
  );
  let sigs = '0x';
  for (const s of sorted) {
    const sig = await s.sign({ hash });
    sigs += sig.slice(2);
  }
  return sigs;
}

export async function runRealSafeTestSuite() {
  console.log('=== ORAKL P3 Canonical Safe v1.4.1 Execution Test Suite ===');
  console.log(`Starting isolated Anvil on port ${ANVIL_PORT} (chainId ${CHAIN_ID})...`);

  // Launch isolated Anvil without code-size-limit override and without auto-impersonate
  const anvilProc = spawn(
    '/home/pupulion/.foundry/bin/anvil',
    [
      '--chain-id', String(CHAIN_ID),
      '--port', String(ANVIL_PORT),
      '--host', '127.0.0.1',
      '--accounts', '20',
      '--balance', '10000',
      '--gas-limit', '60000000',
    ],
    { stdio: 'ignore' }
  );

  // Wait for RPC to respond
  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const id = await publicClient.getChainId();
      if (id === CHAIN_ID) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  if (!ready) {
    anvilProc.kill('SIGKILL');
    throw new Error('Failed to start Anvil within 6 seconds');
  }

  try {
    const deployer = mnemonicToAccount(MNEMONIC, { addressIndex: 0 });
    const walletClient = createWalletClient({ account: deployer, transport: http(RPC_URL) });

    // Derive accounts:
    // Accounts 1..5: Governance Safe Owners
    // Accounts 6..10: Compliance Safe Owners
    // Accounts 11..15: Arbitration Safe Owners
    // Account 16: Guardian
    // Account 17: External / Unauthorized
    // Account 18: Market Proposer
    // Account 19: Market Challenger
    const govOwners = [1, 2, 3, 4, 5].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));
    const compOwners = [6, 7, 8, 9, 10].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));
    const arbOwners = [11, 12, 13, 14, 15].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));
    const guardian = mnemonicToAccount(MNEMONIC, { addressIndex: 16 });
    const externalAccount = mnemonicToAccount(MNEMONIC, { addressIndex: 17 });
    const proposerAccount = mnemonicToAccount(MNEMONIC, { addressIndex: 18 });
    const challengerAccount = mnemonicToAccount(MNEMONIC, { addressIndex: 19 });

    const externalWallet = createWalletClient({ account: externalAccount, transport: http(RPC_URL) });
    const guardianWallet = createWalletClient({ account: guardian, transport: http(RPC_URL) });
    const proposerWallet = createWalletClient({ account: proposerAccount, transport: http(RPC_URL) });
    const challengerWallet = createWalletClient({ account: challengerAccount, transport: http(RPC_URL) });

    // Deploy Safe Singletons and Factory with on-chain bytecode hashing
    log('init', 'Deploying official Safe singleton and SafeProxyFactory...');
    const { singletonAddress, factoryAddress } = await deploySafeInfrastructure(walletClient, publicClient);

    // Deploy 3 Role Safes (each verified for codehash, mastercopy slot 0, owners, threshold, modules, guard)
    log('init', 'Deploying Governance Safe (3-of-5)...');
    const govSafeAddress = await deployRoleSafe(walletClient, publicClient, {
      factoryAddress,
      singletonAddress,
      owners: govOwners.map((o) => o.address),
      threshold: 3n,
      saltNonce: 101n,
    });

    log('init', 'Deploying Compliance Safe (3-of-5)...');
    const compSafeAddress = await deployRoleSafe(walletClient, publicClient, {
      factoryAddress,
      singletonAddress,
      owners: compOwners.map((o) => o.address),
      threshold: 3n,
      saltNonce: 102n,
    });

    log('init', 'Deploying Arbitration Safe (3-of-5)...');
    const arbSafeAddress = await deployRoleSafe(walletClient, publicClient, {
      factoryAddress,
      singletonAddress,
      owners: arbOwners.map((o) => o.address),
      threshold: 3n,
      saltNonce: 103n,
    });

    // Deploy Protocol Contracts bound to genuine Safes
    log('init', 'Deploying ProtocolConfig and SelectedMarketFactory bound to Safes...');
    const configArt = JSON.parse(readFileSync(resolve(REPO_ROOT, 'contracts/out/ProtocolConfig.sol/ProtocolConfig.json'), 'utf8'));
    const factoryArt = JSON.parse(readFileSync(resolve(REPO_ROOT, 'contracts/out/SelectedMarketFactory.sol/SelectedMarketFactory.json'), 'utf8'));

    const initialParameters = {
      feeBps: 200, // 2%
      creationBond: 1000000000000000000n, // 1 ETH (poolCap / 100)
      proposalBond: 10000000000000000000n, // 10 ETH (poolCap / 10)
      challengeBond: 1000000000000000000n, // 1 ETH (poolCap / 100)
      minContribution: 10000000000000000n, // 0.01 ETH (poolCap / 10000)
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
    const configAddress = configReceipt.contractAddress;

    const selectedFactoryTx = await walletClient.deployContract({
      abi: factoryArt.abi,
      bytecode: factoryArt.bytecode.object,
      args: [configAddress],
    });
    const selectedFactoryReceipt = await publicClient.waitForTransactionReceipt({ hash: selectedFactoryTx });
    const selectedFactoryAddress = selectedFactoryReceipt.contractAddress;

    // Helper to sign transaction hash with specific owners
    async function signTx(safeAddr, signersList, txData, customNonce = null) {
      const safe = getAddress(safeAddr);
      const nonce = customNonce !== null
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
        args: [
          txData.to,
          txData.value || 0n,
          txData.data || '0x',
          txData.operation || 0,
          txData.safeTxGas || 0n,
          txData.baseGas || 0n,
          txData.gasPrice || 0n,
          txData.gasToken || '0x0000000000000000000000000000000000000000',
          txData.refundReceiver || '0x0000000000000000000000000000000000000000',
          nonce,
        ],
      });

      const signatures = await signHashWithSigners(txHash, signersList);
      return { txHash, signatures, nonce };
    }

    // ------------------------------------------------------------------------
    // SCENARIO 1: Five distinct owners configured
    // ------------------------------------------------------------------------
    const govState = await verifySafeInstance(publicClient, govSafeAddress, govOwners.map((o) => o.address), 3);
    if (!govState.ownersMatch || govState.owners.length !== 5) {
      fail(1, `Expected 5 distinct owners, got ${govState.owners.length}`);
    }
    pass(1, 'Five distinct owners configured on Governance Safe');

    // ------------------------------------------------------------------------
    // SCENARIO 2: Threshold exactly three
    // ------------------------------------------------------------------------
    if (govState.threshold !== 3) {
      fail(2, `Expected threshold 3, got ${govState.threshold}`);
    }
    pass(2, 'Threshold exactly three verified on Governance Safe');

    // ------------------------------------------------------------------------
    // SCENARIO 3: Two signatures cannot authorize execution
    // ------------------------------------------------------------------------
    const dummyTo = '0x0000000000000000000000000000000000000123';
    const twoSigners = [govOwners[0], govOwners[1]];
    const twoSigData = await signTx(govSafeAddress, twoSigners, { to: dummyTo, value: 0n, data: '0x' });

    const nonceBeforeSc3 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    let twoSigError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [dummyTo, 0n, '0x', 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', twoSigData.signatures],
      });
    } catch (err) {
      twoSigError = err;
    }
    assertRevertMatches(twoSigError, 'GS020', 3, 'Insufficient signatures');
    const nonceAfterSc3 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterSc3 !== nonceBeforeSc3) {
      fail(3, `Nonce modified on failed under-quorum execution: expected ${nonceBeforeSc3}, got ${nonceAfterSc3}`);
    }
    pass(3, 'Two signatures cannot authorize execution (reverted with GS020, nonce unmutated)');

    // ------------------------------------------------------------------------
    // SCENARIO 4: Three valid signatures can authorize execution
    // ------------------------------------------------------------------------
    const threeSigners = [govOwners[0], govOwners[1], govOwners[2]];
    const threeSigData = await signTx(govSafeAddress, threeSigners, { to: dummyTo, value: 0n, data: '0x' });
    const nonceBeforeSc4 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    const threeSigTx = await walletClient.writeContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'execTransaction',
      args: [dummyTo, 0n, '0x', 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', threeSigData.signatures],
    });
    const threeSigReceipt = await publicClient.waitForTransactionReceipt({ hash: threeSigTx });
    if (threeSigReceipt.status !== 'success') fail(4, 'Execution failed with 3 valid signatures');
    const nonceAfterSc4 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterSc4 !== nonceBeforeSc4 + 1n) {
      fail(4, `Expected nonce progression ${nonceBeforeSc4} -> ${nonceBeforeSc4 + 1n}, got ${nonceAfterSc4}`);
    }
    pass(4, 'Three valid signatures can authorize execution (ExecutionSuccess verified, nonce advanced)');

    // ------------------------------------------------------------------------
    // SCENARIO 5: Unregistered signer rejected
    // ------------------------------------------------------------------------
    const unregSigners = [govOwners[0], govOwners[1], externalAccount];
    const unregSigData = await signTx(govSafeAddress, unregSigners, { to: dummyTo, value: 0n, data: '0x' });
    const nonceBeforeSc5 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    let unregError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [dummyTo, 0n, '0x', 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', unregSigData.signatures],
      });
    } catch (err) {
      unregError = err;
    }
    assertRevertMatches(unregError, 'GS026', 5, 'Unregistered signer');
    const nonceAfterSc5 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterSc5 !== nonceBeforeSc5) {
      fail(5, `Nonce modified on rejected unregistered execution: expected ${nonceBeforeSc5}, got ${nonceAfterSc5}`);
    }
    pass(5, 'Unregistered signer rejected (reverted with GS026, nonce unmutated)');

    // ------------------------------------------------------------------------
    // SCENARIO 6: Duplicate signer rejected
    // ------------------------------------------------------------------------
    const dupSigner = govOwners[0];
    const nonceBeforeSc6 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    const dupSigHash = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'getTransactionHash',
      args: [dummyTo, 0n, '0x', 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', nonceBeforeSc6],
    });
    const singleSig = await dupSigner.sign({ hash: dupSigHash });
    const dupSignatures = '0x' + singleSig.slice(2) + singleSig.slice(2) + singleSig.slice(2);
    let dupError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [dummyTo, 0n, '0x', 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', dupSignatures],
      });
    } catch (err) {
      dupError = err;
    }
    assertRevertMatches(dupError, 'GS026', 6, 'Duplicate signer');
    const nonceAfterSc6 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterSc6 !== nonceBeforeSc6) {
      fail(6, `Nonce modified on rejected duplicate execution: expected ${nonceBeforeSc6}, got ${nonceAfterSc6}`);
    }
    pass(6, 'Duplicate signer rejected (reverted with GS026, nonce unmutated)');

    // ------------------------------------------------------------------------
    // SCENARIO 7: Incorrect signature order rejected
    // ------------------------------------------------------------------------
    const descSigners = [...threeSigners].sort((a, b) =>
      b.address.toLowerCase().localeCompare(a.address.toLowerCase())
    );
    let descSigs = '0x';
    for (const s of descSigners) {
      const sig = await s.sign({ hash: dupSigHash });
      descSigs += sig.slice(2);
    }
    const nonceBeforeSc7 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    let descError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [dummyTo, 0n, '0x', 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', descSigs],
      });
    } catch (err) {
      descError = err;
    }
    assertRevertMatches(descError, 'GS026', 7, 'Unsorted signatures');
    const nonceAfterSc7 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterSc7 !== nonceBeforeSc7) {
      fail(7, `Nonce modified on rejected unsorted execution: expected ${nonceBeforeSc7}, got ${nonceAfterSc7}`);
    }
    pass(7, 'Incorrect signature order rejected (reverted with GS026, nonce unmutated)');

    // ------------------------------------------------------------------------
    // SCENARIO 8: Invalid EIP-712 digest rejected
    // ------------------------------------------------------------------------
    const corruptedHash = '0x1234567890123456789012345678901234567890123456789012345678901234';
    const corruptedSigs = await signHashWithSigners(corruptedHash, threeSigners);
    const nonceBeforeSc8 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    let corruptError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [dummyTo, 0n, '0x', 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', corruptedSigs],
      });
    } catch (err) {
      corruptError = err;
    }
    assertRevertMatches(corruptError, 'GS026', 8, 'Corrupted digest');
    const nonceAfterSc8 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterSc8 !== nonceBeforeSc8) {
      fail(8, `Nonce modified on rejected corrupt digest execution: expected ${nonceBeforeSc8}, got ${nonceAfterSc8}`);
    }
    pass(8, 'Invalid EIP-712 digest rejected (reverted with GS026, nonce unmutated)');

    // ------------------------------------------------------------------------
    // SCENARIO 9: Tampered calldata rejected
    // ------------------------------------------------------------------------
    const validCalldataTx = await signTx(govSafeAddress, threeSigners, {
      to: dummyTo,
      value: 0n,
      data: '0x1234',
    });
    const nonceBeforeSc9 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    let tamperError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [dummyTo, 0n, '0x9999', 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', validCalldataTx.signatures],
      });
    } catch (err) {
      tamperError = err;
    }
    assertRevertMatches(tamperError, 'GS026', 9, 'Tampered calldata');
    const nonceAfterSc9 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterSc9 !== nonceBeforeSc9) {
      fail(9, `Nonce modified on rejected tampered calldata execution: expected ${nonceBeforeSc9}, got ${nonceAfterSc9}`);
    }
    pass(9, 'Tampered calldata rejected (reverted with GS026, nonce unmutated)');

    // ------------------------------------------------------------------------
    // SCENARIO 10: Wrong Safe proxy address invalidates signature (domain separator defense)
    // ------------------------------------------------------------------------
    // Deploy two dedicated test Safes sharing the exact same 5 signers and threshold 3.
    // Prove cross-proxy signature rejection (GS026) is driven strictly by proxy address
    // domain separation, not owner set mismatch.
    log('test 10', 'Deploying domainSafeA and domainSafeB with identical 5 owners...');
    const domainSafeA = await deployRoleSafe(walletClient, publicClient, {
      factoryAddress,
      singletonAddress,
      owners: govOwners.map((o) => o.address),
      threshold: 3n,
      saltNonce: 201n,
    });
    const domainSafeB = await deployRoleSafe(walletClient, publicClient, {
      factoryAddress,
      singletonAddress,
      owners: govOwners.map((o) => o.address),
      threshold: 3n,
      saltNonce: 202n,
    });
    if (domainSafeA.toLowerCase() === domainSafeB.toLowerCase()) {
      fail(10, 'domainSafeA and domainSafeB must have distinct addresses');
    }

    // Sign for domainSafeA with 3 owners
    const domainTxData = { to: dummyTo, value: 0n, data: '0x' };
    const domainSafeATx = await signTx(domainSafeA, threeSigners, domainTxData);

    // Submit domainSafeA's signatures to domainSafeB.execTransaction
    const nonceDomainBBefore = await publicClient.readContract({
      address: domainSafeB,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    let crossProxyError = null;
    try {
      await walletClient.writeContract({
        address: domainSafeB,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [
          domainTxData.to,
          domainTxData.value,
          domainTxData.data,
          0,
          0n,
          0n,
          0n,
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
          domainSafeATx.signatures,
        ],
      });
    } catch (err) {
      crossProxyError = err;
    }
    assertRevertMatches(crossProxyError, 'GS026', 10, 'Cross-proxy replay');

    // Verify domainSafeB nonce remains 0
    const nonceDomainB = await publicClient.readContract({
      address: domainSafeB,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceDomainB !== nonceDomainBBefore) {
      fail(10, `Expected domainSafeB nonce ${nonceDomainBBefore}, got ${nonceDomainB}`);
    }

    // Verify same signatures execute successfully on domainSafeA
    const domainAExec = await walletClient.writeContract({
      address: domainSafeA,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'execTransaction',
      args: [
        domainTxData.to,
        domainTxData.value,
        domainTxData.data,
        0,
        0n,
        0n,
        0n,
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
        domainSafeATx.signatures,
      ],
    });
    const domainAReceipt = await publicClient.waitForTransactionReceipt({ hash: domainAExec });
    if (domainAReceipt.status !== 'success') {
      fail(10, 'Legitimate execution on domainSafeA failed');
    }
    const nonceDomainA = await publicClient.readContract({
      address: domainSafeA,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceDomainA !== 1n) {
      fail(10, `Expected domainSafeA nonce 1, got ${nonceDomainA}`);
    }
    pass(10, 'Wrong Safe proxy address invalidates signature with identical signers (EIP-712 domain separation GS026, nonces verified)');

    // ------------------------------------------------------------------------
    // SCENARIO 11: Wrong chain ID invalidates signature
    // ------------------------------------------------------------------------
    const nonceBeforeSc11 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    const wrongChainTxData = {
      to: dummyTo,
      value: 0n,
      data: '0x',
      operation: 0,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
      nonce: nonceBeforeSc11,
    };
    // Compute digest under Ethereum Mainnet (chainId = 1) instead of local Anvil (31337)
    const mainnetHash = computeSafeTransactionHash(govSafeAddress, 1n, wrongChainTxData);
    const wrongChainSigs = await signHashWithSigners(mainnetHash, threeSigners);

    let wrongChainError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [
          wrongChainTxData.to,
          wrongChainTxData.value,
          wrongChainTxData.data,
          wrongChainTxData.operation,
          wrongChainTxData.safeTxGas,
          wrongChainTxData.baseGas,
          wrongChainTxData.gasPrice,
          wrongChainTxData.gasToken,
          wrongChainTxData.refundReceiver,
          wrongChainSigs,
        ],
      });
    } catch (err) {
      wrongChainError = err;
    }
    assertRevertMatches(wrongChainError, 'GS026', 11, 'Wrong chain ID');
    const nonceAfterSc11 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterSc11 !== nonceBeforeSc11) {
      fail(11, `Safe nonce modified on rejected wrong-chain execution: expected ${nonceBeforeSc11}, got ${nonceAfterSc11}`);
    }
    pass(11, 'Wrong chain ID invalidates signature (EIP-712 domain binds chainId 31337, nonce unmutated)');

    // ------------------------------------------------------------------------
    // SCENARIO 12: Replayed transaction rejected
    // ------------------------------------------------------------------------
    const replayPayload = await signTx(govSafeAddress, threeSigners, {
      to: dummyTo,
      value: 0n,
      data: '0x',
    });
    // First execution succeeds
    const firstExec = await walletClient.writeContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'execTransaction',
      args: [dummyTo, 0n, '0x', 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', replayPayload.signatures],
    });
    await publicClient.waitForTransactionReceipt({ hash: firstExec });
    const nonceAfterFirstExec = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });

    // Replay attempt with same signatures
    let replayError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [dummyTo, 0n, '0x', 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', replayPayload.signatures],
      });
    } catch (err) {
      replayError = err;
    }
    assertRevertMatches(replayError, 'GS026', 12, 'Replay protection');
    const nonceAfterReplay = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterReplay !== nonceAfterFirstExec) {
      fail(12, `Nonce modified on rejected replay execution: expected ${nonceAfterFirstExec}, got ${nonceAfterReplay}`);
    }
    pass(12, 'Replayed transaction rejected (reverted with GS026, nonce advanced monotonically)');

    // ------------------------------------------------------------------------
    // SCENARIO 13: Safe nonce increments correctly
    // ------------------------------------------------------------------------
    if (nonceAfterReplay !== 2n) fail(13, `Expected nonce 2, got ${nonceAfterReplay}`);
    pass(13, 'Safe nonce increments monotonically on successful execution');

    // ------------------------------------------------------------------------
    // SCENARIO 14: Invalid nonce signatures rejected
    // ------------------------------------------------------------------------
    const currentNonceGov = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    const futureNonce = currentNonceGov + 10n;
    const futureNonceTx = await signTx(govSafeAddress, threeSigners, {
      to: dummyTo,
      value: 0n,
      data: '0x',
    }, futureNonce);

    let futureNonceError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [
          dummyTo,
          0n,
          '0x',
          0,
          0n,
          0n,
          0n,
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
          futureNonceTx.signatures,
        ],
      });
    } catch (err) {
      futureNonceError = err;
    }
    assertRevertMatches(futureNonceError, 'GS026', 14, 'Future nonce rejection');
    const nonceAfterFutureAttempt = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterFutureAttempt !== currentNonceGov) {
      fail(14, `Safe nonce modified on failed execution: expected ${currentNonceGov}, got ${nonceAfterFutureAttempt}`);
    }
    pass(14, 'Invalid nonce signatures rejected (reverted with GS026, nonce unmutated)');

    // ------------------------------------------------------------------------
    // SCENARIO 15: Unauthorized direct call to ProtocolConfig rejected
    // ------------------------------------------------------------------------
    const factoryBeforeSc15 = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'factory',
    });
    let directCallError = null;
    try {
      await externalWallet.writeContract({
        address: configAddress,
        abi: configArt.abi,
        functionName: 'bindFactory',
        args: [selectedFactoryAddress],
      });
    } catch (err) {
      directCallError = err;
    }
    assertRevertMatches(directCallError, 'Unauthorized', 15, 'Unauthorized direct call to ProtocolConfig');
    const factoryAfterSc15 = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'factory',
    });
    if (factoryAfterSc15 !== factoryBeforeSc15) {
      fail(15, `Factory address mutated on rejected direct call: expected ${factoryBeforeSc15}, got ${factoryAfterSc15}`);
    }
    pass(15, 'Unauthorized direct call to ProtocolConfig rejected (onlyGovernance, state unmutated)');

    // ------------------------------------------------------------------------
    // SCENARIO 16: Governance Safe can bind factory as authorized
    // ------------------------------------------------------------------------
    const bindCalldata = encodeFunctionData({
      abi: configArt.abi,
      functionName: 'bindFactory',
      args: [selectedFactoryAddress],
    });
    const bindTx = await signTx(govSafeAddress, threeSigners, {
      to: configAddress,
      value: 0n,
      data: bindCalldata,
    });
    const bindExec = await walletClient.writeContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'execTransaction',
      args: [configAddress, 0n, bindCalldata, 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', bindTx.signatures],
    });
    await publicClient.waitForTransactionReceipt({ hash: bindExec });
    const boundFactory = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'factory',
    });
    if (boundFactory.toLowerCase() !== selectedFactoryAddress.toLowerCase()) {
      fail(16, `Bound factory mismatch: ${boundFactory}`);
    }
    pass(16, 'Governance Safe successfully executed bindFactory() via 3-of-5 multisig');

    // ------------------------------------------------------------------------
    // SCENARIO 17: Compliance Safe can approve the release
    // ------------------------------------------------------------------------
    const releaseTag = keccak256(toHex('ORAKL-P3-CANONICAL-SAFE-2026-11-01'));
    const approveCalldata = encodeFunctionData({
      abi: configArt.abi,
      functionName: 'approveRelease',
      args: [releaseTag],
    });
    const comp3Signers = compOwners.slice(0, 3);
    const approveTx = await signTx(compSafeAddress, comp3Signers, {
      to: configAddress,
      value: 0n,
      data: approveCalldata,
    });
    const approveExec = await walletClient.writeContract({
      address: compSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'execTransaction',
      args: [configAddress, 0n, approveCalldata, 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', approveTx.signatures],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveExec });
    const approvedRelease = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'approvedRelease',
    });
    if (approvedRelease !== releaseTag) fail(17, 'Compliance approval not recorded');
    pass(17, 'Compliance Safe successfully executed approveRelease() via 3-of-5 multisig');

    // ------------------------------------------------------------------------
    // SCENARIO 18: Governance Safe cannot bypass 24-hour timelock
    // ------------------------------------------------------------------------
    const activateCalldata = encodeFunctionData({
      abi: configArt.abi,
      functionName: 'activateFinance',
      args: [releaseTag],
    });
    const prematureTx = await signTx(govSafeAddress, threeSigners, {
      to: configAddress,
      value: 0n,
      data: activateCalldata,
    });
    const nonceBeforeSc18 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    let prematureError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [configAddress, 0n, activateCalldata, 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', prematureTx.signatures],
      });
    } catch (err) {
      prematureError = err;
    }
    assertRevertMatches(prematureError, 'GS013', 18, 'Premature activation');
    const nonceAfterSc18 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterSc18 !== nonceBeforeSc18) {
      fail(18, `Safe nonce modified on rejected premature activation: expected ${nonceBeforeSc18}, got ${nonceAfterSc18}`);
    }
    const financeActiveBeforeDelay = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'financialActive',
    });
    if (financeActiveBeforeDelay) fail(18, 'Finance state active before 24-hour delay');
    pass(18, 'Governance Safe cannot bypass 24-hour timelock (subcall reverted GS013/InvalidTimelock, state and nonce unmutated)');

    // ------------------------------------------------------------------------
    // SCENARIO 19: Governance Safe activates finance after delay elapses
    // ------------------------------------------------------------------------
    // Warp Anvil clock 24 hours + 10 seconds
    await publicClient.request({ method: 'evm_increaseTime', params: [86410] });
    await publicClient.request({ method: 'evm_mine', params: [] });

    const activateTx = await signTx(govSafeAddress, threeSigners, {
      to: configAddress,
      value: 0n,
      data: activateCalldata,
    });
    const activateExec = await walletClient.writeContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'execTransaction',
      args: [configAddress, 0n, activateCalldata, 0, 0n, 0n, 0n, '0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000', activateTx.signatures],
    });
    await publicClient.waitForTransactionReceipt({ hash: activateExec });
    const financeActiveAfter = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'financialActive',
    });
    if (!financeActiveAfter) fail(19, 'Finance failed to activate after timelock');
    pass(19, 'Governance Safe successfully activated finance after 24-hour timelock');

    // ------------------------------------------------------------------------
    // SCENARIO 20: Guardian can pause immediately
    // ------------------------------------------------------------------------
    const pauseTx = await guardianWallet.writeContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'pause',
    });
    await publicClient.waitForTransactionReceipt({ hash: pauseTx });
    const paused = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'paused',
    });
    if (!paused) fail(20, 'Guardian failed to pause');
    pass(20, 'Guardian paused protocol immediately without multisig quorum delay');

    // ------------------------------------------------------------------------
    // SCENARIO 21: Guardian cannot unpause
    // ------------------------------------------------------------------------
    let guardianUnpauseError = null;
    try {
      await guardianWallet.writeContract({
        address: configAddress,
        abi: configArt.abi,
        functionName: 'unpause',
      });
    } catch (err) {
      guardianUnpauseError = err;
    }
    assertRevertMatches(guardianUnpauseError, 'Unauthorized', 21, 'Guardian cannot unpause');
    const pausedStillTrue = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'paused',
    });
    if (!pausedStillTrue) fail(21, 'Protocol unexpectedly unpaused on rejected guardian attempt');
    pass(21, 'Guardian cannot unpause (restricted strictly to Governance Safe, state unmutated)');

    // ------------------------------------------------------------------------
    // SCENARIO 22: Emergency pause invalidates prior release approval
    // ------------------------------------------------------------------------
    const approvalAfterPause = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'approvedRelease',
    });
    if (approvalAfterPause !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
      fail(22, 'Prior approval was not cleared on emergency pause');
    }
    pass(22, 'Emergency pause invalidates prior release approval (epoch interrupted)');

    // ------------------------------------------------------------------------
    // SCENARIO 23: New compliance approval and timelock strictly precede unpause
    // ------------------------------------------------------------------------
    // Step 1: Governance attempts unpause without approval -> reverts GS013/NotApproved
    const unpauseCalldata = encodeFunctionData({
      abi: configArt.abi,
      functionName: 'unpause',
    });
    const unpauseTxWithoutApproval = await signTx(govSafeAddress, threeSigners, {
      to: configAddress,
      value: 0n,
      data: unpauseCalldata,
    });
    const nonceBeforeSc23Step1 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    let unpauseWithoutApprovalError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [
          configAddress,
          0n,
          unpauseCalldata,
          0,
          0n,
          0n,
          0n,
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
          unpauseTxWithoutApproval.signatures,
        ],
      });
    } catch (err) {
      unpauseWithoutApprovalError = err;
    }
    assertRevertMatches(unpauseWithoutApprovalError, 'GS013', 23, 'Unpause without approval');
    const nonceAfterSc23Step1 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterSc23Step1 !== nonceBeforeSc23Step1) {
      fail(23, `Safe nonce modified on rejected unpause: expected ${nonceBeforeSc23Step1}, got ${nonceAfterSc23Step1}`);
    }

    const stillPaused = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'paused',
    });
    if (!stillPaused) fail(23, 'Protocol unexpectedly unpaused without re-approval');

    // Step 2: Compliance Safe signs and executes approveRelease(recoveryTag)
    const recoveryTag = keccak256(toHex('ORAKL-P3-RECOVERY-UNPAUSE-2026-11-01'));
    const approveRecoveryCalldata = encodeFunctionData({
      abi: configArt.abi,
      functionName: 'approveRelease',
      args: [recoveryTag],
    });
    const approveRecoveryRes = await executeSafeTransaction(walletClient, publicClient, {
      safeAddress: compSafeAddress,
      to: configAddress,
      data: approveRecoveryCalldata,
      signers: compOwners.slice(0, 3),
    });
    if (!approveRecoveryRes.executionSuccess) {
      fail(23, 'Compliance Safe failed to execute approveRelease for recovery');
    }
    const approvedRecovery = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'approvedRelease',
    });
    if (approvedRecovery !== recoveryTag) {
      fail(23, `Approved release mismatch: expected ${recoveryTag}, got ${approvedRecovery}`);
    }

    // Step 3: Governance attempts unpause before timelock elapses -> reverts GS013/InvalidTimelock
    const unpauseTxPremature = await signTx(govSafeAddress, threeSigners, {
      to: configAddress,
      value: 0n,
      data: unpauseCalldata,
    });
    const nonceBeforeSc23Step3 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    let unpausePrematureError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [
          configAddress,
          0n,
          unpauseCalldata,
          0,
          0n,
          0n,
          0n,
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
          unpauseTxPremature.signatures,
        ],
      });
    } catch (err) {
      unpausePrematureError = err;
    }
    assertRevertMatches(unpausePrematureError, 'GS013', 23, 'Premature unpause before timelock');
    const nonceAfterSc23Step3 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterSc23Step3 !== nonceBeforeSc23Step3) {
      fail(23, `Safe nonce modified on rejected premature unpause: expected ${nonceBeforeSc23Step3}, got ${nonceAfterSc23Step3}`);
    }

    // Step 4: Warp time past 24-hour timelock (86,400s + 10s)
    await publicClient.request({ method: 'evm_increaseTime', params: [86410] });
    await publicClient.request({ method: 'evm_mine', params: [] });

    // Step 5: Governance Safe executes unpause after timelock elapses
    const unpauseExecRes = await executeSafeTransaction(walletClient, publicClient, {
      safeAddress: govSafeAddress,
      to: configAddress,
      data: unpauseCalldata,
      signers: threeSigners,
    });
    if (!unpauseExecRes.executionSuccess) {
      fail(23, 'Governance Safe unpause execution failed after timelock');
    }
    const pausedAfter = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'paused',
    });
    if (pausedAfter) {
      fail(23, 'Protocol remains paused after authorized Governance Safe unpause');
    }

    // Step 6: Governance Safe reactivates finance
    const reactivateCalldata = encodeFunctionData({
      abi: configArt.abi,
      functionName: 'activateFinance',
      args: [recoveryTag],
    });
    const reactivateExecRes = await executeSafeTransaction(walletClient, publicClient, {
      safeAddress: govSafeAddress,
      to: configAddress,
      data: reactivateCalldata,
      signers: threeSigners,
    });
    if (!reactivateExecRes.executionSuccess) {
      fail(23, 'Governance Safe reactivate finance execution failed');
    }
    const financeActiveAfterUnpause = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'financialActive',
    });
    if (!financeActiveAfterUnpause) {
      fail(23, 'Financial activity not reactivated after Governance Safe activation');
    }
    pass(23, 'New compliance approval and 24-hour timelock strictly precede unpause (unpause & finance reactivation succeeded)');

    // ------------------------------------------------------------------------
    // SCENARIO 24: Arbitrator Safe can execute authorized actions
    // ------------------------------------------------------------------------
    // Create a real market fixture, transition through CLOSED -> PROPOSED -> DISPUTED,
    // and execute settleDispute via 3-of-5 Arbitration Safe.
    const currentBlock = await publicClient.getBlock();
    const nowTime = Number(currentBlock.timestamp);

    const closeTime = BigInt(nowTime + 30);
    const resolutionTime = BigInt(nowTime + 40);
    const challengePeriod = 172800n; // 48 hours
    const arbitrationPeriod = 345600n; // 96 hours
    const maxResolutionTime = resolutionTime + challengePeriod + arbitrationPeriod + 172800n + 3600n; // + 48h buffer + 1h

    const metadataHash = keccak256(toHex('Market 001 Test Metadata'));
    const metadataURI = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

    log('test 24', 'Creating market fixture on SelectedMarketFactory...');
    const createMarketTx = await walletClient.writeContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'createMarket',
      args: [metadataHash, metadataURI, closeTime, resolutionTime, maxResolutionTime],
      value: 1000000000000000000n, // 1 ETH creationBond
    });
    await publicClient.waitForTransactionReceipt({ hash: createMarketTx });
    const marketId = 0n;

    // Warp time past closeTime and resolutionTime
    await publicClient.request({ method: 'evm_increaseTime', params: [50] });
    await publicClient.request({ method: 'evm_mine', params: [] });

    // Propose result: outcome YES (1)
    const proposeEvidence = keccak256(toHex('Evidence Proposer 001'));
    const proposeTx = await proposerWallet.writeContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'proposeResult',
      args: [marketId, 1, proposeEvidence],
      value: 10000000000000000000n, // 10 ETH proposalBond
    });
    await publicClient.waitForTransactionReceipt({ hash: proposeTx });

    // Challenge result: stake 1 ETH challengeBond
    const challengeEvidence = keccak256(toHex('Evidence Challenger 001'));
    const challengeTx = await challengerWallet.writeContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'challengeResult',
      args: [marketId, challengeEvidence],
      value: 1000000000000000000n, // 1 ETH challengeBond
    });
    await publicClient.waitForTransactionReceipt({ hash: challengeTx });

    // Verify market is now DISPUTED (state = 3)
    const marketBeforeSettle = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'getMarket',
      args: [marketId],
    });
    if (marketBeforeSettle.storedState !== 3) {
      fail(24, `Expected market state DISPUTED (3), got ${marketBeforeSettle.storedState}`);
    }

    // Warp time past challengeDeadline (48 hours = 172,800s + 10s)
    await publicClient.request({ method: 'evm_increaseTime', params: [172810] });
    await publicClient.request({ method: 'evm_mine', params: [] });

    // Settle dispute via Arbitration Safe (3-of-5 multisig)
    // Decision: NO (2)
    const arbRulingEvidence = keccak256(toHex('Arbitration Safe Ruling 001'));
    const settleCalldata = encodeFunctionData({
      abi: factoryArt.abi,
      functionName: 'settleDispute',
      args: [marketId, 2, arbRulingEvidence],
    });

    const settleRes = await executeSafeTransaction(walletClient, publicClient, {
      safeAddress: arbSafeAddress,
      to: selectedFactoryAddress,
      data: settleCalldata,
      signers: arbOwners.slice(0, 3),
    });
    if (!settleRes.executionSuccess) {
      fail(24, 'Arbitration Safe settleDispute transaction failed on-chain');
    }

    // Verify market is now FINALIZED (state = 4) and outcome is NO (2)
    const marketAfterSettle = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'getMarket',
      args: [marketId],
    });
    if (marketAfterSettle.storedState !== 4) {
      fail(24, `Expected market state FINALIZED (4), got ${marketAfterSettle.storedState}`);
    }
    if (marketAfterSettle.finalOutcome !== 2) {
      fail(24, `Expected final outcome NO (2), got ${marketAfterSettle.finalOutcome}`);
    }
    if (marketAfterSettle.decisionEvidence !== arbRulingEvidence) {
      fail(24, 'Decision evidence mismatch on resolved market');
    }
    pass(24, 'Arbitrator Safe successfully executed settleDispute() on disputed market via 3-of-5 multisig');

    // ------------------------------------------------------------------------
    // SCENARIO 25: Unauthorized arbitration decisions rejected
    // ------------------------------------------------------------------------
    // Workstream A2: Fix unauthorized arbitration isolation.
    // Market 0 was finalized in Scenario 24. We create dedicated fixture Market 1
    // and transition it to DISPUTED state within its active arbitration window.
    // Verify external EOA, Governance Safe, and Compliance Safe cannot settle
    // and do not mutate state/accounting/exposure.
    // Then verify authorized Arbitration Safe settles Market 1 to FINALIZED.
    const currentBlockM1 = await publicClient.getBlock();
    const nowTimeM1 = Number(currentBlockM1.timestamp);

    const closeTimeM1 = BigInt(nowTimeM1 + 30);
    const resolutionTimeM1 = BigInt(nowTimeM1 + 40);
    const challengePeriodM1 = 172800n; // 48 hours
    const arbitrationPeriodM1 = 345600n; // 96 hours
    const maxResolutionTimeM1 = resolutionTimeM1 + challengePeriodM1 + arbitrationPeriodM1 + 172800n + 3600n;

    const metadataHashM1 = keccak256(toHex('Market 002 Test Metadata'));
    const metadataURIM1 = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/2';

    log('test 25', 'Creating dedicated Market 1 fixture for dispute isolation...');
    const createMarketTx1 = await walletClient.writeContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'createMarket',
      args: [metadataHashM1, metadataURIM1, closeTimeM1, resolutionTimeM1, maxResolutionTimeM1],
      value: 1000000000000000000n, // 1 ETH creationBond
    });
    await publicClient.waitForTransactionReceipt({ hash: createMarketTx1 });
    const marketId1 = 1n;

    // Warp time past closeTimeM1 and resolutionTimeM1
    await publicClient.request({ method: 'evm_increaseTime', params: [50] });
    await publicClient.request({ method: 'evm_mine', params: [] });

    // Propose result: outcome YES (1)
    const proposeEvidenceM1 = keccak256(toHex('Evidence Proposer Market 1'));
    const proposeTx1 = await proposerWallet.writeContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'proposeResult',
      args: [marketId1, 1, proposeEvidenceM1],
      value: 10000000000000000000n, // 10 ETH proposalBond
    });
    await publicClient.waitForTransactionReceipt({ hash: proposeTx1 });

    // Challenge result: stake 1 ETH challengeBond
    const challengeEvidenceM1 = keccak256(toHex('Evidence Challenger Market 1'));
    const challengeTx1 = await challengerWallet.writeContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'challengeResult',
      args: [marketId1, challengeEvidenceM1],
      value: 1000000000000000000n, // 1 ETH challengeBond
    });
    await publicClient.waitForTransactionReceipt({ hash: challengeTx1 });

    // Warp time past challengeDeadline (48 hours = 172,800s + 10s) into active arbitration window
    await publicClient.request({ method: 'evm_increaseTime', params: [172810] });
    await publicClient.request({ method: 'evm_mine', params: [] });

    // Verify Market 1 is now DISPUTED (state = 3) and within arbitration window
    const market1Before = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'getMarket',
      args: [marketId1],
    });
    if (market1Before.storedState !== 3) {
      fail(25, `Expected Market 1 state DISPUTED (3), got ${market1Before.storedState}`);
    }

    const exposureBeforeSc25 = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'totalUnresolvedExposure',
    });

    // Check A: Direct call from non-arbitrator reverts Unauthorized()
    const arbRulingEvidenceM1 = keccak256(toHex('Arbitration Safe Ruling Market 1'));
    let directSettleError = null;
    try {
      await externalWallet.writeContract({
        address: selectedFactoryAddress,
        abi: factoryArt.abi,
        functionName: 'settleDispute',
        args: [marketId1, 2, arbRulingEvidenceM1],
      });
    } catch (err) {
      directSettleError = err;
    }
    assertRevertMatches(directSettleError, 'Unauthorized', 25, 'Direct settleDispute by external account');

    // Verify Market 1 state and protocol exposure are unmodified
    const market1AfterDirect = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'getMarket',
      args: [marketId1],
    });
    if (market1AfterDirect.storedState !== 3) {
      fail(25, `Market 1 state mutated by unauthorized direct call: ${market1AfterDirect.storedState}`);
    }

    // Check B: Governance Safe executing settleDispute reverts GS013 (Unauthorized)
    const govSettleCalldata = encodeFunctionData({
      abi: factoryArt.abi,
      functionName: 'settleDispute',
      args: [marketId1, 2, arbRulingEvidenceM1],
    });
    const govSettleTx = await signTx(govSafeAddress, threeSigners, {
      to: selectedFactoryAddress,
      value: 0n,
      data: govSettleCalldata,
    });
    const govNonceBeforeSc25 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    let govSettleError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [
          selectedFactoryAddress,
          0n,
          govSettleCalldata,
          0,
          0n,
          0n,
          0n,
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
          govSettleTx.signatures,
        ],
      });
    } catch (err) {
      govSettleError = err;
    }
    assertRevertMatches(govSettleError, 'GS013', 25, 'Governance Safe settleDispute');
    const govNonceAfterSc25 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (govNonceAfterSc25 !== govNonceBeforeSc25) {
      fail(25, `Gov Safe nonce mutated on rejected settleDispute: expected ${govNonceBeforeSc25}, got ${govNonceAfterSc25}`);
    }

    // Check C: Compliance Safe executing settleDispute reverts GS013 (Unauthorized)
    const compSettleTx = await signTx(compSafeAddress, compOwners.slice(0, 3), {
      to: selectedFactoryAddress,
      value: 0n,
      data: govSettleCalldata,
    });
    const compNonceBeforeSc25 = await publicClient.readContract({
      address: compSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    let compSettleError = null;
    try {
      await walletClient.writeContract({
        address: compSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [
          selectedFactoryAddress,
          0n,
          govSettleCalldata,
          0,
          0n,
          0n,
          0n,
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
          compSettleTx.signatures,
        ],
      });
    } catch (err) {
      compSettleError = err;
    }
    assertRevertMatches(compSettleError, 'GS013', 25, 'Compliance Safe settleDispute');
    const compNonceAfterSc25 = await publicClient.readContract({
      address: compSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (compNonceAfterSc25 !== compNonceBeforeSc25) {
      fail(25, `Comp Safe nonce mutated on rejected settleDispute: expected ${compNonceBeforeSc25}, got ${compNonceAfterSc25}`);
    }

    // Check D: requireArbitrator with non-multisig reverts InvalidMultisig()
    let nonMultisigError = null;
    try {
      await publicClient.readContract({
        address: configAddress,
        abi: configArt.abi,
        functionName: 'requireArbitrator',
        args: [externalAccount.address, keccak256(toHex('dummy'))],
      });
    } catch (err) {
      nonMultisigError = err;
    }
    assertRevertMatches(nonMultisigError, 'InvalidMultisig', 25, 'requireArbitrator for non-multisig');

    // Check E: requireArbitrator with wrong fingerprint reverts ControlChanged()
    let wrongFingerprintError = null;
    try {
      await publicClient.readContract({
        address: configAddress,
        abi: configArt.abi,
        functionName: 'requireArbitrator',
        args: [arbSafeAddress, keccak256(toHex('corrupted-fingerprint'))],
      });
    } catch (err) {
      wrongFingerprintError = err;
    }
    assertRevertMatches(wrongFingerprintError, 'ControlChanged', 25, 'requireArbitrator with wrong fingerprint');

    // Verify state unchanged after all negative attempts
    const market1BeforeAuth = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'getMarket',
      args: [marketId1],
    });
    if (market1BeforeAuth.storedState !== 3) {
      fail(25, `Market 1 state mutated after negative tests: ${market1BeforeAuth.storedState}`);
    }
    const exposureAfterNegative = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'totalUnresolvedExposure',
    });
    if (exposureAfterNegative !== exposureBeforeSc25) {
      fail(25, `Total exposure mutated after negative tests: expected ${exposureBeforeSc25}, got ${exposureAfterNegative}`);
    }

    // Check F: Authorized Arbitration Safe settles Market 1 to FINALIZED
    const settleM1Calldata = encodeFunctionData({
      abi: factoryArt.abi,
      functionName: 'settleDispute',
      args: [marketId1, 1, arbRulingEvidenceM1], // Outcome YES (1)
    });
    const settleM1Res = await executeSafeTransaction(walletClient, publicClient, {
      safeAddress: arbSafeAddress,
      to: selectedFactoryAddress,
      data: settleM1Calldata,
      signers: arbOwners.slice(0, 3),
    });
    if (!settleM1Res.executionSuccess) {
      fail(25, 'Authorized Arbitration Safe settleDispute on Market 1 failed');
    }
    const market1AfterAuth = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'getMarket',
      args: [marketId1],
    });
    if (market1AfterAuth.storedState !== 4) {
      fail(25, `Expected Market 1 state FINALIZED (4), got ${market1AfterAuth.storedState}`);
    }
    if (market1AfterAuth.finalOutcome !== 1) {
      fail(25, `Expected Market 1 final outcome YES (1), got ${market1AfterAuth.finalOutcome}`);
    }
    const exposure1Released = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'exposureReleased',
      args: [marketId1],
    });
    if (!exposure1Released) {
      fail(25, 'Exposure not released for Market 1 after authorized settlement');
    }
    pass(25, 'Unauthorized arbitration decisions rejected and authorized settlement isolated & verified on Market 1');

    // ------------------------------------------------------------------------
    // SCENARIO 26: Safe ownership changes follow Safe authorization rules
    // ------------------------------------------------------------------------
    // Only Safe calling self (selfauthorized) can modify owners or threshold.
    // 1. Direct call to changeThreshold reverts with GS031
    let directThresholdChangeError = null;
    try {
      await externalWallet.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'changeThreshold',
        args: [4n],
      });
    } catch (err) {
      directThresholdChangeError = err;
    }
    assertRevertMatches(directThresholdChangeError, 'GS031', 26, 'Direct changeThreshold without self-call');

    // 2. Authorized self-call via 3-of-5 multisig to increase threshold to 4
    const changeThresholdCalldata4 = encodeFunctionData({
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'changeThreshold',
      args: [4n],
    });
    const increaseThresholdRes = await executeSafeTransaction(walletClient, publicClient, {
      safeAddress: govSafeAddress,
      to: govSafeAddress,
      data: changeThresholdCalldata4,
      signers: threeSigners,
    });
    if (!increaseThresholdRes.executionSuccess) {
      fail(26, 'Authorized self-call to changeThreshold(4) failed');
    }
    const threshold4 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'getThreshold',
    });
    if (threshold4 !== 4n) {
      fail(26, `Expected threshold 4, got ${threshold4}`);
    }

    // 3. Confirm 3 signatures are now rejected under threshold 4 with GS020
    const testPayloadData = { to: dummyTo, value: 0n, data: '0x' };
    const threeSigsUnderTh4 = await signTx(govSafeAddress, threeSigners, testPayloadData);
    const nonceBeforeSc26UnderQuorum = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    let underQuorumError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [
          dummyTo,
          0n,
          '0x',
          0,
          0n,
          0n,
          0n,
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
          threeSigsUnderTh4.signatures,
        ],
      });
    } catch (err) {
      underQuorumError = err;
    }
    assertRevertMatches(underQuorumError, 'GS020', 26, 'Under-quorum execution when threshold is 4');
    const nonceAfterSc26UnderQuorum = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterSc26UnderQuorum !== nonceBeforeSc26UnderQuorum) {
      fail(26, `Nonce mutated on under-quorum: expected ${nonceBeforeSc26UnderQuorum}, got ${nonceAfterSc26UnderQuorum}`);
    }

    // 4. Restore threshold to 3 using 4 signatures
    const changeThresholdCalldata3 = encodeFunctionData({
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'changeThreshold',
      args: [3n],
    });
    const fourSigners = govOwners.slice(0, 4);
    const restoreThresholdRes = await executeSafeTransaction(walletClient, publicClient, {
      safeAddress: govSafeAddress,
      to: govSafeAddress,
      data: changeThresholdCalldata3,
      signers: fourSigners,
    });
    if (!restoreThresholdRes.executionSuccess) {
      fail(26, 'Authorized self-call to restore changeThreshold(3) failed');
    }
    const thresholdRestored = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'getThreshold',
    });
    if (thresholdRestored !== 3n) {
      fail(26, `Expected threshold 3, got ${thresholdRestored}`);
    }
    pass(26, 'Changes to Safe ownership follow strict self-authorized Safe execution rules (GS031 & GS020 enforced)');

    // ------------------------------------------------------------------------
    // SCENARIO 27: Safe execution failure does not silently create state changes
    // ------------------------------------------------------------------------
    // Governance Safe attempts to call setParameters with invalid feeBps (> 1000)
    const invalidParameters = {
      ...initialParameters,
      feeBps: 1500, // exceeds MAX_FEE_BPS (1000)
    };
    const invalidParamsCalldata = encodeFunctionData({
      abi: configArt.abi,
      functionName: 'setParameters',
      args: [invalidParameters],
    });

    // Case A: safeTxGas = 0 (atomic rollback via GS013)
    const invalidGovTx = await signTx(govSafeAddress, threeSigners, {
      to: configAddress,
      value: 0n,
      data: invalidParamsCalldata,
    });
    const nonceBeforeSc27 = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    let invalidGovError = null;
    try {
      await walletClient.writeContract({
        address: govSafeAddress,
        abi: SAFE_SINGLETON_ARTIFACT.abi,
        functionName: 'execTransaction',
        args: [
          configAddress,
          0n,
          invalidParamsCalldata,
          0,
          0n,
          0n,
          0n,
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000',
          invalidGovTx.signatures,
        ],
      });
    } catch (err) {
      invalidGovError = err;
    }
    assertRevertMatches(invalidGovError, 'GS013', 27, 'Atomic rollback on invalid setParameters');
    const nonceAfterSc27CaseA = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterSc27CaseA !== nonceBeforeSc27) {
      fail(27, `Nonce modified on atomic rollback: expected ${nonceBeforeSc27}, got ${nonceAfterSc27CaseA}`);
    }

    // Verify ProtocolConfig parameters are unchanged
    const currentParams = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'parameters',
    });
    if (currentParams.feeBps !== 200) {
      fail(27, `Parameters feeBps corrupted: expected 200, got ${currentParams.feeBps}`);
    }

    // Case B: safeTxGas > 0 (subcall fails, event ExecutionFailure emitted, outer tx succeeds, state unmutated)
    const invalidGovTxWithGas = await signTx(govSafeAddress, threeSigners, {
      to: configAddress,
      value: 0n,
      data: invalidParamsCalldata,
      safeTxGas: 300000n,
    });
    const nonceBeforeSc27CaseB = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    const subcallFailHash = await walletClient.writeContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'execTransaction',
      args: [
        configAddress,
        0n,
        invalidParamsCalldata,
        0,
        300000n,
        0n,
        0n,
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
        invalidGovTxWithGas.signatures,
      ],
    });
    const subcallFailReceipt = await publicClient.waitForTransactionReceipt({ hash: subcallFailHash });
    if (subcallFailReceipt.status !== 'success') {
      fail(27, 'Safe outer transaction unexpectedly failed for safeTxGas > 0');
    }
    let sawExecutionFailure = false;
    for (const logItem of subcallFailReceipt.logs) {
      if (logItem.address.toLowerCase() === govSafeAddress.toLowerCase()) {
        try {
          const dec = decodeEventLog({
            abi: SAFE_SINGLETON_ARTIFACT.abi,
            data: logItem.data,
            topics: logItem.topics,
          });
          if (dec.eventName === 'ExecutionFailure') {
            sawExecutionFailure = true;
          }
        } catch {}
      }
    }
    if (!sawExecutionFailure) {
      fail(27, 'Expected ExecutionFailure event for failed inner subcall with safeTxGas > 0');
    }
    const nonceAfterSc27CaseB = await publicClient.readContract({
      address: govSafeAddress,
      abi: SAFE_SINGLETON_ARTIFACT.abi,
      functionName: 'nonce',
    });
    if (nonceAfterSc27CaseB !== nonceBeforeSc27CaseB + 1n) {
      fail(27, `Nonce did not advance on safeTxGas > 0 failure: expected ${nonceBeforeSc27CaseB + 1n}, got ${nonceAfterSc27CaseB}`);
    }

    // Verify ProtocolConfig parameters remain strictly unmodified
    const currentParamsAfterSubcall = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'parameters',
    });
    if (currentParamsAfterSubcall.feeBps !== 200) {
      fail(27, `Parameters feeBps corrupted after failed subcall: expected 200, got ${currentParamsAfterSubcall.feeBps}`);
    }
    pass(27, 'Safe execution failure does not silently create state changes (atomic rollback & subcall revert verified)');

    // ------------------------------------------------------------------------
    // SCENARIO 28: Financial invariants remain intact
    // ------------------------------------------------------------------------
    const pilotPoolCap = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'pilotPoolCap',
    });
    if (pilotPoolCap !== 100000000000000000000n) {
      fail(28, `pilotPoolCap mismatch: ${pilotPoolCap}`);
    }

    const globalCap = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'globalUnresolvedCap',
    });
    if (globalCap !== 300000000000000000000n) {
      fail(28, `globalUnresolvedCap mismatch: ${globalCap}`);
    }

    const perArbCap = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'perArbitratorUnresolvedCap',
    });
    if (perArbCap !== 200000000000000000000n) {
      fail(28, `perArbitratorUnresolvedCap mismatch: ${perArbCap}`);
    }

    const totalExposure = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'totalUnresolvedExposure',
    });
    if (totalExposure !== 0n) {
      fail(28, `totalUnresolvedExposure mismatch: expected 0, got ${totalExposure}`);
    }

    const exposureReleased0 = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'exposureReleased',
      args: [marketId],
    });
    if (!exposureReleased0) {
      fail(28, 'Exposure was not released on settled Market 0');
    }

    const exposureReleased1 = await publicClient.readContract({
      address: selectedFactoryAddress,
      abi: factoryArt.abi,
      functionName: 'exposureReleased',
      args: [marketId1],
    });
    if (!exposureReleased1) {
      fail(28, 'Exposure was not released on settled Market 1');
    }

    const isPaused = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'paused',
    });
    if (isPaused) fail(28, 'Protocol unexpectedly paused');

    const isFinancialActive = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'financialActive',
    });
    if (!isFinancialActive) fail(28, 'Financial activity disabled');

    const finalParams = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'parameters',
    });
    if (finalParams.feeBps !== 200) fail(28, `feeBps mismatch: ${finalParams.feeBps}`);
    if (finalParams.creationBond !== 1000000000000000000n) fail(28, 'creationBond mismatch');
    if (finalParams.proposalBond !== 10000000000000000000n) fail(28, 'proposalBond mismatch');
    if (finalParams.challengeBond !== 1000000000000000000n) fail(28, 'challengeBond mismatch');
    if (finalParams.minContribution !== 10000000000000000n) fail(28, 'minContribution mismatch');
    if (finalParams.poolCap !== 100000000000000000000n) fail(28, 'poolCap mismatch');
    if (finalParams.challengePeriod !== 172800) fail(28, 'challengePeriod mismatch');
    if (finalParams.arbitrationPeriod !== 345600) fail(28, 'arbitrationPeriod mismatch');
    if (finalParams.arbitrator.toLowerCase() !== arbSafeAddress.toLowerCase()) {
      fail(28, 'arbitrator mismatch');
    }

    const boundGovernance = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'governance',
    });
    if (boundGovernance.toLowerCase() !== govSafeAddress.toLowerCase()) {
      fail(28, 'governance mismatch');
    }

    const boundCompliance = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'complianceApprover',
    });
    if (boundCompliance.toLowerCase() !== compSafeAddress.toLowerCase()) {
      fail(28, 'complianceApprover mismatch');
    }

    const boundGuardian = await publicClient.readContract({
      address: configAddress,
      abi: configArt.abi,
      functionName: 'guardian',
    });
    if (boundGuardian.toLowerCase() !== guardian.address.toLowerCase()) {
      fail(28, 'guardian mismatch');
    }

    pass(28, 'All financial invariants, role bindings, and safety invariants quantitatively verified');

    console.log('\n=== ALL 28 CANONICAL SAFE EXECUTION SCENARIOS PASSED ===');
    return true;
  } finally {
    anvilProc.kill('SIGKILL');
  }
}

if (process.argv[1]?.endsWith('test-real-safe.mjs')) {
  runRealSafeTestSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal error during Safe execution test suite:', err);
      process.exit(1);
    });
}
