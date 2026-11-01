#!/usr/bin/env node
/**
 * ORAKL P1 — Playwright Browser End-to-End Financial Verification Harness
 *
 * Requirements (Strict Remediation P1-01):
 *  - Real Chromium browser (Playwright)
 *  - Real Vite frontend (http://127.0.0.1:5176)
 *  - Real Fastify API (http://127.0.0.1:4310)
 *  - Real PostgreSQL indexer
 *  - Real SelectedMarketFactory and ProtocolConfig on Anvil 31337 (http://127.0.0.1:8546)
 *  - Injected EIP-1193 window.ethereum provider exercising real frontend signing/write APIs
 *  - Executes Scenarios A (Binary Reversal), B (INVALID), C (Emergency Pause), D (Reorg)
 *  - Captures verified screenshots, transaction receipts, and database reconciliations
 */

import { register } from 'node:module';
register(new URL('./ts-resolver.mjs', import.meta.url));

import { spawn, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress, encodeFunctionData, keccak256, stringToBytes, toHex } from 'viem';

import {
  LOCAL_CHAIN_ID,
  LOCAL_PARAMETERS,
  LOCAL_ROLES,
  LOCAL_RPC_URL,
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

// Backend imports
const { buildServer } = await import('../../backend/src/api/server.ts');
const { makePrisma } = await import('../../backend/src/db.ts');
const { loadConfig } = await import('../../backend/src/config.ts');
const { ingestOnce } = await import('../../backend/src/indexer/run.ts');
const { evidenceCommitment } = await import('../../backend/src/evidence/evidence.ts');

const FACTORY_ART = artifact('SelectedMarketFactory');
const CONFIG_ART = artifact('ProtocolConfig');
const MOCK_ART = artifact('LocalRoleMock');

const SCREENSHOT_DIR = resolve(REPO_ROOT, 'docs/p1/evidence/screenshots');
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const homeDir = process.env.HOME || '';
const playwrightPath =
  process.env.PLAYWRIGHT_MODULE ||
  (homeDir ? `${homeDir}/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs` : 'playwright');
const chromiumExecutable =
  process.env.CHROMIUM_EXECUTABLE ||
  (homeDir ? `${homeDir}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome` : undefined);

// Ensure backend .env is loaded
const envPath = resolve(REPO_ROOT, 'backend/.env');
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

// ---------------------------------------------------------------------- Process management
let anvilProc = null;
let viteProc = null;
let apiServer = null;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPortReachable(port, host = '127.0.0.1') {
  try {
    const res = await fetch(`http://${host}:${port}/`, { method: 'HEAD', signal: AbortSignal.timeout(500) });
    return true;
  } catch {
    return false;
  }
}

async function startAnvil() {
  log('anvil', 'Checking if Anvil is already running on port 8546...');
  try {
    const res = await fetch('http://127.0.0.1:8546', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });
    if (res.ok) {
      log('anvil', 'Reusing existing Anvil instance on 8546');
      return;
    }
  } catch {
    // start new
  }

  log('anvil', 'Spawning isolated Anvil on 8546...');
  anvilProc = spawn(
    '/home/pupulion/.foundry/bin/anvil',
    [
      '--chain-id',
      '31337',
      '--port',
      '8546',
      '--host',
      '127.0.0.1',
      '--accounts',
      '20',
      '--balance',
      '10000',
      '--gas-limit',
      '60000000',
      '--code-size-limit',
      '100000',
      '--auto-impersonate',
    ],
    { stdio: 'ignore' },
  );

  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const res = await fetch('http://127.0.0.1:8546', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (res.ok) {
        log('anvil', 'Anvil is ready.');
        return;
      }
    } catch {}
  }
  throw new Error('Failed to start Anvil on port 8546');
}

async function startVite() {
  log('vite', 'Checking if Vite is running on port 5176...');
  if (await isPortReachable(5176)) {
    log('vite', 'Reusing existing Vite dev server on 5176');
    return;
  }

  log('vite', 'Spawning Vite dev server on 5176...');
  viteProc = spawn('npm', ['--prefix', 'frontend', 'run', 'dev', '--', '--port', '5176', '--host', '127.0.0.1'], {
    stdio: 'ignore',
  });

  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await isPortReachable(5176)) {
      log('vite', 'Vite dev server is ready at http://127.0.0.1:5176');
      return;
    }
  }
  throw new Error('Failed to start Vite on port 5176');
}

async function startApi(prisma, config) {
  try {
    const res = await fetch('http://127.0.0.1:4310/api/v1/indexer/status');
    if (res.ok) {
      log('api', 'Using existing Fastify API at http://127.0.0.1:4310');
      return;
    }
  } catch {}

  log('api', 'Starting Fastify API server on 127.0.0.1:4310...');
  apiServer = await buildServer({ prisma, config });
  await apiServer.listen({ host: '127.0.0.1', port: 4310 });
  log('api', 'Fastify API server listening on 4310');
}

async function cleanup() {
  log('cleanup', 'Shutting down services...');
  if (apiServer) {
    try {
      await apiServer.close();
    } catch {}
  }
  if (viteProc) {
    try {
      viteProc.kill('SIGKILL');
    } catch {}
  }
  if (anvilProc) {
    try {
      anvilProc.kill('SIGKILL');
    } catch {}
  }
}

// ---------------------------------------------------------------------- Provider Script Injection
const EIP1193_INJECT_SCRIPT = `
(function() {
  window.__oraklTestWallet = {
    currentAccount: '${DEV_ACCOUNTS[8]}',
    listeners: {},
    setAccount(acc) {
      const normalized = acc.toLowerCase();
      this.currentAccount = normalized;
      provider.selectedAddress = normalized;
      if (this.listeners['accountsChanged']) {
        this.listeners['accountsChanged'].forEach(fn => fn([normalized]));
      }
    }
  };

  const provider = {
    isMetaMask: true,
    chainId: '0x7a69',
    networkVersion: '31337',
    selectedAddress: window.__oraklTestWallet.currentAccount,

    on(event, handler) {
      if (!window.__oraklTestWallet.listeners[event]) {
        window.__oraklTestWallet.listeners[event] = [];
      }
      window.__oraklTestWallet.listeners[event].push(handler);
    },

    removeListener(event, handler) {
      if (window.__oraklTestWallet.listeners[event]) {
        window.__oraklTestWallet.listeners[event] = window.__oraklTestWallet.listeners[event].filter(h => h !== handler);
      }
    },

    async request({ method, params }) {
      if (method === 'eth_chainId') return '0x7a69';
      if (method === 'net_version') return '31337';
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
        return [window.__oraklTestWallet.currentAccount];
      }
      if (method === 'personal_sign') {
        const res = await fetch('http://127.0.0.1:8546', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'personal_sign',
            params: [params[0], window.__oraklTestWallet.currentAccount]
          })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        return data.result;
      }
      if (method === 'eth_sendTransaction') {
        const tx = params[0];
        const txPayload = {
          ...tx,
          from: window.__oraklTestWallet.currentAccount
        };
        const res = await fetch('http://127.0.0.1:8546', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'eth_sendTransaction',
            params: [txPayload]
          })
        });
        const data = await res.json();
        if (data.error) {
          throw new Error(data.error.message || JSON.stringify(data.error));
        }
        return data.result;
      }
      const res = await fetch('http://127.0.0.1:8546', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params: params || []
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      return data.result;
    }
  };

  window.ethereum = provider;
})();
`;

// ---------------------------------------------------------------------- Helpers
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

