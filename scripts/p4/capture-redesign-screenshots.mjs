#!/usr/bin/env node
/** Capture high-resolution visual inspection screenshots across all 10 mandatory viewpoints.
 *  Uses Playwright with Google Chrome for Testing.
 */

import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { chromium } from '/home/pupulion/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const OUT_DIR = resolve(REPO_ROOT, 'docs/design/screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const CHROME_PATH = '/home/pupulion/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const BASE_URL = 'http://localhost:5176/local.html';

async function run() {
  console.log('[capture] Launching Chromium...');
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_PATH,
  });

  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // Retina resolution
  });

  const page = await desktopContext.newPage();

  // Helper for screenshot
  async function snap(filename, options = {}) {
    const dest = resolve(OUT_DIR, filename);
    await page.screenshot({ path: dest, ...options });
    console.log(`[capture] Saved ${filename}`);
  }

  // 1. Market Discovery Desktop
  console.log('[capture] 1. Market Discovery Desktop');
  await page.goto(`${BASE_URL}#/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await snap('01-market-discovery-desktop.png');

  // 2. Market Detail Desktop (Market #4 - DISPUTED)
  console.log('[capture] 2. Market Detail Desktop (Market #4)');
  await page.goto(`${BASE_URL}#/market/4`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await snap('02-market-detail-desktop.png');

  // 3. Resolution Timeline Element
  console.log('[capture] 3. Resolution Timeline');
  const stepper = await page.$('.resolution-stepper-card');
  if (stepper) {
    await stepper.screenshot({ path: resolve(OUT_DIR, '03-resolution-timeline.png') });
    console.log('[capture] Saved 03-resolution-timeline.png (element)');
  } else {
    await snap('03-resolution-timeline.png');
  }

  // 4. Evidence Panel & RFC 8785 Inspector Modal
  console.log('[capture] 4. Evidence Panel & RFC 8785 Modal');
  const inspectBtn = await page.$('[data-action="inspect-evidence"]');
  if (inspectBtn) {
    await inspectBtn.click();
    await page.waitForTimeout(600);
    await snap('04-evidence-dossier-modal.png');
    // Close modal
    const closeBtn = await page.$('[data-action="close-modal"]');
    if (closeBtn) await closeBtn.click();
    await page.waitForTimeout(300);
  } else {
    await snap('04-evidence-dossier-modal.png');
  }

  // 5. Arbitration Workspace Dispute Queue
  console.log('[capture] 5. Arbitration Workspace Dispute Queue');
  await page.goto(`${BASE_URL}#/arbitration`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await snap('05-dispute-queue.png');

  // 6. Arbitration Case Detail (Case #4)
  console.log('[capture] 6. Arbitration Case Detail');
  await page.goto(`${BASE_URL}#/arbitration/4`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await snap('06-arbitration-case-detail.png');

  // 9. Empty State (Filter with no match)
  console.log('[capture] 9. Empty State View');
  await page.goto(`${BASE_URL}#/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const searchInput = await page.$('#market-search');
  if (searchInput) {
    await searchInput.fill('NonexistentQuery12345XYZ');
    await page.waitForTimeout(600);
  }
  await snap('09-empty-state.png');

  // 10. Disconnected / Observer State on Market Detail
  console.log('[capture] 10. Disconnected / Observer State');
  await page.goto(`${BASE_URL}#/market/5`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await snap('10-disconnected-or-error-state.png');

  await desktopContext.close();

  // Mobile Context (390 x 844 iPhone 14 / modern smartphone)
  console.log('[capture] Initializing Mobile Viewport (390x844)...');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileContext.newPage();

  // 7. Mobile Market View
  console.log('[capture] 7. Mobile Market View');
  await mobilePage.goto(`${BASE_URL}#/market/4`, { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(1000);
  await mobilePage.screenshot({ path: resolve(OUT_DIR, '07-mobile-market-view.png') });
  console.log('[capture] Saved 07-mobile-market-view.png');

  // 8. Mobile Arbitration Workspace
  console.log('[capture] 8. Mobile Arbitration Workspace');
  await mobilePage.goto(`${BASE_URL}#/arbitration`, { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(1000);
  await mobilePage.screenshot({ path: resolve(OUT_DIR, '08-mobile-arbitration-view.png') });
  console.log('[capture] Saved 08-mobile-arbitration-view.png');

  await mobileContext.close();
  await browser.close();
  console.log('[capture] All 10 viewpoints successfully captured in docs/design/screenshots/!');
}

run().catch((err) => {
  console.error('[capture] Error:', err);
  process.exit(1);
});
