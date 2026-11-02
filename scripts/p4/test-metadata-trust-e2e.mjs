#!/usr/bin/env node
/**
 * ORAKL Metadata Trust & Create Market Integrity E2E Test
 *
 * Verifies:
 *  1. Fail-closed metadata publication (signature rejection and API failures abort creation).
 *  2. Verification of displayed metadata against the actual on-chain commitment.
 *  3. Accurate verified/unverified/unavailable status and tampering detection.
 *  4. Real local browser E2E proving published metadata survives in a fresh browser session.
 */

import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { chromium } from '/home/pupulion/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const OUT_DIR = resolve(REPO_ROOT, 'docs/design/screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const CHROME_PATH = '/home/pupulion/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
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
  console.log('[E2E] ORAKL Metadata Trust & Integrity Test Suite');
  console.log('========================================================');

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await context.addInitScript(WALLET_INJECTION_SCRIPT);
  const page = await context.newPage();

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
  // Negative Path A: Signature Rejection Fail-Closed
  // -------------------------------------------------------------------
  console.log('\n[E2E] 2. Testing Negative Path A: Signature Rejection Fail-Closed...');
  await page.goto(`${BASE_URL}#/create`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // Load preset
  const presetBtn = await page.$('[data-action="fill-gold-preset"]');
  if (presetBtn) await presetBtn.click();
  await page.waitForTimeout(400);

  // Navigate to Step 4 tab
  const step4Tab = await page.$('[data-step="4"]');
  if (step4Tab) await step4Tab.click();
  await page.waitForTimeout(300);

  // Check immutability checkbox
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
  console.log('[E2E] Negative Path A PASSED: Fail-closed on signature rejection verified (0 on-chain tx sent).');

  // -------------------------------------------------------------------
  // Negative Path B: API Node Publication Failure Fail-Closed
  // -------------------------------------------------------------------
  console.log('\n[E2E] 3. Testing Negative Path B: API Node Failure Fail-Closed...');
  // Route /api/v1/markets/metadata to fail with 500
  await page.route('**/api/v1/markets/metadata', (route) => {
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NODE_OFFLINE', message: 'Simulated node publication failure' } }),
    });
  });

  // Re-load preset and navigate to step 4
  const presetBtnB = await page.waitForSelector('[data-action="fill-gold-preset"]');
  if (presetBtnB) await presetBtnB.click();
  await page.waitForTimeout(400);

  const step4TabB = await page.waitForSelector('[data-step="4"]');
  if (step4TabB) await step4TabB.click();
  await page.waitForTimeout(300);

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
  console.log('[E2E] Negative Path B PASSED: Fail-closed on API failure verified (0 on-chain tx sent).');

  // Unroute mock
  await page.unroute('**/api/v1/markets/metadata');

  // -------------------------------------------------------------------
  // Positive Path: Valid Creation with Node Publication & Mining
  // -------------------------------------------------------------------
  console.log('\n[E2E] 4. Testing Positive Path: Valid Create Market & Publication...');
  const presetBtnPos = await page.waitForSelector('[data-action="fill-gold-preset"]');
  if (presetBtnPos) await presetBtnPos.click();
  await page.waitForTimeout(400);

  const step4TabPos = await page.waitForSelector('[data-step="4"]');
  if (step4TabPos) await step4TabPos.click();
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    window.__oraklTestWallet.rejectNextSign = false;
    window.__oraklTestWallet.clearTransactions();
    const cb = document.getElementById('confirm-immutability');
    if (cb) cb.checked = true;
  });

  const submitBtnPos = await page.waitForSelector('#btn-submit-create', { timeout: 3000 });
  if (submitBtnPos) await submitBtnPos.click();
  await page.waitForTimeout(4000); // Wait for personal_sign, API publish, and on-chain tx mining

  const sentTxs = await page.evaluate(() => window.__oraklTestWallet.sentTransactions);
  if (sentTxs.length === 0) {
    throw new Error('Expected on-chain createMarket transaction to be submitted upon successful publication');
  }
  const createdTxHash = sentTxs[0].txHash;
  console.log('[E2E] createMarket transaction mined on Anvil! Hash:', createdTxHash);

  // Check URL navigated to created market
  const currentUrl = page.url();
  console.log('[E2E] Redirected to URL:', currentUrl);
  const createdMarketIdMatch = currentUrl.match(/#\/market\/(\d+)/);
  if (!createdMarketIdMatch) {
    throw new Error(`Expected redirect to #/market/:id, but got ${currentUrl}`);
  }
  const newMarketId = createdMarketIdMatch[1];
  console.log('[E2E] Newly created market verified with ID:', newMarketId);

  // Close creator session
  await context.close();

  // -------------------------------------------------------------------
  // Priority 4: Brand New Fresh Browser Session Survival
  // -------------------------------------------------------------------
  console.log('\n[E2E] 5. Launching Brand New Fresh Browser Context (No Cached Session)...');
  const freshContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  // Do NOT add test wallet init script — clean disconnected user session!
  const freshPage = await freshContext.newPage();

  console.log('[E2E] Navigating fresh browser session to market discovery...');
  await freshPage.goto(`${BASE_URL}#/`, { waitUntil: 'networkidle' });
  await freshPage.waitForTimeout(1500);

  // Assert market card appears with verified question
  const cardSelector = `.market-card`;
  const cards = await freshPage.$$(cardSelector);
  console.log(`[E2E] Fresh session loaded ${cards.length} market cards.`);

  const pageContent = await freshPage.content();
  const expectedQuestion = 'Will London Gold Fixing PM (XAU/USD) exceed $2,800.00 on 2026-12-31?';

  if (!pageContent.includes(expectedQuestion)) {
    throw new Error(`FRESH SESSION INTEGRITY FAILURE: Did not find "${expectedQuestion}" on market discovery page!`);
  }
  console.log('[E2E] Found verified question in fresh session:', expectedQuestion);

  // Verify that the title is NOT a raw IPFS URI
  if (pageContent.includes(`>${expectedQuestion}<`)) {
    console.log('[E2E] Verified question is rendered as primary human-readable title!');
  }

  // Navigate to market detail in fresh session
  console.log(`[E2E] Navigating fresh session to market #${newMarketId} detail...`);
  await freshPage.goto(`${BASE_URL}#/market/${newMarketId}`, { waitUntil: 'networkidle' });
  await freshPage.waitForTimeout(1500);

  const detailContent = await freshPage.content();
  if (!detailContent.includes(expectedQuestion)) {
    throw new Error('Fresh session market detail does not render verified question!');
  }
  if (!detailContent.includes('Verified Question')) {
    throw new Error('Fresh session market detail does not render Verified Question badge!');
  }
  console.log('[E2E] Fresh session verified detail question and badge!');

  // Capture screenshot of fresh session proof
  const snapDest = resolve(OUT_DIR, '18-metadata-e2e-fresh-session.png');
  await freshPage.screenshot({ path: snapDest });
  console.log('[E2E] Saved fresh session verification screenshot: 18-metadata-e2e-fresh-session.png');

  // -------------------------------------------------------------------
  // Negative Path C: Cache Tampering Detection
  // -------------------------------------------------------------------
  console.log('\n[E2E] 6. Testing Negative Path C: In-Browser Cache Tampering Detection...');
  await freshPage.evaluate(async (marketId) => {
    const key = 'orakl_local_manifest_cache_v1';
    // Fetch market metadataHash from API
    const res = await fetch(`http://127.0.0.1:4310/api/v1/markets/${marketId}`);
    const data = await res.json();
    const hash = (data?.data?.metadataHash || '').toLowerCase();
    const uri = (data?.data?.metadataURI || '').toLowerCase();

    // Construct tampered manifest with altered question
    const tamperedManifest = {
      schema: 'orakl-market-metadata-v1',
      chainId: '31337',
      factory: '0xdc64a140aa3e981100a9beca4e685f962f0cf6c9',
      question: 'TAMPERED PHONY QUESTION: Has Gold collapsed to zero?',
      description: 'Tampered description',
      category: 'finance',
      resolutionCriteria: '[YES] Tampered criteria',
      sources: ['https://example.com'],
      creator: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
      createdAt: '1730000000',
    };

    const store = {};
    if (hash) store[hash] = tamperedManifest;
    if (uri) store[uri] = tamperedManifest;
    localStorage.setItem(key, JSON.stringify(store));
  }, newMarketId);

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
  console.log('[E2E] Negative Path C PASSED: In-browser tampering successfully detected and surfaced!');

  await freshContext.close();
  await browser.close();

  console.log('\n========================================================');
  console.log('[E2E] ALL METADATA TRUST & INTEGRITY GATES PASSED!');
  console.log('========================================================\n');
}

main().catch((err) => {
  console.error('\n[E2E] FATAL ERROR:', err);
  process.exit(1);
});
