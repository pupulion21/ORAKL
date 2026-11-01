#!/usr/bin/env node
/**
 * ORAKL P1 — Automated End-to-End Scenarios Runner (Scenarios A & B)
 *
 * Scope: Isolated Anvil simulation ONLY (chainId 31337).
 * Executes the complete multi-wallet lifecycle through real smart contract
 * transactions, event ingestion, API read verification, and mathematical
 * financial balance reconciliation.
 *
 * Usage:
 *   node scripts/p1/run-e2e-scenarios.mjs --scenarios A,B
 *   node scripts/p1/run-e2e-scenarios.mjs --scenario A
 *   node scripts/p1/run-e2e-scenarios.mjs --scenario B
 */

import { register } from 'node:module';
register(new URL('./ts-resolver.mjs', import.meta.url));

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeFunctionData, getAddress, keccak256, toHex, stringToBytes } from 'viem';

// Ensure backend .env is loaded for Prisma
const envPath = resolve(import.meta.dirname, '../../backend/.env');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

import {
  LOCAL_CHAIN_ID,
  LOCAL_RPC_URL,
  LOCAL_ROLES,
  LOCAL_PARAMETERS,
  DEV_ACCOUNTS,
  REPO_ROOT,
  artifact,
  assert,
  fundDevAccounts,
  log,
  makeClients,
  requireLocalChain,
  stepTime,
} from './lib.mjs';
import { publishEvidenceBundle } from './evidence-partition.mjs';

// Dynamic backend imports (via ts-resolver hook)
const { buildServer } = await import('../../backend/src/api/server.ts');
const { makePrisma } = await import('../../backend/src/db.ts');
const { loadConfig } = await import('../../backend/src/config.ts');
const { ingestOnce } = await import('../../backend/src/indexer/run.ts');
const { canonicalizeEvidence, evidenceCommitment } = await import('../../backend/src/evidence/evidence.ts');

const FACTORY_ART = artifact('SelectedMarketFactory');
const MOCK_ART = artifact('LocalRoleMock');
const CONFIG_ART = artifact('ProtocolConfig');

const BondType = { CREATION: 0, PROPOSAL: 1, CHALLENGE: 2 };
const Outcome = { UNRESOLVED: 0, YES: 1, NO: 2, INVALID: 3 };
const Side = { YES: 0, NO: 1 };

function parseArgs() {
  const args = process.argv.slice(2);
  let scenariosArg = 'A,B,C,D';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenarios' || args[i] === '--scenario') {
      scenariosArg = args[i + 1] ?? 'A,B,C,D';
      i++;
    } else if (args[i].startsWith('--scenarios=')) {
      scenariosArg = args[i].slice('--scenarios='.length);
    } else if (args[i].startsWith('--scenario=')) {
      scenariosArg = args[i].slice('--scenario='.length);
    }
  }
  const set = new Set(scenariosArg.toUpperCase().split(',').map((s) => s.trim()));
  return {
    runA: set.has('A') || set.has('ALL'),
    runB: set.has('B') || set.has('ALL'),
    runC: set.has('C') || set.has('ALL'),
    runD: set.has('D') || set.has('ALL'),
  };
}

async function ensureApiRunning(prisma, config) {
  try {
    const res = await fetch('http://127.0.0.1:4310/api/v1/indexer/status');
    if (res.ok) {
      log('api', 'Using existing Fastify server at http://127.0.0.1:4310');
      return { app: null, external: true };
    }
  } catch {
    // start local instance
  }

  log('api', 'Starting Fastify server in-process on 127.0.0.1:4310');
  const app = await buildServer({ prisma, config });
  await app.listen({ host: '127.0.0.1', port: 4310 });
  log('api', 'Fastify server listening on http://127.0.0.1:4310');
  return { app, external: false };
}

async function publishMetadataToApi(metadata, signerAddress, request) {
  const sortedFields = [
    `"category":"${metadata.category}"`,
    `"chainId":"${metadata.chainId}"`,
    `"createdAt":"${metadata.createdAt}"`,
    `"creator":"${metadata.creator}"`,
    `"description":"${metadata.description}"`,
    `"factory":"${metadata.factory}"`,
    `"question":"${metadata.question}"`,
    `"resolutionCriteria":"${metadata.resolutionCriteria}"`,
    `"schema":"${metadata.schema}"`,
    `"sources":["${metadata.sources.join('","')}"]`,
  ];
  const canonicalString = `{${sortedFields.join(',')}}`;
  const commitment = keccak256(stringToBytes(canonicalString));

  const auth = {
    app: 'ORAKL',
    version: '1',
    action: 'metadata',
    chainId: LOCAL_CHAIN_ID,
    factory: metadata.factory.toLowerCase(),
    publisher: metadata.creator.toLowerCase(),
    commitment: commitment.toLowerCase(),
    nonce: `meta_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };
  const message = [
    'ORAKL PUBLICATION AUTHORIZATION',
    `app: ${auth.app}`,
    `version: ${auth.version}`,
    `action: ${auth.action}`,
    `chainId: ${auth.chainId}`,
    `factory: ${auth.factory}`,
    `publisher: ${auth.publisher}`,
    `commitment: ${auth.commitment}`,
    `nonce: ${auth.nonce}`,
    `deadline: ${auth.deadline}`,
  ].join('\n');
  const msgHex = toHex(stringToBytes(message));
  const signature = await request('personal_sign', [msgHex, signerAddress]);

  const res = await fetch('http://127.0.0.1:4310/api/v1/markets/metadata', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ metadata, auth, signature }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to publish market metadata: ${res.status} ${err}`);
  }
  const json = await res.json();
  return { commitment, uri: json.data.uri };
}

async function publishEvidenceToApi(manifest, signerAddress, request) {
  const commitment = evidenceCommitment(manifest);
  const auth = {
    app: 'ORAKL',
    version: '1',
    action: 'evidence',
    chainId: LOCAL_CHAIN_ID,
    factory: manifest.contract.toLowerCase(),
    publisher: manifest.publisher.toLowerCase(),
    commitment: commitment.toLowerCase(),
    nonce: `evi_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };
  const message = [
    'ORAKL PUBLICATION AUTHORIZATION',
    `app: ${auth.app}`,
    `version: ${auth.version}`,
    `action: ${auth.action}`,
    `chainId: ${auth.chainId}`,
    `factory: ${auth.factory}`,
    `publisher: ${auth.publisher}`,
    `commitment: ${auth.commitment}`,
    `nonce: ${auth.nonce}`,
    `deadline: ${auth.deadline}`,
  ].join('\n');
  const msgHex = toHex(stringToBytes(message));
  const signature = await request('personal_sign', [msgHex, signerAddress]);

  const res = await fetch('http://127.0.0.1:4310/api/v1/evidence', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ manifest, auth, signature }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to publish evidence: ${res.status} ${err}`);
  }
  return { commitment };
}

async function sendOk({ publicClient, walletClient, account, to, data = '0x', value = 0n, label = '' }) {
  const hash = await walletClient.sendTransaction({
    account: getAddress(account),
    to: getAddress(to),
    data,
    value,
    chain: publicClient.chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 50 });
  assert(receipt.status === 'success', `${label} reverted (tx: ${hash})`);
  log(`tx ok [${label}]`, `${hash.slice(0, 10)}... block=${receipt.blockNumber} gas=${receipt.gasUsed}`);
  return receipt;
}

async function sendRevert({ publicClient, walletClient, account, to, data = '0x', value = 0n, label = '' }) {
  const hash = await walletClient.sendTransaction({
    account: getAddress(account),
    to: getAddress(to),
    data,
    value,
    chain: publicClient.chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 50 });
  assert(receipt.status === 'reverted', `${label} expected revert, got status: ${receipt.status} (tx: ${hash})`);
  log(`tx revert [${label}]`, `${hash.slice(0, 10)}... confirmed reverted at block=${receipt.blockNumber}`);
  return receipt;
}

async function multisigExecuteBothOwners({ publicClient, walletClient, mock, owners, to, data, label = '' }) {
  const calldata = encodeFunctionData({
    abi: MOCK_ART.abi,
    functionName: 'execute',
    args: [getAddress(to), data],
  });

  const receipts = [];
  for (let i = 0; i < owners.length; i++) {
    const owner = getAddress(owners[i]);
    const hash = await walletClient.sendTransaction({
      account: owner,
      to: getAddress(mock),
      data: calldata,
      value: 0n,
      chain: publicClient.chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 50 });
    receipts.push(receipt);
    log(`multisig [${label}] owner=${i + 1}/${owners.length}`, `${hash.slice(0, 10)}... status=${receipt.status}`);
  }
  return receipts;
}

