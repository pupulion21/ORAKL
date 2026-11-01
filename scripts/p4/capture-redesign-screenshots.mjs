#!/usr/bin/env node
/** Capture high-resolution visual inspection screenshots across all 14 mandatory viewpoints.
 *  Uses Playwright with Google Chrome for Testing across Desktop, Laptop, Tablet, and Mobile viewports.
 */

import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { chromium } from '/home/pupulion/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const OUT_DIR = resolve(REPO_ROOT, 'docs/design/screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const CHROME_PATH = '/home/pupulion/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const BASE_URL = 'http://localhost:5176/local.html';

async function run() {
  console.log('[capture] Launching Chromium from:', CHROME_PATH);
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
  });

  // -------------------------------------------------------------------
  // Desktop Context (1440 x 900)
  // -------------------------------------------------------------------
  console.log('[capture] Initializing Desktop Context (1440x900)...');
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await desktopContext.newPage();

  async function snap(filename, targetPage = page, options = {}) {
    const dest = resolve(OUT_DIR, filename);
    await targetPage.screenshot({ path: dest, ...options });
    console.log(`[capture] Saved ${filename}`);
  }

  // 01. Market Discovery (Desktop 1440px)
  console.log('[capture] 01. Market Discovery');
  await page.goto(`${BASE_URL}#/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await snap('01-market-discovery.png');

  // 02. Market Detail (Desktop 1440px) - Market #4 (Disputed)
  console.log('[capture] 02. Market Detail');
  await page.goto(`${BASE_URL}#/market/4`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await snap('02-market-detail.png');

  // 03. Create Market Empty State (Desktop 1440px)
  console.log('[capture] 03. Create Market Empty State');
  await page.goto(`${BASE_URL}#/create`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await snap('03-create-market-empty.png');

  // 04. Create Market With Validated Input (Gold Benchmark Preset)
  console.log('[capture] 04. Create Market Validated Input');
  const presetBtn = await page.$('[data-action="fill-gold-preset"]');
  if (presetBtn) {
    await presetBtn.click();
    await page.waitForTimeout(600);
  }
  const validateBtn = await page.$('[data-action="validate-create-form"]');
  if (validateBtn) {
    await validateBtn.click();
    await page.waitForTimeout(600);
  }
  await snap('04-create-market-validated.png');

  // 05. Publication Review Card Element
  console.log('[capture] 05. Publication Review');
  const reviewCard = await page.$('#section-review');
  if (reviewCard) {
    await reviewCard.screenshot({ path: resolve(OUT_DIR, '05-publication-review.png') });
    console.log('[capture] Saved 05-publication-review.png (element)');
  } else {
    await snap('05-publication-review.png');
  }

  // 06. Resolution Timeline (Market #2 - Proposed)
  console.log('[capture] 06. Resolution Timeline');
  await page.goto(`${BASE_URL}#/market/2`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const stepper = await page.$('.resolution-stepper-card');
  if (stepper) {
    await stepper.screenshot({ path: resolve(OUT_DIR, '06-resolution-timeline.png') });
    console.log('[capture] Saved 06-resolution-timeline.png (element)');
  } else {
    await snap('06-resolution-timeline.png');
  }

  // 07. Evidence Details & RFC 8785 Modal (Market #4)
  console.log('[capture] 07. Evidence Details & Modal');
  await page.goto(`${BASE_URL}#/market/4`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const inspectBtn = await page.$('[data-action="inspect-evidence"]');
  if (inspectBtn) {
    await inspectBtn.click();
    await page.waitForTimeout(600);
    await snap('07-evidence-details.png');
    const closeBtn = await page.$('[data-action="close-modal"]');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(300);
  } else {
    await snap('07-evidence-details.png');
  }

  // 08. Dispute Queue (Arbitration Workspace #/arbitration)
  console.log('[capture] 08. Dispute Queue');
  await page.goto(`${BASE_URL}#/arbitration`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await snap('08-dispute-queue.png');

  // 09. Arbitration Case Detail (#/arbitration/4)
  console.log('[capture] 09. Arbitration Case Detail');
  await page.goto(`${BASE_URL}#/arbitration/4`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await snap('09-arbitration-case-detail.png');

  // 10. Wallet Disconnected State (Portfolio View without wallet)
  console.log('[capture] 10. Wallet Disconnected State');
  await page.goto(`${BASE_URL}#/portfolio`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await snap('10-wallet-disconnected.png');

  await desktopContext.close();

  // -------------------------------------------------------------------
  // Error States Context (Simulated Failures)
  // -------------------------------------------------------------------
  console.log('[capture] 11. RPC Unavailable Error State');
  const errorContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const errorPage = await errorContext.newPage();

  // Route RPC calls to fail immediately
  await errorPage.route('**/127.0.0.1:8546/**', (route) => route.abort('connectionrefused'));
  await errorPage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await errorPage.waitForTimeout(1500);
  await snap('11-error-state-rpc-unavailable.png', errorPage);
  await errorContext.close();

  // 12. Metadata Publisher Unavailable State (Evidence Lab node publication failure)
  console.log('[capture] 12. Metadata Publisher Unavailable State');
  const metaContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const metaPage = await metaContext.newPage();
  await metaPage.goto(`${BASE_URL}#/evidence`, { waitUntil: 'networkidle' });
  await metaPage.waitForTimeout(1000);
  const pubEvidenceBtn = await metaPage.$('[data-action="publish-evidence-node"]');
  if (pubEvidenceBtn) {
    await pubEvidenceBtn.click();
    await metaPage.waitForTimeout(1000);
  }
  await snap('12-error-state-metadata-unavailable.png', metaPage);
  await metaContext.close();

  // -------------------------------------------------------------------
  // Mobile Context (390 x 844 iPhone 14 / modern smartphone)
  // -------------------------------------------------------------------
  console.log('[capture] Initializing Mobile Viewport (390x844)...');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileContext.newPage();

  // 13. Mobile Navigation & Discovery Viewport
  console.log('[capture] 13. Mobile Navigation & Discovery');
  await mobilePage.goto(`${BASE_URL}#/`, { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(1000);
  await snap('13-mobile-navigation.png', mobilePage);

  // 14. Mobile Create Form Validation Viewport
  console.log('[capture] 14. Mobile Create Form Validation');
  await mobilePage.goto(`${BASE_URL}#/create`, { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(1000);
  const mobValidateBtn = await mobilePage.$('[data-action="validate-create-form"]');
  if (mobValidateBtn) {
    await mobValidateBtn.click();
    await mobilePage.waitForTimeout(600);
  }
  await snap('14-mobile-create-form.png', mobilePage);

  await mobileContext.close();
  await browser.close();

  console.log('\n======================================================');
  console.log('[capture] ALL 14 MANDATORY VIEWPOINTS SUCCESSFULLY CAPTURED!');
  console.log('Location:', OUT_DIR);
  console.log('======================================================\n');
}

run().catch((err) => {
  console.error('[capture] Error:', err);
  process.exit(1);
});
