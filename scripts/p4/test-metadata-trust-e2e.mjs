#!/usr/bin/env node
/**
 * ORAKL Metadata Trust & Create Market Integrity E2E Test Suite (Blockers 1 & 2)
 *
 * Verifies all 6 critical gates required for Demo Freeze:
 *  Gate 1: Fail-closed on signing rejection (zero wallet writes, form values preserved, Step 4 retained).
 *  Gate 2: Fail-closed on API publication failure (zero wallet writes, form values preserved, retry button rendered).
 *  Gate 3: Working retry action: clicking "Retry Submission" after publication failure succeeds exactly once.
 *  Gate 4: Fail-closed on corrupted server readback (zero wallet writes).
 *  Gate 5: Fail-closed on metadata GET 404/500 readback failure (zero wallet writes).
 *  Gate 6: API lies about question with genuine hash & verifiedMetadata=true: fake question MUST NOT receive verified badge.
 *  Gate 7: Clean browser session: metadata verified from complete persisted manifest, not creator localStorage.
 *  Gate 8: In-browser cache tampering detection (commitment mismatch surfaced with error banner).
 */

import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const OUT_DIR = resolve(REPO_ROOT, 'docs/design/screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = 'http://localhost:5176/local.html';
const DEV_ACCOUNT = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';

const WALLET_INJECTION_SCRIPT = `
(function() {
  window.__oraklTestWallet = {
    currentAccount: '${DEV_ACCOUNT}',
    currentChainId: '0x7a69',
    rejectNextSign: false,
    rejectNextTx: false,
    listeners: {},
    sentTransactions: [],
    lastTxHash: null,
    setAccount(acc) {
      const normalized = acc.toLowerCase();
      this.currentAccount = normalized;
      provider.selectedAddress = normalized;
      if (this.listeners['accountsChanged']) {
        this.listeners['accountsChanged'].forEach(fn => fn([normalized]));
      }
    },
    clearTransactions() {
      this.sentTransactions = [];
      this.lastTxHash = null;
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
      if (method === 'eth_chainId') return window.__oraklTestWallet.currentChainId;
      if (method === 'net_version') return String(parseInt(window.__oraklTestWallet.currentChainId, 16));
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
        return [window.__oraklTestWallet.currentAccount];
      }
      if (method === 'personal_sign') {
        if (window.__oraklTestWallet.rejectNextSign) {
          window.__oraklTestWallet.rejectNextSign = false;
          const err = new Error('User rejected the signing request');
          err.code = 4001;
          throw err;
        }
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
        if (window.__oraklTestWallet.rejectNextTx) {
          window.__oraklTestWallet.rejectNextTx = false;
          const err = new Error('User rejected the transaction');
          err.code = 4001;
          throw err;
        }
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
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        const txHash = data.result;
        window.__oraklTestWallet.sentTransactions.push({
          txHash,
          from: window.__oraklTestWallet.currentAccount,
          to: txPayload.to,
          data: txPayload.data,
          value: txPayload.value
        });
        window.__oraklTestWallet.lastTxHash = txHash;
        return txHash;
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

async function main() {
  console.log('========================================================');
  console.log('[E2E] ORAKL Metadata Trust & Integrity Demo Freeze Suite');
  console.log('========================================================');

  const launchOptions = {
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  };
  const browser = await chromium.launch(launchOptions);

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await context.addInitScript(WALLET_INJECTION_SCRIPT);
  const page = await context.newPage();
  page.on('console', (msg) => console.log('  [BROWSER-CONSOLE]', msg.text()));
  page.on('pageerror', (err) => console.log('  [BROWSER-PAGEERROR]', err));

  // Step 1: Open app & Connect wallet
  console.log('\n[E2E] 1. Loading app and connecting test wallet...');
  await page.goto(`${BASE_URL}#/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const connectBtn = await page.waitForSelector('[data-action="connect"], [data-action="connect-first"]', { timeout: 5000 });
  if (connectBtn) {
    await connectBtn.click();
    await page.waitForTimeout(800);
  }

  // Verify wallet is connected
  await page.waitForSelector('.wallet-ready', { timeout: 5000 });
  console.log('[E2E] Wallet connected successfully:', DEV_ACCOUNT);

  // -------------------------------------------------------------------
  // Gate 1: Signature Rejection Fail-Closed (Zero Wallet Writes)
  // -------------------------------------------------------------------
  console.log('\n[E2E] Gate 1: Testing Signature Rejection Fail-Closed...');
  await page.goto(`${BASE_URL}#/create`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // Load preset
  const presetBtn = await page.$('[data-action="fill-gold-preset"]');
  if (presetBtn) await presetBtn.click();
  await page.waitForTimeout(400);

  // Requirement 3 & 5 Regression Check: confirm-immutability must NOT be auto-checked
  const isAutoChecked = await page.evaluate(() => {
    const cb = document.getElementById('confirm-immutability');
    return cb ? cb.checked : false;
  });
  if (isAutoChecked) {
    throw new Error('Requirement 3 & 5 Violation: confirm-immutability was auto-checked by preset loader!');
  }

  // Requirement 1 & 2 Regression Check: Verify preset chronology and YES/NO criteria
  const presetFormValues = await page.evaluate(() => {
    return {
      close: document.getElementById('input-closeTime')?.value,
      res: document.getElementById('input-resolutionTime')?.value,
      max: document.getElementById('input-maxResolutionTime')?.value,
      yes: document.getElementById('input-yesCriteria')?.value,
      no: document.getElementById('input-noCriteria')?.value,
    };
  });

  if (!presetFormValues.close || !presetFormValues.close.startsWith('2026-12-30')) {
    throw new Error(`Requirement 1 Violation: closeTime is not December 30, 2026! Got: ${presetFormValues.close}`);
  }
  if (!presetFormValues.res || !presetFormValues.res.startsWith('2026-12-31')) {
    throw new Error(`Requirement 1 Violation: resolutionTime is not December 31, 2026! Got: ${presetFormValues.res}`);
  }
  if (!presetFormValues.max || !presetFormValues.max.startsWith('2027-01')) {
    throw new Error(`Requirement 1 Violation: maxResolutionTime does not extend into January 2027! Got: ${presetFormValues.max}`);
  }
  if (!presetFormValues.yes || !presetFormValues.yes.includes('strictly greater than $2,800.00')) {
    throw new Error(`Requirement 2 Violation: YES criteria semantic mismatch! Got: ${presetFormValues.yes}`);
  }
  if (presetFormValues.yes.includes('greater than or equal to')) {
    throw new Error(`Requirement 2 Violation: YES criteria must not say "greater than or equal to"!`);
  }
  if (!presetFormValues.no || !presetFormValues.no.includes('less than or equal to $2,800.00')) {
    throw new Error(`Requirement 2 Violation: NO criteria semantic mismatch! Got: ${presetFormValues.no}`);
  }
  console.log('[E2E] Verified preset chronology and semantic consistency in form inputs.');

  // Navigate to Step 4 tab
  const step4Tab = await page.$('[data-step="4"]');
  if (step4Tab) await step4Tab.click();
  await page.waitForTimeout(300);

  // Check immutability checkbox (Deliberate user confirmation)
  await page.evaluate(() => {
    const cb = document.getElementById('confirm-immutability');
    if (cb) cb.checked = true;
  });

  // Set rejectNextSign flag
  await page.evaluate(() => {
    window.__oraklTestWallet.rejectNextSign = true;
    window.__oraklTestWallet.clearTransactions();
  });

  // Click Submit button
  const submitBtn = await page.$('#btn-submit-create');
  if (submitBtn) await submitBtn.click();
  await page.waitForTimeout(1000);

  // Verify FAIL-CLOSED: No on-chain transaction was sent!
  const txCountAfterSigRejection = await page.evaluate(() => window.__oraklTestWallet.sentTransactions.length);
  if (txCountAfterSigRejection !== 0) {
    throw new Error(`FAIL-CLOSED VIOLATION: Transaction sent despite rejected signature! Sent count: ${txCountAfterSigRejection}`);
  }

  // Verify UI surfaced signature error
  const flashText = await page.evaluate(() => document.getElementById('flash')?.textContent || '');
  if (!flashText.includes('Signature rejected')) {
    throw new Error(`Expected signature rejection error in flash notice, got: "${flashText}"`);
  }

  // Verify Requirement 3: Form values preserved, Step 4 retained, retry action rendered
  const preservedQuestionA = await page.evaluate(() => document.getElementById('input-question')?.value);
  if (!preservedQuestionA || !preservedQuestionA.includes('London Gold Fixing PM')) {
    throw new Error(`Requirement 3 Violation: Question was lost on signature rejection! Got: "${preservedQuestionA}"`);
  }
  const isStep4A = await page.evaluate(() => document.getElementById('step-4-card')?.style.display !== 'none');
  if (!isStep4A) {
    throw new Error('Requirement 3 Violation: Step 4 wizard card was not retained on signature rejection!');
  }
  const retryBtnA = await page.$('[data-action="retry-create"]');
  if (!retryBtnA) {
    throw new Error('Requirement 3 Violation: Working retry action button was not rendered on signature rejection!');
  }

  console.log('[E2E] Gate 1 PASSED: Fail-closed on signature rejection verified (0 on-chain tx, form preserved, retry ready).');

  // -------------------------------------------------------------------
  // Gate 2 & 3: Failed Publication Followed by Clicking Retry Submission (Succeeds Exactly Once)
  // -------------------------------------------------------------------
  console.log('\n[E2E] Gate 2 & 3: Testing Failed Publication Followed by Retry Submission...');
  // Route /api/v1/markets/metadata to fail with 500
  await page.route('**/api/v1/markets/metadata', (route) => {
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NODE_OFFLINE', message: 'Simulated node publication failure' } }),
    });
  });

  // Re-navigate or ensure Step 4 is ready
  await page.evaluate(() => {
    window.__oraklTestWallet.rejectNextSign = false;
    window.__oraklTestWallet.clearTransactions();
    const cb = document.getElementById('confirm-immutability');
    if (cb) cb.checked = true;
  });

  const submitBtnB = await page.waitForSelector('#btn-submit-create', { timeout: 3000 });
  if (submitBtnB) await submitBtnB.click();
  await page.waitForTimeout(1000);

  // Verify FAIL-CLOSED: No on-chain transaction was sent!
  const txCountAfterApiFailure = await page.evaluate(() => window.__oraklTestWallet.sentTransactions.length);
  if (txCountAfterApiFailure !== 0) {
    throw new Error(`FAIL-CLOSED VIOLATION: Transaction sent despite API node publication failure!`);
  }

  const flashApiErr = await page.evaluate(() => document.getElementById('flash')?.textContent || '');
  if (!flashApiErr.includes('Metadata publication failed')) {
    throw new Error(`Expected API publication failure in flash notice, got: "${flashApiErr}"`);
  }

  // Verify Form preserved and Retry button rendered
  const isStep4B = await page.evaluate(() => document.getElementById('step-4-card')?.style.display !== 'none');
  if (!isStep4B) {
    throw new Error('Step 4 wizard card was not retained on API failure!');
  }
  const retryBtnB = await page.waitForSelector('[data-action="retry-create"]', { timeout: 3000 });
  if (!retryBtnB) {
    throw new Error('Working retry action button was not rendered on API failure!');
  }
  console.log('[E2E] Gate 2 PASSED: Zero wallet writes on publication failure, retry button rendered.');

  // Unroute mock failure so retry will succeed
  await page.unroute('**/api/v1/markets/metadata');

  // CLICK RETRY SUBMISSION!
  console.log('[E2E] Gate 3: Clicking "Retry Submission" button...');
  await page.evaluate(() => {
    window.__oraklTestWallet.clearTransactions();
    const cb = document.getElementById('confirm-immutability');
    if (cb) cb.checked = true;
  });

  await retryBtnB.click();
  await page.waitForTimeout(4000); // Wait for signature, publication, readback, and on-chain mining

  const retrySentTxs = await page.evaluate(() => window.__oraklTestWallet.sentTransactions);
  if (retrySentTxs.length !== 1) {
    throw new Error(`Expected exactly 1 on-chain transaction on retry, got: ${retrySentTxs.length}`);
  }
  const createdTxHash = retrySentTxs[0].txHash;
  console.log('[E2E] Gate 3 PASSED: Retry succeeded exactly once! Tx Hash:', createdTxHash);

  // Check URL navigated to created market
  const currentUrl = page.url();
  const createdMarketIdMatch = currentUrl.match(/#\/market\/(\d+)/);
  if (!createdMarketIdMatch) {
    throw new Error(`Expected redirect to #/market/:id, but got ${currentUrl}`);
  }
  const newMarketId = createdMarketIdMatch[1];
  console.log('[E2E] Redirected to newly created market ID:', newMarketId);

  // -------------------------------------------------------------------
  // Gate 4: Successful Publication Followed by Corrupted Readback (Zero Wallet Writes)
  // -------------------------------------------------------------------
  console.log('\n[E2E] Gate 4: Testing Corrupted Server Readback Fail-Closed...');
  await page.goto(`${BASE_URL}#/create`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const presetBtn4 = await page.waitForSelector('[data-action="fill-gold-preset"]');
  if (presetBtn4) await presetBtn4.click();
  await page.waitForTimeout(400);

  // Set a distinct question
  await page.evaluate(() => {
    const q = document.getElementById('input-question');
    if (q) q.value = 'Distinct Test Market For Corrupted Readback Gate #4?';
  });

  const step4Tab4 = await page.waitForSelector('[data-step="4"]');
  if (step4Tab4) await step4Tab4.click();
  await page.waitForTimeout(300);

  // Mock GET /api/v1/metadata/* to return a corrupted manifest
  await page.route('**/api/v1/metadata/*', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        simulationOnly: true,
        data: {
          commitment: '0x1111111111111111111111111111111111111111111111111111111111111111',
          uri: 'ipfs://orakl-local-artifact/tampered',
          formData: {
            schema: 'orakl-market-metadata-v1',
            chainId: '31337',
            factory: '0xdc64a140aa3e981100a9beca4e685f962f0cf6c9',
            question: 'CORRUPTED INJECTION FROM SERVER READBACK?',
            description: 'Corrupted description',
            category: 'finance',
            resolutionCriteria: '[YES] criteria',
            sources: ['https://example.com'],
            creator: DEV_ACCOUNT,
            createdAt: '1730000000',
          },
        },
      }),
    });
  });

  await page.evaluate(() => {
    window.__oraklTestWallet.clearTransactions();
    const cb = document.getElementById('confirm-immutability');
    if (cb) cb.checked = true;
  });

  const submitBtn4 = await page.waitForSelector('#btn-submit-create', { timeout: 3000 });
  if (submitBtn4) await submitBtn4.click();
  await page.waitForTimeout(2000);

  // Assert ZERO wallet writes on corrupted readback
  const txCountAfterCorruptedReadback = await page.evaluate(() => window.__oraklTestWallet.sentTransactions.length);
  if (txCountAfterCorruptedReadback !== 0) {
    throw new Error(`FAIL-CLOSED VIOLATION: Transaction sent despite corrupted server readback! Count: ${txCountAfterCorruptedReadback}`);
  }

  const errBanner4 = await page.evaluate(() => document.getElementById('create-error-banner')?.textContent || '');
  if (!errBanner4.toLowerCase().includes('failed') && !errBanner4.toLowerCase().includes('mismatch')) {
    throw new Error(`Expected readback failure banner in UI, got: "${errBanner4}"`);
  }
  console.log('[E2E] Gate 4 PASSED: Corrupted readback aborted on-chain submission (0 wallet writes).');

  // Unroute mock
  await page.unroute('**/api/v1/metadata/*');

  // -------------------------------------------------------------------
  // Gate 5: Metadata GET Returning 404/500 During Readback (Zero Wallet Writes)
  // -------------------------------------------------------------------
  console.log('\n[E2E] Gate 5: Testing Metadata GET 404/500 Readback Failure Fail-Closed...');
  await page.goto(`${BASE_URL}#/create`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const presetBtn5 = await page.waitForSelector('[data-action="fill-gold-preset"]');
  if (presetBtn5) await presetBtn5.click();
  await page.waitForTimeout(400);

  await page.evaluate(() => {
    const q = document.getElementById('input-question');
    if (q) q.value = 'Distinct Test Market For 404 Readback Gate #5?';
  });

  const step4Tab5 = await page.waitForSelector('[data-step="4"]');
  if (step4Tab5) await step4Tab5.click();
  await page.waitForTimeout(300);

  // Route /api/v1/metadata/* to fail with 404
  await page.route('**/api/v1/metadata/*', (route) => {
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Artifact not found' } }),
    });
  });

  await page.evaluate(() => {
    window.__oraklTestWallet.clearTransactions();
    const cb = document.getElementById('confirm-immutability');
    if (cb) cb.checked = true;
  });

  const submitBtn5 = await page.waitForSelector('#btn-submit-create', { timeout: 3000 });
  if (submitBtn5) await submitBtn5.click();
  await page.waitForTimeout(2000);

  // Assert ZERO wallet writes
  const txCountAfter404 = await page.evaluate(() => window.__oraklTestWallet.sentTransactions.length);
  if (txCountAfter404 !== 0) {
    throw new Error(`FAIL-CLOSED VIOLATION: Transaction sent despite metadata readback 404!`);
  }

  const errBanner5 = await page.evaluate(() => document.getElementById('create-error-banner')?.textContent || '');
  if (!errBanner5.toLowerCase().includes('failed') && !errBanner5.toLowerCase().includes('not found') && !errBanner5.toLowerCase().includes('aborted')) {
    throw new Error(`Expected readback 404 error banner in UI, got: "${errBanner5}"`);
  }
  console.log('[E2E] Gate 5 PASSED: Readback 404 aborted on-chain submission (0 wallet writes).');

  // Unroute mock
  await page.unroute('**/api/v1/metadata/*');

  // -------------------------------------------------------------------
  // Gate 6: API Returns Fake Question with Genuine Hash & verifiedMetadata=true (Blocker 1 & 2)
  // Fake question MUST NOT receive a verified badge!
  // -------------------------------------------------------------------
  console.log('\n[E2E] Gate 6: Testing API Fake Question Inversion Protection...');
  // Intercept /api/v1/markets to return a fabricated question with genuine metadataHash and verifiedMetadata=true
  await page.route('**/api/v1/markets?*', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    if (json?.data?.items?.length > 0) {
      json.data.items[0].question = 'FABRICATED FAKE QUESTION: Will Bitcoin crash to zero?';
      json.data.items[0].verifiedMetadata = true; // API falsely claims it is verified!
    }
    await route.fulfill({ json });
  });

  // Also mock /api/v1/metadata/* so manifest artifact is unavailable
  await page.route('**/api/v1/metadata/*', (route) => {
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No manifest' } }),
    });
  });

  // Clear local manifest cache so the fake item has no local cached manifest
  await page.evaluate(() => {
    localStorage.removeItem('orakl_local_manifest_cache_v1');
  });

  await page.goto(`${BASE_URL}#/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Find the first market card
  const firstCard = await page.waitForSelector('.market-card', { timeout: 5000 });
  const cardHtml = await firstCard.innerHTML();

  // Assert: Fake question MUST NOT receive "Verified Question" badge!
  if (cardHtml.includes('Verified Question')) {
    throw new Error('BLOCKER 1 & 2 VIOLATION: Fake question received "Verified Question" badge simply because API claimed verifiedMetadata=true!');
  }

  // Assert it renders as Unverified Question or Metadata Unavailable
  if (!cardHtml.includes('Unverified Question') && !cardHtml.includes('Metadata Unavailable')) {
    throw new Error('Expected unverified or unavailable badge on fake question card without verified manifest!');
  }
  console.log('[E2E] Gate 6 PASSED: Fake question from lying API did NOT receive Verified Question badge!');

  // Unroute mocks
  await page.unroute('**/api/v1/markets?*');
  await page.unroute('**/api/v1/metadata/*');

  // Close creator session
  await context.close();

  // -------------------------------------------------------------------
  // Gate 7: Clean Browser Session (No Creator localStorage)
  // Metadata is verified from complete persisted manifest!
  // -------------------------------------------------------------------
  console.log('\n[E2E] Gate 7: Launching Brand New Fresh Browser Context (No Cached Session)...');
  const freshContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const freshPage = await freshContext.newPage();

  // Verify fresh context has clean isolated storage (no inherited creator cache)
  const storageState = await freshContext.storageState();
  const hasLocalCache = storageState.origins.some((o) =>
    o.localStorage.some((item) => item.name === 'orakl_local_manifest_cache_v1')
  );
  if (hasLocalCache) {
    throw new Error('Fresh context inherited localStorage from creator context!');
  }

  const expectedQuestion = 'Will London Gold Fixing PM (XAU/USD) exceed $2,800.00 on 2026-12-30?';

  // Navigate to market detail in fresh session
  console.log(`[E2E] Navigating fresh session to market #${newMarketId} detail...`);
  await freshPage.goto(`${BASE_URL}#/market/${newMarketId}`, { waitUntil: 'networkidle' });
  await freshPage.waitForTimeout(2000);

  const detailContent = await freshPage.content();
  if (!detailContent.includes(expectedQuestion)) {
    throw new Error('Fresh session market detail does not render verified question!');
  }
  if (!detailContent.includes('Verified Question')) {
    throw new Error('Fresh session market detail does not render Verified Question badge!');
  }

  // Requirement 4 Regression Check: Primary Observation Source links to verified resolution source, not metadata URI
  const primaryObsLink = await freshPage.evaluate(() => {
    const link = document.querySelector('.rules-source-link a');
    return link ? link.getAttribute('href') : null;
  });
  if (primaryObsLink !== 'https://www.lbma.org.uk/prices-and-data/precious-metal-prices') {
    throw new Error(`Requirement 4 Violation: Primary Observation Source link was "${primaryObsLink}", expected LBMA URL!`);
  }
  console.log('[E2E] Verified Primary Observation Source displays verified LBMA primary URL, not metadata URI.');

  // Verify that fresh session cached the verified manifest from the complete server artifact
  const cachedAfterVisit = await freshPage.evaluate(() => localStorage.getItem('orakl_local_manifest_cache_v1'));
  if (!cachedAfterVisit || !cachedAfterVisit.includes('London Gold Fixing PM')) {
    throw new Error('Fresh session failed to cache verified manifest after retrieving complete artifact!');
  }
  console.log('[E2E] Gate 7 PASSED: Clean browser verified question from persisted manifest and cached it locally.');

  // Capture screenshot of fresh session proof
  const snapDest = resolve(OUT_DIR, '18-metadata-e2e-fresh-session.png');
  await freshPage.screenshot({ path: snapDest });
  console.log('[E2E] Saved fresh session verification screenshot: 18-metadata-e2e-fresh-session.png');

  // -------------------------------------------------------------------
  // Gate 8: In-Browser Cache Tampering Detection
  // -------------------------------------------------------------------
  console.log('\n[E2E] Gate 8: Testing In-Browser Cache Tampering Detection...');
  await freshPage.evaluate(async ({ marketId, devAccount }) => {
    const key = 'orakl_local_manifest_cache_v1';
    const res = await fetch(`http://127.0.0.1:4310/api/v1/markets/${marketId}`);
    const data = await res.json();
    const hash = (data?.data?.metadataHash || '').toLowerCase();
    const uri = (data?.data?.metadataURI || '').toLowerCase();

    // Construct tampered manifest with altered question that breaks Keccak-256 commitment
    const tamperedManifest = {
      schema: 'orakl-market-metadata-v1',
      chainId: '31337',
      factory: '0xdc64a140aa3e981100a9beca4e685f962f0cf6c9',
      question: 'TAMPERED PHONY QUESTION: Has Gold collapsed to zero?',
      description: 'Tampered description',
      category: 'finance',
      resolutionCriteria: '[YES] Tampered criteria',
      sources: ['https://example.com'],
      creator: devAccount,
      createdAt: '1730000000',
    };

    const store = {};
    if (hash) store[hash] = tamperedManifest;
    if (uri) store[uri] = tamperedManifest;
    localStorage.setItem(key, JSON.stringify(store));
  }, { marketId: newMarketId, devAccount: DEV_ACCOUNT });

  // Reload page to trigger verification against on-chain hash
  await freshPage.reload({ waitUntil: 'networkidle' });
  await freshPage.waitForTimeout(1000);

  const tamperedContent = await freshPage.content();
  if (!tamperedContent.includes('Commitment Mismatch')) {
    throw new Error('TAMPERING DETECTION FAILED: Tampered cache did not trigger Commitment Mismatch badge!');
  }
  if (!tamperedContent.includes('Metadata Commitment Mismatch Detected')) {
    throw new Error('TAMPERING DETECTION FAILED: Tampered cache did not trigger mismatch warning banner!');
  }
  console.log('[E2E] Gate 8 PASSED: In-browser tampering successfully detected and surfaced!');

  await freshContext.close();
  await browser.close();

  console.log('\n========================================================');
  console.log('[E2E] ALL 8 DEMO FREEZE VERIFICATION GATES PASSED!');
  console.log('========================================================\n');
}

main().catch((err) => {
  console.error('\n[E2E] FATAL ERROR:', err);
  process.exit(1);
});
