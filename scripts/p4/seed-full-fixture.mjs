#!/usr/bin/env node
/**
 * Seed helper to create Market #4 (DISPUTED), Market #5 (PROPOSED),
 * and Market #6 (Unindexed / Missing Metadata test case).
 */
import { register } from 'node:module';
register(new URL('../p1/ts-resolver.mjs', import.meta.url));

import { encodeFunctionData, keccak256, stringToBytes, toHex, getAddress } from 'viem';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LOCAL_CHAIN_ID,
  LOCAL_PARAMETERS,
  LOCAL_ROLES,
  REPO_ROOT,
  artifact,
  log,
  makeClients,
} from '../p1/lib.mjs';

const { buildServer } = await import('../../backend/src/api/server.ts');
const { makePrisma } = await import('../../backend/src/db.ts');
const { loadConfig } = await import('../../backend/src/config.ts');
const { ingestOnce } = await import('../../backend/src/indexer/run.ts');
const { canonicalizeEvidence, evidenceCommitment } = await import('../../backend/src/evidence/evidence.ts');

const FACTORY_ART = artifact('SelectedMarketFactory');
const MOCK_ART = artifact('LocalRoleMock');
const CONFIG_ART = artifact('ProtocolConfig');

const { publicClient, walletClient, request } = makeClients();
const prisma = makePrisma();
const config = loadConfig();

const depPath = resolve(REPO_ROOT, 'frontend/public/deployments/local-selected.json');
const deployment = JSON.parse(readFileSync(depPath, 'utf8'));
const factoryAddr = getAddress(deployment.contracts.selectedMarketFactory.address);
const configAddr = getAddress(deployment.contracts.protocolConfig.address);

const roles = {
  creator: getAddress(LOCAL_ROLES.creator),
  yesParticipant: getAddress(LOCAL_ROLES.yesParticipant),
  noParticipant: getAddress(LOCAL_ROLES.noParticipant),
  proposer: getAddress(LOCAL_ROLES.proposer),
  challengerA: getAddress(LOCAL_ROLES.challengerA),
  challengerB: getAddress(LOCAL_ROLES.challengerB),
};

const Side = { YES: 0, NO: 1 };

async function publishMetadataToApi(metadata, signerAddress) {
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

async function sendOk({ account, to, data, value = 0n, label }) {
  const hash = await walletClient.sendTransaction({
    account,
    to,
    data,
    value,
    chain: publicClient.chain,
  });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`Tx ${label} reverted: ${hash}`);
  log('tx ok', `[${label}] ${hash.slice(0, 10)}... block=${rc.blockNumber}`);
  return rc;
}