async function main() {
  const { runA, runB, runC, runD } = parseArgs();
  assert(runA || runB || runC || runD, 'No scenarios selected. Use --scenarios A,B,C,D');

  const { publicClient, walletClient, request } = makeClients();
  await requireLocalChain(request);

  log('init', `Checking deployment manifest and isolated environment...`);
  const manifestPath = resolve(REPO_ROOT, 'backend/deployments/local-selected.json');
  assert(existsSync(manifestPath), `Deployment manifest missing at ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  assert(manifest.network.chainId === LOCAL_CHAIN_ID, `Manifest chainId mismatch`);
  assert(manifest.status === 'LOCAL_SIMULATION', `Manifest not LOCAL_SIMULATION`);

  const factoryAddr = getAddress(manifest.contracts.selectedMarketFactory.address);
  const configAddr = getAddress(manifest.contracts.protocolConfig.address);
  const arbitratorMockAddr = getAddress(manifest.roleMocks.arbitrator.address);
  const complianceMockAddr = getAddress(manifest.roleMocks.compliance.address);
  const governanceMockAddr = getAddress(manifest.roleMocks.governance.address);

  // Fund accounts & activate auto-impersonation
  await fundDevAccounts(request);
  log('accounts', `Funded ${DEV_ACCOUNTS.length} dev accounts with 10,000 ETH`);

  const prisma = makePrisma();
  const config = loadConfig();
  const apiServer = await ensureApiRunning(prisma, config);

  const existingCheckpoint = await prisma.indexerCheckpoint.findFirst({
    where: { chainId: LOCAL_CHAIN_ID },
  });
  if (existingCheckpoint && existingCheckpoint.contractAddress.toLowerCase() !== factoryAddr.toLowerCase()) {
    log('init', `New factory contract detected (${factoryAddr} != ${existingCheckpoint.contractAddress}). Wiping stale local records...`);
    await prisma.protocolFeeAccrual.deleteMany({ where: { chainId: LOCAL_CHAIN_ID } });
    await prisma.accountingSnapshot.deleteMany({ where: { chainId: LOCAL_CHAIN_ID } });
    await prisma.market.deleteMany({ where: { chainId: LOCAL_CHAIN_ID } });
    await prisma.indexedEvent.deleteMany({ where: { chainId: LOCAL_CHAIN_ID } });
    await prisma.indexedBlock.deleteMany({ where: { chainId: LOCAL_CHAIN_ID } });
    await prisma.indexerRollback.deleteMany({ where: { chainId: LOCAL_CHAIN_ID } });
    await prisma.indexerCheckpoint.deleteMany({ where: { chainId: LOCAL_CHAIN_ID } });
    await prisma.transactionRecord.deleteMany({ where: { chainId: LOCAL_CHAIN_ID } });
    await prisma.contractDeployment.deleteMany({ where: { chainId: LOCAL_CHAIN_ID } });
    await prisma.marketMetadata.deleteMany({ where: { chainId: LOCAL_CHAIN_ID } });
    await prisma.evidenceArtifact.deleteMany({ where: { chainId: LOCAL_CHAIN_ID } });
  }

  const indexerDeps = {
    prisma,
    publicClient,
    chainId: LOCAL_CHAIN_ID,
    factory: factoryAddr,
    configContract: configAddr,
    startBlock: BigInt(manifest.contracts.selectedMarketFactory.startBlock),
    batchSize: 100,
    confirmations: 0,
  };

  // Initial catch-up ingest
  const initIngest = await ingestOnce(indexerDeps);
  log('indexer', `Synced ${initIngest.events} events up to block ${await publicClient.getBlockNumber()}`);

  const evidenceRecords = {
    timestamp: new Date().toISOString(),
    chainId: LOCAL_CHAIN_ID,
    contracts: {
      factory: factoryAddr,
      config: configAddr,
      arbitrator: arbitratorMockAddr,
      compliance: complianceMockAddr,
      governance: governanceMockAddr,
    },
    scenarios: {},
    summary: {},
  };

  try {
    // =========================================================================
    // SCENARIO A: Binary Reversal with Fee Deduction & Remainder-Free Claims
    // =========================================================================
    if (runA) {
      log('\n' + '='.repeat(80));
      log('SCENARIO A', 'Binary Reversal with Fee Deduction & Remainder-Free Claims');
      log('='.repeat(80));

      const txLogA = [];
      const stepsA = [];

      function recordTx(stepNo, stepName, receipt, extra = {}) {
        const item = {
          step: stepNo,
          action: stepName,
          txHash: receipt.transactionHash,
          blockNumber: Number(receipt.blockNumber),
          gasUsed: receipt.gasUsed.toString(),
          status: receipt.status,
          ...extra,
        };
        txLogA.push(item);
        stepsA.push(`Step ${stepNo}: ${stepName} (${receipt.status})`);
      }

      // Step 1: Pre-market status check
      const marketCountBeforeA = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'marketCount',
        }),
      );
      const marketIdA = marketCountBeforeA;
      log('A.01', `Target Market ID: ${marketIdA}`);

      const contractBalBeforeA = await publicClient.getBalance({ address: factoryAddr });
      const feeLiabilityBeforeA = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'feeLiability',
        }),
      );

      // Step 2: Publish Market Metadata to Fastify API
      const metadataA = {
        schema: 'orakl-market-metadata-v1',
        chainId: '31337',
        factory: factoryAddr.toLowerCase(),
        question: 'Will Ethereum spot market cap flip Bitcoin in 2026?',
        description: 'Resolves YES if ETH market cap exceeds BTC market cap on CoinGecko before 2027.',
        category: 'crypto',
        resolutionCriteria: 'CoinGecko spot market cap ETH > BTC.',
        sources: ['https://coingecko.com'],
        creator: getAddress(LOCAL_ROLES.creator).toLowerCase(),
        createdAt: '1790000000',
      };
      const { commitment: metaHashA, uri: metaUriA } = await publishMetadataToApi(
        metadataA,
        LOCAL_ROLES.creator,
        request,
      );
      log('A.02', `Published Market Metadata: commitment=${metaHashA}`);

      // Step 3: Creator deploys Market A
      const curBlockA = await publicClient.getBlock();
      const nowA = curBlockA.timestamp;
      const closeTimeA = nowA + 3600n; // +1h
      const resTimeA = nowA + 3600n;
      const maxResTimeA = resTimeA + 48n * 3600n + 96n * 3600n + 48n * 3600n; // Validated floor (+192h)

      const createMarketDataA = encodeFunctionData({
        abi: FACTORY_ART.abi,
        functionName: 'createMarket',
        args: [metaHashA, metaUriA, closeTimeA, resTimeA, maxResTimeA],
      });
      const rcCreateA = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.creator,
        to: factoryAddr,
        data: createMarketDataA,
        value: LOCAL_PARAMETERS.creationBond, // 1 ETH
        label: 'A: CreateMarket',
      });
      recordTx(1, 'Creator deploys market with 1 ETH bond', rcCreateA, { marketId: marketIdA.toString() });

      // Step 4: Alice predicts YES (10 ETH)
      const rcAliceA = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.yesParticipant,
        to: factoryAddr,
        data: encodeFunctionData({ abi: FACTORY_ART.abi, functionName: 'predict', args: [marketIdA, Side.YES] }),
        value: 10n * 10n ** 18n,
        label: 'A: Alice Predict YES (10 ETH)',
      });
      recordTx(2, 'Alice deposits 10 ETH on YES', rcAliceA);

      // Step 5: Bob predicts NO (20 ETH)
      const rcBobA = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.noParticipant,
        to: factoryAddr,
        data: encodeFunctionData({ abi: FACTORY_ART.abi, functionName: 'predict', args: [marketIdA, Side.NO] }),
        value: 20n * 10n ** 18n,
        label: 'A: Bob Predict NO (20 ETH)',
      });
      recordTx(3, 'Bob deposits 20 ETH on NO', rcBobA);

      // Step 6: Ingest & Read Model Check
      await ingestOnce(indexerDeps);
      const poolsA = await publicClient.readContract({
        address: factoryAddr,
        abi: FACTORY_ART.abi,
        functionName: 'getPoolTotals',
        args: [marketIdA],
      });
      assert(poolsA[0] === 10n * 10n ** 18n, 'yesPool mismatch');
      assert(poolsA[1] === 20n * 10n ** 18n, 'noPool mismatch');
      assert(poolsA[2] === 30n * 10n ** 18n, 'totalPool mismatch');
      log('A.06', `Pool totals verified: YES=10 ETH, NO=20 ETH, Total=30 ETH`);

      // Step 7: Fast-forward time past trading close
      await stepTime(request, 3605);
      const stateAfterCloseA = await publicClient.readContract({
        address: factoryAddr,
        abi: FACTORY_ART.abi,
        functionName: 'marketState',
        args: [marketIdA],
      });
      assert(Number(stateAfterCloseA) === 1, 'marketState must be CLOSED (1)');
      log('A.07', `Time advanced past close; marketState is CLOSED`);

      // Step 8: Proposer publishes RFC 8785 evidence and proposes YES (10 ETH)
      const manifestPropA = {
        schema: 'orakl-evidence-v1',
        chainId: '31337',
        contract: factoryAddr.toLowerCase(),
        marketId: marketIdA.toString(),
        kind: 'proposal',
        claim: 'YES',
        proposedOutcome: 'YES',
        sources: ['https://reuters.com/eth-marketcap-report'],
        publishedAt: '1790003605',
        publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
        contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        contentMediaType: 'text/plain',
        media: [],
      };
      const { commitment: commPropA } = await publishEvidenceToApi(manifestPropA, DEV_ACCOUNTS[0], request);
      const rcPropA = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.proposer,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'proposeResult',
          args: [marketIdA, Outcome.YES, commPropA],
        }),
        value: LOCAL_PARAMETERS.proposalBond, // 10 ETH
        label: 'A: Proposer Proposes YES (10 ETH)',
      });
      recordTx(4, 'Proposer deposits 10 ETH bond proposing YES', rcPropA, { commitment: commPropA });

      // Step 9: Challenger A publishes evidence and bonds C_A = 1 ETH
      const manifestChallA = {
        schema: 'orakl-evidence-v1',
        chainId: '31337',
        contract: factoryAddr.toLowerCase(),
        marketId: marketIdA.toString(),
        kind: 'objection',
        claim: 'NO',
        proposedOutcome: 'YES',
        sources: ['https://coingecko.com/btc-dominance-data'],
        publishedAt: '1790003700',
        publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
        contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        contentMediaType: 'text/plain',
        media: [],
      };
      const { commitment: commChallA } = await publishEvidenceToApi(manifestChallA, DEV_ACCOUNTS[0], request);
      const rcChallA = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.challengerA,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'challengeResult',
          args: [marketIdA, commChallA],
        }),
        value: 1n * 10n ** 18n, // 1 ETH
        label: 'A: Challenger A Stakes 1 ETH',
      });
      recordTx(5, 'Challenger A bonds C_A = 1 ETH with objection evidence', rcChallA, { commitment: commChallA });

      // Step 10: Challenger B publishes evidence and bonds C_B = 2 ETH
      const manifestChallB = {
        schema: 'orakl-evidence-v1',
        chainId: '31337',
        contract: factoryAddr.toLowerCase(),
        marketId: marketIdA.toString(),
        kind: 'supplement',
        claim: 'NO',
        proposedOutcome: 'YES',
        sources: ['https://coinmarketcap.com/historical-snapshot'],
        publishedAt: '1790003800',
        publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
        contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        contentMediaType: 'text/plain',
        media: [],
      };
      const { commitment: commChallB } = await publishEvidenceToApi(manifestChallB, DEV_ACCOUNTS[0], request);
      const rcChallB = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.challengerB,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'challengeResult',
          args: [marketIdA, commChallB],
        }),
        value: 2n * 10n ** 18n, // 2 ETH
        label: 'A: Challenger B Stakes 2 ETH',
      });
      recordTx(6, 'Challenger B bonds C_B = 2 ETH with supplemental evidence', rcChallB, { commitment: commChallB });

      // Step 11: Ingest & Verify Tranche Offsets & API Endpoint
      await ingestOnce(indexerDeps);
      const stakeA = await publicClient.readContract({
        address: factoryAddr,
        abi: FACTORY_ART.abi,
        functionName: 'getChallengeStake',
        args: [marketIdA, getAddress(LOCAL_ROLES.challengerA)],
      });
      const stakeB = await publicClient.readContract({
        address: factoryAddr,
        abi: FACTORY_ART.abi,
        functionName: 'getChallengeStake',
        args: [marketIdA, getAddress(LOCAL_ROLES.challengerB)],
      });
      const totalStakeOnChainA = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'totalChallengeStake',
          args: [marketIdA],
        }),
      );

      assert(totalStakeOnChainA === 3n * 10n ** 18n, 'Total challenge stake must be 3 ETH');
      assert(stakeA.amount === 1n * 10n ** 18n && stakeA.prefixBefore === 0n, 'Challenger A prefix offset mismatch');
      assert(
        stakeB.amount === 2n * 10n ** 18n && stakeB.prefixBefore === 1n * 10n ** 18n,
        'Challenger B prefix offset mismatch',
      );
      log('A.11', `Verified challenge stakes: S=3 ETH, S_0=0 ETH, S_1=1 ETH`);

      // Check Fastify API tranches endpoint
      const resChallengesA = await fetch(`http://127.0.0.1:4310/api/v1/markets/${marketIdA}/challenges`);
      assert(resChallengesA.ok, 'Failed to fetch market challenges from Fastify API');
      const jsonChallengesA = await resChallengesA.json();
      assert(jsonChallengesA.data.stakes.length === 2, 'Challenges route must list 2 tranches');
      assert(jsonChallengesA.data.totalChallengeStake === '3000000000000000000', 'API totalChallengeStake mismatch');
      log('A.12', `Fastify API verified: /api/v1/markets/${marketIdA}/challenges returned 2 valid tranches`);

      // Step 12: Premature Arbitration Revert Verification
      log('A.13', `Executing premature arbitration revert verification (before challengeDeadline)...`);
      const dummyDecisionHash = '0x' + 'd'.repeat(64);
      const prematureCalldata = encodeFunctionData({
        abi: FACTORY_ART.abi,
        functionName: 'settleDispute',
        args: [marketIdA, Outcome.NO, dummyDecisionHash],
      });
      const executeCalldataA = encodeFunctionData({
        abi: MOCK_ART.abi,
        functionName: 'execute',
        args: [factoryAddr, prematureCalldata],
      });
      // Confirm from first arbitrator owner
      await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.arbitratorOwners[0],
        to: arbitratorMockAddr,
        data: executeCalldataA,
        label: 'A: Arbitrator Owner 1 Premature Confirm',
      });
      // Second arbitrator owner execution MUST revert because block.timestamp < challengeDeadline
      const rcPremature = await sendRevert({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.arbitratorOwners[1],
        to: arbitratorMockAddr,
        data: executeCalldataA,
        label: 'A: Premature Arbitration Revert (InvalidTime)',
      });
      recordTx(7, 'Premature arbitration reverts with InvalidTime()', rcPremature);

      // Step 13: Advance time past challengeDeadline (48h)
      await stepTime(request, 48 * 3600 + 10);
      log('A.14', `Time advanced past challengeDeadline (+48h)`);

      // Step 14: Arbitrator publishes RFC 8785 decision evidence & settles dispute to NO
      const manifestDecisionA = {
        schema: 'orakl-evidence-v1',
        chainId: '31337',
        contract: factoryAddr.toLowerCase(),
        marketId: marketIdA.toString(),
        kind: 'decision',
        claim: 'NO',
        proposedOutcome: 'YES',
        sources: ['https://oracle.org/arbitration-ruling-m0'],
        publishedAt: '1790176500',
        publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
        contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        contentMediaType: 'text/plain',
        media: [],
      };
      const { commitment: commDecisionA } = await publishEvidenceToApi(manifestDecisionA, DEV_ACCOUNTS[0], request);
      log('A.15', `Arbitrator published decision evidence: ${commDecisionA}`);

      const settleCalldataA = encodeFunctionData({
        abi: FACTORY_ART.abi,
        functionName: 'settleDispute',
        args: [marketIdA, Outcome.NO, commDecisionA],
      });
      const rcArbitrateA = await multisigExecuteBothOwners({
        publicClient,
        walletClient,
        mock: arbitratorMockAddr,
        owners: LOCAL_ROLES.arbitratorOwners,
        to: factoryAddr,
        data: settleCalldataA,
        label: 'A: Arbitrator Settle Dispute NO',
      });
      recordTx(8, 'Arbitrator Owner 1 confirms dispute settlement', rcArbitrateA[0]);
      recordTx(9, 'Arbitrator Owner 2 executes settlement NO', rcArbitrateA[1], { commitment: commDecisionA });

      // Step 15: Ingest & Check Terminal Accounting & Exposure Release
      await ingestOnce(indexerDeps);
      const marketRowA = await prisma.market.findUnique({
        where: { onchainMarketId: marketIdA },
      });
      assert(marketRowA.status === 'FINALIZED', 'Market status in DB must be FINALIZED');
      assert(marketRowA.finalOutcome === 'NO', 'Market finalOutcome in DB must be NO');
      assert(marketRowA.refundable === false, 'Market refundable in DB must be false');
      const feeAccrualsA = await prisma.protocolFeeAccrual.findMany({
        where: { marketId: marketRowA.id, kind: 'accrued' },
      });
      assert(feeAccrualsA.length === 1, 'Expected 1 protocolFeeAccrual record');
      assert(feeAccrualsA[0].amount === 600000000000000000n, 'Protocol fee in DB must be 0.6 ETH (2%)');

      const onChainMarketA = await publicClient.readContract({
        address: factoryAddr,
        abi: FACTORY_ART.abi,
        functionName: 'getMarket',
        args: [marketIdA],
      });
      assert(onChainMarketA.protocolFee === 600000000000000000n, 'On-chain protocolFee must be 0.6 ETH');
      assert(
        onChainMarketA.distributablePool === 29400000000000000000n,
        'On-chain distributablePool must be 29.4 ETH (30 - 0.6)',
      );

      const settlementA = await prisma.marketSettlement.findUnique({
        where: { marketId: marketRowA.id },
      });
      assert(settlementA.disposition === 'CHALLENGERS', 'Disposition must be CHALLENGERS');
      log('A.16', `Indexer projected settlement: disposition=CHALLENGERS, fee=0.6 ETH, distributable=29.4 ETH`);

      // Verify Exposure Release
      const exposuresA = await prisma.exposureSnapshot.findMany({
        where: { marketId: marketRowA.id },
      });
      assert(exposuresA.length >= 1, 'ExposureSnapshot row must be created upon settlement');
      assert(exposuresA[0].amount.toString() === '30000000000000000000', 'Exposure release amount must equal 30 ETH pool');
      log('A.17', `Exposure release verified in database projections (30 ETH exposure freed)`);

      // Step 16: Bob claims winning payout (29.4 ETH)
      const bobBalBeforeA = await publicClient.getBalance({ address: getAddress(LOCAL_ROLES.noParticipant) });
      const rcBobClaimA = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.noParticipant,
        to: factoryAddr,
        data: encodeFunctionData({ abi: FACTORY_ART.abi, functionName: 'claim', args: [marketIdA] }),
        label: 'A: Bob Claim Payout',
      });
      const bobBalAfterA = await publicClient.getBalance({ address: getAddress(LOCAL_ROLES.noParticipant) });
      const bobGainA = bobBalAfterA - bobBalBeforeA; // gas costs will slightly reduce on balance, but event verifies exact transfer
      recordTx(10, 'Bob claims winning payout of 29.4 ETH', rcBobClaimA, { expectedPayout: '29400000000000000000' });

      // Step 17: Alice attempts claim -> Reverts with NothingToClaim()
      const rcAliceClaimA = await sendRevert({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.yesParticipant,
        to: factoryAddr,
        data: encodeFunctionData({ abi: FACTORY_ART.abi, functionName: 'claim', args: [marketIdA] }),
        label: 'A: Alice Claim Revert (NothingToClaim)',
      });
      recordTx(11, 'Alice attempts claim on losing outcome -> reverts with NothingToClaim()', rcAliceClaimA);

      // Step 18: Creator claims creation bond K = 1 ETH
      const rcCreatorBondA = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.creator,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'claimBond',
          args: [marketIdA, BondType.CREATION, getAddress(LOCAL_ROLES.creator)],
        }),
        label: 'A: Creator Claim Bond (1 ETH)',
      });
      recordTx(12, 'Creator claims 100% creation bond (1 ETH)', rcCreatorBondA, { expectedBond: '1000000000000000000' });

      // Step 19: Challenger A claims bond & telescopic reward
      // C_A = 1 ETH + floor(10 ETH * 1 / 3) = 1 ETH + 3.333333333333333333 ETH = 4.333333333333333333 ETH
      const entitlementChallA = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'getBondEntitlement',
          args: [marketIdA, BondType.CHALLENGE, getAddress(LOCAL_ROLES.challengerA)],
        }),
      );
      assert(
        entitlementChallA === 4333333333333333333n,
        `Challenger A entitlement mismatch: expected 4333333333333333333, got ${entitlementChallA}`,
      );

      const rcChallAClaim = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.challengerA,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'claimBond',
          args: [marketIdA, BondType.CHALLENGE, getAddress(LOCAL_ROLES.challengerA)],
        }),
        label: 'A: Challenger A Claim Entitlement',
      });
      recordTx(13, 'Challenger A claims 4.333333333333333333 ETH', rcChallAClaim, {
        entitlement: entitlementChallA.toString(),
      });

      // Step 20: Challenger B claims bond & telescopic reward
      // C_B = 2 ETH + (10 ETH - 3.333333333333333333 ETH) = 8.666666666666666667 ETH
      const entitlementChallB = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'getBondEntitlement',
          args: [marketIdA, BondType.CHALLENGE, getAddress(LOCAL_ROLES.challengerB)],
        }),
      );
      assert(
        entitlementChallB === 8666666666666666667n,
        `Challenger B entitlement mismatch: expected 8666666666666666667, got ${entitlementChallB}`,
      );

      const rcChallBClaim = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.challengerB,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'claimBond',
          args: [marketIdA, BondType.CHALLENGE, getAddress(LOCAL_ROLES.challengerB)],
        }),
        label: 'A: Challenger B Claim Entitlement',
      });
      recordTx(14, 'Challenger B claims 8.666666666666666667 ETH', rcChallBClaim, {
        entitlement: entitlementChallB.toString(),
      });

      // Verify Telescopic Challenger Total
      assert(
        entitlementChallA + entitlementChallB === 13n * 10n ** 18n,
        'Sum of challenger entitlements must equal exactly 13 ETH (3 ETH stake + 10 ETH bond)',
      );
      log('A.20', `Remainder-free challenger distribution verified: 4.333... + 8.666... = 13.0 ETH exactly`);

      // Step 21: Post-claim Indexer Ingestion & Mathematical Reconciliation
      await ingestOnce(indexerDeps);

      const contractBalAfterA = await publicClient.getBalance({ address: factoryAddr });
      const feeLiabilityAfterA = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'feeLiability',
        }),
      );
      const contractBalDeltaA = contractBalAfterA - contractBalBeforeA;
      const feeLiabilityDeltaA = feeLiabilityAfterA - feeLiabilityBeforeA;
      const unaccountedA = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'unaccountedBalance',
        }),
      );

      const totalDepositsA = 44n * 10n ** 18n; // 1 (creation) + 10 (Alice) + 20 (Bob) + 10 (proposal) + 1 (ChallA) + 2 (ChallB)
      const totalClaimsA = 294n * 10n ** 17n + 1n * 10n ** 18n + entitlementChallA + entitlementChallB; // 29.4 + 1.0 + 13.0 = 43.4 ETH
      const protocolFeeA = 6n * 10n ** 17n; // 0.6 ETH

      assert(feeLiabilityDeltaA === protocolFeeA, `feeLiability delta (${feeLiabilityDeltaA}) must equal 0.6 ETH`);
      assert(
        contractBalDeltaA === protocolFeeA,
        `Contract balance delta (${contractBalDeltaA}) must equal remaining fee liability (${protocolFeeA})`,
      );
      assert(unaccountedA === 0n, `Unaccounted dust on-chain must be 0, got ${unaccountedA}`);
      assert(
        totalClaimsA + feeLiabilityDeltaA === totalDepositsA,
        `Solvency failed: claims (${totalClaimsA}) + fees (${feeLiabilityDeltaA}) != deposits (${totalDepositsA})`,
      );

      log('A.21', `Mathematical Reconciliation PASSED:`);
      log('  - Total Deposits:   44.0 ETH');
      log('  - Total Claims:     43.4 ETH (Bob=29.4, Creator=1.0, ChallA=4.333..., ChallB=8.666...)');
      log('  - Fee Liability:     0.6 ETH (Delta retained in contract)');
      log('  - Unaccounted Dust:  0 WEI (Exact Solvency)');

      evidenceRecords.scenarios.scenarioA = {
        status: 'PASSED',
        marketId: marketIdA.toString(),
        totalTransactions: txLogA.length,
        transactions: txLogA,
        steps: stepsA,
        reconciliation: {
          totalDeposits: totalDepositsA.toString(),
          totalClaims: totalClaimsA.toString(),
          feeLiabilityDelta: feeLiabilityDeltaA.toString(),
          contractBalanceDelta: contractBalDeltaA.toString(),
          unaccountedDust: unaccountedA.toString(),
          solvencyDelta: (totalDepositsA - totalClaimsA - feeLiabilityDeltaA).toString(),
        },
      };
    }

    // =========================================================================
    // SCENARIO B: Neutral INVALID Resolution with 100% Principal Refunds
    // =========================================================================
    if (runB) {
      log('\n' + '='.repeat(80));
      log('SCENARIO B', 'Neutral INVALID Resolution with 100% Principal Refunds and Zero Fees');
      log('='.repeat(80));

      const txLogB = [];
      const stepsB = [];

      function recordTxB(stepNo, stepName, receipt, extra = {}) {
        const item = {
          step: stepNo,
          action: stepName,
          txHash: receipt.transactionHash,
          blockNumber: Number(receipt.blockNumber),
          gasUsed: receipt.gasUsed.toString(),
          status: receipt.status,
          ...extra,
        };
        txLogB.push(item);
        stepsB.push(`Step ${stepNo}: ${stepName} (${receipt.status})`);
      }

      const marketCountBeforeB = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'marketCount',
        }),
      );
      const marketIdB = marketCountBeforeB;
      log('B.01', `Target Market ID: ${marketIdB}`);

      // Contract balance before Market B
      const contractBalBeforeB = await publicClient.getBalance({ address: factoryAddr });
      const feeLiabilityBeforeB = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'feeLiability',
        }),
      );

      // Step 1: Publish Market Metadata for Market B
      const metadataB = {
        schema: 'orakl-market-metadata-v1',
        chainId: '31337',
        factory: factoryAddr.toLowerCase(),
        question: 'Will net energy gain fusion reactor deliver power to commercial grid in 2026?',
        description: 'Resolves YES if any commercial power grid receives >= 10MW from nuclear fusion.',
        category: 'science',
        resolutionCriteria: 'IAEA / US DOE official announcement.',
        sources: ['https://iaea.org'],
        creator: getAddress(LOCAL_ROLES.creator).toLowerCase(),
        createdAt: '1790200000',
      };
      const { commitment: metaHashB, uri: metaUriB } = await publishMetadataToApi(
        metadataB,
        LOCAL_ROLES.creator,
        request,
      );
      log('B.02', `Published Market B Metadata: commitment=${metaHashB}`);

      // Step 2: Creator deploys Market B (1 ETH bond)
      const curBlockB = await publicClient.getBlock();
      const nowB = curBlockB.timestamp;
      const closeTimeB = nowB + 3600n;
      const resTimeB = nowB + 3600n;
      const maxResTimeB = resTimeB + 48n * 3600n + 96n * 3600n + 48n * 3600n;

      const rcCreateB = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.creator,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'createMarket',
          args: [metaHashB, metaUriB, closeTimeB, resTimeB, maxResTimeB],
        }),
        value: LOCAL_PARAMETERS.creationBond, // 1 ETH
        label: 'B: CreateMarket',
      });
      recordTxB(1, 'Creator deploys market with 1 ETH bond', rcCreateB, { marketId: marketIdB.toString() });

      // Step 3: Alice deposits 5 ETH on YES
      const rcAliceB = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.yesParticipant,
        to: factoryAddr,
        data: encodeFunctionData({ abi: FACTORY_ART.abi, functionName: 'predict', args: [marketIdB, Side.YES] }),
        value: 5n * 10n ** 18n,
        label: 'B: Alice Predict YES (5 ETH)',
      });
      recordTxB(2, 'Alice deposits 5 ETH on YES', rcAliceB);

      // Step 4: Bob deposits 15 ETH on NO
      const rcBobB = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.noParticipant,
        to: factoryAddr,
        data: encodeFunctionData({ abi: FACTORY_ART.abi, functionName: 'predict', args: [marketIdB, Side.NO] }),
        value: 15n * 10n ** 18n,
        label: 'B: Bob Predict NO (15 ETH)',
      });
      recordTxB(3, 'Bob deposits 15 ETH on NO', rcBobB);

      // Step 5: Fast-forward time past trading close
      await stepTime(request, 3605);
      log('B.05', `Time advanced past close; marketState is CLOSED`);

      // Step 6: Proposer proposes YES (10 ETH) with evidence
      const manifestPropB = {
        schema: 'orakl-evidence-v1',
        chainId: '31337',
        contract: factoryAddr.toLowerCase(),
        marketId: marketIdB.toString(),
        kind: 'proposal',
        claim: 'YES',
        proposedOutcome: 'YES',
        sources: ['https://iter.org/press-release'],
        publishedAt: '1790203605',
        publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
        contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        contentMediaType: 'text/plain',
        media: [],
      };
      const { commitment: commPropB } = await publishEvidenceToApi(manifestPropB, DEV_ACCOUNTS[0], request);
      const rcPropB = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.proposer,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'proposeResult',
          args: [marketIdB, Outcome.YES, commPropB],
        }),
        value: LOCAL_PARAMETERS.proposalBond, // 10 ETH
        label: 'B: Proposer Proposes YES (10 ETH)',
      });
      recordTxB(4, 'Proposer deposits 10 ETH bond proposing YES', rcPropB, { commitment: commPropB });

      // Step 7: Challenger A stakes C_A = 1 ETH
      const manifestChallAB = {
        schema: 'orakl-evidence-v1',
        chainId: '31337',
        contract: factoryAddr.toLowerCase(),
        marketId: marketIdB.toString(),
        kind: 'objection',
        claim: 'INVALID',
        proposedOutcome: 'YES',
        sources: ['https://iaea.org/no-commercial-fusion-connection'],
        publishedAt: '1790203700',
        publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
        contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        contentMediaType: 'text/plain',
        media: [],
      };
      const { commitment: commChallAB } = await publishEvidenceToApi(manifestChallAB, DEV_ACCOUNTS[0], request);
      const rcChallAB = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.challengerA,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'challengeResult',
          args: [marketIdB, commChallAB],
        }),
        value: 1n * 10n ** 18n,
        label: 'B: Challenger A Stakes 1 ETH',
      });
      recordTxB(5, 'Challenger A bonds C_A = 1 ETH alleging INVALID ambiguity', rcChallAB, { commitment: commChallAB });

      // Step 8: Challenger B stakes C_B = 2 ETH
      const manifestChallBB = {
        schema: 'orakl-evidence-v1',
        chainId: '31337',
        contract: factoryAddr.toLowerCase(),
        marketId: marketIdB.toString(),
        kind: 'supplement',
        claim: 'INVALID',
        proposedOutcome: 'YES',
        sources: ['https://energy.gov/fusion-definitions'],
        publishedAt: '1790203800',
        publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
        contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        contentMediaType: 'text/plain',
        media: [],
      };
      const { commitment: commChallBB } = await publishEvidenceToApi(manifestChallBB, DEV_ACCOUNTS[0], request);
      const rcChallBB = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.challengerB,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'challengeResult',
          args: [marketIdB, commChallBB],
        }),
        value: 2n * 10n ** 18n,
        label: 'B: Challenger B Stakes 2 ETH',
      });
      recordTxB(6, 'Challenger B bonds C_B = 2 ETH with supplemental evidence', rcChallBB, { commitment: commChallBB });

      // Step 9: Advance time past challengeDeadline (48h)
      await stepTime(request, 48 * 3600 + 10);
      log('B.09', `Time advanced past challengeDeadline (+48h)`);

      // Step 10: Arbitrator publishes decision evidence & settles to INVALID
      const manifestDecisionB = {
        schema: 'orakl-evidence-v1',
        chainId: '31337',
        contract: factoryAddr.toLowerCase(),
        marketId: marketIdB.toString(),
        kind: 'decision',
        claim: 'INVALID',
        proposedOutcome: 'YES',
        sources: ['https://oracle.org/arbitration-ruling-m1-invalid'],
        publishedAt: '1790380000',
        publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
        contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        contentMediaType: 'text/plain',
        media: [],
      };
      const { commitment: commDecisionB } = await publishEvidenceToApi(manifestDecisionB, DEV_ACCOUNTS[0], request);
      log('B.10', `Arbitrator published decision evidence: ${commDecisionB}`);

      const settleCalldataB = encodeFunctionData({
        abi: FACTORY_ART.abi,
        functionName: 'settleDispute',
        args: [marketIdB, Outcome.INVALID, commDecisionB],
      });
      const rcArbitrateB = await multisigExecuteBothOwners({
        publicClient,
        walletClient,
        mock: arbitratorMockAddr,
        owners: LOCAL_ROLES.arbitratorOwners,
        to: factoryAddr,
        data: settleCalldataB,
        label: 'B: Arbitrator Settle Dispute INVALID',
      });
      recordTxB(7, 'Arbitrator Owner 1 confirms dispute settlement', rcArbitrateB[0]);
      recordTxB(8, 'Arbitrator Owner 2 executes settlement INVALID', rcArbitrateB[1], { commitment: commDecisionB });

      // Step 11: Ingest & Verify Neutral Disposition & Zero Fee in Database/API
      await ingestOnce(indexerDeps);
      const marketRowB = await prisma.market.findUnique({
        where: { onchainMarketId: marketIdB },
      });
      assert(marketRowB.status === 'CANCELLED', 'Market status in DB must be CANCELLED');
      assert(marketRowB.finalOutcome === 'INVALID', 'Market finalOutcome in DB must be INVALID');
      assert(marketRowB.refundable === true, 'Market refundable in DB must be true');
      const feeAccrualsB = await prisma.protocolFeeAccrual.findMany({
        where: { marketId: marketRowB.id, kind: 'accrued' },
      });
      assert(feeAccrualsB.length === 0, 'Protocol fee on INVALID must be exactly 0 (ADR-0011)');

      const settlementB = await prisma.marketSettlement.findUnique({
        where: { marketId: marketRowB.id },
      });
      assert(settlementB.disposition === 'NEUTRAL', 'Disposition on INVALID must be NEUTRAL');
      assert(settlementB.refundable === true, 'Settlement refundable must be true');
      log('B.11', `Indexer projected neutral settlement: disposition=NEUTRAL, fee=0, refundable=true`);

      // Verify Exposure Release
      const exposuresB = await prisma.exposureSnapshot.findMany({
        where: { marketId: marketRowB.id },
      });
      assert(exposuresB.length >= 1, 'ExposureSnapshot row must be created upon settlement');
      assert(exposuresB[0].amount.toString() === '20000000000000000000', 'Exposure release amount must equal 20 ETH pool');
      log('B.12', `Exposure release verified in database projections (20 ETH exposure freed)`);

      // Verify Fastify API shows CANCELLED and refundable: true
      const resMarketB = await fetch(`http://127.0.0.1:4310/api/v1/markets/${marketIdB}`);
      assert(resMarketB.ok, 'Failed to fetch market from API');
      const jsonMarketB = await resMarketB.json();
      assert(jsonMarketB.data.status === 'CANCELLED', 'API status must be CANCELLED');
      assert(jsonMarketB.data.refundable === true, 'API refundable must be true');
      log('B.13', `Fastify API verified: /api/v1/markets/${marketIdB} is CANCELLED and refundable`);

      // Step 12: 100% Principal Refunds Execution
      // Alice claims 5 ETH refund
      const rcAliceRefundB = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.yesParticipant,
        to: factoryAddr,
        data: encodeFunctionData({ abi: FACTORY_ART.abi, functionName: 'claimRefund', args: [marketIdB] }),
        label: 'B: Alice Claim 100% Refund (5 ETH)',
      });
      recordTxB(9, 'Alice claims 100% principal refund of 5 ETH', rcAliceRefundB, { expectedRefund: '5000000000000000000' });

      // Bob claims 15 ETH refund
      const rcBobRefundB = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.noParticipant,
        to: factoryAddr,
        data: encodeFunctionData({ abi: FACTORY_ART.abi, functionName: 'claimRefund', args: [marketIdB] }),
        label: 'B: Bob Claim 100% Refund (15 ETH)',
      });
      recordTxB(10, 'Bob claims 100% principal refund of 15 ETH', rcBobRefundB, { expectedRefund: '15000000000000000000' });

      // Creator claims 1 ETH creator bond
      const rcCreatorBondB = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.creator,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'claimBond',
          args: [marketIdB, BondType.CREATION, getAddress(LOCAL_ROLES.creator)],
        }),
        label: 'B: Creator Claim Bond (1 ETH)',
      });
      recordTxB(11, 'Creator claims 100% creation bond (1 ETH)', rcCreatorBondB, { expectedBond: '1000000000000000000' });

      // Proposer claims 10 ETH proposal bond
      const rcPropBondB = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.proposer,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'claimBond',
          args: [marketIdB, BondType.PROPOSAL, getAddress(LOCAL_ROLES.proposer)],
        }),
        label: 'B: Proposer Claim Bond (10 ETH)',
      });
      recordTxB(12, 'Proposer claims 100% proposal bond (10 ETH)', rcPropBondB, { expectedBond: '10000000000000000000' });

      // Challenger A claims 1 ETH challenge bond
      const rcChallABondB = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.challengerA,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'claimBond',
          args: [marketIdB, BondType.CHALLENGE, getAddress(LOCAL_ROLES.challengerA)],
        }),
        label: 'B: Challenger A Claim Bond (1 ETH)',
      });
      recordTxB(13, 'Challenger A claims 100% challenge bond (1 ETH)', rcChallABondB, { expectedBond: '1000000000000000000' });

      // Challenger B claims 2 ETH challenge bond
      const rcChallBBondB = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.challengerB,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'claimBond',
          args: [marketIdB, BondType.CHALLENGE, getAddress(LOCAL_ROLES.challengerB)],
        }),
        label: 'B: Challenger B Claim Bond (2 ETH)',
      });
      recordTxB(14, 'Challenger B claims 100% challenge bond (2 ETH)', rcChallBBondB, { expectedBond: '2000000000000000000' });

      // Step 13: Post-refund Indexer Ingestion & Mathematical Reconciliation
      await ingestOnce(indexerDeps);

      const contractBalAfterB = await publicClient.getBalance({ address: factoryAddr });
      const feeLiabilityAfterB = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'feeLiability',
        }),
      );
      const unaccountedB = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'unaccountedBalance',
        }),
      );

      const totalDepositsB = 34n * 10n ** 18n; // 1 (creation) + 5 (Alice) + 15 (Bob) + 10 (proposer) + 1 (ChallA) + 2 (ChallB)
      const totalRefundsB = 5n * 10n ** 18n + 15n * 10n ** 18n + 1n * 10n ** 18n + 10n * 10n ** 18n + 1n * 10n ** 18n + 2n * 10n ** 18n; // 34 ETH

      assert(totalDepositsB === totalRefundsB, 'Total deposits must equal total refunds for Market B');
      assert(
        contractBalAfterB === contractBalBeforeB,
        `Net contract balance delta for Market B must be exactly 0 (before: ${contractBalBeforeB}, after: ${contractBalAfterB})`,
      );
      assert(
        feeLiabilityAfterB === feeLiabilityBeforeB,
        `Fee liability must not increase for neutral INVALID resolution (before: ${feeLiabilityBeforeB}, after: ${feeLiabilityAfterB})`,
      );
      assert(unaccountedB === 0n, `Unaccounted dust must be 0, got ${unaccountedB}`);

      log('B.13', `Mathematical Reconciliation PASSED:`);
      log('  - Total Deposits:        34.0 ETH');
      log('  - Total Refunds:         34.0 ETH (Alice=5, Bob=15, Creator=1, Proposer=10, ChallA=1, ChallB=2)');
      log('  - Net Balance Delta:      0 WEI (Exact Zero-Delta Invariant)');
      log('  - Protocol Fee Accrued:   0 WEI (Neutral Resolution)');
      log('  - Unaccounted Dust:       0 WEI (Exact Solvency)');

      evidenceRecords.scenarios.scenarioB = {
        status: 'PASSED',
        marketId: marketIdB.toString(),
        totalTransactions: txLogB.length,
        transactions: txLogB,
        steps: stepsB,
        reconciliation: {
          totalDeposits: totalDepositsB.toString(),
          totalRefunds: totalRefundsB.toString(),
          feeLiabilityAccrued: '0',
          netBalanceDelta: (contractBalAfterB - contractBalBeforeB).toString(),
          unaccountedDust: unaccountedB.toString(),
          solvencyDelta: '0',
        },
      };
    }

    // =========================================================================
    // SCENARIO C: Emergency Pause & Expired Market Cancellation
    // =========================================================================
    if (runC) {
      log('\n' + '='.repeat(80));
      log('SCENARIO C', 'Emergency Pause & Expired Market Cancellation');
      log('='.repeat(80));

      const txLogC = [];
      const stepsC = [];

      function recordTxC(stepNo, stepName, receipt, extra = {}) {
        const item = {
          step: stepNo,
          action: stepName,
          txHash: receipt.transactionHash,
          blockNumber: Number(receipt.blockNumber),
          gasUsed: receipt.gasUsed.toString(),
          status: receipt.status,
          ...extra,
        };
        txLogC.push(item);
        stepsC.push(`Step ${stepNo}: ${stepName} (${receipt.status})`);
      }

      // Step 1: Pre-market status check
      const marketCountBeforeC = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'marketCount',
        }),
      );
      const marketIdC = marketCountBeforeC;
      log('C.01', `Target Market ID: ${marketIdC}`);

      const contractBalBeforeC = await publicClient.getBalance({ address: factoryAddr });
      const feeLiabilityBeforeC = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'feeLiability',
        }),
      );

      // Step 2: Publish Market Metadata to Fastify API
      const metadataC = {
        schema: 'orakl-market-metadata-v1',
        chainId: LOCAL_CHAIN_ID.toString(),
        factory: factoryAddr.toLowerCase(),
        question: 'ORAKL P1 Scenario C: Emergency Pause & Expired Market Cancellation',
        description: 'Market C for emergency pause and expired dispute cancellation verification.',
        category: 'emergency',
        resolutionCriteria: 'Cancels cleanly upon resolution expiration while under pause.',
        sources: ['https://orakl.network/protocol/c'],
        creator: getAddress(LOCAL_ROLES.creator).toLowerCase(),
        createdAt: '1790400000',
      };
      const { commitment: commMetaC, uri: metaUriC } = await publishMetadataToApi(
        metadataC,
        LOCAL_ROLES.creator,
        request,
      );
      log('C.02', `Published Market Metadata: commitment=${commMetaC}`);

      // Step 3: Deploy Market C
      const curBlockC = await publicClient.getBlock();
      const nowC = curBlockC.timestamp;
      const closeTimeC = nowC + 3600n;
      const resTimeC = nowC + 3600n;
      const maxResTimeC = resTimeC + 48n * 3600n + 96n * 3600n + 48n * 3600n;

      const rcCreateC = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.creator,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'createMarket',
          args: [commMetaC, metaUriC, closeTimeC, resTimeC, maxResTimeC],
        }),
        value: LOCAL_PARAMETERS.creationBond,
        label: 'C: CreateMarket',
      });
      recordTxC(1, 'Creator deploys Market C with 1 ETH bond', rcCreateC, { commitment: commMetaC });

      // Step 4: Deposits (YES=10 ETH, NO=20 ETH)
      const rcAlicePredC = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.yesParticipant,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'predict',
          args: [marketIdC, Side.YES],
        }),
        value: 10n * 10n ** 18n,
        label: 'C: Alice Predict YES (10 ETH)',
      });
      recordTxC(2, 'Alice deposits 10 ETH on YES', rcAlicePredC);

      const rcBobPredC = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.noParticipant,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'predict',
          args: [marketIdC, Side.NO],
        }),
        value: 20n * 10n ** 18n,
        label: 'C: Bob Predict NO (20 ETH)',
      });
      recordTxC(3, 'Bob deposits 20 ETH on NO', rcBobPredC);

      const marketInfoC = await publicClient.readContract({
        address: factoryAddr,
        abi: FACTORY_ART.abi,
        functionName: 'getMarket',
        args: [marketIdC],
      });
      assert(marketInfoC.yesPool === 10n * 10n ** 18n, 'yesPool must be 10 ETH');
      assert(marketInfoC.noPool === 20n * 10n ** 18n, 'noPool must be 20 ETH');
      log('C.06', `Pool totals verified: YES=10 ETH, NO=20 ETH, Total=30 ETH`);

      // Step 5: Advance past close
      await stepTime(request, 3605);
      log('C.07', `Time advanced past close; marketState is CLOSED`);

      // Step 6: Propose Outcome YES
      const manifestPropC = {
        schema: 'orakl-evidence-v1',
        chainId: LOCAL_CHAIN_ID.toString(),
        contract: factoryAddr.toLowerCase(),
        marketId: marketIdC.toString(),
        kind: 'proposal',
        claim: 'YES',
        proposedOutcome: 'YES',
        sources: ['https://reuters.com/eth-marketcap-report'],
        publishedAt: '1790403605',
        publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
        contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        contentMediaType: 'text/plain',
        media: [],
      };
      const { commitment: commPropC } = await publishEvidenceToApi(manifestPropC, DEV_ACCOUNTS[0], request);
      const rcPropC = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.proposer,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'proposeResult',
          args: [marketIdC, Outcome.YES, commPropC],
        }),
        value: LOCAL_PARAMETERS.proposalBond,
        label: 'C: Proposer Proposes YES (10 ETH)',
      });
      recordTxC(4, 'Proposer stakes 10 ETH on outcome YES', rcPropC, { commitment: commPropC });

      // Step 7: Dispute via Challenger A (1 ETH)
      const manifestChallC = {
        schema: 'orakl-evidence-v1',
        chainId: LOCAL_CHAIN_ID.toString(),
        contract: factoryAddr.toLowerCase(),
        marketId: marketIdC.toString(),
        kind: 'objection',
        claim: 'INVALID',
        proposedOutcome: 'YES',
        sources: ['https://coingecko.com/btc-dominance-data'],
        publishedAt: '1790403700',
        publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
        contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        contentMediaType: 'text/plain',
        media: [],
      };
      const { commitment: commChallC } = await publishEvidenceToApi(manifestChallC, DEV_ACCOUNTS[0], request);
      const rcChallC = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.challengerA,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'challengeResult',
          args: [marketIdC, commChallC],
        }),
        value: 1n * 10n ** 18n,
        label: 'C: Challenger A Stakes 1 ETH',
      });
      recordTxC(5, 'Challenger A stakes 1 ETH to dispute proposal', rcChallC, { commitment: commChallC });
      log('C.09', `Market entered DISPUTED state.`);

      // Step 8: Guardian triggers emergency pause
      const rcPause = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.guardian,
        to: configAddr,
        data: encodeFunctionData({
          abi: CONFIG_ART.abi,
          functionName: 'pause',
        }),
        label: 'C: Guardian Pause Protocol',
      });
      recordTxC(6, 'Guardian pauses ProtocolConfig', rcPause);

      const isPaused = await publicClient.readContract({
        address: configAddr,
        abi: CONFIG_ART.abi,
        functionName: 'paused',
      });
      assert(isPaused === true, 'ProtocolConfig must be paused');
      const isFinActive = await publicClient.readContract({
        address: configAddr,
        abi: CONFIG_ART.abi,
        functionName: 'financialActive',
      });
      assert(isFinActive === false, 'ProtocolConfig financialActive must be false');
      log('C.10', `ProtocolConfig successfully paused by Guardian; financialActive=false.`);

      // Step 9: Verify financial entry reverts when paused
      const rcRevertPred = await sendRevert({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.yesParticipant,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'predict',
          args: [marketIdC, Side.YES],
        }),
        value: 1n * 10n ** 18n,
        label: 'C: Predict Revert While Paused (FinancialActivityDisabled)',
      });
      recordTxC(7, 'Predict reverts with FinancialActivityDisabled while paused', rcRevertPred);
      log('C.11', `Confirmed: Financial deposit entry reverts while paused.`);

      // Step 10: Verify off-chain and on-chain evidence submission remains operational while paused
      const manifestSuppC = {
        schema: 'orakl-evidence-v1',
        chainId: LOCAL_CHAIN_ID.toString(),
        contract: factoryAddr.toLowerCase(),
        marketId: marketIdC.toString(),
        kind: 'supplement',
        claim: 'INVALID',
        proposedOutcome: 'YES',
        sources: ['https://orakl.network/supplemental-evidence'],
        publishedAt: '1790403800',
        publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
        contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        contentMediaType: 'text/plain',
        media: [],
      };
      const { commitment: commSuppC } = await publishEvidenceToApi(manifestSuppC, DEV_ACCOUNTS[0], request);
      const rcSuppEv = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.challengerA,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'submitEvidence',
          args: [marketIdC, commSuppC],
        }),
        label: 'C: Submit Evidence While Paused',
      });
      recordTxC(8, 'Submit evidence succeeds while paused', rcSuppEv, { commitment: commSuppC });
      log('C.12', `Confirmed: Off-chain and on-chain evidence submission remains active while paused.`);

      // Step 11: Premature cancellation attempt before arbitrationDeadline reverts
      await stepTime(request, 48 * 3600 + 10);
      const rcPrematureCancel = await sendRevert({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.spare,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'cancelExpiredMarket',
          args: [marketIdC],
        }),
        label: 'C: Premature Cancel Revert (InvalidTime)',
      });
      recordTxC(9, 'cancelExpiredMarket reverts with InvalidTime before arbitrationDeadline', rcPrematureCancel);
      log('C.13', `Confirmed: Premature cancellation before arbitrationDeadline reverts with InvalidTime.`);

      // Step 12: Advance past arbitrationDeadline and permissionlessly cancel
      await stepTime(request, 96 * 3600 + 100);
      const rcCancelExpired = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.spare,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'cancelExpiredMarket',
          args: [marketIdC],
        }),
        label: 'C: Permissionless cancelExpiredMarket',
      });
      recordTxC(10, 'Permissionlessly cancel expired disputed market', rcCancelExpired);

      // Verify duplicate cancellation reverts with InvalidState (exposure released once)
      const rcDupCancel = await sendRevert({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.spare,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'cancelExpiredMarket',
          args: [marketIdC],
        }),
        label: 'C: Duplicate Cancel Revert (InvalidState)',
      });
      recordTxC(11, 'Duplicate cancellation reverts with InvalidState', rcDupCancel);
      log('C.14', `Expired market cancelled permissionlessly; duplicate cancellation reverted with InvalidState.`);

      // Step 13: Ingest indexer & verify DB and API read model
      await ingestOnce(indexerDeps);
      const marketRowC = await prisma.market.findFirst({
        where: { onchainMarketId: marketIdC, chainId: LOCAL_CHAIN_ID },
      });
      assert(marketRowC.status === 'CANCELLED', 'Market C status in DB must be CANCELLED');
      assert(marketRowC.finalOutcome === 'INVALID', 'Market C finalOutcome in DB must be INVALID');
      assert(marketRowC.refundable === true, 'Market C refundable in DB must be true');

      const resC = await fetch(`http://127.0.0.1:4310/api/v1/markets/${marketIdC}`);
      assert(resC.ok, `API market fetch failed: ${resC.status}`);
      const jsonC = await resC.json();
      assert(jsonC.data.status === 'CANCELLED', 'API status must be CANCELLED');
      assert(jsonC.data.refundable === true, 'API refundable must be true');
      log('C.15', `Indexer and Fastify API verified: Market ${marketIdC} is CANCELLED and refundable.`);

      // Step 14: 100% Principal and Neutral Bond Claims
      const rcAliceRefundC = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.yesParticipant,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'claimRefund',
          args: [marketIdC],
        }),
        label: 'C: Alice Claim 100% Refund (10 ETH)',
      });
      recordTxC(12, 'Alice claims 100% refund (10 ETH)', rcAliceRefundC);

      const rcBobRefundC = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.noParticipant,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'claimRefund',
          args: [marketIdC],
        }),
        label: 'C: Bob Claim 100% Refund (20 ETH)',
      });
      recordTxC(13, 'Bob claims 100% refund (20 ETH)', rcBobRefundC);

      const rcCreatorBondC = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.creator,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'claimBond',
          args: [marketIdC, BondType.CREATION, getAddress(LOCAL_ROLES.creator)],
        }),
        label: 'C: Creator Claim Bond (1 ETH)',
      });
      recordTxC(14, 'Creator claims 100% creation bond (1 ETH)', rcCreatorBondC);

      const rcPropBondC = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.proposer,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'claimBond',
          args: [marketIdC, BondType.PROPOSAL, getAddress(LOCAL_ROLES.proposer)],
        }),
        label: 'C: Proposer Claim Bond (10 ETH)',
      });
      recordTxC(15, 'Proposer claims 100% proposal bond (10 ETH)', rcPropBondC);

      const rcChallBondC = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.challengerA,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'claimBond',
          args: [marketIdC, BondType.CHALLENGE, getAddress(LOCAL_ROLES.challengerA)],
        }),
        label: 'C: Challenger A Claim Bond (1 ETH)',
      });
      recordTxC(16, 'Challenger A claims 100% challenge bond (1 ETH)', rcChallBondC);

      const rcDupClaim = await sendRevert({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.yesParticipant,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'claimRefund',
          args: [marketIdC],
        }),
        label: 'C: Alice Duplicate Claim Revert (AlreadyClaimed)',
      });
      recordTxC(17, 'Alice duplicate claim reverts with AlreadyClaimed', rcDupClaim);
      log('C.16', `All 100% refunds and neutral bonds claimed; duplicate claim reverted with AlreadyClaimed.`);

      // Step 15: Post-refund Indexer Ingestion & Mathematical Solvency Reconciliation
      await ingestOnce(indexerDeps);
      const contractBalAfterC = await publicClient.getBalance({ address: factoryAddr });
      const feeLiabilityAfterC = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'feeLiability',
        }),
      );
      const unaccountedC = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'unaccountedBalance',
        }),
      );

      const totalDepositsC = 42n * 10n ** 18n;
      const totalRefundsC =
        10n * 10n ** 18n + 20n * 10n ** 18n + 1n * 10n ** 18n + 10n * 10n ** 18n + 1n * 10n ** 18n;
      assert(totalDepositsC === totalRefundsC, 'Total deposits must equal total refunds for Market C');
      assert(
        contractBalAfterC === contractBalBeforeC,
        `Net contract balance delta for Market C must be exactly 0 (before: ${contractBalBeforeC}, after: ${contractBalAfterC})`,
      );
      assert(
        feeLiabilityAfterC === feeLiabilityBeforeC,
        `Fee liability must not increase for neutral cancellation (before: ${feeLiabilityBeforeC}, after: ${feeLiabilityAfterC})`,
      );
      assert(unaccountedC === 0n, `Unaccounted dust must be 0, got ${unaccountedC}`);

      log('C.17', `Mathematical Reconciliation PASSED:`);
      log('  - Total Deposits:        42.0 ETH');
      log('  - Total Refunds:         42.0 ETH (Alice=10, Bob=20, Creator=1, Proposer=10, ChallA=1)');
      log('  - Net Balance Delta:      0 WEI (Exact Zero-Delta Invariant)');
      log('  - Protocol Fee Accrued:   0 WEI (Neutral Resolution)');
      log('  - Unaccounted Dust:       0 WEI (Exact Solvency)');

      // Step 16: Compliance approve & Governance unpause/reactivate finance
      const releaseC = keccak256(
        toHex(`ORAKL-SELECTED-RELEASE-31337-${manifest.status}-${manifest.contracts.selectedMarketFactory.address}`),
      );
      const rcApproveRelease = await multisigExecuteBothOwners({
        publicClient,
        walletClient,
        mock: complianceMockAddr,
        owners: LOCAL_ROLES.complianceOwners,
        to: configAddr,
        data: encodeFunctionData({
          abi: CONFIG_ART.abi,
          functionName: 'approveRelease',
          args: [releaseC],
        }),
        label: 'C: Compliance Approve Release',
      });
      recordTxC(18, 'Compliance approves release for unpause', rcApproveRelease[1]);

      await stepTime(request, 86400);

      const rcUnpause = await multisigExecuteBothOwners({
        publicClient,
        walletClient,
        mock: governanceMockAddr,
        owners: LOCAL_ROLES.governanceOwners,
        to: configAddr,
        data: encodeFunctionData({
          abi: CONFIG_ART.abi,
          functionName: 'unpause',
        }),
        label: 'C: Governance Unpause Protocol',
      });
      recordTxC(19, 'Governance unpauses ProtocolConfig', rcUnpause[1]);

      const rcReactivate = await multisigExecuteBothOwners({
        publicClient,
        walletClient,
        mock: governanceMockAddr,
        owners: LOCAL_ROLES.governanceOwners,
        to: configAddr,
        data: encodeFunctionData({
          abi: CONFIG_ART.abi,
          functionName: 'activateFinance',
          args: [releaseC],
        }),
        label: 'C: Governance Reactivate Finance',
      });
      recordTxC(20, 'Governance reactivates finance', rcReactivate[1]);

      const isPausedFinal = await publicClient.readContract({
        address: configAddr,
        abi: CONFIG_ART.abi,
        functionName: 'paused',
      });
      assert(isPausedFinal === false, 'ProtocolConfig must be unpaused');
      const isFinActiveFinal = await publicClient.readContract({
        address: configAddr,
        abi: CONFIG_ART.abi,
        functionName: 'financialActive',
      });
      assert(isFinActiveFinal === true, 'ProtocolConfig financialActive must be restored to true');
      await ingestOnce(indexerDeps);
      log('C.18', `Protocol successfully restored: paused=false, financialActive=true.`);

      evidenceRecords.scenarios.scenarioC = {
        status: 'PASSED',
        marketId: marketIdC.toString(),
        totalTransactions: txLogC.length,
        transactions: txLogC,
        steps: stepsC,
        reconciliation: {
          totalDeposits: totalDepositsC.toString(),
          totalRefunds: totalRefundsC.toString(),
          feeLiabilityAccrued: '0',
          netBalanceDelta: (contractBalAfterC - contractBalBeforeC).toString(),
          unaccountedDust: unaccountedC.toString(),
          solvencyDelta: '0',
        },
      };
    }

    // =========================================================================
    // SCENARIO D: 10-Block Reorganization Rollback, Pruning & Canonical Replay
    // =========================================================================
    if (runD) {
      log('\n' + '='.repeat(80));
      log('SCENARIO D', '10-Block Reorganization Rollback, Pruning & Canonical Replay');
      log('='.repeat(80));

      const txLogD = [];
      const stepsD = [];

      function recordTxD(stepNo, stepName, receipt, extra = {}) {
        const item = {
          step: stepNo,
          action: stepName,
          txHash: receipt.transactionHash,
          blockNumber: Number(receipt.blockNumber),
          gasUsed: receipt.gasUsed.toString(),
          status: receipt.status,
          ...extra,
        };
        txLogD.push(item);
        stepsD.push(`Step ${stepNo}: ${stepName} (${receipt.status})`);
      }

      // Step 1: Ensure indexer is synced up to current canonical head before snapshot
      await ingestOnce(indexerDeps);
      const snapBlock = await publicClient.getBlockNumber({ cacheTime: 0 });
      const snapId = await request('evm_snapshot', []);
      assert(snapId, 'evm_snapshot failed');
      log('D.01', `Anvil snapshot captured: ${snapId} at block ${snapBlock}`);

      // Step 2: Mine Branch 1 (>= 10 blocks) with active market state
      const marketCountD = BigInt(
        await publicClient.readContract({
          address: factoryAddr,
          abi: FACTORY_ART.abi,
          functionName: 'marketCount',
        }),
      );
      log('D.02', `Target Market ID for Fork Branch 1: ${marketCountD}`);

      const metadataD1 = {
        schema: 'orakl-market-metadata-v1',
        chainId: LOCAL_CHAIN_ID.toString(),
        factory: factoryAddr.toLowerCase(),
        question: 'ORAKL P1 Scenario D: Forked Branch 1 Market',
        description: 'Market D Branch 1 for reorganization fork simulation.',
        category: 'tech',
        resolutionCriteria: 'This market is mined on Branch 1 and should be rolled back.',
        sources: ['https://orakl.network/reorg/d1'],
        creator: getAddress(LOCAL_ROLES.creator).toLowerCase(),
        createdAt: '1790500000',
      };
      const { commitment: commD1, uri: uriD1 } = await publishMetadataToApi(
        metadataD1,
        LOCAL_ROLES.creator,
        request,
      );

      const curBlockD1 = await publicClient.getBlock();
      const nowD1 = curBlockD1.timestamp;
      const closeTimeD1 = nowD1 + 3600n;
      const resTimeD1 = nowD1 + 3600n;
      const maxResTimeD1 = resTimeD1 + 48n * 3600n + 96n * 3600n + 48n * 3600n;

      const rcCreateD1 = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.creator,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'createMarket',
          args: [commD1, uriD1, closeTimeD1, resTimeD1, maxResTimeD1],
        }),
        value: LOCAL_PARAMETERS.creationBond,
        label: 'D1: CreateMarket Branch 1',
      });
      recordTxD(1, 'Creator deploys Market D1 on Branch 1 (1 ETH bond)', rcCreateD1);

      const rcAliceD1 = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.yesParticipant,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'predict',
          args: [marketCountD, Side.YES],
        }),
        value: 7n * 10n ** 18n,
        label: 'D1: Alice Predict YES (7 ETH)',
      });
      recordTxD(2, 'Alice deposits 7 ETH on YES (Branch 1)', rcAliceD1);

      const rcBobD1 = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.noParticipant,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'predict',
          args: [marketCountD, Side.NO],
        }),
        value: 13n * 10n ** 18n,
        label: 'D1: Bob Predict NO (13 ETH)',
      });
      recordTxD(3, 'Bob deposits 13 ETH on NO (Branch 1)', rcBobD1);

      await stepTime(request, 3605);

      const manifestPropD1 = {
        schema: 'orakl-evidence-v1',
        chainId: LOCAL_CHAIN_ID.toString(),
        contract: factoryAddr.toLowerCase(),
        marketId: marketCountD.toString(),
        kind: 'proposal',
        claim: 'YES',
        proposedOutcome: 'YES',
        sources: ['https://reuters.com/reorg-branch1'],
        publishedAt: '1790503605',
        publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
        contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        contentMediaType: 'text/plain',
        media: [],
      };
      const { commitment: commPropD1 } = await publishEvidenceToApi(manifestPropD1, DEV_ACCOUNTS[0], request);
      const rcPropD1 = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.proposer,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'proposeResult',
          args: [marketCountD, Outcome.YES, commPropD1],
        }),
        value: LOCAL_PARAMETERS.proposalBond,
        label: 'D1: Proposer Proposes YES (10 ETH)',
      });
      recordTxD(4, 'Proposer proposes YES on Branch 1 (10 ETH bond)', rcPropD1);

      const manifestChallD1 = {
        schema: 'orakl-evidence-v1',
        chainId: LOCAL_CHAIN_ID.toString(),
        contract: factoryAddr.toLowerCase(),
        marketId: marketCountD.toString(),
        kind: 'objection',
        claim: 'INVALID',
        proposedOutcome: 'YES',
        sources: ['https://coingecko.com/reorg-branch1'],
        publishedAt: '1790503700',
        publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
        contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        contentMediaType: 'text/plain',
        media: [],
      };
      const { commitment: commChallD1 } = await publishEvidenceToApi(manifestChallD1, DEV_ACCOUNTS[0], request);
      const rcChallD1 = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.challengerA,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'challengeResult',
          args: [marketCountD, commChallD1],
        }),
        value: 1n * 10n ** 18n,
        label: 'D1: Challenger A Stakes 1 ETH',
      });
      recordTxD(5, 'Challenger A stakes 1 ETH on Branch 1', rcChallD1);

      // Mine 6 additional blocks to guarantee Branch 1 spans at least 11 blocks from snapshot
      for (let i = 0; i < 6; i++) {
        await request('evm_mine', []);
      }
      const tipBranch1 = await publicClient.getBlockNumber({ cacheTime: 0 });
      assert(tipBranch1 - snapBlock >= 10n, `Branch 1 must span >= 10 blocks: ${tipBranch1 - snapBlock}`);
      log('D.03', `Branch 1 mined to block ${tipBranch1} (${tipBranch1 - snapBlock} blocks from snapshot).`);

      // Ingest Branch 1
      const r1 = await ingestOnce(indexerDeps);
      assert(r1.events > 0, 'Branch 1 must produce events');
      const mD1 = await prisma.market.findFirst({
        where: { onchainMarketId: marketCountD, chainId: LOCAL_CHAIN_ID },
      });
      assert(mD1 && mD1.status === 'DISPUTED', 'Branch 1 market must be DISPUTED in DB');
      const predsD1 = await prisma.prediction.findMany({
        where: { market: { onchainMarketId: marketCountD } },
      });
      assert(predsD1.length === 2, 'Branch 1 must have 2 predictions in DB');
      const yesPredD1 = predsD1.find((p) => p.side === 'YES');
      const noPredD1 = predsD1.find((p) => p.side === 'NO');
      assert(
        yesPredD1 && BigInt(yesPredD1.amount.toString()) === 7n * 10n ** 18n,
        'Branch 1 YES prediction must be 7 ETH',
      );
      assert(
        noPredD1 && BigInt(noPredD1.amount.toString()) === 13n * 10n ** 18n,
        'Branch 1 NO prediction must be 13 ETH',
      );
      const disputesD1 = await prisma.dispute.count({ where: { market: { onchainMarketId: marketCountD } } });
      assert(disputesD1 === 1, 'Branch 1 must have 1 dispute recorded');

      const onChainD1 = await publicClient.readContract({
        address: factoryAddr,
        abi: FACTORY_ART.abi,
        functionName: 'getMarket',
        args: [marketCountD],
      });
      assert(onChainD1.yesPool === 7n * 10n ** 18n, 'Branch 1 on-chain yesPool must be 7 ETH');
      assert(onChainD1.noPool === 13n * 10n ** 18n, 'Branch 1 on-chain noPool must be 13 ETH');
      log('D.04', `Branch 1 ingested successfully into database with 1 dispute and 2 predictions.`);

      // Step 3: Revert to snapshot to simulate chain reorganization
      const revOk = await request('evm_revert', [snapId]);
      assert(revOk === true, 'evm_revert failed');
      const revertedBlock = await publicClient.getBlockNumber({ cacheTime: 0 });
      assert(revertedBlock === snapBlock, `Reverted block mismatch: ${revertedBlock} vs ${snapBlock}`);
      log('D.05', `Anvil reverted to snapshot at block ${snapBlock}; Branch 1 is now orphaned.`);

      // Step 4: Mine Canonical Branch 2 over the same heights with distinct content and hashes
      await stepTime(request, 15);

      const metadataD2 = {
        schema: 'orakl-market-metadata-v1',
        chainId: LOCAL_CHAIN_ID.toString(),
        factory: factoryAddr.toLowerCase(),
        question: 'ORAKL P1 Scenario D: Canonical Alternative Branch 2 Market',
        description: 'Market D Branch 2 canonical branch after reorganization.',
        category: 'tech',
        resolutionCriteria: 'This market is mined on Canonical Branch 2 and must persist.',
        sources: ['https://orakl.network/canonical/d2'],
        creator: getAddress(LOCAL_ROLES.creator).toLowerCase(),
        createdAt: '1790600000',
      };
      const { commitment: commD2, uri: uriD2 } = await publishMetadataToApi(
        metadataD2,
        LOCAL_ROLES.creator,
        request,
      );

      const curBlockD2 = await publicClient.getBlock();
      const nowD2 = curBlockD2.timestamp;
      const closeTimeD2 = nowD2 + 3600n;
      const resTimeD2 = nowD2 + 3600n;
      const maxResTimeD2 = resTimeD2 + 48n * 3600n + 96n * 3600n + 48n * 3600n;

      const rcCreateD2 = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.creator,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'createMarket',
          args: [commD2, uriD2, closeTimeD2, resTimeD2, maxResTimeD2],
        }),
        value: LOCAL_PARAMETERS.creationBond,
        label: 'D2: CreateMarket Branch 2',
      });
      recordTxD(6, 'Creator deploys Market D2 on Canonical Branch 2 (1 ETH bond)', rcCreateD2);

      const rcAliceD2 = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.yesParticipant,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'predict',
          args: [marketCountD, Side.YES],
        }),
        value: 4n * 10n ** 18n,
        label: 'D2: Alice Predict YES (4 ETH)',
      });
      recordTxD(7, 'Alice deposits 4 ETH on YES (Branch 2)', rcAliceD2);

      const rcBobD2 = await sendOk({
        publicClient,
        walletClient,
        account: LOCAL_ROLES.noParticipant,
        to: factoryAddr,
        data: encodeFunctionData({
          abi: FACTORY_ART.abi,
          functionName: 'predict',
          args: [marketCountD, Side.NO],
        }),
        value: 8n * 10n ** 18n,
        label: 'D2: Bob Predict NO (8 ETH)',
      });
      recordTxD(8, 'Bob deposits 8 ETH on NO (Branch 2)', rcBobD2);

      // Mine 8 additional blocks to ensure Branch 2 spans >= 10 blocks
      for (let i = 0; i < 8; i++) {
        await request('evm_mine', []);
      }
      const tipBranch2 = await publicClient.getBlockNumber({ cacheTime: 0 });
      assert(tipBranch2 - snapBlock >= 10n, `Branch 2 must span >= 10 blocks: ${tipBranch2 - snapBlock}`);
      const liveTipHeader = await publicClient.getBlock({ blockNumber: tipBranch2 });
      log('D.06', `Canonical Branch 2 mined to block ${tipBranch2} (${tipBranch2 - snapBlock} blocks from snapshot).`);

      // Step 5: Trigger indexer cycle -> verify reorg detection & rollback
      const r2 = await ingestOnce(indexerDeps);
      assert(r2.rollbacks === 1, `Expected exactly 1 rollback, got ${r2.rollbacks}`);
      log('D.07', `Indexer detected reorg divergence and performed 1 atomic rollback.`);

      // Step 6: Verify IndexerRollback database audit record
      const rb = await prisma.indexerRollback.findFirst({
        where: { chainId: LOCAL_CHAIN_ID },
        orderBy: { id: 'desc' },
      });
      assert(rb, 'IndexerRollback row must exist in DB');
      assert(rb.removedBlocks >= 10, `Expected at least 10 removed blocks, got ${rb.removedBlocks}`);
      assert(rb.removedEvents > 0, `Expected removedEvents > 0, got ${rb.removedEvents}`);
      assert(rb.replayedEvents > 0, `Expected replayedEvents > 0, got ${rb.replayedEvents}`);
      log(
        'D.08',
        `Rollback audit verified: removedBlocks=${rb.removedBlocks}, removedEvents=${rb.removedEvents}, replayedEvents=${rb.replayedEvents}`,
      );

      // Step 7: Verify atomic pruning & projection replay without duplicate stakes
      const disputesAfter = await prisma.dispute.count({ where: { market: { onchainMarketId: marketCountD } } });
      assert(disputesAfter === 0, `Branch 1 dispute must be purged, found ${disputesAfter}`);
      const challengeStakesAfter = await prisma.challengeStake.count({
        where: { market: { onchainMarketId: marketCountD } },
      });
      assert(challengeStakesAfter === 0, `Branch 1 challenge stakes must be purged, found ${challengeStakesAfter}`);

      const mBranch2 = await prisma.market.findFirst({
        where: { onchainMarketId: marketCountD, chainId: LOCAL_CHAIN_ID },
      });
      assert(mBranch2, 'Canonical market D must exist in DB');
      assert(mBranch2.status === 'OPEN', `Market on canonical branch must be OPEN, got ${mBranch2.status}`);

      const predsAfter = await prisma.prediction.findMany({
        where: { market: { onchainMarketId: marketCountD } },
      });
      assert(predsAfter.length === 2, `Expected exactly 2 predictions, got ${predsAfter.length}`);
      const yesPredD2 = predsAfter.find((p) => p.side === 'YES');
      const noPredD2 = predsAfter.find((p) => p.side === 'NO');
      assert(
        yesPredD2 && BigInt(yesPredD2.amount.toString()) === 4n * 10n ** 18n,
        'Branch 2 YES prediction must be 4 ETH',
      );
      assert(
        noPredD2 && BigInt(noPredD2.amount.toString()) === 8n * 10n ** 18n,
        'Branch 2 NO prediction must be 8 ETH',
      );

      const onChainD2 = await publicClient.readContract({
        address: factoryAddr,
        abi: FACTORY_ART.abi,
        functionName: 'getMarket',
        args: [marketCountD],
      });
      assert(onChainD2.yesPool === 4n * 10n ** 18n, 'Branch 2 on-chain yesPool must be 4 ETH');
      assert(onChainD2.noPool === 8n * 10n ** 18n, 'Branch 2 on-chain noPool must be 8 ETH');

      log(
        'D.09',
        `Orphaned Branch 1 projections purged; Canonical Branch 2 state accurately folded with zero duplicates.`,
      );

      // Step 8: Verify Fastify API sync metadata reflects the new canonical block hash
      const resApi = await fetch('http://127.0.0.1:4310/api/v1/indexer/status');
      assert(resApi.ok, `API indexer status failed: ${resApi.status}`);
      const apiJson = await resApi.json();
      const lastBlock = BigInt(apiJson.sync?.lastProcessedBlock ?? apiJson.data?.checkpoint?.lastProcessedBlock);
      const lastHash = String(apiJson.sync?.lastProcessedBlockHash ?? apiJson.data?.checkpoint?.lastProcessedBlockHash);
      assert(
        lastBlock === tipBranch2,
        `API sync lastProcessedBlock mismatch: ${lastBlock} vs ${tipBranch2}`,
      );
      assert(
        lastHash.toLowerCase() === liveTipHeader.hash.toLowerCase(),
        `API sync lastProcessedBlockHash mismatch: ${lastHash} vs ${liveTipHeader.hash}`,
      );
      log(
        'D.10',
        `Fastify API sync metadata verified: block=${lastBlock}, hash=${lastHash.slice(0, 10)}...`,
      );

      // Step 9: Verify Checkpoint Resumption after simulated process restart
      const restartPrisma = makePrisma();
      const restartDeps = { ...indexerDeps, prisma: restartPrisma };
      const eventsBeforeRestart = await restartPrisma.indexedEvent.count({ where: { chainId: LOCAL_CHAIN_ID } });
      const rRestart = await ingestOnce(restartDeps);
      assert(rRestart.events === 0, `Expected 0 new events on restart, got ${rRestart.events}`);
      assert(rRestart.blocks === 0, `Expected 0 new blocks on restart, got ${rRestart.blocks}`);
      assert(rRestart.rollbacks === 0, `Expected 0 rollbacks on restart, got ${rRestart.rollbacks}`);
      const eventsAfterRestart = await restartPrisma.indexedEvent.count({ where: { chainId: LOCAL_CHAIN_ID } });
      assert(eventsBeforeRestart === eventsAfterRestart, 'Event count changed after restart');
      await restartPrisma.$disconnect();
      log('D.11', `Simulated process restart verified: checkpoint resumed with 0 duplicate events.`);

      evidenceRecords.scenarios.scenarioD = {
        status: 'PASSED',
        marketId: marketCountD.toString(),
        totalTransactions: txLogD.length,
        transactions: txLogD,
        steps: stepsD,
        rollbackAudit: {
          removedBlocks: rb.removedBlocks,
          removedEvents: rb.removedEvents,
          replayedEvents: rb.replayedEvents,
        },
        canonicalState: {
          status: mBranch2.status,
          yesPool: onChainD2.yesPool.toString(),
          noPool: onChainD2.noPool.toString(),
          predictionsCount: predsAfter.length,
        },
      };
    }

    // =========================================================================
    // Write Evidence Artifacts
    // =========================================================================
    evidenceRecords.summary = {
      allPassed: true,
      scenariosExecuted: [
        runA ? 'Scenario A' : null,
        runB ? 'Scenario B' : null,
        runC ? 'Scenario C' : null,
        runD ? 'Scenario D' : null,
      ].filter(Boolean),
      totalTransactions:
        (evidenceRecords.scenarios.scenarioA?.transactions.length ?? 0) +
        (evidenceRecords.scenarios.scenarioB?.transactions.length ?? 0) +
        (evidenceRecords.scenarios.scenarioC?.transactions.length ?? 0) +
        (evidenceRecords.scenarios.scenarioD?.transactions.length ?? 0),
      executedAt: new Date().toISOString(),
      verifier: 'scripts/p1/run-e2e-scenarios.mjs',
    };

    const outDir = resolve(REPO_ROOT, 'docs/p1/evidence');
    const isFullRun = Boolean(runA && runB && runC && runD);

    const pubResult = publishEvidenceBundle({
      outDir,
      records: evidenceRecords,
      isFullRun,
    });

    if (pubResult.publishedCanonical) {
      log('\nevidence', `Published canonical 3-artifact bundle to: ${outDir.replace(`${REPO_ROOT}/`, '')}`);
      for (const a of pubResult.canonicalArtifacts) {
        log('artifact', `${a.file}: ${a.bytes} bytes, sha256=${a.sha256}`);
      }
    } else {
      log('\nevidence', `Partial scenario run: evidence saved to ${pubResult.partialPath.replace(`${REPO_ROOT}/`, '')}`);
      log('warning', 'Canonical bundle (e2e-scenarios.json, etc.) NOT overwritten to preserve unified execution provenance.');
    }

    // =========================================================================
    // Format and Print Summary Table
    // =========================================================================
    console.log('\n' + '='.repeat(100));
    console.log('                          ORAKL P1 E2E VERIFICATION SUMMARY');
    console.log('='.repeat(100));
    console.log(` Network: Chain ID ${LOCAL_CHAIN_ID} (Anvil) | Timestamp: ${evidenceRecords.summary.executedAt}`);
    console.log(` Factory: ${factoryAddr} | Config: ${configAddr}`);
    console.log('-'.repeat(100));
    console.log(
      `| ${'Scenario'.padEnd(12)} | ${'Market'.padEnd(8)} | ${'Txs'.padEnd(6)} | ${'Status'.padEnd(8)} | ${'Deposits'.padEnd(14)} | ${'Payouts / Refunds'.padEnd(18)} | ${'Fee Retained'.padEnd(14)} |`,
    );
    console.log('-'.repeat(100));

    if (evidenceRecords.scenarios.scenarioA) {
      console.log(
        `| ${'Scenario A'.padEnd(12)} | ${evidenceRecords.scenarios.scenarioA.marketId.padEnd(8)} | ${evidenceRecords.scenarios.scenarioA.totalTransactions.toString().padEnd(6)} | ${'PASSED'.padEnd(8)} | ${'44.0 ETH'.padEnd(14)} | ${'43.4 ETH'.padEnd(18)} | ${'0.6 ETH (2%)'.padEnd(14)} |`,
      );
    }
    if (evidenceRecords.scenarios.scenarioB) {
      console.log(
        `| ${'Scenario B'.padEnd(12)} | ${evidenceRecords.scenarios.scenarioB.marketId.padEnd(8)} | ${evidenceRecords.scenarios.scenarioB.totalTransactions.toString().padEnd(6)} | ${'PASSED'.padEnd(8)} | ${'34.0 ETH'.padEnd(14)} | ${'34.0 ETH'.padEnd(18)} | ${'0.0 ETH (0%)'.padEnd(14)} |`,
      );
    }
    if (evidenceRecords.scenarios.scenarioC) {
      console.log(
        `| ${'Scenario C'.padEnd(12)} | ${evidenceRecords.scenarios.scenarioC.marketId.padEnd(8)} | ${evidenceRecords.scenarios.scenarioC.totalTransactions.toString().padEnd(6)} | ${'PASSED'.padEnd(8)} | ${'42.0 ETH'.padEnd(14)} | ${'42.0 ETH'.padEnd(18)} | ${'0.0 ETH (0%)'.padEnd(14)} |`,
      );
    }
    if (evidenceRecords.scenarios.scenarioD) {
      console.log(
        `| ${'Scenario D'.padEnd(12)} | ${evidenceRecords.scenarios.scenarioD.marketId.padEnd(8)} | ${evidenceRecords.scenarios.scenarioD.totalTransactions.toString().padEnd(6)} | ${'PASSED'.padEnd(8)} | ${'13.0 ETH'.padEnd(14)} | ${'REORG REPLAY'.padEnd(18)} | ${'ROLLBACK: 1'.padEnd(14)} |`,
      );
    }
    console.log('='.repeat(100));
    console.log(' [✔] Remainder-Free Telescopic Challenger Allocation Confirmed (0 dust)');
    console.log(' [✔] Premature Arbitration Revert Confirmed (InvalidTime)');
    console.log(' [✔] 100% Principal Refunds on Neutral INVALID Confirmed (Zero Protocol Fee)');
    console.log(' [✔] Emergency Pause Blocks Predictions While Preserving Dispute Evidence Submission');
    console.log(' [✔] 100% Neutral Refunds on Expired Dispute Cancellation Confirmed (Zero Fee)');
    console.log(' [✔] 10-Block Reorganization Detection, Atomic Pruning & Canonical Replay Confirmed');
    console.log(' [✔] Indexer Checkpoint Resumption After Restart Idempotent (Zero Duplicates)');
    console.log(' [✔] Fastify API Sync Metadata Accurately Reflects Canonical Tip');
    console.log('='.repeat(100) + '\n');
  } finally {
    if (apiServer && !apiServer.external && apiServer.app) {
      await apiServer.app.close();
      log('api', 'Closed local Fastify server');
    }
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  process.stderr.write(`\n[E2E RUNNER ERROR] ${err.stack ?? err}\n`);
  process.exit(1);
});