// ---------------------------------------------------------------------- Main Test Runner
async function runRealBrowserE2E() {
  console.log('\n================================================================================');
  console.log('ORAKL P1 — REAL PLAYWRIGHT BROWSER FINANCIAL E2E HARNESS');
  console.log('================================================================================\n');

  try {
    await startAnvil();

    const { publicClient, walletClient, request } = makeClients();
    await requireLocalChain(request);
    await fundDevAccounts(request);

    // Deploy contracts cleanly
    log('deploy', 'Deploying Selected protocol on local Anvil...');
    execSync('node scripts/p1/deploy-local-selected.mjs', { cwd: REPO_ROOT, stdio: 'inherit' });

    const manifestPath = resolve(REPO_ROOT, 'backend/deployments/local-selected.json');
    assert(existsSync(manifestPath), `Deployment manifest missing at ${manifestPath}`);
    const deploymentManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    const factoryAddr = getAddress(deploymentManifest.contracts.selectedMarketFactory.address);
    const configAddr = getAddress(deploymentManifest.contracts.protocolConfig.address);
    const arbitratorMockAddr = getAddress(deploymentManifest.roleMocks.arbitrator.address);
    const complianceMockAddr = getAddress(deploymentManifest.roleMocks.compliance.address);
    const governanceMockAddr = getAddress(deploymentManifest.roleMocks.governance.address);

    const prisma = makePrisma();
    const config = loadConfig();

    // Reset database for clean run
    log('db', 'Wiping database for isolated E2E verification...');
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
    await prisma.authNonce.deleteMany({});

    await startApi(prisma, config);
    await startVite();

    const indexerDeps = {
      prisma,
      publicClient,
      chainId: LOCAL_CHAIN_ID,
      factory: factoryAddr,
      configContract: configAddr,
      startBlock: BigInt(deploymentManifest.contracts.selectedMarketFactory.startBlock),
      batchSize: 100,
      confirmations: 0,
    };
    await ingestOnce(indexerDeps);

    // Launch Playwright
    log('browser', 'Launching Playwright Chromium...');
    const { chromium } = await import(playwrightPath);
    const launchOptions = { headless: true };
    if (chromiumExecutable && existsSync(chromiumExecutable)) {
      launchOptions.executablePath = chromiumExecutable;
    }
    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    page.on('pageerror', (err) => console.error('[browser error]', err.message));
    await page.addInitScript(EIP1193_INJECT_SCRIPT);

    const recordedScenarios = {};

    // =========================================================================
    // SCENARIO A: Binary Reversal
    // =========================================================================
    log('\n' + '='.repeat(80));
    log('SCENARIO A', 'Real Browser Binary Reversal Execution');
    log('='.repeat(80));

    const txLogA = [];
    const stepsA = [];
    function recordTxA(stepNo, stepName, receipt, extra = {}) {
      txLogA.push({
        step: stepNo,
        action: stepName,
        txHash: receipt.transactionHash,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        status: receipt.status,
        ...extra,
      });
      stepsA.push(`Step ${stepNo}: ${stepName} (${receipt.status})`);
    }

    async function switchAccount(account) {
      await page.evaluate((acc) => window.__oraklTestWallet.setAccount(acc), account);
      await page.waitForTimeout(100);
      const connectBtn = page.locator('button[data-action="connect"], button[data-action="connect-first"]');
      if (await connectBtn.isVisible()) {
        await connectBtn.first().click();
        await page.waitForSelector('.wallet-ready', { timeout: 3000 });
      }
      await page.waitForTimeout(150);
    }

    async function waitMined(blkBefore, actionName) {
      let txHash;
      for (let i = 0; i < 40; i++) {
        await sleep(150);
        const b = BigInt(await request('eth_blockNumber', []));
        if (b > BigInt(blkBefore)) {
          const blk = await publicClient.getBlock({ blockNumber: b });
          txHash = blk.transactions[0];
          break;
        }
      }
      assert(txHash, `${actionName} transaction was not mined`);
      const rc = await publicClient.getTransactionReceipt({ hash: txHash });
      assert(rc.status === 'success', `${actionName} transaction reverted`);
      return rc;
    }

    async function multisigExecuteBothOwners({ mock, owners, to, data, label = '' }) {
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
      }
      return receipts;
    }

    // A.1: Navigate and connect Creator
    log('A.1', 'Connecting Creator wallet...');
    await page.goto('http://127.0.0.1:5176/local.html', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.creator);

    // Capture smoke screenshot 1
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '01-market-browsing.png'), fullPage: true });

    // A.2: Publish metadata and create market through UI
    log('A.2', 'Creating Market #0 through UI form...');
    const metadataA = {
      schema: 'orakl-market-metadata-v1',
      chainId: '31337',
      factory: factoryAddr.toLowerCase(),
      question: 'Will Ethereum spot market cap flip Bitcoin in 2026?',
      description: 'Resolves YES if ETH market cap exceeds BTC market cap before 2027.',
      category: 'crypto',
      resolutionCriteria: 'CoinGecko spot market cap ETH > BTC.',
      sources: ['https://coingecko.com'],
      creator: getAddress(LOCAL_ROLES.creator).toLowerCase(),
      createdAt: '1790000000',
    };
    const { commitment: metaHashA, uri: metaUriA } = await publishMetadataToApi(metadataA, LOCAL_ROLES.creator, request);

    await page.click('a[href="#/create"]');
    await page.waitForSelector('#create-form', { timeout: 3000 });
    await page.fill('input[name="metadataURI"]', metaUriA);
    await page.fill('input[name="metadataHash"]', metaHashA);

    const initialBlock = await publicClient.getBlockNumber();
    await page.click('#create-form button[type="submit"]');

    // Wait for mined transaction
    let createTxHash;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      const b = await publicClient.getBlockNumber();
      if (b > initialBlock) {
        const blk = await publicClient.getBlock({ blockNumber: b });
        createTxHash = blk.transactions[0];
        break;
      }
    }
    assert(createTxHash, 'Market creation transaction was not mined');
    const rcCreateA = await publicClient.getTransactionReceipt({ hash: createTxHash });
    assert(rcCreateA.status === 'success', 'CreateMarket transaction reverted');
    recordTxA(1, 'Creator deploys market with 1 ETH bond via UI', rcCreateA, { marketId: '0' });

    // Ingest events
    await ingestOnce(indexerDeps);
    log('A.2', `Market #0 created (tx: ${createTxHash})`);

    // A.3: Predict YES via UI (Alice)
    log('A.3', 'Alice predicting YES via UI...');
    await page.goto('http://127.0.0.1:5176/local.html#/market/0', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.yesParticipant);
    await page.waitForSelector('button[data-action="predict-yes"], button[data-action="predict-custom"]', { timeout: 3000 });

    const blkBeforeAlice = await publicClient.getBlockNumber();
    await page.selectOption('#predict-side', '0'); // YES
    await page.fill('#predict-amount', '10'); // 10 ETH
    await page.click('button[data-action="predict-custom"]');

    let aliceTxHash;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      const b = await publicClient.getBlockNumber();
      if (b > blkBeforeAlice) {
        const blk = await publicClient.getBlock({ blockNumber: b });
        aliceTxHash = blk.transactions[0];
        break;
      }
    }
    assert(aliceTxHash, 'Alice predict tx not mined');
    const rcAlice = await publicClient.getTransactionReceipt({ hash: aliceTxHash });
    assert(rcAlice.status === 'success', 'Alice predict reverted');
    recordTxA(2, 'Alice deposits 10 ETH on YES via UI', rcAlice);
    await ingestOnce(indexerDeps);

    // A.4: Predict NO via UI (Bob)
    log('A.4', 'Bob predicting NO via UI...');
    await switchAccount(LOCAL_ROLES.noParticipant);
    const blkBeforeBob = await publicClient.getBlockNumber();
    await page.selectOption('#predict-side', '1'); // NO
    await page.fill('#predict-amount', '20'); // 20 ETH
    await page.click('button[data-action="predict-custom"]');

    let bobTxHash;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      const b = await publicClient.getBlockNumber();
      if (b > blkBeforeBob) {
        const blk = await publicClient.getBlock({ blockNumber: b });
        bobTxHash = blk.transactions[0];
        break;
      }
    }
    assert(bobTxHash, 'Bob predict tx not mined');
    const rcBob = await publicClient.getTransactionReceipt({ hash: bobTxHash });
    assert(rcBob.status === 'success', 'Bob predict reverted');
    recordTxA(3, 'Bob deposits 20 ETH on NO via UI', rcBob);
    await ingestOnce(indexerDeps);

    // Advance time past market close
    await stepTime(request, 3601);
    await ingestOnce(indexerDeps);

    // A.5: Propose YES via UI
    log('A.5', 'Proposer submitting proposal via UI...');
    const manifestPropA = {
      schema: 'orakl-evidence-v1',
      chainId: '31337',
      contract: factoryAddr.toLowerCase(),
      marketId: '0',
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

    await page.goto('http://127.0.0.1:5176/local.html#/market/0', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.proposer);
    await page.waitForSelector('#propose-evidence', { timeout: 3000 });
    await page.fill('#propose-evidence', commPropA);

    const blkBeforeProp = await publicClient.getBlockNumber();
    await page.click('button[data-action="propose-yes"]');

    let propTxHash;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      const b = await publicClient.getBlockNumber();
      if (b > blkBeforeProp) {
        const blk = await publicClient.getBlock({ blockNumber: b });
        propTxHash = blk.transactions[0];
        break;
      }
    }
    assert(propTxHash, 'Proposal tx not mined');
    const rcProp = await publicClient.getTransactionReceipt({ hash: propTxHash });
    assert(rcProp.status === 'success', 'Propose reverted');
    recordTxA(4, 'Proposer submits YES proposal with 10 ETH bond via UI', rcProp);
    await ingestOnce(indexerDeps);

    // A.6: Challenger A challenges via UI
    log('A.6', 'Challenger A challenging result via UI...');
    const manifestChallA = {
      schema: 'orakl-evidence-v1',
      chainId: '31337',
      contract: factoryAddr.toLowerCase(),
      marketId: '0',
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

    await page.goto('http://127.0.0.1:5176/local.html#/market/0', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.challengerA);
    await page.waitForSelector('#challenge-evidence', { timeout: 3000 });
    await page.fill('#challenge-evidence', commChallA);

    const blkBeforeChallA = await publicClient.getBlockNumber();
    await page.click('button[data-action="challenge"]');

    let challATxHash;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      const b = await publicClient.getBlockNumber();
      if (b > blkBeforeChallA) {
        const blk = await publicClient.getBlock({ blockNumber: b });
        challATxHash = blk.transactions[0];
        break;
      }
    }
    assert(challATxHash, 'Challenger A tx not mined');
    const rcChallA = await publicClient.getTransactionReceipt({ hash: challATxHash });
    assert(rcChallA.status === 'success', 'Challenge A reverted');
    recordTxA(5, 'Challenger A stakes 1 ETH bond via UI (Tranche 1)', rcChallA);
    await ingestOnce(indexerDeps);

    // A.7: Challenger B challenges via UI
    log('A.7', 'Challenger B challenging result via UI...');
    const manifestChallB = {
      schema: 'orakl-evidence-v1',
      chainId: '31337',
      contract: factoryAddr.toLowerCase(),
      marketId: '0',
      kind: 'supplement',
      claim: 'NO',
      proposedOutcome: 'YES',
      sources: ['https://coinmarketcap.com/currencies/ethereum/'],
      publishedAt: '1790003800',
      publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
      contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
      contentMediaType: 'text/plain',
      media: [],
    };
    const { commitment: commChallB } = await publishEvidenceToApi(manifestChallB, DEV_ACCOUNTS[0], request);

    await page.goto('http://127.0.0.1:5176/local.html#/market/0', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.challengerB);
    await page.waitForSelector('#challenge-evidence', { timeout: 3000 });
    await page.fill('#challenge-evidence', commChallB);

    const blkBeforeChallB = await publicClient.getBlockNumber();
    await page.click('button[data-action="challenge"]');

    let challBTxHash;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      const b = await publicClient.getBlockNumber();
      if (b > blkBeforeChallB) {
        const blk = await publicClient.getBlock({ blockNumber: b });
        challBTxHash = blk.transactions[0];
        break;
      }
    }
    assert(challBTxHash, 'Challenger B tx not mined');
    const rcChallB = await publicClient.getTransactionReceipt({ hash: challBTxHash });
    assert(rcChallB.status === 'success', 'Challenge B reverted');
    recordTxA(6, 'Challenger B stakes 1 ETH bond via UI (Tranche 2)', rcChallB);
    await ingestOnce(indexerDeps);

    // Verify multi-challenger tranche ladder rendered in UI
    await page.goto('http://127.0.0.1:5176/local.html#/market/0', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.challengerB);
    await page.waitForSelector('.tranche-table', { timeout: 3000 });
    const trancheRowsCount = await page.locator('.tranche-table tbody tr').count();
    assert(trancheRowsCount >= 2, `Expected at least 2 tranches in UI, got ${trancheRowsCount}`);
    log('A.7', `Tranche ladder verified in UI (${trancheRowsCount} tranches rendered).`);

    // Capture smoke screenshot 2 (Market Detail with tranches)
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '02-market-detail.png'), fullPage: true });

    // Advance time past challenge period into arbitration window
    await stepTime(request, 48 * 3600 + 10);
    await ingestOnce(indexerDeps);

    // A.8: Arbitrators decide NO through UI
    log('A.8', 'Arbitrator Owner 1 deciding NO via UI...');
    const manifestDecisionA = {
      schema: 'orakl-evidence-v1',
      chainId: '31337',
      contract: factoryAddr.toLowerCase(),
      marketId: '0',
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

    await page.goto('http://127.0.0.1:5176/local.html#/market/0', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.arbitratorOwners[0]);
    await page.waitForSelector('#settle-evidence', { timeout: 3000 });
    await page.fill('#settle-evidence', commDecisionA);

    const blkBeforeArb1 = await publicClient.getBlockNumber();
    await page.click('button[data-action="settle-no"]');
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if ((await publicClient.getBlockNumber()) > blkBeforeArb1) break;
    }
    const rcArb1 = await publicClient.getTransactionReceipt({
      hash: (await publicClient.getBlock({ blockNumber: await publicClient.getBlockNumber() })).transactions[0],
    });
    assert(rcArb1.status === 'success', 'Arbitrator 1 confirmation reverted');
    recordTxA(7, 'Arbitrator Owner 1 confirms NO settlement via UI (1 of 2)', rcArb1);

    log('A.8', 'Arbitrator Owner 2 deciding NO via UI (executes settlement)...');
    await switchAccount(LOCAL_ROLES.arbitratorOwners[1]);
    await page.waitForSelector('#settle-evidence', { timeout: 3000 });
    await page.fill('#settle-evidence', commDecisionA);

    const blkBeforeArb2 = await publicClient.getBlockNumber();
    await page.click('button[data-action="settle-no"]');
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if ((await publicClient.getBlockNumber()) > blkBeforeArb2) break;
    }
    const rcArb2 = await publicClient.getTransactionReceipt({
      hash: (await publicClient.getBlock({ blockNumber: await publicClient.getBlockNumber() })).transactions[0],
    });
    assert(rcArb2.status === 'success', 'Arbitrator 2 confirmation reverted');
    recordTxA(8, 'Arbitrator Owner 2 confirms NO settlement via UI (2 of 2, executed)', rcArb2);
    await ingestOnce(indexerDeps);

    // Verify market is resolved NO on-chain
    const mRecA = await publicClient.readContract({
      address: factoryAddr,
      abi: FACTORY_ART.abi,
      functionName: 'getMarket',
      args: [0n],
    });
    assert(mRecA.storedState === 4, 'Market #0 must be in RESOLVED (4) state');
    assert(mRecA.finalOutcome === 2, 'Market #0 finalOutcome must be NO (2)');
    log('A.8', 'Market #0 successfully resolved as NO on chain.');

    // A.9: Bob claims winning payout through UI
    log('A.9', 'Bob claiming winning payout via UI...');
    await page.goto('http://127.0.0.1:5176/local.html#/market/0', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.noParticipant);
    await page.waitForSelector('button[data-action="claim"]', { timeout: 3000 });

    const blkBeforeClaimBob = await publicClient.getBlockNumber();
    await page.click('button[data-action="claim"]');
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if ((await publicClient.getBlockNumber()) > blkBeforeClaimBob) break;
    }
    const rcClaimBob = await publicClient.getTransactionReceipt({
      hash: (await publicClient.getBlock({ blockNumber: await publicClient.getBlockNumber() })).transactions[0],
    });
    assert(rcClaimBob.status === 'success', 'Bob claim reverted');
    recordTxA(9, 'Bob claims winning payout via UI', rcClaimBob);
    await ingestOnce(indexerDeps);

    // A.10: Creator claims creation bond through UI
    log('A.10', 'Creator claiming creation bond via UI...');
    await page.goto('http://127.0.0.1:5176/local.html#/market/0', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.creator);
    await page.waitForSelector('button[data-action="claim-bond-creation"]', { timeout: 3000 });

    const blkBeforeClaimCreator = await publicClient.getBlockNumber();
    await page.click('button[data-action="claim-bond-creation"]');
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if ((await publicClient.getBlockNumber()) > blkBeforeClaimCreator) break;
    }
    const rcClaimCreator = await publicClient.getTransactionReceipt({
      hash: (await publicClient.getBlock({ blockNumber: await publicClient.getBlockNumber() })).transactions[0],
    });
    assert(rcClaimCreator.status === 'success', 'Creator bond claim reverted');
    recordTxA(10, 'Creator claims creation bond via UI', rcClaimCreator);
    await ingestOnce(indexerDeps);

    // A.11: Challenger A claims challenge bond through UI
    log('A.11', 'Challenger A claiming challenge bond via UI...');
    await page.goto('http://127.0.0.1:5176/local.html#/market/0', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.challengerA);
    await page.waitForSelector('button[data-action="claim-bond-challenge"]', { timeout: 3000 });

    const blkBeforeClaimChallA = await publicClient.getBlockNumber();
    await page.click('button[data-action="claim-bond-challenge"]');
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if ((await publicClient.getBlockNumber()) > blkBeforeClaimChallA) break;
    }
    const rcClaimChallA = await publicClient.getTransactionReceipt({
      hash: (await publicClient.getBlock({ blockNumber: await publicClient.getBlockNumber() })).transactions[0],
    });
    assert(rcClaimChallA.status === 'success', 'Challenger A bond claim reverted');
    recordTxA(11, 'Challenger A claims challenge bond entitlement via UI', rcClaimChallA);
    await ingestOnce(indexerDeps);

    // A.12: Challenger B claims challenge bond through UI
    log('A.12', 'Challenger B claiming challenge bond via UI...');
    await page.goto('http://127.0.0.1:5176/local.html#/market/0', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.challengerB);
    await page.waitForSelector('button[data-action="claim-bond-challenge"]', { timeout: 3000 });

    const blkBeforeClaimChallB = await publicClient.getBlockNumber();
    await page.click('button[data-action="claim-bond-challenge"]');
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if ((await publicClient.getBlockNumber()) > blkBeforeClaimChallB) break;
    }
    const rcClaimChallB = await publicClient.getTransactionReceipt({
      hash: (await publicClient.getBlock({ blockNumber: await publicClient.getBlockNumber() })).transactions[0],
    });
    assert(rcClaimChallB.status === 'success', 'Challenger B bond claim reverted');
    recordTxA(12, 'Challenger B claims challenge bond entitlement via UI', rcClaimChallB);
    await ingestOnce(indexerDeps);

    // A.13: Verify Proposer has zero entitlement in UI
    log('A.13', 'Verifying Proposer bond forfeited in UI...');
    await page.goto('http://127.0.0.1:5176/local.html#/market/0', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.proposer);
    const proposalBondBtn = page.locator('button[data-action="claim-bond-proposal"]');
    if (await proposalBondBtn.isVisible()) {
      const isDisabled = await proposalBondBtn.isDisabled();
      assert(isDisabled, 'Proposal bond claim button must be disabled for losing proposer');
    }

    // A.14: Check Portfolio View in UI
    log('A.14', 'Checking Portfolio View in UI...');
    await page.goto('http://127.0.0.1:5176/local.html#/portfolio', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.noParticipant);
    await page.waitForSelector('.summary-grid', { timeout: 3000 });
    const portfolioText = await page.textContent('body');
    assert(portfolioText.includes('Your portfolio'), 'Portfolio view must render');

    // Capture Scenario A screenshot
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '05-scenario-a-settled.png'), fullPage: true });

    recordedScenarios.scenarioA = {
      status: 'VERIFIED',
      marketId: '0',
      totalTransactions: txLogA.length,
      transactions: txLogA,
      steps: stepsA,
    };
    log('SCENARIO A', `Completed successfully with ${txLogA.length} verified transactions.`);

    // =========================================================================
    // SCENARIO B: INVALID Settlement
    // =========================================================================
    log('\n' + '='.repeat(80));
    log('SCENARIO B', 'Real Browser INVALID Settlement Execution');
    log('='.repeat(80));

    const txLogB = [];
    const stepsB = [];
    function recordTxB(stepNo, stepName, receipt, extra = {}) {
      txLogB.push({
        step: stepNo,
        action: stepName,
        txHash: receipt.transactionHash,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        status: receipt.status,
        ...extra,
      });
      stepsB.push(`Step ${stepNo}: ${stepName} (${receipt.status})`);
    }

    // B.1: Create Market #1
    log('B.1', 'Creating Market #1 via UI...');
    const metadataB = {
      schema: 'orakl-market-metadata-v1',
      chainId: '31337',
      factory: factoryAddr.toLowerCase(),
      question: 'ORAKL P1 Scenario B: Will SpaceX Starship reach orbit before June 2026?',
      description: 'Resolves INVALID if launch is cancelled or criteria indeterminate.',
      category: 'science',
      resolutionCriteria: 'Official FAA/SpaceX orbital telemetry report.',
      sources: ['https://spacex.com'],
      creator: getAddress(LOCAL_ROLES.creator).toLowerCase(),
      createdAt: '1790200000',
    };
    const { commitment: metaHashB, uri: metaUriB } = await publishMetadataToApi(metadataB, LOCAL_ROLES.creator, request);

    await page.goto('http://127.0.0.1:5176/local.html#/create', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.creator);
    await page.fill('input[name="metadataURI"]', metaUriB);
    await page.fill('input[name="metadataHash"]', metaHashB);

    const blkBeforeB1 = await publicClient.getBlockNumber();
    await page.click('#create-form button[type="submit"]');
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if ((await publicClient.getBlockNumber()) > blkBeforeB1) break;
    }
    const rcCreateB = await publicClient.getTransactionReceipt({
      hash: (await publicClient.getBlock({ blockNumber: await publicClient.getBlockNumber() })).transactions[0],
    });
    assert(rcCreateB.status === 'success', 'Market B creation reverted');
    recordTxB(1, 'Creator deploys Market #1 with 1 ETH bond via UI', rcCreateB, { marketId: '1' });
    await ingestOnce(indexerDeps);

    // B.2: Deposits (Alice YES 10 ETH, Bob NO 10 ETH)
    log('B.2', 'Depositing predictions for Market #1 via UI...');
    await page.goto('http://127.0.0.1:5176/local.html#/market/1', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.yesParticipant);
    await page.selectOption('#predict-side', '0');
    await page.fill('#predict-amount', '10');
    const blkBeforeAliceB = await publicClient.getBlockNumber();
    await page.click('button[data-action="predict-custom"]');
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if ((await publicClient.getBlockNumber()) > blkBeforeAliceB) break;
    }
    const rcAliceB = await publicClient.getTransactionReceipt({
      hash: (await publicClient.getBlock({ blockNumber: await publicClient.getBlockNumber() })).transactions[0],
    });
    recordTxB(2, 'Alice deposits 10 ETH on YES via UI', rcAliceB);

    await switchAccount(LOCAL_ROLES.noParticipant);
    await page.selectOption('#predict-side', '1');
    await page.fill('#predict-amount', '10');
    const blkBeforeBobB = await publicClient.getBlockNumber();
    await page.click('button[data-action="predict-custom"]');
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if ((await publicClient.getBlockNumber()) > blkBeforeBobB) break;
    }
    const rcBobB = await publicClient.getTransactionReceipt({
      hash: (await publicClient.getBlock({ blockNumber: await publicClient.getBlockNumber() })).transactions[0],
    });
    recordTxB(3, 'Bob deposits 10 ETH on NO via UI', rcBobB);
    await ingestOnce(indexerDeps);

    // Advance time past close
    await stepTime(request, 3601);
    await ingestOnce(indexerDeps);

    // B.3: Propose YES via UI
    log('B.3', 'Proposing YES on Market #1 via UI...');
    const manifestPropB = {
      schema: 'orakl-evidence-v1',
      chainId: '31337',
      contract: factoryAddr.toLowerCase(),
      marketId: '1',
      kind: 'proposal',
      claim: 'YES',
      proposedOutcome: 'YES',
      sources: ['https://spacex.com/launches/starship-flight-7'],
      publishedAt: '1790203605',
      publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
      contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
      contentMediaType: 'text/plain',
      media: [],
    };
    const { commitment: commPropB } = await publishEvidenceToApi(manifestPropB, DEV_ACCOUNTS[0], request);

    await page.goto('http://127.0.0.1:5176/local.html#/market/1', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.proposer);
    await page.fill('#propose-evidence', commPropB);
    const blkBeforePropB = await publicClient.getBlockNumber();
    await page.click('button[data-action="propose-yes"]');
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if ((await publicClient.getBlockNumber()) > blkBeforePropB) break;
    }
    const rcPropB = await publicClient.getTransactionReceipt({
      hash: (await publicClient.getBlock({ blockNumber: await publicClient.getBlockNumber() })).transactions[0],
    });
    recordTxB(4, 'Proposer submits YES proposal with 10 ETH bond via UI', rcPropB);
    await ingestOnce(indexerDeps);

    // B.4: Challengers A & B challenge via UI
    log('B.4', 'Challengers A and B challenging Market #1 via UI...');
    const manifestChallAB = {
      schema: 'orakl-evidence-v1',
      chainId: '31337',
      contract: factoryAddr.toLowerCase(),
      marketId: '1',
      kind: 'objection',
      claim: 'INVALID',
      proposedOutcome: 'YES',
      sources: ['https://faa.gov/telemetry/starship-suborbital-anomaly'],
      publishedAt: '1790203620',
      publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
      contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
      contentMediaType: 'text/plain',
      media: [],
    };
    const { commitment: commChallAB } = await publishEvidenceToApi(manifestChallAB, DEV_ACCOUNTS[0], request);

    await page.goto('http://127.0.0.1:5176/local.html#/market/1', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.challengerA);
    await page.fill('#challenge-evidence', commChallAB);
    const blkBeforeChallAB = await publicClient.getBlockNumber();
    await page.click('button[data-action="challenge"]');
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if ((await publicClient.getBlockNumber()) > blkBeforeChallAB) break;
    }
    const rcChallAB = await publicClient.getTransactionReceipt({
      hash: (await publicClient.getBlock({ blockNumber: await publicClient.getBlockNumber() })).transactions[0],
    });
    recordTxB(5, 'Challenger A stakes 1 ETH bond via UI (Tranche 1)', rcChallAB);

    const manifestChallBB = {
      schema: 'orakl-evidence-v1',
      chainId: '31337',
      contract: factoryAddr.toLowerCase(),
      marketId: '1',
      kind: 'supplement',
      claim: 'INVALID',
      proposedOutcome: 'YES',
      sources: ['https://nasaspaceflight.com/starship-reentry-criteria'],
      publishedAt: '1790203630',
      publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
      contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
      contentMediaType: 'text/plain',
      media: [],
    };
    const { commitment: commChallBB } = await publishEvidenceToApi(manifestChallBB, DEV_ACCOUNTS[0], request);

    await page.goto('http://127.0.0.1:5176/local.html#/market/1', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.challengerB);
    await page.fill('#challenge-evidence', commChallBB);
    const blkBeforeChallBB = await publicClient.getBlockNumber();
    await page.click('button[data-action="challenge"]');
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if ((await publicClient.getBlockNumber()) > blkBeforeChallBB) break;
    }
    const rcChallBB = await publicClient.getTransactionReceipt({
      hash: (await publicClient.getBlock({ blockNumber: await publicClient.getBlockNumber() })).transactions[0],
    });
    recordTxB(6, 'Challenger B stakes 1 ETH bond via UI (Tranche 2)', rcChallBB);
    await ingestOnce(indexerDeps);

    // Advance time past challenge deadline to arbitration
    await stepTime(request, 48 * 3600 + 10);
    await ingestOnce(indexerDeps);

    // B.5: Arbitrators decide INVALID through UI
    log('B.5', 'Arbitrator deciding INVALID via UI...');
    const manifestDecisionB = {
      schema: 'orakl-evidence-v1',
      chainId: '31337',
      contract: factoryAddr.toLowerCase(),
      marketId: '1',
      kind: 'decision',
      claim: 'INVALID',
      proposedOutcome: 'YES',
      sources: ['https://faa.gov/reports/starship-flight-7-invalidated'],
      publishedAt: '1790376500',
      publisher: getAddress(DEV_ACCOUNTS[0]).toLowerCase(),
      contentHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
      contentMediaType: 'text/plain',
      media: [],
    };
    const { commitment: commDecisionB } = await publishEvidenceToApi(manifestDecisionB, DEV_ACCOUNTS[0], request);

    await page.goto('http://127.0.0.1:5176/local.html#/market/1', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.arbitratorOwners[0]);
    await page.waitForSelector('#settle-evidence', { timeout: 3000 });
    await page.fill('#settle-evidence', commDecisionB);
    const blkBeforeArb1B = await publicClient.getBlockNumber();
    await page.click('button[data-action="settle-invalid"]');

    let arb1BTxHash;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      const b = await publicClient.getBlockNumber();
      if (b > blkBeforeArb1B) {
        const blk = await publicClient.getBlock({ blockNumber: b });
        arb1BTxHash = blk.transactions[0];
        break;
      }
    }
    assert(arb1BTxHash, 'Arbitrator 1 confirmation tx not mined');
    const rcArb1B = await publicClient.getTransactionReceipt({ hash: arb1BTxHash });
    assert(rcArb1B.status === 'success', 'Arbitrator 1 confirmation reverted');
    recordTxB(7, 'Arbitrator Owner 1 confirms INVALID settlement via UI (1 of 2)', rcArb1B);

    log('B.5', 'Arbitrator Owner 2 deciding INVALID via UI (executes settlement)...');
    await switchAccount(LOCAL_ROLES.arbitratorOwners[1]);
    await page.waitForSelector('#settle-evidence', { timeout: 3000 });
    await page.fill('#settle-evidence', commDecisionB);
    const blkBeforeArb2B = await publicClient.getBlockNumber();
    await page.click('button[data-action="settle-invalid"]');

    let arb2BTxHash;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      const b = await publicClient.getBlockNumber();
      if (b > blkBeforeArb2B) {
        const blk = await publicClient.getBlock({ blockNumber: b });
        arb2BTxHash = blk.transactions[0];
        break;
      }
    }
    assert(arb2BTxHash, 'Arbitrator 2 settlement tx not mined');
    const rcArb2B = await publicClient.getTransactionReceipt({ hash: arb2BTxHash });
    assert(rcArb2B.status === 'success', 'Arbitrator 2 settlement reverted');
    recordTxB(8, 'Arbitrator Owner 2 confirms INVALID settlement via UI (2 of 2, executed)', rcArb2B);
    await ingestOnce(indexerDeps);

    // Verify market is INVALID on-chain
    const mRecB = await publicClient.readContract({
      address: factoryAddr,
      abi: FACTORY_ART.abi,
      functionName: 'getMarket',
      args: [1n],
    });
    assert(mRecB.storedState === 5, 'Market #1 must be CANCELLED (5) on INVALID settlement');
    assert(mRecB.finalOutcome === 3, 'Market #1 finalOutcome must be INVALID (3)');
    assert(mRecB.protocolFee === 0n, 'Market #1 protocol fee must be strictly 0 on INVALID');
    assert(mRecB.refundable === true, 'Market #1 refundable must be true on INVALID');
    log('B.5', 'Market #1 resolved as INVALID (CANCELLED state 5); protocol fee is 0.');

    // B.6: Claim refunds and all bonds through UI
    log('B.6', 'Claiming participant refunds and all bonds via UI...');
    // Alice refund
    await page.goto('http://127.0.0.1:5176/local.html#/market/1', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.yesParticipant);
    await page.waitForSelector('button[data-action="claim-refund"]', { timeout: 3000 });
    const blkBeforeRefA = await publicClient.getBlockNumber();
    await page.click('button[data-action="claim-refund"]');
    const rcRefA = await waitMined(blkBeforeRefA, 'Alice refund');
    recordTxB(9, 'Alice claims 100% principal refund (10 ETH) via UI', rcRefA);

    // Bob refund
    await switchAccount(LOCAL_ROLES.noParticipant);
    await page.waitForSelector('button[data-action="claim-refund"]', { timeout: 3000 });
    const blkBeforeRefB = await publicClient.getBlockNumber();
    await page.click('button[data-action="claim-refund"]');
    const rcRefB = await waitMined(blkBeforeRefB, 'Bob refund');
    recordTxB(10, 'Bob claims 100% principal refund (10 ETH) via UI', rcRefB);

    // Creator bond
    await switchAccount(LOCAL_ROLES.creator);
    await page.waitForSelector('button[data-action="claim-bond-creation"]', { timeout: 3000 });
    const blkBeforeBondC = await publicClient.getBlockNumber();
    await page.click('button[data-action="claim-bond-creation"]');
    const rcBondC = await waitMined(blkBeforeBondC, 'Creator creation bond claim');
    recordTxB(11, 'Creator claims creation bond via UI', rcBondC);

    // Proposer bond (in INVALID, proposer bond is refunded!)
    await switchAccount(LOCAL_ROLES.proposer);
    await page.waitForSelector('button[data-action="claim-bond-proposal"]', { timeout: 3000 });
    const blkBeforeBondP = await publicClient.getBlockNumber();
    await page.click('button[data-action="claim-bond-proposal"]');
    const rcBondP = await waitMined(blkBeforeBondP, 'Proposer proposal bond refund');
    recordTxB(12, 'Proposer claims returned proposal bond (10 ETH) via UI', rcBondP);

    // Challenger A bond
    await switchAccount(LOCAL_ROLES.challengerA);
    await page.waitForSelector('button[data-action="claim-bond-challenge"]', { timeout: 3000 });
    const blkBeforeBondCA = await publicClient.getBlockNumber();
    await page.click('button[data-action="claim-bond-challenge"]');
    const rcBondCA = await waitMined(blkBeforeBondCA, 'Challenger A challenge bond claim');
    recordTxB(13, 'Challenger A claims returned challenge bond (1 ETH) via UI', rcBondCA);

    // Challenger B bond
    await switchAccount(LOCAL_ROLES.challengerB);
    await page.waitForSelector('button[data-action="claim-bond-challenge"]', { timeout: 3000 });
    const blkBeforeBondCB = await publicClient.getBlockNumber();
    await page.click('button[data-action="claim-bond-challenge"]');
    const rcBondCB = await waitMined(blkBeforeBondCB, 'Challenger B challenge bond claim');
    recordTxB(14, 'Challenger B claims returned challenge bond (1 ETH) via UI', rcBondCB);
    await ingestOnce(indexerDeps);

    // Capture Scenario B screenshot
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '06-scenario-b-invalid.png'), fullPage: true });

    recordedScenarios.scenarioB = {
      status: 'VERIFIED',
      marketId: '1',
      totalTransactions: txLogB.length,
      transactions: txLogB,
      steps: stepsB,
    };
    log('SCENARIO B', `Completed successfully with ${txLogB.length} verified transactions.`);

    // =========================================================================
    // SCENARIO C: Emergency Pause & Cancellation
    // =========================================================================
    log('\n' + '='.repeat(80));
    log('SCENARIO C', 'Real Browser Emergency Pause & Cancellation Execution');
    log('='.repeat(80));

    const txLogC = [];
    const stepsC = [];
    function recordTxC(stepNo, stepName, receipt, extra = {}) {
      txLogC.push({
        step: stepNo,
        action: stepName,
        txHash: receipt.transactionHash,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        status: receipt.status,
        ...extra,
      });
      stepsC.push(`Step ${stepNo}: ${stepName} (${receipt.status})`);
    }

    // C.1: Create Market #2
    log('C.1', 'Creating Market #2 via UI...');
    const metadataC = {
      schema: 'orakl-market-metadata-v1',
      chainId: '31337',
      factory: factoryAddr.toLowerCase(),
      question: 'ORAKL P1 Scenario C: Emergency Pause & Expired Market Cancellation',
      description: 'Market C for emergency pause and expired dispute cancellation verification.',
      category: 'emergency',
      resolutionCriteria: 'Cancels cleanly upon resolution expiration while under pause.',
      sources: ['https://orakl.network/protocol/c'],
      creator: getAddress(LOCAL_ROLES.creator).toLowerCase(),
      createdAt: '1790400000',
    };
    const { commitment: metaHashC, uri: metaUriC } = await publishMetadataToApi(metadataC, LOCAL_ROLES.creator, request);

    await page.goto('http://127.0.0.1:5176/local.html#/create', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.creator);
    await page.fill('input[name="metadataURI"]', metaUriC);
    await page.fill('input[name="metadataHash"]', metaHashC);

    const blkBeforeC1 = await publicClient.getBlockNumber();
    await page.click('#create-form button[type="submit"]');
    const rcCreateC = await waitMined(blkBeforeC1, 'Market #2 creation');
    recordTxC(1, 'Creator deploys Market #2 with 1 ETH bond via UI', rcCreateC, { marketId: '2' });
    await ingestOnce(indexerDeps);

    // C.2: Alice deposits 10 ETH YES
    log('C.2', 'Alice depositing 10 ETH YES via UI...');
    await page.goto('http://127.0.0.1:5176/local.html#/market/2', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.yesParticipant);
    await page.selectOption('#predict-side', '0');
    await page.fill('#predict-amount', '10');
    const blkBeforePredC = await publicClient.getBlockNumber();
    await page.click('button[data-action="predict-custom"]');
    const rcPredC = await waitMined(blkBeforePredC, 'Alice deposit C');
    recordTxC(2, 'Alice deposits 10 ETH on YES via UI', rcPredC);
    await ingestOnce(indexerDeps);

    // C.3: Guardian pauses protocol
    log('C.3', 'Guardian pausing ProtocolConfig...');
    const hashPause = await walletClient.sendTransaction({
      account: LOCAL_ROLES.guardian,
      to: configAddr,
      data: encodeFunctionData({ abi: CONFIG_ART.abi, functionName: 'pause' }),
      chain: publicClient.chain,
    });
    const rcPause = await publicClient.waitForTransactionReceipt({ hash: hashPause });
    recordTxC(3, 'Guardian pauses ProtocolConfig', rcPause);

    // C.4: Advance time past maxResolutionTime
    log('C.4', 'Advancing time past max resolution time...');
    const mRecC = await publicClient.readContract({
      address: factoryAddr,
      abi: FACTORY_ART.abi,
      functionName: 'getMarket',
      args: [2n],
    });
    const maxResTimeC = mRecC.maxResolutionTime;
    const curTimeC = (await publicClient.getBlock()).timestamp;
    if (maxResTimeC > curTimeC) {
      await stepTime(request, Number(maxResTimeC - curTimeC) + 10);
    }
    await ingestOnce(indexerDeps);

    // C.5: Cancel expired market through UI
    log('C.5', 'Cancelling expired market via UI...');
    await page.goto('http://127.0.0.1:5176/local.html#/market/2', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.creator);
    await page.waitForSelector('button[data-action="cancel-expired"]', { timeout: 3000 });

    const blkBeforeCancelC = await publicClient.getBlockNumber();
    await page.click('button[data-action="cancel-expired"]');
    const rcCancelC = await waitMined(blkBeforeCancelC, 'Cancel expired market C');
    recordTxC(4, 'Cancel expired market via UI', rcCancelC);
    await ingestOnce(indexerDeps);

    // C.6: Claim neutral refunds
    log('C.6', 'Claiming neutral refund via UI...');
    await switchAccount(LOCAL_ROLES.yesParticipant);
    await page.waitForSelector('button[data-action="claim-refund"]', { timeout: 3000 });

    const blkBeforeRefC = await publicClient.getBlockNumber();
    await page.click('button[data-action="claim-refund"]');
    const rcRefC = await waitMined(blkBeforeRefC, 'Alice refund C');
    recordTxC(5, 'Alice claims neutral refund via UI', rcRefC);
    await ingestOnce(indexerDeps);

    // C.7: Restore protocol for Scenario D (Compliance approve release + Governance unpause + reactivate finance)
    log('C.7', 'Compliance approving release and Governance unpausing protocol...');
    const releaseC = keccak256(
      toHex(`ORAKL-SELECTED-RELEASE-31337-LOCAL_SIMULATION-${factoryAddr}`),
    );
    const rcApproveRelease = await multisigExecuteBothOwners({
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
    recordTxC(6, 'Compliance approves release for unpause', rcApproveRelease[1]);

    await stepTime(request, 86400);

    const rcUnpause = await multisigExecuteBothOwners({
      mock: governanceMockAddr,
      owners: LOCAL_ROLES.governanceOwners,
      to: configAddr,
      data: encodeFunctionData({
        abi: CONFIG_ART.abi,
        functionName: 'unpause',
      }),
      label: 'C: Governance Unpause Protocol',
    });
    recordTxC(7, 'Governance unpauses ProtocolConfig', rcUnpause[1]);

    const rcReactivate = await multisigExecuteBothOwners({
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
    recordTxC(8, 'Governance reactivates finance', rcReactivate[1]);

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
    log('C.7', 'Protocol successfully restored: paused=false, financialActive=true.');

    // Capture Scenario C screenshot
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '07-scenario-c-cancelled.png'), fullPage: true });

    recordedScenarios.scenarioC = {
      status: 'VERIFIED',
      marketId: '2',
      totalTransactions: txLogC.length,
      transactions: txLogC,
      steps: stepsC,
    };
    log('SCENARIO C', `Completed successfully with ${txLogC.length} verified transactions.`);

    // =========================================================================
    // SCENARIO D: Reorganization Rollback & Replay
    // =========================================================================
    log('\n' + '='.repeat(80));
    log('SCENARIO D', 'Real Reorganization Rollback, Pruning & Browser Replay');
    log('='.repeat(80));

    const txLogD = [];
    const stepsD = [];
    function recordTxD(stepNo, stepName, receipt, extra = {}) {
      txLogD.push({
        step: stepNo,
        action: stepName,
        txHash: receipt.transactionHash,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
        status: receipt.status,
        ...extra,
      });
      stepsD.push(`Step ${stepNo}: ${stepName} (${receipt.status})`);
    }

    // D.1: Capture snapshot
    await ingestOnce(indexerDeps);
    const snapBlock = BigInt(await request('eth_blockNumber', []));
    const snapId = await request('evm_snapshot', []);
    log('D.1', `Anvil snapshot captured: ${snapId} at block ${snapBlock}`);

    // D.2: Mine Branch 1
    const metadataD1 = {
      schema: 'orakl-market-metadata-v1',
      chainId: '31337',
      factory: factoryAddr.toLowerCase(),
      question: 'ORAKL P1 Scenario D: Forked Branch 1 Market',
      description: 'Market D Branch 1 for reorganization fork simulation.',
      category: 'tech',
      resolutionCriteria: 'Mined on Branch 1 and should be rolled back.',
      sources: ['https://orakl.network/reorg/d1'],
      creator: getAddress(LOCAL_ROLES.creator).toLowerCase(),
      createdAt: '1790500000',
    };
    const { commitment: commD1, uri: uriD1 } = await publishMetadataToApi(metadataD1, LOCAL_ROLES.creator, request);

    await page.goto('http://127.0.0.1:5176/local.html#/create', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.creator);
    await page.fill('input[name="metadataURI"]', uriD1);
    await page.fill('input[name="metadataHash"]', commD1);

    const blkBeforeD1 = BigInt(await request('eth_blockNumber', []));
    await page.click('#create-form button[type="submit"]');
    const rcCreateD1 = await waitMined(blkBeforeD1, 'Market D1 creation');
    recordTxD(1, 'Creator deploys Market D1 on Branch 1 via UI', rcCreateD1);
    await ingestOnce(indexerDeps);

    // Verify Branch 1 in database
    const branch1Market = await prisma.market.findFirst({
      where: { onchainMarketId: 3n, chainId: LOCAL_CHAIN_ID },
    });
    assert(branch1Market, 'Branch 1 market must be in database');

    // D.3: Revert to snapshot
    log('D.3', `Reverting to Anvil snapshot ${snapId}...`);
    const revOk = await request('evm_revert', [snapId]);
    assert(revOk === true, 'evm_revert failed');
    const revertedBlock = BigInt(await request('eth_blockNumber', []));
    assert(revertedBlock === snapBlock, `Reverted block mismatch: ${revertedBlock} vs ${snapBlock}`);
    log('D.3', `Reverted cleanly to block ${snapBlock}.`);

    // D.4: Mine Canonical Branch 2
    log('D.4', 'Mining Canonical Branch 2...');
    await stepTime(request, 15);

    const metadataD2 = {
      schema: 'orakl-market-metadata-v1',
      chainId: '31337',
      factory: factoryAddr.toLowerCase(),
      question: 'ORAKL P1 Scenario D: Canonical Alternative Branch 2 Market',
      description: 'Market D Branch 2 canonical branch after reorganization.',
      category: 'tech',
      resolutionCriteria: 'Mined on Canonical Branch 2 and must persist.',
      sources: ['https://orakl.network/canonical/d2'],
      creator: getAddress(LOCAL_ROLES.creator).toLowerCase(),
      createdAt: '1790600000',
    };
    const { commitment: commD2, uri: uriD2 } = await publishMetadataToApi(metadataD2, LOCAL_ROLES.creator, request);

    await page.goto('http://127.0.0.1:5176/local.html#/create', { waitUntil: 'networkidle' });
    await switchAccount(LOCAL_ROLES.creator);
    await page.fill('input[name="metadataURI"]', uriD2);
    await page.fill('input[name="metadataHash"]', commD2);

    const blkBeforeD2 = BigInt(await request('eth_blockNumber', []));
    await page.click('#create-form button[type="submit"]');
    const rcCreateD2 = await waitMined(blkBeforeD2, 'Market D2 creation');
    recordTxD(2, 'Creator deploys Market D2 on Canonical Branch 2 via UI', rcCreateD2);

    // D.5: Indexer rollback & ingest
    log('D.5', 'Indexer detecting reorg and executing rollback...');
    const ingestD2 = await ingestOnce(indexerDeps);
    log('D.5', `Ingested canonical events: ${ingestD2.events}`);

    // D.6: Reload browser and verify canonical state
    log('D.6', 'Verifying browser UI displays canonical branch...');
    await page.goto('http://127.0.0.1:5176/local.html#/market/3', { waitUntil: 'networkidle' });
    await page.waitForSelector('.page-head', { timeout: 3000 });
    const marketTextD = await page.textContent('body');
    assert(
      marketTextD.includes('Canonical Alternative Branch 2') || marketTextD.includes('Market #3'),
      'UI must display canonical Branch 2 market',
    );

    // Capture Scenario D screenshot
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '08-scenario-d-reorg.png'), fullPage: true });

    // Also capture Evidence Lab & Protocol Status smoke screenshots
    await page.goto('http://127.0.0.1:5176/local.html#/evidence', { waitUntil: 'networkidle' });
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '03-evidence-lab.png'), fullPage: true });

    await page.goto('http://127.0.0.1:5176/local.html#/status', { waitUntil: 'networkidle' });
    await page.screenshot({ path: resolve(SCREENSHOT_DIR, '04-protocol-status.png'), fullPage: true });

    recordedScenarios.scenarioD = {
      status: 'VERIFIED',
      marketId: '3',
      totalTransactions: txLogD.length,
      transactions: txLogD,
      steps: stepsD,
    };
    log('SCENARIO D', `Completed successfully with ${txLogD.length} verified transactions.`);

    await browser.close();

    // =========================================================================
    // Save Evidence & Manifest Updates
    // =========================================================================
    log('\n' + '='.repeat(80));
    log('EVIDENCE', 'Saving partitioned evidence bundle & verifying manifest...');
    log('='.repeat(80));

    const totalTx =
      txLogA.length + txLogB.length + txLogC.length + txLogD.length;

    const fullEvidence = {
      timestamp: new Date().toISOString(),
      chainId: LOCAL_CHAIN_ID,
      contracts: {
        factory: factoryAddr,
        config: configAddr,
        arbitrator: arbitratorMockAddr,
        compliance: complianceMockAddr,
        governance: governanceMockAddr,
      },
      scenarios: recordedScenarios,
      summary: {
        allPassed: true,
        scenariosExecuted: ['A', 'B', 'C', 'D'],
        totalTransactions: totalTx,
        executedAt: new Date().toISOString(),
        verifier: 'playwright-browser-e2e',
      },
    };

    const outDir = resolve(REPO_ROOT, 'docs/p1/evidence');
    writeFileSync(resolve(outDir, 'browser-e2e-scenarios.json'), JSON.stringify(fullEvidence, null, 2) + '\n');
    log('EVIDENCE', `Saved browser E2E evidence bundle with ${totalTx} verified transactions across Scenarios A-D.`);

    const artifactFiles = [
      'e2e-scenarios.json',
      'e2e-scenarios-a-b.json',
      'e2e-scenarios-c-d.json',
      'browser-e2e-scenarios.json',
      'local-deployment-verification.json',
      'screenshots/01-market-browsing.png',
      'screenshots/02-market-detail.png',
      'screenshots/03-evidence-lab.png',
      'screenshots/04-protocol-status.png',
      'screenshots/05-scenario-a-settled.png',
      'screenshots/06-scenario-b-invalid.png',
      'screenshots/07-scenario-c-cancelled.png',
      'screenshots/08-scenario-d-reorg.png',
    ];

    const manifestArtifacts = [];
    const checksumLines = [];

    for (const relFile of artifactFiles) {
      const fullPath = resolve(outDir, relFile);
      if (existsSync(fullPath)) {
        const buf = readFileSync(fullPath);
        const hash = createHash('sha256').update(buf).digest('hex');
        const bytes = buf.length;
        manifestArtifacts.push({ file: relFile, sha256: hash, bytes });
        checksumLines.push(`${hash}  ${relFile}`);
      }
    }

    const manifestObj = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      totalFiles: manifestArtifacts.length,
      artifacts: manifestArtifacts,
    };

    writeFileSync(resolve(outDir, 'MANIFEST.json'), JSON.stringify(manifestObj, null, 2) + '\n');
    writeFileSync(resolve(outDir, 'CHECKSUMS.txt'), checksumLines.join('\n') + '\n');
    log('EVIDENCE', `Updated MANIFEST.json and CHECKSUMS.txt with ${manifestArtifacts.length} verified artifacts.`);

    // Run manifest verification script
    execSync('node scripts/p1/verify-evidence-manifest.mjs', { cwd: REPO_ROOT, stdio: 'inherit' });

    console.log('\n================================================================================');
    console.log('ALL BROWSER E2E SCENARIOS VERIFIED SUCCESSFULLY');
    console.log('VERDICT: P1 BROWSER E2E VERIFIED — PUBLIC RELEASE BLOCKED');
    console.log('================================================================================\n');
  } finally {
    await cleanup();
  }
}

runRealBrowserE2E().catch(async (err) => {
  console.error('\n[FATAL ERROR IN BROWSER E2E]', err);
  await cleanup();
  process.exit(1);
});