async function main() {
  const marketCount = await publicClient.readContract({
    address: factoryAddr,
    abi: FACTORY_ART.abi,
    functionName: 'marketCount',
  });
  console.log(`Starting market count: ${marketCount}`);

  const indexerDeps = {
    prisma,
    config,
    chainId: LOCAL_CHAIN_ID,
    factory: factoryAddr,
    configContract: configAddr,
    startBlock: 5n,
    publicClient,
    batchSize: 100,
    confirmations: 0,
  };

  if (marketCount <= 4n) {
    // -------------------------------------------------------------
    // MARKET #4: DISPUTED (contested result with Proposer & Challenger)
    // -------------------------------------------------------------
    console.log('\n--- Creating Market #4 (DISPUTED) ---');
    const metadata4 = {
      schema: 'orakl-market-metadata-v1',
      chainId: '31337',
      factory: factoryAddr.toLowerCase(),
      question: 'Will the US Federal Reserve cut benchmark policy rates below 4.00% before December 2026?',
      description: 'Resolves YES if the upper bound of the target federal funds rate is lowered below 4.00% at or before the December 2026 FOMC meeting.',
      category: 'finance',
      resolutionCriteria: 'Federal Reserve Board FOMC statement confirms upper federal funds target < 4.00%.',
      sources: ['https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'],
      creator: getAddress(LOCAL_ROLES.creator).toLowerCase(),
      createdAt: '1790400000',
    };
    const { commitment: comm4, uri: uri4 } = await publishMetadataToApi(metadata4, LOCAL_ROLES.creator);

    const block4 = await publicClient.getBlock();
    const now4 = block4.timestamp;
    const close4 = now4 + 1800n; // 30 min
    const res4 = close4;
    const maxRes4 = res4 + 48n * 3600n + 96n * 3600n + 48n * 3600n;

    await sendOk({
      account: roles.creator,
      to: factoryAddr,
      data: encodeFunctionData({
        abi: FACTORY_ART.abi,
        functionName: 'createMarket',
        args: [comm4, uri4, close4, res4, maxRes4],
      }),
      value: LOCAL_PARAMETERS.creationBond,
      label: 'Create Market #4',
    });

    // Predictions: 5 ETH YES, 7 ETH NO
    await sendOk({
      account: roles.yesParticipant,
      to: factoryAddr,
      data: encodeFunctionData({ abi: FACTORY_ART.abi, functionName: 'predict', args: [4n, Side.YES] }),
      value: 5n * 10n ** 18n,
      label: 'Alice 5 ETH YES #4',
    });
    await sendOk({
      account: roles.noParticipant,
      to: factoryAddr,
      data: encodeFunctionData({ abi: FACTORY_ART.abi, functionName: 'predict', args: [4n, Side.NO] }),
      value: 7n * 10n ** 18n,
      label: 'Bob 7 ETH NO #4',
    });

    // Advance time past close
    await request('evm_increaseTime', [1900]);
    await request('evm_mine', []);

    // Proposer proposes YES (10 ETH)
    const commProp4 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await sendOk({
      account: roles.proposer,
      to: factoryAddr,
      data: encodeFunctionData({
        abi: FACTORY_ART.abi,
        functionName: 'proposeResult',
        args: [4n, 1, commProp4],
      }),
      value: LOCAL_PARAMETERS.proposalBond,
      label: 'Propose YES #4 (10 ETH)',
    });

    // Challenger A challenges (1 ETH)
    const commChall4 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    await sendOk({
      account: roles.challengerA,
      to: factoryAddr,
      data: encodeFunctionData({
        abi: FACTORY_ART.abi,
        functionName: 'challengeResult',
        args: [4n, commChall4],
      }),
      value: LOCAL_PARAMETERS.challengeBond,
      label: 'Challenger A stakes 1 ETH #4',
    });
    console.log('Market #4 entered DISPUTED state.');
  }

  if (marketCount <= 5n) {
    // -------------------------------------------------------------
    // MARKET #5: PROPOSED (active challenge window)
    // -------------------------------------------------------------
    console.log('\n--- Creating Market #5 (PROPOSED) ---');
    const metadata5 = {
      schema: 'orakl-market-metadata-v1',
      chainId: '31337',
      factory: factoryAddr.toLowerCase(),
      question: 'Will James Webb Space Telescope detect confirmed atmospheric biosignatures on an exoplanet by end of 2026?',
      description: 'Resolves YES if NASA/STScI publishes a peer-reviewed detection of atmospheric phosphine, methane, or ozone as biosignatures on an exoplanet.',
      category: 'science',
      resolutionCriteria: 'NASA or STScI press release and peer-reviewed astrophysical publication.',
      sources: ['https://webbtelescope.org/news'],
      creator: roles.creator.toLowerCase(),
      createdAt: '1790500000',
    };
    const { commitment: comm5, uri: uri5 } = await publishMetadataToApi(metadata5, roles.creator);

    const block5 = await publicClient.getBlock();
    const now5 = block5.timestamp;
    const close5 = now5 + 1800n;
    const res5 = close5;
    const maxRes5 = res5 + 48n * 3600n + 96n * 3600n + 48n * 3600n;

    await sendOk({
      account: roles.creator,
      to: factoryAddr,
      data: encodeFunctionData({
        abi: FACTORY_ART.abi,
        functionName: 'createMarket',
        args: [comm5, uri5, close5, res5, maxRes5],
      }),
      value: LOCAL_PARAMETERS.creationBond,
      label: 'Create Market #5',
    });

    // Predictions: 8 ETH YES, 0 ETH NO
    await sendOk({
      account: roles.yesParticipant,
      to: factoryAddr,
      data: encodeFunctionData({ abi: FACTORY_ART.abi, functionName: 'predict', args: [5n, Side.YES] }),
      value: 8n * 10n ** 18n,
      label: 'Alice 8 ETH YES #5',
    });

    // Advance time past close
    await request('evm_increaseTime', [1900]);
    await request('evm_mine', []);

    // Proposer proposes YES (10 ETH)
    const commProp5 = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    await sendOk({
      account: roles.proposer,
      to: factoryAddr,
      data: encodeFunctionData({
        abi: FACTORY_ART.abi,
        functionName: 'proposeResult',
        args: [5n, 1, commProp5],
      }),
      value: LOCAL_PARAMETERS.proposalBond,
      label: 'Propose YES #5 (10 ETH)',
    });
    console.log('Market #5 entered PROPOSED state.');
  }

  // Sync indexer
  console.log('\n--- Syncing Indexer ---');
  const res = await ingestOnce(indexerDeps);
  console.log(`Synced ${res.events} events into DB.`);

  const finalCount = await publicClient.readContract({
    address: factoryAddr,
    abi: FACTORY_ART.abi,
    functionName: 'marketCount',
  });
  console.log(`\nFinal on-chain market count: ${finalCount}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
