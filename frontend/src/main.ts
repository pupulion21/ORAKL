/** QIE Predict UI.
 *
 *  The UI is deliberately thin: every number shown comes from a read against the
 *  verified QIE testnet RPC, and every write is sent through the user's EIP-1193
 *  wallet on chain 1983. There is no demo mode, mock token, fake balance, local
 *  chain fallback, or auto-retry of a write.
 */

import './styles.css';

import {getAddress, type TransactionReceipt} from 'viem';
import {
  QIE_PREDICTION_MARKET_ARTIFACT,
  QIE_PREDICTION_MARKET_CREATION_BYTECODE,
} from './abi.ts';
import {
  blockTimestamp,
  encodeCancelIfExpired,
  encodeClaim,
  encodeClaimTo,
  encodeCreateMarket,
  encodeRefund,
  encodeRefundTo,
  encodeResolve,
  encodeStake,
  getReceipt,
  isAddress,
  loadAndVerifyDeployment,
  marketIdFromReceipt,
  readBlockNumber,
  readGlobalStats,
  readMarket,
  readMarketAccountState,
  readMarketCount,
  readMarketRange,
  readNativeBalance,
  sameAddress,
  verifyContractRuntime,
  waitForReceipt,
  type Address,
  type CreateMarketInput,
  type DeploymentLoad,
  type DeploymentVerification,
  type GlobalStats,
  type MarketAccountState,
  type MarketRecord,
  type Side,
} from './chain.ts';
import {publicClient, QIE_RPC_IS_OVERRIDE, QIE_RPC_URLS, shortRpcLabel} from './config.ts';
import * as C from './constants.ts';
import * as F from './format.ts';
import {CATEGORIES, MARKET_IDEAS, categoryForQuestion, filterIdeas, icon, isCategory,
  marketBookmarkKey, parseBookmarks, type Category, type MarketIdea} from './platform.ts';
import {createTransactionTracker, type TxStatus} from './transactions.ts';
import {
  artifactHashes,
  parseManifestJson,
  type DeploymentManifest,
} from './manifest.ts';
import {
  createWalletSession,
  discoverWallets,
  walletErrorText,
  type WalletInfo,
  type WalletSession,
  type WalletSnapshot,
  type WalletTransaction,
} from './wallet.ts';

// --------------------------------------------------------------------- state

type Route =
  | {name: 'list'}
  | {name: 'detail'; id: bigint}
  | {name: 'create'}
  | {name: 'portfolio'}
  | {name: 'resolver'}
  | {name: 'deploy'}
  | {name: 'developer'}
  | {name: 'watchlist'}
  | {name: 'learn'};

interface NetworkState {
  status: 'checking' | 'ok' | 'mismatch' | 'error';
  chainId: number | null;
  blockNumber: bigint | null;
  error: string | null;
}

interface CreateDraft {
  question: string;
  criteria: string;
  source: string;
  resolver: string;
  closeTime: string;
  resolveDeadline: string;
}

interface CurrentDetail {
  market: MarketRecord;
  accountState: MarketAccountState | null;
  balance: bigint | null;
}

interface PortfolioRow {
  market: MarketRecord;
  accountState: MarketAccountState;
}

interface ActiveDeployment {
  manifest: DeploymentManifest;
  verification: DeploymentVerification;
  session: boolean;
}

interface ModalState {
  title: string;
  body: string;
  confirmLabel: string;
  tone: 'primary' | 'danger';
  onConfirm: () => Promise<void>;
}

type ListPhase = 'ALL' | F.MarketPhase;
type ListSort = 'newest' | 'closing' | 'pool';

const appRoot = document.getElementById('app');
if (!(appRoot instanceof HTMLElement)) throw new Error('The #app element was not found');
const app: HTMLElement = appRoot;

let route: Route = parseRoute();
let network: NetworkState = {status: 'checking', chainId: null, blockNumber: null, error: null};
let networkRequest = 0;
let deploymentLoad: DeploymentLoad | null = null;
let deploymentLoading = false;
let deploymentRequest = 0;
let sessionDeployment: {manifest: DeploymentManifest; verification: DeploymentVerification} | null = null;

let wallets: WalletInfo[] = [];
let walletsLoading = true;
let walletSnapshot: WalletSnapshot = {
  phase: 'disconnected',
  account: null,
  chainId: null,
  error: null,
  info: null,
};
let walletSession: WalletSession | null = null;

let markets: MarketRecord[] | null = null;
let marketsError: string | null = null;
let marketsLoading = false;
let marketsProgress: {loaded: number; total: number} | null = null;
let marketsPromise: Promise<void> | null = null;
let marketsToken = 0;
let stats: GlobalStats | null = null;
let statsError: string | null = null;
let statsRequest = 0;

let listState: {page: number; pageSize: number; query: string; phase: ListPhase; sort: ListSort; category: Category} = {
  page: 0,
  pageSize: 9,
  query: '',
  phase: 'ALL',
  sort: 'newest',
  category: 'all',
};

const BOOKMARK_STORAGE = 'qie-predict:bookmarks:v1';
let bookmarks = readBookmarks();
let preferredStakeSide: Side = 0;
let previousModalFocus: HTMLElement | null = null;

let draft: CreateDraft = defaultDraft();
let currentDetail: CurrentDetail | null = null;
const transactions = createTransactionTracker({
  waitForReceipt,
  getReceipt,
  onChange: () => renderTxDock(),
  onError: (message) => showToast(message, 'err'),
  errorText: (error) => F.contractErrorText(F.errorMessage(error)),
});
let writePending = false;
let txDockExpanded: boolean | null = null;
let uiEpoch = 0;
let currentModal: ModalState | null = null;
let modalError = '';
let modalBusy = false;
let toastTimer: number | null = null;
let searchTimer: number | null = null;

let portfolioRows: PortfolioRow[] | null = null;
let portfolioError: string | null = null;
let portfolioLoading = false;
let portfolioProgress: {loaded: number; total: number} = {loaded: 0, total: 0};
let portfolioToken = 0;
let portfolioAccount: Address | null = null;
let portfolioDeployment: Address | null = null;

// ------------------------------------------------------------------- helpers

function parseRoute(): Route {
  const hash = (location.hash.replace(/^#/, '') || '/').trim();
  if (hash.startsWith('/market/')) {
    const raw = hash.slice('/market/'.length);
    if (/^\d+$/.test(raw)) return {name: 'detail', id: BigInt(raw)};
  }
  if (hash === '/watchlist') return {name: 'watchlist'};
  if (hash === '/how-it-works') return {name: 'learn'};
  if (hash === '/create') return {name: 'create'};
  if (hash === '/portfolio') return {name: 'portfolio'};
  if (hash === '/resolver') return {name: 'resolver'};
  if (hash === '/deploy' || hash === '/network') return {name: 'deploy'};
  if (hash === '/developer') return {name: 'developer'};
  return {name: 'list'};
}

function defaultDraft(): CreateDraft {
  const now = F.nowSec();
  return {
    question: '',
    criteria: '',
    source: '',
    resolver: '',
    closeTime: F.toDateTimeLocal(BigInt(now + 86_400)),
    resolveDeadline: F.toDateTimeLocal(BigInt(now + 2 * 86_400)),
  };
}

function walletAccount(): Address | null {
  const account = walletSnapshot.account;
  if (!account || !isAddress(account)) return null;
  try {
    return getAddress(account);
  } catch {
    return null;
  }
}

function effectiveDeployment(): ActiveDeployment | null {
  if (sessionDeployment) return {...sessionDeployment, session: true};
  if (deploymentLoad?.kind === 'ACTIVE') {
    return {manifest: deploymentLoad.manifest, verification: deploymentLoad.verification, session: false};
  }
  return null;
}

function requireDeploymentAddress(): Address {
  const active = effectiveDeployment();
  if (!active) throw new Error('QIE Predict is not active yet. Deploy the contract from your wallet first.');
  return getAddress(active.manifest.address);
}

function requireSession(expectedAccount?: Address): WalletSession {
  if (!walletSession || walletSnapshot.phase !== 'ready' || !walletAccount()) {
    throw new Error('Connect your wallet on QIE Testnet (1983).');
  }
  if (expectedAccount && !sameAddress(walletAccount(), expectedAccount)) {
    throw new Error('Your wallet account changed. Review the transaction with the active account.');
  }
  return walletSession;
}

function dataId(el: HTMLElement): bigint {
  const raw = el.dataset.id;
  if (!raw || !/^\d+$/.test(raw)) throw new Error('Invalid market ID');
  return BigInt(raw);
}

function dataSide(el: HTMLElement): Side {
  if (el.dataset.side === '0') return 0;
  if (el.dataset.side === '1') return 1;
  throw new Error('Invalid stake side');
}

function dataOutcome(el: HTMLElement): 1 | 2 | 3 {
  const raw = el.dataset.outcome;
  if (raw === '1' || raw === '2' || raw === '3') return Number(raw) as 1 | 2 | 3;
  throw new Error('Invalid resolution outcome');
}

function showToast(message: string, tone: 'info' | 'ok' | 'warn' | 'err' = 'info'): void {
  const toast = ensureToast();
  toast.textContent = message;
  toast.className = `toast ${tone}`;
  toast.hidden = false;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => {
      toast.hidden = true;
    },
    tone === 'err' ? 10_000 : 6_000,
  );
}

function addressLink(address: string): string {
  return `<a class="mono" href="${F.addressUrl(address)}" target="_blank" rel="noopener noreferrer">${F.escapeHtml(
    F.shortAddress(address),
  )}</a>`;
}

function hashLink(hash: string, label?: string): string {
  return `<a class="mono" href="${F.txUrl(hash)}" target="_blank" rel="noopener noreferrer">${F.escapeHtml(
    label ?? F.shortAddress(hash, 10, 8),
  )}</a>`;
}

// --------------------------------------------------------------- data loading

async function bootLoad(): Promise<void> {
  await Promise.allSettled([loadWallets(), refreshNetwork(), loadDeployment()]);
  render();
}

async function loadWallets(): Promise<void> {
  walletsLoading = true;
  render();
  try {
    wallets = await discoverWallets();
  } catch (error) {
    wallets = [];
    showToast(`Could not discover wallets: ${F.errorMessage(error)}`, 'err');
  } finally {
    walletsLoading = false;
    render();
  }
}

async function refreshNetwork(): Promise<void> {
  const token = ++networkRequest;
  network = {status: 'checking', chainId: null, blockNumber: null, error: null};
  render();
  try {
    const chainId = await publicClient.getChainId();
    if (token !== networkRequest) return;
    if (chainId !== C.QIE_CHAIN_ID) {
      network = {status: 'mismatch', chainId, blockNumber: null, error: null};
      render();
      return;
    }
    const blockNumber = await readBlockNumber();
    if (token !== networkRequest) return;
    network = {status: 'ok', chainId, blockNumber, error: null};
  } catch (error) {
    if (token !== networkRequest) return;
    network = {status: 'error', chainId: null, blockNumber: null, error: F.errorMessage(error)};
  }
  render();
}

async function loadDeployment(): Promise<void> {
  const token = ++deploymentRequest;
  deploymentLoading = true;
  render();
  const result = await loadAndVerifyDeployment(C.QIE_DEPLOYMENT_URL);
  if (token !== deploymentRequest) return;
  deploymentLoad = result;
  deploymentLoading = false;
  if (!sessionDeployment) {
    stats = null;
    statsError = null;
  }
  invalidateMarkets();
  render();
}

async function refreshGlobalStats(): Promise<void> {
  const active = effectiveDeployment();
  if (!active) return;
  const token = ++statsRequest;
  try {
    const next = await readGlobalStats(getAddress(active.manifest.address));
    if (token !== statsRequest) return;
    stats = next;
    statsError = null;
  } catch (error) {
    if (token !== statsRequest) return;
    statsError = F.errorMessage(error);
  }
  renderFooterStats();
}

function invalidateMarkets(): void {
  marketsToken += 1;
  markets = null;
  marketsError = null;
  marketsLoading = false;
  marketsProgress = null;
  marketsPromise = null;
  currentDetail = null;
  invalidatePortfolio();
}

function invalidatePortfolio(): void {
  portfolioToken += 1;
  portfolioRows = null;
  portfolioError = null;
  portfolioLoading = false;
  portfolioProgress = {loaded: 0, total: 0};
  portfolioAccount = null;
  portfolioDeployment = null;
}

async function retry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 450));
    }
  }
  throw lastError;
}

async function ensureMarkets(onProgress?: () => void): Promise<void> {
  if (markets) {
    onProgress?.();
    return;
  }
  if (marketsPromise) {
    await marketsPromise;
    onProgress?.();
    return;
  }
  const active = effectiveDeployment();
  if (!active) return;

  const token = ++marketsToken;
  const address = getAddress(active.manifest.address);
  marketsLoading = true;
  marketsError = null;
  marketsProgress = {loaded: 0, total: 0};
  onProgress?.();

  const run = (async () => {
    try {
      const count = await retry(() => readMarketCount(address));
      if (token !== marketsToken) return;
      if (count === 0n) {
        markets = [];
        marketsProgress = {loaded: 0, total: 0};
        onProgress?.();
        return;
      }
      const total = Number(count);
      if (!Number.isSafeInteger(total)) throw new Error('marketCount exceeds the supported UI range');
      const collected: MarketRecord[] = [];
      const chunk = 6n;
      let high = count - 1n;
      while (high >= 0n) {
        const low = high >= chunk ? high - chunk + 1n : 0n;
        const items = await retry(() => readMarketRange(address, low, high));
        if (token !== marketsToken) return;
        collected.push(...items);
        marketsProgress = {loaded: collected.length, total};
        onProgress?.();
        if (low === 0n) break;
        high = low - 1n;
      }
      if (token !== marketsToken) return;
      markets = collected;
    } catch (error) {
      if (token === marketsToken) marketsError = F.errorMessage(error);
    } finally {
      if (token === marketsToken) {
        marketsLoading = false;
        marketsPromise = null;
      }
      onProgress?.();
    }
  })();

  marketsPromise = run;
  await run;
}

// --------------------------------------------------------------- shell / nav

function render(): void {
  const epoch = ++uiEpoch;
  if (currentModal && !modalBusy) {
    currentModal = null;
    modalError = '';
    renderModal();
  }
  currentDetail = null;
  app.innerHTML = shellHtml();
  renderRoute(epoch);
  renderTxDock();
  renderFooterStats();
}

function navLink(href: string, label: string, active: boolean): string {
  return `<a class="${active ? 'active' : ''}" href="${href}" ${active ? 'aria-current="page"' : ''}>${label}</a>`;
}

function shellHtml(): string {
  const listActive = route.name === 'list' || route.name === 'detail';
  const brand = `<span class="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M23 23a11 11 0 1 0-7 3h12l-7-7"/><path d="m10 18 5-6 4 3 5-7"/></svg></span><span class="brand-text">QIE<span>Predict</span></span>`;
  const links = [
    ['#/', 'Markets', 'grid', listActive],
    ['#/portfolio', 'Portfolio', 'wallet', route.name === 'portfolio'],
    ['#/watchlist', 'Watchlist', 'bookmark', route.name === 'watchlist'],
    ['#/create', 'Create market', 'plus', route.name === 'create'],
  ] as const;
  const primary = links.map(([href, label, glyph, active]) => navLink(href, `${icon(glyph, 20)}<span>${label}</span>`, active)).join('');
  return `
    <a href="#view" class="skip-link" data-action="skip-to-content">Skip to content</a>
    <aside class="sidebar">
      <a class="brand" href="#/" aria-label="QIE Predict home">${brand}</a>
      <div class="workspace-label">WORKSPACE <span>TESTNET</span></div>
      <nav class="sidebar-primary nav" aria-label="Main navigation">${primary}</nav>
      <div class="sidebar-section"><span class="nav-label">EXPLORE TOPICS</span><div class="category-nav sidebar-categories" role="group" aria-label="Market categories">${categoryNavHtml()}</div></div>
      <div class="sidebar-bottom">
        <nav class="sidebar-secondary" aria-label="Resources">${navLink('#/how-it-works', `${icon('help', 19)}<span>How it works</span>`, route.name === 'learn')}${navLink('#/resolver', `${icon('shield', 19)}<span>Resolve markets</span>`, route.name === 'resolver')}</nav>
        <a class="sidebar-network" href="${C.QIE_EXPLORER}" target="_blank" rel="noopener noreferrer"><span class="status-dot ${network.status === 'ok' ? 'connected' : ''}"></span><span>QIE Testnet<small>${network.status === 'ok' ? 'Network connected' : network.status === 'checking' ? 'Connecting to network…' : 'Network unavailable'}</small></span>${icon('external', 15)}</a>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <a class="brand mobile-brand" href="#/" aria-label="QIE Predict home">${brand}</a>
        <form id="search-form" class="search" role="search">${icon('search', 20)}<input id="list-search" type="search" placeholder="Search markets, topics, questions…" autocomplete="off" value="${F.escapeHtml(listState.query)}" aria-label="Search markets" /><kbd>/</kbd></form>
        <div class="header-actions"><span class="network-pill"><span class="status-dot ${network.status === 'ok' ? 'connected' : ''}"></span> QIE Testnet</span><div class="wallet-panel">${walletPanelHtml()}</div></div>
      </header>
      <div class="shell">${networkBannerHtml()}${deploymentBannerHtml()}<main id="view" class="view" tabindex="-1"></main>
        <footer class="footer"><div><span class="footer-wordmark">QIE Predict</span><span>Prediction markets on QIE.</span></div><div class="footer-links"><a href="#/how-it-works">How it works</a><a class="mobile-resource" href="#/resolver">Resolve markets</a><a href="#/network">Network status</a><a href="${C.QIE_EXPLORER}" target="_blank" rel="noopener noreferrer">Explorer ${icon('external', 13)}</a><span id="footer-stats" class="footer-stats"></span><span class="testnet-label">TESTNET · 1983</span></div></footer>
      </div>
    </div>
    <nav class="mobile-nav" aria-label="Mobile navigation">${primary}</nav>`;
}

function walletPanelHtml(): string {
  if (walletSnapshot.phase === 'ready') {
    return `<div class="wallet-ready"><span class="wallet-account">${icon('wallet', 17)} ${F.escapeHtml(F.shortAddress(walletSnapshot.account ?? ''))}</span>
      <button class="icon-btn" type="button" data-action="disconnect" aria-label="Disconnect wallet" title="Disconnect wallet">${icon('close', 16)}</button></div>`;
  }
  if (walletSnapshot.phase === 'connecting') return `<button class="btn primary wallet-button" type="button" disabled><span class="spinner"></span> Connecting…</button>`;
  if (walletSnapshot.phase === 'wrong-chain') {
    return `<button class="btn wallet-wrong" type="button" data-action="refresh-chain" title="${F.escapeHtml(walletErrorText(walletSnapshot.error))}">${icon('wallet', 17)} Switch to Testnet</button>`;
  }
  if (wallets.length > 0) {
    const primary = wallets[0]!;
    const button = (wallet: WalletInfo) => `<button class="btn primary wallet-button" type="button" data-action="connect" data-uuid="${F.escapeHtml(wallet.uuid)}" title="${F.escapeHtml(wallet.name)}">${icon('wallet', 17)} <span>Connect wallet</span></button>`;
    return wallets.length === 1 ? button(primary) : `<div class="wallet-options">${button(primary)}<details><summary aria-label="Choose another wallet">⌄</summary><div class="wallet-menu">${wallets.slice(1).map((wallet) => `<button class="btn" type="button" data-action="connect" data-uuid="${F.escapeHtml(wallet.uuid)}">${F.escapeHtml(wallet.name)}</button>`).join('')}</div></details></div>`;
  }
  return `<button class="btn primary wallet-button" type="button" data-action="connect-first">${icon('wallet', 17)} <span>Connect wallet</span></button>`;
}

function networkBannerHtml(): string {
  if (network.status === 'checking' || network.status === 'ok') return '';
  const title = QIE_RPC_IS_OVERRIDE ? 'Custom endpoint' : QIE_RPC_URLS.map(shortRpcLabel).join(', ');
  return `<div class="banner connection-notice" role="status" title="${F.escapeHtml(title)}">${icon('globe', 16)}
    <span>${network.status === 'mismatch' ? 'Connected to a different network. Switch to QIE Testnet to transact.' : 'QIE is currently unavailable. You can still browse ideas and prepare a market.'}</span>
    <button class="text-btn" type="button" data-action="refresh-network">Try again ${icon('refresh', 14)}</button></div>`;
}

function deploymentBannerHtml(): string {
  if (sessionDeployment) return `<div class="banner session-notice" role="status">${icon('shield', 16)}<span>You’re using a temporary platform connection in this tab.</span><a href="#/network">Connection details ${icon('arrow', 14)}</a></div>`;
  if (!deploymentLoad || deploymentLoading || deploymentLoad.kind === 'ACTIVE' || deploymentLoad.kind === 'NOT_DEPLOYED') return '';
  return `<div class="banner connection-notice" role="status">${icon('shield', 16)}<span>We couldn’t verify the platform connection. Transactions are temporarily unavailable.</span><a href="#/network">Check connection ${icon('arrow', 14)}</a></div>`;
}

// -------------------------------------------------------------------- routing

function renderRoute(epoch: number): void {
  if (route.name === 'list' || route.name === 'watchlist') return renderListPage(epoch);
  if (route.name === 'detail') return renderDetailPage(epoch, route.id);
  if (route.name === 'create') return renderCreatePage();
  if (route.name === 'portfolio') return renderPortfolioPage(epoch);
  if (route.name === 'resolver') return renderResolverPage(epoch);
  if (route.name === 'learn') return renderLearnPage();
  if (route.name === 'developer') return renderDeveloperPage();
  renderDeployPage();
}

// ----------------------------------------------------------------- list page

function renderListPage(epoch: number): void {
  const view = document.getElementById('view');
  if (!view) return;
  const saved = route.name === 'watchlist';
  view.innerHTML = `
    <section class="page-head page-head-split discovery-heading"><div><div class="eyebrow">${saved ? 'YOUR COLLECTION' : 'THE WORLD, UP FOR DISCUSSION'}</div><h1>${saved ? 'Watchlist' : 'Markets'}<span class="heading-dot">.</span></h1><p>${saved ? 'The questions you want to keep an eye on.' : 'Find your next conviction. Explore a question. Pick a side.'}</p></div><a class="btn primary create-cta" href="#/create">${icon('plus', 18)} Create market</a></section>
    ${saved ? '' : `<section class="collections" aria-label="Explore featured topics">${featuredHtml()}</section>`}
    <div class="discovery-nav"><div class="category-nav mobile-categories" role="group" aria-label="Browse topics">${categoryNavHtml()}</div></div>
    <section class="markets-section" aria-labelledby="markets-heading">
      <div class="market-section-heading ${effectiveDeployment() ? '' : 'templates-heading'}"><div class="section-tabs"><h2 id="markets-heading" tabindex="-1">${saved ? 'Saved markets' : 'All markets'}</h2><span class="section-tab-note">${saved ? 'Stored on this device' : 'Discover what’s next'}</span></div><div class="market-toolbar">${effectiveDeployment() ? `<select id="list-phase" aria-label="Filter status">${phaseOption('ALL', 'All statuses')}${phaseOption('OPEN', 'Open')}${phaseOption('AWAITING_RESOLUTION', 'Awaiting result')}${phaseOption('EXPIRED_UNRESOLVED', 'Expired')}${phaseOption('RESOLVED', 'Resolved')}</select><select id="list-sort" aria-label="Sort markets"><option value="newest" ${listState.sort === 'newest' ? 'selected' : ''}>Newest</option><option value="closing" ${listState.sort === 'closing' ? 'selected' : ''}>Closing soon</option><option value="pool" ${listState.sort === 'pool' ? 'selected' : ''}>Largest pool</option></select>` : ''}<button class="icon-btn refresh-button" type="button" data-action="refresh-markets" aria-label="Refresh markets" title="Refresh markets">${icon('refresh', 18)}</button></div></div>
      <div id="list-progress" class="progress-text" role="status" aria-live="polite"></div><div id="list-results" class="market-list"></div>
    </section>
    ${saved ? '' : `<section class="community-callout"><span class="callout-icon">${icon('plus', 25)}</span><div><h2>A question worth asking?</h2><p>Set the rules, choose a resolver, and open a market.</p></div><a class="btn" href="#/create">Create a market ${icon('arrow', 17)}</a></section>`}`;
  renderListResults();
  void loadList(epoch);
}

function phaseOption(value: ListPhase, label: string): string {
  return `<option value="${value}" ${listState.phase === value ? 'selected' : ''}>${label}</option>`;
}

async function loadList(epoch: number): Promise<void> {
  if (network.status !== 'ok') {
    renderListResults();
    return;
  }
  if (!effectiveDeployment()) {
    renderListResults();
    return;
  }
  await ensureMarkets(() => {
    if (epoch === uiEpoch) renderListResults();
  });
  if (epoch !== uiEpoch) return;
  renderListResults();
  if (!stats && !statsError) void refreshGlobalStats();
}

function filteredMarkets(): MarketRecord[] {
  const query = listState.query.trim().toLocaleLowerCase('en-US');
  const current = F.nowSec();
  const address = effectiveDeployment()?.manifest.address;
  const result = (markets ?? []).filter((market) => {
    if (query && !`${market.question} ${market.criteria} ${market.source}`.toLocaleLowerCase('en-US').includes(query)) return false;
    if (listState.category !== 'all' && categoryForQuestion(market.question) !== listState.category) return false;
    if (route.name === 'watchlist' && (!address || !bookmarks.has(marketBookmarkKey(address, market.id)))) return false;
    return listState.phase === 'ALL' || F.marketPhase(market, current) === listState.phase;
  });
  if (listState.sort === 'closing') result.sort((a, b) => a.closeTime < b.closeTime ? -1 : a.closeTime > b.closeTime ? 1 : 0);
  else if (listState.sort === 'pool') result.sort((a, b) => a.yesStake + a.noStake > b.yesStake + b.noStake ? -1 : a.yesStake + a.noStake < b.yesStake + b.noStake ? 1 : 0);
  else result.sort((a, b) => a.id > b.id ? -1 : 1);
  return result;
}

function renderListResults(): void {
  const results = document.getElementById('list-results');
  if (!results) return;
  const heading = document.getElementById('markets-heading');
  if (heading) heading.textContent = route.name === 'watchlist' ? 'Saved markets'
    : listState.query.trim() ? 'Search results'
    : listState.category === 'all' ? 'All markets'
    : `${CATEGORIES.find((item) => item.id === listState.category)?.label ?? 'All'} markets`;
  const progress = document.getElementById('list-progress');
  const feature = document.getElementById('featured-market');
  if (feature) feature.innerHTML = featuredHtml();
  if (progress) {
    progress.innerHTML = marketsLoading ? `<span class="spinner"></span> Loading markets${marketsProgress?.total ? ` ${marketsProgress.loaded}/${marketsProgress.total}` : ''}…` : '';
  }
  if (!effectiveDeployment() || network.status !== 'ok') {
    results.innerHTML = ideasHtml();
    return;
  }
  if (marketsError) {
    results.innerHTML = `<div class="inline-empty" role="status">${icon('refresh', 24)}<div><h3>Could not load markets</h3><p>${F.escapeHtml(marketsError)}</p></div><button class="btn" type="button" data-action="refresh-markets">Try again</button></div>${ideasHtml()}`;
    return;
  }
  if (!markets) {
    results.innerHTML = `<div class="market-grid" aria-label="Loading markets">${Array.from({length: 6}, () => '<div class="market-skeleton" aria-hidden="true"><i></i><b></b><b></b><span></span></div>').join('')}</div>`;
    return;
  }
  if (markets.length === 0) {
    results.innerHTML = `${route.name === 'watchlist' ? '' : `<div class="inline-empty">${icon('sparkles', 28)}<div><h3>Open the first market.</h3><p>There are no markets on this platform yet. Start one with your own question.</p></div><a class="btn primary" href="#/create">Create market</a></div>`}${ideasHtml()}`;
    return;
  }
  const filtered = filteredMarkets();
  const savedIdeas = route.name === 'watchlist' ? filterIdeas(listState.query, listState.category).filter((idea) => bookmarks.has(`idea:${idea.id}`)) : [];
  const totalPages = Math.max(1, Math.ceil(filtered.length / listState.pageSize));
  listState.page = Math.min(Math.max(listState.page, 0), totalPages - 1);
  const start = listState.page * listState.pageSize;
  const pageItems = filtered.slice(start, start + listState.pageSize);
  if (filtered.length === 0 && savedIdeas.length === 0) {
    results.innerHTML = emptyDiscoveryHtml();
    return;
  }
  results.innerHTML = `<div class="list-meta"><span>${filtered.length} market${listState.query ? ` matching “${F.escapeHtml(listState.query)}”` : ''}</span><span><span class="status-dot connected"></span> Data from QIE Testnet</span></div>
    <div class="market-grid">${pageItems.map(marketCardHtml).join('')}${savedIdeas.map(ideaCardHtml).join('')}</div>
    ${totalPages > 1 ? `<div class="pagination"><button class="btn" type="button" data-action="list-prev" ${listState.page === 0 ? 'disabled' : ''}>← Previous</button><span>Page ${listState.page + 1} of ${totalPages}</span><button class="btn" type="button" data-action="list-next" ${listState.page + 1 >= totalPages ? 'disabled' : ''}>Next →</button></div>` : ''}`;
}

function blockedCard(message: string): string {
  return `<div class="card empty-state"><h2>Network verification required</h2><p class="muted">${F.escapeHtml(
    message,
  )}</p><button class="btn" type="button" data-action="refresh-network">Verify again</button></div>`;
}

function marketCardHtml(market: MarketRecord): string {
  const phase = F.marketPhase(market);
  const total = market.yesStake + market.noStake;
  const yesBps = F.poolShareBps(market.yesStake, total);
  const category = CATEGORIES.find((item) => item.id === categoryForQuestion(market.question))!;
  const address = effectiveDeployment()?.manifest.address;
  const key = address ? marketBookmarkKey(address, market.id) : '';
  return `<article class="market-card phase-${F.phaseTone(phase)}">
    <div class="market-card-top"><span class="topic-icon topic-${category.id}">${icon(category.icon, 24)}</span><span class="market-category">${category.label}</span>${bookmarkButtonHtml(key)}</div>
    <a class="market-question" href="#/market/${market.id}"><h3>${F.escapeHtml(market.question)}</h3></a>
    <div class="market-status"><span class="status-dot ${phase === 'OPEN' ? 'connected' : ''}"></span>${F.phaseLabel(phase)}<span class="market-number">#${market.id}</span></div>
    <div class="market-outcomes"><button class="outcome yes" type="button" data-action="view-market" data-id="${market.id}" data-side="0"><span>YES ${icon('arrow', 14)}</span><strong>${F.formatBps(yesBps)}</strong></button>
      <button class="outcome no" type="button" data-action="view-market" data-id="${market.id}" data-side="1"><span>NO ${icon('arrow', 14)}</span><strong>${F.formatBps(F.poolShareBps(market.noStake, total))}</strong></button></div>
    <div class="pool-share-note">${total > 0n ? 'Current pool share · not probability' : 'No stakes in this pool yet'}</div>
    ${resolvedTagHtml(market)}
    <div class="market-card-foot"><span>${icon('chart', 14)} ${F.formatQie(total)} QIE in pool</span><span title="${F.formatDateTime(market.closeTime)}">${icon('clock', 14)} Closes ${F.formatDateTime(market.closeTime)}</span></div>
  </article>`;
}

function resolvedTagHtml(market: MarketRecord): string {
  if (market.cancelled) return `<div class="resolved-tag warn">CANCELLED — REFUNDS AVAILABLE</div>`;
  if (market.outcome === 3) return `<div class="resolved-tag warn">INVALID — REFUNDS AVAILABLE</div>`;
  if (market.outcome === 1 || market.outcome === 2) {
    const winner = F.outcomeLabel(market.outcome);
    return `<div class="resolved-tag done">${winner}${market.refundable ? ' · NO WINNING STAKES · REFUND' : ''}</div>`;
  }
  return '';
}

// ---------------------------------------------------------------- detail page

function renderDetailPage(epoch: number, id: bigint): void {
  const view = document.getElementById('view');
  if (!view) return;
  view.innerHTML = `
    <div id="detail-body"><div class="breadcrumbs"><a href="#/">← All markets</a><span>#${id.toString()}</span></div><div class="card"><span class="spinner"></span> Loading markets #${id.toString()}…</div></div>
  `;
  void loadDetail(epoch, id);
}

async function loadDetail(epoch: number, id: bigint): Promise<void> {
  const body = document.getElementById('detail-body');
  if (!body) return;
  if (network.status !== 'ok') {
    body.innerHTML = blockedCard('QIE Testnet RPC has not been verified.');
    return;
  }
  const active = effectiveDeployment();
  if (!active) {
    body.innerHTML = `
      <div class="card empty-state">
        <h2>Contract not active</h2>
        <p class="muted">Markets become available after a deployment passes verification.</p>
        <a class="btn primary" href="#/network">Check connection</a>
      </div>
    `;
    return;
  }
  const address = getAddress(active.manifest.address);
  try {
    const market = await retry(() => readMarket(address, id));
    const account = walletAccount();
    let accountState: MarketAccountState | null = null;
    let balance: bigint | null = null;
    if (account) {
      const [state, nativeBalance] = await Promise.all([
        readMarketAccountState(address, id, account),
        readNativeBalance(account),
      ]);
      accountState = state;
      balance = nativeBalance;
    }
    if (epoch !== uiEpoch) return;
    currentDetail = {market, accountState, balance};
    body.innerHTML = detailHtml(market, accountState, balance);
    updateStakeEstimate();
    if (!stats && !statsError) void refreshGlobalStats();
  } catch (error) {
    if (epoch !== uiEpoch) return;
    body.innerHTML = `
      <div class="card empty-state">
        <h2>Could not read market</h2>
        <p class="err">${F.escapeHtml(F.contractErrorText(F.errorMessage(error)))}</p>
        <div class="row"><a class="btn" href="#/">Back</a><button class="btn" type="button" data-action="refresh-detail">Try again</button></div>
      </div>
    `;
  }
}

function detailHtml(market: MarketRecord, state: MarketAccountState | null, balance: bigint | null): string {
  const phase = F.marketPhase(market);
  const total = market.yesStake + market.noStake;
  const yesBps = F.poolShareBps(market.yesStake, total);
  const category = CATEGORIES.find((item) => item.id === categoryForQuestion(market.question))!;
  return `<div class="breadcrumbs"><a href="#/">Explore</a>${icon('chevron', 13)}<span>${category.label}</span>${icon('chevron', 13)}<span>Market #${market.id}</span></div>
    <section class="detail-head"><div class="row"><span class="topic-icon topic-${category.id}">${icon(category.icon, 22)}</span><span class="tag ${F.phaseTone(phase)}">${F.phaseLabel(phase)}</span><span class="muted">${category.label}</span></div>
      <h1>${F.escapeHtml(market.question)}</h1>${resolvedTagHtml(market)}
      <div class="detail-byline">Created by ${addressLink(market.creator)} <span>·</span> Resolver ${addressLink(market.resolver)}</div></section>
    <div class="detail-layout"><div class="detail-main">
      <section class="card pool-card"><div class="row space"><div><div class="eyebrow">MARKET OVERVIEW</div><h2>Pool composition</h2></div><span class="mono">${F.formatQie(total)} QIE</span></div>
        <div class="pool-labels large"><span><b class="yes-text">YES</b><strong>${F.formatBps(yesBps)}</strong></span><span><b class="no-text">NO</b><strong>${F.formatBps(F.poolShareBps(market.noStake, total))}</strong></span></div>
        <div class="pool-bar ${total === 0n ? 'is-empty' : ''}"><span class="yes" style="width:${yesBps === null ? 0 : yesBps / 100}%"></span></div>
        <div class="pool-labels"><span>${F.formatQie(market.yesStake)} QIE on YES</span><span>${F.formatQie(market.noStake)} QIE on NO</span></div>
        <p class="hint">Percentages show pool share, not probability. Payouts depend on the final pool when the result is set.</p>
        <div class="stat-grid"><div><span>Funds in escrow</span><strong>${F.formatQie(market.remainingEscrow)} QIE</strong></div><div><span>Paid out</span><strong>${F.formatQie(market.paidOut)} QIE</strong></div><div><span>Refund</span><strong>${market.refundable ? 'Available' : 'Unavailable'}</strong></div></div>
      </section>
      <section class="card market-rules"><div class="section-label">${icon('shield', 19)}<h2>Rules &amp; resolution</h2></div><h3>What determines the result?</h3><div class="prewrap">${F.escapeHtml(market.criteria)}</div><h3>Reference source</h3>${sourceHtml(market.source)}
        <div class="resolution-timeline"><div>${icon('clock', 18)}<span>Staking closes<strong>${F.formatDateTime(market.closeTime)}</strong></span></div><div>${icon('check', 18)}<span>Resolution deadline<strong>${F.formatDateTime(market.resolveDeadline)}</strong></span></div></div>
        <p class="hint">The resolver sets the result once. If the deadline passes without a result, anyone can cancel the market and enable refunds.</p></section>
      <section class="card"><div class="section-label">${icon('wallet', 19)}<h2>Your position</h2></div>${positionHtml(market, state, balance)}</section>
    </div><aside class="trade-sidebar">${actionPanelHtml(market, state, balance)}<div class="trade-trust">${icon('shield', 16)}<span>Stakes are held in the contract.<br />You approve transactions in your wallet.</span></div></aside></div>
    <details class="payout-disclosure"><summary>How are payouts calculated?</summary><p>Payout = your winning stake × total pool ÷ total winning stake, rounded down. Rounding dust stays in escrow. Losing stakes are not returned after a valid result. An INVALID result, cancellation, or a winning side with no stakes enables full refunds.</p></details>`;
}

function sourceHtml(source: string): string {
  const trimmed = source.trim();
  const link = /^https?:\/\//i.test(trimmed)
    ? `<div>${F.externalLink(trimmed, 'Open source in a new tab', trimmed)}</div>`
    : '';
  return `<div class="prewrap">${F.escapeHtml(source)}</div>${link}`;
}

function positionHtml(market: MarketRecord, state: MarketAccountState | null, balance: bigint | null): string {
  if (!walletAccount()) {
    return `<p class="muted">Connect your QIE wallet to view your position and available actions.</p>`;
  }
  if (!state) return `<p class="muted">Position data is unavailable.</p>`;
  const settled = state.position.settled;
  return `
    <div class="stat-grid">
      <div><span>Stake YES</span><strong class="yes-text">${F.formatQie(state.position.yes)} QIE</strong></div>
      <div><span>Stake NO</span><strong class="no-text">${F.formatQie(state.position.no)} QIE</strong></div>
      <div><span>Position status</span><strong>${settled ? 'Settled' : 'Open'}</strong></div>
      <div><span>Wallet balance</span><strong>${balance === null ? '—' : `${F.formatQie(balance)} QIE`}</strong></div>
      <div><span>Projected payout</span><strong>${F.formatQie(state.projectedPayout)} QIE</strong></div>
      <div><span>Projected refund</span><strong>${F.formatQie(state.projectedRefund)} QIE</strong></div>
    </div>
    <p class="hint">Projections use current contract data. Your final payout is calculated when your claim executes.</p>
  `;
}

// -------------------------------------------------------------- action panels

function actionPanelHtml(market: MarketRecord, state: MarketAccountState | null, balance: bigint | null): string {
  if (network.status !== 'ok') {
    return `<div class="card action-card"><h2>Actions</h2><p class="muted">QIE Testnet RPC has not been verified. Actions are unavailable.</p></div>`;
  }
  const account = walletAccount();
  if (!account) {
    return `<section class="card action-card connect-trade"><span class="empty-icon">${icon('wallet', 30)}</span><h2>What’s your prediction?</h2><p>Connect your QIE wallet, pick YES or NO, and make your first prediction.</p><button class="btn primary" type="button" data-action="connect-first">${icon('wallet', 17)} Connect wallet</button></section>`;
  }
  const phase = F.marketPhase(market);
  if (phase === 'OPEN') return stakePanelHtml(market, balance);
  if (phase === 'AWAITING_RESOLUTION') {
    if (sameAddress(market.resolver, account)) return resolvePanelHtml(market);
    return `
      <div class="card action-card">
        <h2>Awaiting resolver</h2>
        <p class="muted">Resolver <span class="mono">${F.escapeHtml(market.resolver)}</span> can set the outcome during the resolution window. Resolution is manual.</p>
      </div>
    `;
  }
  if (phase === 'EXPIRED_UNRESOLVED') return cancelPanelHtml(market);
  if (!state) return `<div class="card action-card"><h2>Actions</h2><p class="muted">Position data is unavailable.</p></div>`;
  if (state.position.settled) {
    return `<div class="card action-card"><h2>Resolved</h2><p class="muted">Your position has been settled. There are no remaining actions.</p></div>`;
  }
  if (market.refundable && state.projectedRefund > 0n) return refundPanelHtml(market, state);
  const winningSide = market.outcome === 1 ? 0 : market.outcome === 2 ? 1 : null;
  const userWinning = winningSide === 0 ? state.position.yes : winningSide === 1 ? state.position.no : 0n;
  if (userWinning > 0n && state.projectedPayout > 0n) return claimPanelHtml(market, state);
  if (state.position.yes > 0n || state.position.no > 0n) {
    return `
      <div class="card action-card">
        <h2>Nothing to claim</h2>
        <p class="muted">Your stake is on the losing side. Losing stakes cannot be refunded after a valid result.</p>
      </div>
    `;
  }
  return `<div class="card action-card"><h2>Actions</h2><p class="muted">You have no position in this market.</p></div>`;
}

function stakePanelHtml(market: MarketRecord, balance: bigint | null): string {
  return `<section class="card action-card stake-card"><div class="eyebrow">YOUR PREDICTION</div><h2>Make a prediction</h2><p class="muted">How do you think this plays out?</p>
    <form id="stake-form" novalidate><label for="stake-amount">Stake amount</label><div class="stake-input-wrap"><input id="stake-amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" /><strong>QIE</strong></div>
      <div class="amount-shortcuts">${['1', '5', '10', '25'].map((amount) => `<button type="button" data-action="stake-amount" data-amount="${amount}">${amount} QIE</button>`).join('')}</div>
      <div class="available-balance">Available balance <strong>${balance === null ? '—' : `${F.formatQie(balance)} QIE`}</strong></div>
      <div class="stake-outcomes"><button class="btn yes ${preferredStakeSide === 0 ? 'preferred' : ''}" type="button" data-action="stake-review" data-side="0" data-id="${market.id}">YES ${icon('arrow', 17)}</button><button class="btn no ${preferredStakeSide === 1 ? 'preferred' : ''}" type="button" data-action="stake-review" data-side="1" data-id="${market.id}">NO ${icon('arrow', 17)}</button></div>
      <div id="stake-estimate" class="stake-estimate" aria-live="polite">Enter an amount to preview your potential payout.</div>
      <p class="hint">Estimates can change. Gas is paid separately. If your side loses, your stake is not returned.</p>
    </form></section>`;
}

function resolvePanelHtml(market: MarketRecord): string {
  return `
    <div class="card action-card">
      <h2>Resolver panel</h2>
      <p class="muted">You are this market’s resolver. The outcome is final. An INVALID result enables full refunds.</p>
      <div class="row">
        <button class="btn yes" type="button" data-action="resolve-review" data-outcome="1" data-id="${market.id}">Resolve YES</button>
        <button class="btn no" type="button" data-action="resolve-review" data-outcome="2" data-id="${market.id}">Resolve NO</button>
        <button class="btn danger" type="button" data-action="resolve-review" data-outcome="3" data-id="${market.id}">Resolve INVALID</button>
      </div>
    </div>
  `;
}

function cancelPanelHtml(market: MarketRecord): string {
  return `
    <div class="card action-card">
      <h2>Cancel market</h2>
      <p class="muted">The resolution window has expired. Anyone can cancel an unresolved market. Cancellation enables full refunds for all positions.</p>
      <button class="btn danger" type="button" data-action="cancel-review" data-id="${market.id}">Cancel market</button>
    </div>
  `;
}

function claimPanelHtml(market: MarketRecord, state: MarketAccountState): string {
  return `
    <div class="card action-card">
      <h2>Claim payout</h2>
      <p>Available payout: <strong>${F.formatQie(state.projectedPayout)} QIE</strong>.</p>
      <label for="recipient-input">Recipient (optional)</label>
      <input id="recipient-input" type="text" autocomplete="off" spellcheck="false"
        placeholder="0x… — leave blank to send to your wallet" />
      <p class="hint">Only the entitled account can call claim/claimTo. The recipient cannot be the zero address or the market contract.</p>
      <button class="btn primary" type="button" data-action="claim-review" data-id="${market.id}">Review claim</button>
    </div>
  `;
}

function refundPanelHtml(market: MarketRecord, state: MarketAccountState): string {
  return `
    <div class="card action-card">
      <h2>Refund</h2>
      <p>Available refund: <strong>${F.formatQie(state.projectedRefund)} QIE</strong> (YES + NO).</p>
      <label for="recipient-input">Recipient (optional)</label>
      <input id="recipient-input" type="text" autocomplete="off" spellcheck="false"
        placeholder="0x… — leave blank to send to your wallet" />
      <p class="hint">Refunds are enabled for INVALID results, cancelled markets, or an empty winning side. The recipient cannot be the zero address or the market contract.</p>
      <button class="btn primary" type="button" data-action="refund-review" data-id="${market.id}">Review refund</button>
    </div>
  `;
}

function updateStakeEstimate(): void {
  const el = document.getElementById('stake-estimate');
  if (!el || !currentDetail) return;
  const input = document.getElementById('stake-amount');
  if (!(input instanceof HTMLInputElement)) return;
  const text = input.value.trim();
  if (!text) {
    el.textContent = 'Enter an amount to preview your potential payout.';
    return;
  }
  try {
    const amount = F.parseQie(text);
    if (amount <= 0n) {
      el.textContent = 'Amount must be greater than zero.';
      return;
    }
    const yesPayout = F.estimatePayoutForStake(
      currentDetail.market.yesStake,
      currentDetail.market.noStake,
      0,
      amount,
    );
    const noPayout = F.estimatePayoutForStake(
      currentDetail.market.yesStake,
      currentDetail.market.noStake,
      1,
      amount,
    );
    let html = `Current estimate — if YES wins: <strong>${F.formatQie(
      yesPayout,
    )} QIE</strong> · if NO wins: <strong>${F.formatQie(noPayout)} QIE</strong>.`;
    if (currentDetail.balance !== null && amount > currentDetail.balance) {
      html += `<br /><span class="err">Amount exceeds your wallet balance (${F.formatQie(currentDetail.balance)} QIE); excluding gas.</span>`;
    }
    el.innerHTML = html;
  } catch (error) {
    el.textContent = F.errorMessage(error);
  }
}

// ----------------------------------------------------------------- create page

function renderCreatePage(): void {
  const view = document.getElementById('view');
  if (!view) return;
  const canPublish = network.status === 'ok' && !!effectiveDeployment() && !!walletAccount();
  view.innerHTML = `<div class="breadcrumbs"><a href="#/">Explore</a>${icon('chevron', 13)}<span>Create market</span></div>
    <section class="page-head"><div class="eyebrow">CREATE A MARKET</div><h1>Start with a question.</h1><p class="muted">Ask a clear question. Define the rules. Let the market take a view.</p></section>
    <div class="create-layout"><form id="create-form" class="card form create-form" novalidate><div id="create-errors" class="form-errors" role="alert" hidden></div>
      <div class="form-section-title"><span>01</span><h2>The question</h2></div>
      <label for="create-question">Market question <span id="counter-question" class="counter">0/280 byte</span></label><input id="create-question" data-create-field="question" type="text" autocomplete="off" value="${F.escapeHtml(draft.question)}" placeholder="Will Bitcoin reach $120,000 in the next 30 days?" required /><p class="hint">Use a question that can be answered YES or NO.</p>
      <label for="create-criteria">Resolution criteria <span id="counter-criteria" class="counter">0/2000 byte</span></label><textarea id="create-criteria" data-create-field="criteria" rows="5" placeholder="Define exactly what counts as YES, NO, or INVALID." required>${F.escapeHtml(draft.criteria)}</textarea>
      <label for="create-source">Information source <span id="counter-source" class="counter">0/512 byte</span></label><textarea id="create-source" data-create-field="source" rows="2" placeholder="A link or official source used to verify the result." required>${F.escapeHtml(draft.source)}</textarea>
      <div class="form-section-title"><span>02</span><h2>The timeline</h2></div><div class="grid-2"><div><label for="create-close">Staking closes</label><input id="create-close" data-create-field="closeTime" type="datetime-local" value="${F.escapeHtml(draft.closeTime)}" required /><p class="hint">No new stakes are accepted after this time.</p></div><div><label for="create-deadline">Resolution deadline</label><input id="create-deadline" data-create-field="resolveDeadline" type="datetime-local" value="${F.escapeHtml(draft.resolveDeadline)}" required /><p class="hint">Allow enough time to verify the result.</p></div></div>
      <div class="form-section-title"><span>03</span><h2>Who will confirm the result?</h2></div><label for="create-resolver">Resolver wallet address</label><div class="row resolver-input"><input id="create-resolver" data-create-field="resolver" type="text" autocomplete="off" spellcheck="false" value="${F.escapeHtml(draft.resolver)}" placeholder="0x…" required /><button class="btn" type="button" data-action="use-my-address">Use my address</button></div><p class="hint">This person is called the resolver. They check the source and confirm YES, NO, or INVALID after the market closes. You can choose your own wallet.</p>
      ${!canPublish ? `<div class="form-connection-note">${icon('wallet', 18)}<div><strong>You can prepare your draft now.</strong><p>${!effectiveDeployment() ? 'The platform connection needs to be verified before publishing.' : !walletAccount() ? 'Connect your QIE wallet to publish.' : 'Wait for the QIE Testnet connection to be verified.'}</p></div>${!effectiveDeployment() ? '<a href="#/network">Check connection →</a>' : !walletAccount() ? '<button class="text-btn" type="button" data-action="connect-first">Connect →</button>' : '<button class="text-btn" type="button" data-action="refresh-network">Check connection →</button>'}</div>` : ''}
      <div class="form-submit-row"><button class="btn primary" type="submit">Review market ${icon('arrow', 18)}</button><button class="text-btn" type="button" data-action="reset-create">Start over</button></div>
    </form><aside class="create-aside"><div class="aside-number">?</div><h2>Good markets start<br />with clear rules.</h2><p>Everyone should understand exactly how the result will be determined.</p><ul class="creation-checklist"><li>${icon('check', 16)} An objective, measurable question</li><li>${icon('check', 16)} A verifiable source</li><li>${icon('check', 16)} A clear closing time</li><li>${icon('check', 16)} A resolver you trust</li></ul><div class="aside-note">${icon('shield', 20)}<p>The question, rules, times, and resolver cannot be changed after publication.</p></div><a class="text-btn" href="#/how-it-works">Learn how it works ${icon('arrow', 15)}</a></aside></div>`;
  updateCreateCounters();
}

function updateCreateCounters(): void {
  updateCounter('counter-question', draft.question, C.QIE_MAX_QUESTION_BYTES);
  updateCounter('counter-criteria', draft.criteria, C.QIE_MAX_CRITERIA_BYTES);
  updateCounter('counter-source', draft.source, C.QIE_MAX_SOURCE_BYTES);
}

function updateCounter(id: string, value: string, maximum: number): void {
  const el = document.getElementById(id);
  if (!el) return;
  const bytes = F.utcByteLength(value);
  el.textContent = `${bytes}/${maximum} byte`;
  el.classList.toggle('over', bytes > maximum);
}

type CreateValidation =
  | {ok: true; input: CreateMarketInput}
  | {ok: false; errors: string[]};

function validateCreateDraft(): CreateValidation {
  const errors: string[] = [];
  const question = draft.question.trim();
  const criteria = draft.criteria.trim();
  const source = draft.source.trim();
  const resolverText = draft.resolver.trim();

  if (question.length === 0) errors.push('Enter a market question.');
  else if (F.utcByteLength(question) > C.QIE_MAX_QUESTION_BYTES) {
    errors.push(`Question ${F.utcByteLength(question)} byte; maximum ${C.QIE_MAX_QUESTION_BYTES} byte.`);
  }
  if (criteria.length === 0) errors.push('Enter resolution criteria.');
  else if (F.utcByteLength(criteria) > C.QIE_MAX_CRITERIA_BYTES) {
    errors.push(`Criteria ${F.utcByteLength(criteria)} byte; maximum ${C.QIE_MAX_CRITERIA_BYTES} byte.`);
  }
  if (source.length === 0) errors.push('Enter an information source.');
  else if (F.utcByteLength(source) > C.QIE_MAX_SOURCE_BYTES) {
    errors.push(`Source ${F.utcByteLength(source)} byte; maximum ${C.QIE_MAX_SOURCE_BYTES} byte.`);
  }

  let resolver: Address | null = null;
  if (!isAddress(resolverText)) {
    errors.push('Enter a valid 0x… resolver address.');
  } else if (F.isZeroAddress(resolverText)) {
    errors.push('The resolver cannot be the zero address.');
  } else {
    try {
      resolver = getAddress(resolverText);
      const active = effectiveDeployment();
      if (active && sameAddress(resolver, active.manifest.address)) {
        errors.push('The resolver cannot be the market contract.');
        resolver = null;
      }
    } catch {
      errors.push('The resolver address has an invalid checksum.');
    }
  }

  const closeDate = new Date(draft.closeTime);
  const deadlineDate = new Date(draft.resolveDeadline);
  const closeMs = closeDate.getTime();
  const deadlineMs = deadlineDate.getTime();
  let closeTime: bigint | null = null;
  let resolveDeadline: bigint | null = null;

  if (!Number.isFinite(closeMs)) errors.push('Invalid closing time.');
  else {
    closeTime = BigInt(Math.floor(closeMs / 1000));
    if (closeTime <= BigInt(F.nowSec() + 30)) {
      errors.push('Closing time must be at least 30 seconds in the future, using your device clock.');
    }
  }
  if (!Number.isFinite(deadlineMs)) errors.push('Invalid resolution deadline.');
  else {
    resolveDeadline = BigInt(Math.floor(deadlineMs / 1000));
    if (closeTime !== null && resolveDeadline <= closeTime) {
      errors.push('Resolution deadline must be after closing time.');
    }
  }

  if (errors.length > 0 || !resolver || closeTime === null || resolveDeadline === null) {
    return {ok: false, errors};
  }
  return {
    ok: true,
    input: {
      question,
      criteria,
      source,
      resolver,
      closeTime,
      resolveDeadline,
    },
  };
}

function renderCreateErrors(errors: string[]): void {
  const el = document.getElementById('create-errors');
  if (!el) return;
  if (errors.length === 0) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = `<strong>Periksa input:</strong><ul>${errors
    .map((error) => `<li>${F.escapeHtml(error)}</li>`)
    .join('')}</ul>`;
  el.scrollIntoView({behavior: 'smooth', block: 'center'});
}

// ------------------------------------------------------------- chain helpers

async function readChainTime(): Promise<number> {
  const blockNumber = await readBlockNumber();
  return Number(await blockTimestamp(blockNumber));
}

function parseRecipient(raw: string, marketAddress: Address): Address | null {
  const text = raw.trim();
  if (!text) return null;
  if (!isAddress(text)) throw new Error('Enter a valid 0x… recipient address.');
  if (F.isZeroAddress(text)) throw new Error('The recipient cannot be the zero address.');
  if (sameAddress(text, marketAddress)) throw new Error('The recipient cannot be the market contract.');
  try {
    return getAddress(text);
  } catch {
    throw new Error('The recipient address has an invalid checksum.');
  }
}

function refreshAfterWrite(message: string): void {
  invalidateMarkets();
  stats = null;
  statsError = null;
  showToast(message, 'ok');
  render();
  void refreshGlobalStats();
}

function runAction(fn: () => Promise<void>): void {
  void fn().catch((error: unknown) => {
    showToast(F.contractErrorText(F.errorMessage(error)), 'err');
  });
}

function navigateToMarket(id: bigint): void {
  const hash = `#/market/${id.toString()}`;
  if (location.hash === hash) {
    route = {name: 'detail', id};
    render();
    return;
  }
  location.hash = hash;
}

// -------------------------------------------------------------- portfolio UI

function renderPortfolioPage(epoch: number): void {
  const view = document.getElementById('view');
  if (!view) return;
  const heading = `<section class="page-head page-head-split"><div><div class="eyebrow">YOUR POSITIONS, AT A GLANCE</div><h1>Portfolio</h1><p class="muted">Track your positions, follow results, and claim payouts in one place.</p></div><a class="btn" href="#/">Explore markets ${icon('arrow', 17)}</a></section>`;
  if (!walletAccount()) {
    view.innerHTML = `${heading}<div class="portfolio-preview" aria-hidden="true"><div><span>Active stake</span><b>— <small>QIE</small></b></div><div><span>Open positions</span><b>—</b></div><div><span>Ready to claim</span><b>— <small>QIE</small></b></div></div><div class="card empty-state portfolio-empty"><span class="empty-icon">${icon('wallet', 32)}</span><h2>Your positions, all in one place.</h2><p>Connect your wallet to view positions and payouts.<br />Your portfolio is read directly from the QIE contract.</p><button class="btn primary" type="button" data-action="connect-first">${icon('wallet', 17)} Connect wallet</button></div>`;
    return;
  }
  if (network.status !== 'ok' || !effectiveDeployment()) {
    view.innerHTML = `${heading}<div class="card empty-state"><span class="empty-icon">${icon('shield', 30)}</span><h2>Portfolio unavailable.</h2><p>${!effectiveDeployment() ? 'Activate the platform contract to start making predictions.' : 'Verify your QIE Testnet connection again.'}</p><a class="btn primary" href="#/network">Network status ${icon('arrow', 17)}</a></div>`;
    return;
  }
  view.innerHTML = `${heading}<div id="portfolio-summary" class="summary-grid"></div><div class="row space"><h2>Your position</h2><button class="text-btn" type="button" data-action="refresh-portfolio">${icon('refresh', 16)} Refresh</button></div><div id="portfolio-progress" class="progress-text" role="status"></div><div id="portfolio-body"><div class="card"><span class="spinner"></span> Loading positions…</div></div>`;
  void loadPortfolio(epoch);
}

async function loadPortfolio(epoch: number): Promise<void> {
  const active = effectiveDeployment();
  const account = walletAccount();
  if (!active || !account || network.status !== 'ok') {
    portfolioLoading = false;
    renderPortfolioBody(epoch);
    return;
  }
  const address = getAddress(active.manifest.address);
  if (portfolioRows !== null && portfolioAccount === account && portfolioDeployment === address) {
    portfolioLoading = false;
    renderPortfolioBody(epoch);
    return;
  }

  const token = ++portfolioToken;
  portfolioAccount = account;
  portfolioDeployment = address;
  portfolioLoading = true;
  portfolioError = null;
  portfolioProgress = {loaded: 0, total: 0};
  renderPortfolioBody(epoch);

  await ensureMarkets(() => {
    if (epoch === uiEpoch && token === portfolioToken) renderPortfolioBody(epoch);
  });
  if (epoch !== uiEpoch || token !== portfolioToken) return;
  if (!markets) {
    portfolioLoading = false;
    portfolioError = marketsError ?? 'Markets have not loaded yet.';
    renderPortfolioBody(epoch);
    return;
  }

  const items = markets;
  const rows: PortfolioRow[] = [];
  portfolioProgress = {loaded: 0, total: items.length};
  try {
    const chunk = 6;
    for (let index = 0; index < items.length; index += chunk) {
      if (epoch !== uiEpoch || token !== portfolioToken) return;
      const batch = items.slice(index, index + chunk);
      const states = await Promise.all(
        batch.map((market) => readMarketAccountState(address, market.id, account)),
      );
      if (epoch !== uiEpoch || token !== portfolioToken) return;
      states.forEach((accountState, offset) => {
        const market = batch[offset];
        if (!market) return;
        if (accountState.position.yes > 0n || accountState.position.no > 0n) {
          rows.push({market, accountState});
        }
      });
      portfolioRows = [...rows];
      portfolioProgress = {loaded: Math.min(index + chunk, items.length), total: items.length};
      renderPortfolioBody(epoch);
    }
    portfolioRows = rows;
    portfolioLoading = false;
  } catch (error) {
    if (epoch !== uiEpoch || token !== portfolioToken) return;
    portfolioLoading = false;
    portfolioError = F.errorMessage(error);
  }
  renderPortfolioBody(epoch);
}

function portfolioSummaryHtml(account: Address | null): string {
  if (!account) return '';
  const rows = portfolioRows;
  const open = (rows ?? []).filter((row) => !row.accountState.position.settled);
  const atRisk = open.reduce(
    (sum, row) => sum + row.accountState.position.yes + row.accountState.position.no,
    0n,
  );
  const claimable = open.reduce(
    (sum, row) => sum + row.accountState.projectedPayout + row.accountState.projectedRefund,
    0n,
  );
  const value = (amount: bigint) => (rows === null ? '…' : `${F.formatQie(amount)} QIE`);
  return `
    <div class="stat-card"><span>Wallet</span><strong class="mono">${F.escapeHtml(F.shortAddress(account))}</strong></div>
    <div class="stat-card"><span>Markets with positions</span><strong>${rows === null ? '…' : rows.length}</strong></div>
    <div class="stat-card"><span>Unsettled positions</span><strong>${rows === null ? '…' : open.length}</strong></div>
    <div class="stat-card"><span>Stake at risk</span><strong>${value(atRisk)}</strong></div>
    <div class="stat-card accent"><span>Ready to claim</span><strong>${value(claimable)}</strong></div>
  `;
}

function renderPortfolioBody(epoch: number): void {
  if (epoch !== uiEpoch) return;
  const body = document.getElementById('portfolio-body');
  const summary = document.getElementById('portfolio-summary');
  const progress = document.getElementById('portfolio-progress');
  if (!body) return;
  if (summary) summary.innerHTML = portfolioSummaryHtml(walletAccount());
  if (progress) {
    if (portfolioLoading && portfolioProgress.total > 0) {
      const pct = Math.min(100, (portfolioProgress.loaded / portfolioProgress.total) * 100);
      progress.innerHTML = `<span>Membaca posisi ${portfolioProgress.loaded}/${portfolioProgress.total} market…</span><span class="progress-bar"><i style="width:${pct.toFixed(1)}%"></i></span>`;
    } else if (portfolioLoading) {
      progress.innerHTML = `<span><span class="spinner"></span> Loading markets…</span>`;
    } else {
      progress.innerHTML = '';
    }
  }
  if (portfolioError) {
    body.innerHTML = `
      <div class="card empty-state">
        <h2>Could not read positions</h2>
        <p class="err">${F.escapeHtml(portfolioError)}</p>
        <button class="btn" type="button" data-action="refresh-portfolio">Try again</button>
      </div>
    `;
    return;
  }
  if (!walletAccount()) {
    body.innerHTML = `<div class="card empty-state"><h2>Wallet not connected</h2><p class="muted">Connect your QIE wallet to view positions.</p></div>`;
    return;
  }
  if (portfolioRows === null) {
    body.innerHTML = `<div class="card">Loading positions from the contract…</div>`;
    return;
  }
  if (portfolioRows.length === 0 && !portfolioLoading) {
    body.innerHTML = `
      <div class="card empty-state">
        <h2>No positions yet</h2>
        <p class="muted">This wallet has no YES or NO stakes in the active contract.</p>
        <a class="btn primary" href="#/">View markets</a>
      </div>
    `;
    return;
  }
  body.innerHTML = `<div class="position-list">${portfolioRows.map(portfolioRowHtml).join('')}</div>`;
}

function portfolioRowHtml(row: PortfolioRow): string {
  const {market, accountState} = row;
  const phase = F.marketPhase(market);
  const settled = accountState.position.settled;
  const hasEntitlement = accountState.projectedPayout + accountState.projectedRefund > 0n;
  return `
    <a class="position-row" href="#/market/${market.id.toString()}">
      <div class="position-main">
        <div class="position-head">
          <span class="tag ${F.phaseTone(phase)}">${F.phaseLabel(phase)}</span>
          <span class="tag ${settled ? 'done' : 'open'}">${settled ? 'Settled' : 'Unsettled'}</span>
          <span class="mono muted">#${market.id.toString()}</span>
        </div>
        <h3>${F.escapeHtml(market.question)}</h3>
        <div class="position-metrics">
          <span><b class="yes-text">YES</b> ${F.formatQie(accountState.position.yes)} QIE</span>
          <span><b class="no-text">NO</b> ${F.formatQie(accountState.position.no)} QIE</span>
          <span>Payout ${F.formatQie(accountState.projectedPayout)} QIE</span>
          <span>Refund ${F.formatQie(accountState.projectedRefund)} QIE</span>
        </div>
      </div>
      <div class="position-side">
        <span class="${hasEntitlement ? 'ok-text' : 'muted'}">${settled ? 'Resolved' : hasEntitlement ? 'Ready to claim' : 'Awaiting result'}</span>
        <span class="muted">View details →</span>
      </div>
    </a>
  `;
}

// --------------------------------------------------------------- resolver UI

function renderResolverPage(epoch: number): void {
  const view = document.getElementById('view');
  if (!view) return;
  if (network.status === 'checking' || deploymentLoading || !deploymentLoad) {
    view.innerHTML = `<section class="page-head"><div class="eyebrow">RESULT REVIEW</div><h1>Resolve markets</h1><p>Review the results of markets assigned to your wallet.</p></section><div class="card" role="status"><span class="spinner"></span> Checking the platform connection…</div>`;
    return;
  }
  if (network.status !== 'ok') {
    view.innerHTML = `<section class="page-head"><h1>Resolve markets</h1></section><div class="card empty-state"><h2>Let’s check your connection</h2><p>We couldn’t reach QIE Testnet. Your assigned markets will be available once the connection returns.</p><a class="btn primary" href="#/network">Check connection</a></div>`;
    return;
  }
  if (!effectiveDeployment()) {
    view.innerHTML = `
      <div class="card empty-state">
        <h2>Platform connection unavailable</h2>
        <p class="muted">We need to verify the platform connection before showing your assigned markets.</p>
        <a class="btn primary" href="#/network">Check connection</a>
      </div>
    `;
    return;
  }
  if (!walletAccount()) {
    view.innerHTML = `
      <section class="page-head">
        <div class="eyebrow">RESOLVER</div>
        <h1>Resolve markets</h1>
        <p class="muted">Connect your wallet to see the markets you’ve been assigned to review.</p>
      </section>
      <div class="card empty-state">
        <h2>Wallet not connected</h2>
        <p class="muted">The resolver is a trusted person selected when the market is created. Results are set manually.</p>
        <button class="btn primary" type="button" data-action="connect-first">Connect wallet</button>
      </div>
    `;
    return;
  }
  view.innerHTML = `
    <section class="page-head">
      <div class="eyebrow">RESOLVER</div>
      <h1>Resolve markets</h1>
      <p class="muted">Check each market’s rules and source before confirming its result. Results can be set after staking closes and before the resolution deadline.</p>
    </section>
    <div id="resolver-summary" class="summary-grid"></div>
    <div id="resolver-progress" class="progress-text"></div>
    <div id="resolver-body"><div class="card">Loading markets…</div></div>
  `;
  void loadResolver(epoch);
}

async function loadResolver(epoch: number): Promise<void> {
  if (!effectiveDeployment() || !walletAccount() || network.status !== 'ok') {
    renderResolverBody(epoch);
    return;
  }
  await ensureMarkets(() => {
    if (epoch === uiEpoch) renderResolverBody(epoch);
  });
  if (epoch !== uiEpoch) return;
  renderResolverBody(epoch);
}

function resolverMarkets(): MarketRecord[] {
  const account = walletAccount();
  if (!account) return [];
  const rank: Record<F.MarketPhase, number> = {
    AWAITING_RESOLUTION: 0,
    EXPIRED_UNRESOLVED: 1,
    OPEN: 2,
    RESOLVED: 3,
  };
  return (markets ?? [])
    .filter((market) => sameAddress(market.resolver, account))
    .sort((a, b) => {
      const phaseA = F.marketPhase(a);
      const phaseB = F.marketPhase(b);
      const rankA = rank[phaseA] ?? 9;
      const rankB = rank[phaseB] ?? 9;
      if (rankA !== rankB) return rankA - rankB;
      if (phaseA === 'OPEN' && phaseB === 'OPEN') {
        return a.closeTime < b.closeTime ? -1 : a.closeTime > b.closeTime ? 1 : 0;
      }
      return a.id > b.id ? -1 : 1;
    });
}

function renderResolverBody(epoch: number): void {
  if (epoch !== uiEpoch) return;
  const body = document.getElementById('resolver-body');
  const summary = document.getElementById('resolver-summary');
  const progress = document.getElementById('resolver-progress');
  if (!body) return;
  const rows = resolverMarkets();
  const actionable = rows.filter((market) => {
    const phase = F.marketPhase(market);
    return phase === 'AWAITING_RESOLUTION' || phase === 'EXPIRED_UNRESOLVED';
  }).length;
  if (summary) {
    summary.innerHTML = `
      <div class="stat-card"><span>Resolver wallet</span><strong class="mono">${F.escapeHtml(
        F.shortAddress(walletAccount() ?? '—'),
      )}</strong></div>
      <div class="stat-card"><span>Assigned markets</span><strong>${markets === null ? '…' : rows.length}</strong></div>
      <div class="stat-card accent"><span>Action required</span><strong>${markets === null ? '…' : actionable}</strong></div>
    `;
  }
  if (progress) {
    progress.innerHTML =
      markets === null && !marketsError
        ? `<span><span class="spinner"></span> Loading markets…</span>`
        : marketsError
          ? `<span class="err">Could not load markets: ${F.escapeHtml(marketsError)}</span>`
          : '';
  }
  if (marketsError) {
    body.innerHTML = `
      <div class="card empty-state">
        <h2>Could not read market</h2>
        <p class="err">${F.escapeHtml(marketsError)}</p>
        <button class="btn" type="button" data-action="refresh-resolver">Try again</button>
      </div>
    `;
    return;
  }
  if (markets === null) {
    body.innerHTML = `<div class="card">Loading markets from the contract…</div>`;
    return;
  }
  if (rows.length === 0) {
    body.innerHTML = `
      <div class="card empty-state">
        <h2>No markets assigned to you</h2>
        <p class="muted">This wallet is not the designated resolver of any market.</p>
        <a class="btn" href="#/create">Create market</a>
      </div>
    `;
    return;
  }
  body.innerHTML = `<div class="resolver-list">${rows.map(resolverRowHtml).join('')}</div>`;
}

function resolverRowHtml(market: MarketRecord): string {
  const phase = F.marketPhase(market);
  const id = market.id.toString();
  const total = market.yesStake + market.noStake;
  let action = '';
  if (phase === 'AWAITING_RESOLUTION') {
    action = `
      <div class="row">
        <button class="btn tiny yes" type="button" data-action="resolve-review" data-outcome="1" data-id="${id}">YES</button>
        <button class="btn tiny no" type="button" data-action="resolve-review" data-outcome="2" data-id="${id}">NO</button>
        <button class="btn tiny danger" type="button" data-action="resolve-review" data-outcome="3" data-id="${id}">INVALID</button>
      </div>
    `;
  } else if (phase === 'EXPIRED_UNRESOLVED') {
    action = `<button class="btn tiny danger" type="button" data-action="cancel-review" data-id="${id}">Cancel &amp; refund</button>`;
  } else if (phase === 'OPEN') {
    action = `<span class="muted">Resolution opens ${F.formatDateTime(market.closeTime)} (${F.countdownText(
      Number(market.closeTime),
    )})</span>`;
  } else {
    action = `<span class="tag done">${resolvedTagText(market)}</span>`;
  }
  return `
    <div class="resolver-row">
      <div class="resolver-main">
        <div class="position-head">
          <span class="tag ${F.phaseTone(phase)}">${F.phaseLabel(phase)}</span>
          <span class="mono muted">#${id}</span>
        </div>
        <h3>${F.escapeHtml(market.question)}</h3>
        <div class="position-metrics">
          <span><b class="yes-text">YES</b> ${F.formatQie(market.yesStake)} QIE</span>
          <span><b class="no-text">NO</b> ${F.formatQie(market.noStake)} QIE</span>
          <span>Pool ${F.formatQie(total)} QIE</span>
          <span>Escrow ${F.formatQie(market.remainingEscrow)} QIE</span>
        </div>
      </div>
      <div class="resolver-actions">
        ${action}
        <a class="btn tiny ghost" href="#/market/${id}">Detail</a>
      </div>
    </div>
  `;
}

function resolvedTagText(market: MarketRecord): string {
  if (market.cancelled) return 'CANCELLED';
  if (market.outcome === 1) return 'YES WINS';
  if (market.outcome === 2) return 'NO WINS';
  if (market.outcome === 3) return 'INVALID — REFUND';
  return 'RESOLVED';
}

// ------------------------------------------------------------------ deploy UI

function renderDeployPage(): void {
  const view = document.getElementById('view');
  if (!view) return;
  const active = effectiveDeployment();
  const checking = network.status === 'checking' || deploymentLoading || !deploymentLoad;
  const connected = network.status === 'ok' && !!active;
  const tone = checking ? 'checking' : connected ? 'connected' : 'attention';
  const title = checking ? 'Checking your connection…' : connected ? 'You’re ready to explore' : network.status !== 'ok' ? 'Let’s reconnect to QIE Testnet' : 'The platform connection needs attention';
  const message = checking ? 'We’re checking the network and the platform. This usually takes a moment.'
    : connected ? 'The platform is connected. Browse a question or create a market when you’re ready.'
    : network.status !== 'ok' ? 'We couldn’t reach the test network. You can keep browsing ideas while we reconnect.'
    : 'Published markets are temporarily unavailable. You can still explore ideas and prepare a draft.';
  const walletReady = walletSnapshot.phase === 'ready' && !!walletAccount();
  const walletWrong = walletSnapshot.phase === 'wrong-chain';
  const walletMessage = walletReady ? 'Connected to QIE Testnet' : walletWrong ? 'Select QIE Testnet in your wallet, then check again.' : walletSnapshot.phase === 'connecting' ? 'Waiting for your wallet…' : 'Connect when you want to create a market or make a prediction.';
  view.innerHTML = `<section class="page-head"><div class="eyebrow">YOUR CONNECTION</div><h1>Network status</h1><p>Everything you need to check before making a prediction.</p></section>
    <div class="connection-layout"><section class="card connection-card" aria-labelledby="connection-heading"><div class="connection-intro"><span class="connection-emblem ${tone}">${checking ? '<span class="spinner"></span>' : icon(connected ? 'check' : 'refresh', 26)}</span><span class="connection-badge">QIE Testnet</span></div>
      <h2 id="connection-heading">${title}</h2><p class="connection-description">${message}</p>
      <div class="connection-checks"><div class="connection-check"><span class="connection-check-icon ${network.status === 'ok' ? 'ok' : ''}">${icon('globe', 20)}</span><div><h3>Network</h3><p>${network.status === 'checking' ? 'Connecting…' : network.status === 'ok' ? 'Connected to QIE Testnet' : 'Connection unavailable'}</p></div><span class="connection-state">${network.status === 'ok' ? 'Connected' : network.status === 'checking' ? 'Checking' : 'Retry needed'}</span></div>
        <div class="connection-check"><span class="connection-check-icon ${active ? 'ok' : ''}">${icon('shield', 20)}</span><div><h3>Platform</h3><p>${active ? 'The platform contract has passed verification.' : checking ? 'Checking the platform connection…' : 'The platform connection hasn’t been verified.'}</p></div><span class="connection-state">${active ? 'Verified' : checking ? 'Checking' : 'Unavailable'}</span></div>
        <div class="connection-check"><span class="connection-check-icon ${walletReady ? 'ok' : ''}">${icon('wallet', 20)}</span><div><h3>Your wallet</h3><p>${walletMessage}</p></div>${walletReady ? `<span class="connection-state">${F.escapeHtml(F.shortAddress(walletAccount()!))}</span>` : walletWrong ? '<button class="text-btn" type="button" data-action="refresh-chain">Check again</button>' : walletSnapshot.phase === 'connecting' ? '<span class="spinner"></span>' : '<button class="text-btn" type="button" data-action="connect-first">Connect wallet</button>'}</div></div>
      <div class="connection-actions"><a class="btn primary" href="#/">Explore markets ${icon('arrow', 17)}</a>${connected ? '<a class="btn" href="#/create">Create a market</a>' : `<button class="btn" type="button" data-action="retry-platform" ${checking ? 'disabled' : ''}>${icon('refresh', 16)} Check again</button>`}</div></section>
      <aside class="connection-guide card"><span class="guide-icon">${icon('help', 24)}</span><h2>Just getting started?</h2><ol><li><strong>Find a question</strong><span>Choose a topic you want to follow.</span></li><li><strong>Read the rules</strong><span>Check what counts as YES or NO and who confirms the result.</span></li><li><strong>Take a side</strong><span>Connect your wallet and use test QIE to try a prediction.</span></li></ol><a class="text-btn" href="#/how-it-works">How it works ${icon('arrow', 16)}</a></aside></div>
    <section class="test-token-callout"><span class="callout-icon">${icon('wallet', 22)}</span><div><h2>Need test QIE?</h2><p>Get free tokens from the official faucet to try creating a market or making a prediction.</p></div><a class="btn" href="${C.QIE_FAUCET}" target="_blank" rel="noopener noreferrer">Get test QIE ${icon('external', 15)}</a></section>
    <details class="connection-details"><summary>Connection details</summary><dl class="kv-list"><div><dt>Network</dt><dd>QIE Testnet · ${C.QIE_CHAIN_ID}</dd></div><div><dt>Platform contract</dt><dd>${active ? addressLink(active.manifest.address) : 'Not connected'}</dd></div>${active ? `<div><dt>Last checked</dt><dd>${F.escapeHtml(new Date(active.verification.verifiedAt).toLocaleString('en-US'))}</dd></div>` : ''}</dl></details>
    <details class="advanced-access"><summary>Advanced options</summary><div><p>Developer tools are for maintaining the platform connection. You can browse, create, and resolve markets from the main navigation.</p><a class="text-btn" href="#/developer">Open developer tools ${icon('arrow', 16)}</a></div></details>`;
  if (active && !stats && !statsError) void refreshGlobalStats();
}

function renderDeveloperPage(): void {
  const view = document.getElementById('view');
  if (!view) return;
  const active = effectiveDeployment();
  const account = walletAccount();
  const artifact = QIE_PREDICTION_MARKET_ARTIFACT;
  const canDeploy = network.status === 'ok' && !!account && walletSnapshot.phase === 'ready';
  const hashes: Array<[string, string]> = [['Creation bytecode keccak256', artifact.creationBytecodeKeccak256], ['Runtime bytecode keccak256', artifact.runtimeBytecodeKeccak256], ['Source keccak256', artifact.sourceKeccak256], ['Settings keccak256', artifact.settingsKeccak256], ['Artifact SHA256', artifact.artifactSha256], ['ABI SHA256', artifact.abiSha256]];
  view.innerHTML = `<div class="breadcrumbs"><a href="#/network">Network status</a>${icon('chevron', 13)}<span>Developer tools</span></div><section class="page-head"><div class="eyebrow">PLATFORM MAINTENANCE</div><h1>Developer tools</h1><p>Manage the platform connection and inspect its technical details. Market creation and result review have their own pages.</p></section>
    <section class="card developer-current"><div class="section-label">${icon('shield', 20)}<h2>Current platform connection</h2></div>${deploymentStatusHtml()}<div class="row deploy-actions"><button class="btn" type="button" data-action="verify-deployment" ${active ? '' : 'disabled'}>${icon('refresh', 16)} Verify again</button><button class="btn ghost" type="button" data-action="download-manifest" ${active ? '' : 'disabled'}>Download configuration</button></div></section>
    <div class="developer-options"><details class="developer-disclosure"><summary><span>Use a different contract<small>Import a deployment configuration for this tab</small></span></summary><div class="disclosure-body"><p>This changes which platform contract this tab uses. Existing markets and funds remain in their original contract.</p><label for="manifest-json">Deployment configuration (JSON)</label><textarea id="manifest-json" rows="5" spellcheck="false" placeholder='{"schemaVersion":1,"status":"ACTIVE",…}'></textarea><button class="btn" type="button" data-action="import-manifest">Verify &amp; connect ${icon('arrow', 17)}</button><p class="hint">Imported configuration applies to this tab. Publish the manifest with the site to make the connection available to all visitors.</p></div></details>
      <details class="developer-disclosure"><summary><span>Deploy a separate platform<small>Create a new contract with its own markets</small></span></summary><div class="disclosure-body"><div class="banner warn">A new deployment starts a separate platform. Existing markets and funds are not migrated.</div><p>Creating a contract is separate from creating a market. To add a question to the current platform, use <a href="#/create">Create market</a>.</p><button class="btn danger" type="button" data-action="deploy-review" ${canDeploy ? '' : 'disabled'}>Review new deployment</button>${canDeploy ? '' : '<p class="hint">Connect a wallet on QIE Testnet and wait for the network check before deploying.</p>'}<p class="hint">You’ll review the contract details before your wallet asks you to sign. Signing and gas payment stay in your wallet.</p></div></details>
      <details class="developer-disclosure"><summary><span>Connection diagnostics<small>Network, wallet, and contract checks</small></span></summary><div class="disclosure-body"><ul class="check-list"><li class="${network.status === 'ok' ? 'ok' : 'warn'}"><span>${network.status === 'ok' ? '✓' : '!'}</span>RPC QIE Testnet chain 1983<small>${F.escapeHtml(QIE_RPC_URLS.map(shortRpcLabel).join(', '))}</small></li><li class="${walletSnapshot.phase === 'ready' ? 'ok' : 'warn'}"><span>${walletSnapshot.phase === 'ready' ? '✓' : '!'}</span>Wallet ${walletSnapshot.phase === 'ready' ? 'ready on chain 1983' : 'not ready'}<small>${account ? F.escapeHtml(F.shortAddress(account)) : 'Not connected'}</small></li><li><span>·</span>Expected runtime digest<small class="mono">${F.escapeHtml(artifact.runtimeBytecodeKeccak256)}</small></li></ul><p class="hint">A successful build or RPC check does not prove wallet-extension compatibility. Contract creation through a real QIE Wallet extension has not been tested by this app’s automated checks.</p></div></details>
      <details class="developer-disclosure"><summary><span>Contract build details<small>Compiler settings and artifact fingerprints</small></span></summary><div class="disclosure-body"><p>Compiler <span class="mono">${F.escapeHtml(artifact.compiler)}</span>, EVM <span class="mono">${F.escapeHtml(artifact.evmVersion)}</span>, optimizer ${artifact.optimizer ? 'on' : 'off'}. The deployed runtime must match this build before the app uses a contract.</p><dl class="hash-list">${hashes.map(([label, value]) => `<div><dt>${label}</dt><dd class="mono">${F.escapeHtml(value)}</dd></div>`).join('')}<div><dt>Creation bytecode size</dt><dd>${F.formatBytes((QIE_PREDICTION_MARKET_CREATION_BYTECODE.length - 2) / 2)}</dd></div><div><dt>Metadata bytecodeHash</dt><dd>${F.escapeHtml(artifact.bytecodeHash)}</dd></div></dl></div></details>
      <details class="developer-disclosure"><summary><span>Publish a platform configuration<small>Make a verified connection available to all visitors</small></span></summary><div class="disclosure-body"><ol class="step-list"><li>Verify the contract or complete a wallet-approved deployment.</li><li>Download the verified configuration.</li><li>Save it to <span class="mono">frontend/public/deployments/qie-testnet.json</span>, then rebuild and deploy the site.</li></ol><p class="hint">An imported or newly deployed connection is kept in this tab’s memory until its configuration is published. The app does not silently activate contracts from localStorage.</p><p class="hint">Wallet deployment uses <span class="mono">eth_sendTransaction</span> with no <span class="mono">to</span> field. A rejected wallet request is not retried or signed on a server.</p></div></details></div>`;
  if (active && !stats && !statsError) void refreshGlobalStats();
}

function deploymentStatusHtml(): string {
  if (sessionDeployment) {
    const {manifest, verification} = sessionDeployment;
    return `
      <div class="status-line ok">
        <span class="dot"></span>
        <div>
          <strong>Session deployment active</strong>
          <div class="mono"><a href="${F.addressUrl(manifest.address)}" target="_blank" rel="noopener noreferrer">${F.escapeHtml(getAddress(manifest.address))}</a></div>
        </div>
      </div>
      <div class="kv-list">
        <div><span>marketCount</span><strong>${verification.marketCount.toString()}</strong></div>
        <div><span>Deploy tx</span><strong>${hashLink(manifest.deployment.txHash, F.shortAddress(manifest.deployment.txHash, 12, 10))}</strong></div>
        <div><span>Deployer</span><strong>${addressLink(manifest.deployment.deployer)}</strong></div>
        <div><span>Verified</span><strong>${F.escapeHtml(new Date(verification.verifiedAt).toLocaleString('en-US'))}</strong></div>
      </div>
      <p class="hint warn-text">This manifest is not published yet. Download it and replace the public manifest before reloading or rebuilding.</p>
    `;
  }
  if (deploymentLoading) {
    return `<div class="status-line wait"><span class="spinner"></span><div><strong>Loading manifest…</strong><div class="muted">Verifying runtime bytecode and accounting.</div></div></div>`;
  }
  if (!deploymentLoad) {
    return `<div class="status-line wait"><span class="dot"></span><div><strong>Status unknown</strong><div class="muted">The manifest has not loaded yet.</div></div></div>`;
  }
  if (deploymentLoad.kind === 'NOT_DEPLOYED') {
    return `
      <div class="status-line warn">
        <span class="dot"></span>
        <div>
          <strong>NOT_DEPLOYED</strong>
          <div class="muted">The public manifest does not point to an active contract. Deploy from your wallet to get started.</div>
        </div>
      </div>
    `;
  }
  if (deploymentLoad.kind === 'ACTIVE') {
    const {manifest, verification} = deploymentLoad;
    return `
      <div class="status-line ok">
        <span class="dot"></span>
        <div>
          <strong>Contract active &amp; verified</strong>
          <div class="mono"><a href="${F.addressUrl(manifest.address)}" target="_blank" rel="noopener noreferrer">${F.escapeHtml(getAddress(manifest.address))}</a></div>
        </div>
      </div>
      <div class="kv-list">
        <div><span>marketCount</span><strong>${verification.marketCount.toString()}</strong></div>
        <div><span>Deploy tx</span><strong>${hashLink(manifest.deployment.txHash, F.shortAddress(manifest.deployment.txHash, 12, 10))}</strong></div>
        <div><span>Deployer</span><strong>${addressLink(manifest.deployment.deployer)}</strong></div>
        <div><span>Block</span><strong class="mono">#${F.escapeHtml(manifest.deployment.blockNumber)}</strong></div>
        <div><span>Verified</span><strong>${F.escapeHtml(new Date(verification.verifiedAt).toLocaleString('en-US'))}</strong></div>
        <div><span>Verifier</span><strong>${F.escapeHtml(manifest.verification.verifier)}</strong></div>
      </div>
    `;
  }
  if (deploymentLoad.kind === 'INVALID') {
    return `
      <div class="status-line bad">
        <span class="dot"></span>
        <div>
          <strong>Manifest/deployment INVALID</strong>
          <div class="err">${F.escapeHtml(deploymentLoad.reason)}</div>
          <div class="muted">The contract is unavailable until its manifest and runtime match.</div>
        </div>
      </div>
    `;
  }
  return `
    <div class="status-line bad">
      <span class="dot"></span>
      <div>
        <strong>Could not load manifest</strong>
        <div class="err">${F.escapeHtml(deploymentLoad.reason)}</div>
      </div>
    </div>
  `;
}

function reviewDeploy(): void {
  if (network.status !== 'ok') throw new Error('QIE Testnet RPC has not been verified. Deployment is unavailable.');
  const account = walletAccount();
  if (!account || walletSnapshot.phase !== 'ready') {
    throw new Error('Connect your QIE wallet on chain 1983 before deploying.');
  }
  const artifact = QIE_PREDICTION_MARKET_ARTIFACT;
  const existing = effectiveDeployment();
  openModal({
    title: 'Review contract deployment',
    confirmLabel: 'Send deployment transaction',
    tone: 'danger',
    body: `
      <p>This transaction creates a new contract on <b>QIE Testnet chain 1983</b>. There are no constructor arguments.</p>
      <div class="kv-list">
        <div><span>Deployer</span><strong class="mono">${F.escapeHtml(account)}</strong></div>
        <div><span>Creation hash</span><strong class="mono">${F.escapeHtml(artifact.creationBytecodeKeccak256)}</strong></div>
        <div><span>Runtime hash</span><strong class="mono">${F.escapeHtml(artifact.runtimeBytecodeKeccak256)}</strong></div>
      </div>
      ${
        existing
          ? `<div class="banner warn">Current active contract: <span class="mono">${F.escapeHtml(
              existing.manifest.address,
            )}</span>. A new deployment does not migrate existing markets or escrow.</div>`
          : ''
      }
      <p class="hint">The contract address depends on the deployer and nonce. The app verifies the
      receipt address, runtime bytecode, <span class="mono">marketCount</span>, and accounting before
      activating the session deployment.</p>
    `,
    onConfirm: () => deployNewContract(account),
  });
}

async function deployNewContract(account: Address): Promise<void> {
  const artifact = QIE_PREDICTION_MARKET_ARTIFACT;
  await sendWrite('Deploy QIE Predict', {
    data: QIE_PREDICTION_MARKET_CREATION_BYTECODE,
  }, async (receipt) => {
    const hash = receipt.transactionHash;
    if (!sameAddress(receipt.from, account)) throw new Error('The receipt deployer does not match the account that approved deployment.');
    if (!receipt.contractAddress) {
      throw new Error(`The receipt succeeded but contractAddress is empty (tx ${hash}). The deployment was not activated.`);
    }
    const address = getAddress(receipt.contractAddress);
    const verification = await verifyContractRuntime(address, artifact.runtimeBytecodeKeccak256);

    const manifest: DeploymentManifest = {
      schemaVersion: 1,
      status: 'ACTIVE',
      network: {name: C.QIE_CHAIN_NAME, chainId: C.QIE_CHAIN_ID},
      address,
      deployment: {
        txHash: hash,
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash,
        deployer: getAddress(account),
        deployedAt: new Date().toISOString(),
      },
      artifact: artifactHashes(),
      verification: {
        runtimeCodeMatches: true,
        marketCountReadable: true,
        marketCount: verification.marketCount.toString(),
        verifiedAt: verification.verifiedAt,
        verifier: 'qie-predict-frontend/0.1.0',
      },
    };

    const parsed = parseManifestJson(JSON.stringify(manifest));
    if (parsed.kind !== 'ACTIVE') {
      const reason = parsed.kind === 'INVALID' ? parsed.reason : 'Manifest status is not ACTIVE';
      throw new Error(`The deployment manifest failed internal validation: ${reason}`);
    }

    sessionDeployment = {manifest, verification};
    invalidateMarkets();
    stats = null;
    statsError = null;
    render();
    void refreshGlobalStats();
    downloadManifest();
    showToast(`Contract verified at ${F.shortAddress(address)}. Download the manifest and replace the public file.`, 'ok');
  }, account);
}

function downloadManifest(): void {
  const active = effectiveDeployment();
  if (!active) {
    showToast('No active manifest to download.', 'warn');
    return;
  }
  const text = `${JSON.stringify(active.manifest, null, 2)}\n`;
  const blob = new Blob([text], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'qie-testnet.json';
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_500);
}

async function verifyCurrentDeployment(): Promise<void> {
  const active = effectiveDeployment();
  if (!active) throw new Error('No active deployment to verify.');
  const verification = await verifyContractRuntime(
    getAddress(active.manifest.address),
    active.manifest.artifact.runtimeBytecodeKeccak256,
  );
  if (sessionDeployment) {
    sessionDeployment = {...sessionDeployment, verification};
  } else if (deploymentLoad?.kind === 'ACTIVE') {
    deploymentLoad = {...deploymentLoad, verification};
  }
  showToast(`Deployment valid · marketCount ${verification.marketCount.toString()}`, 'ok');
  render();
}

// ------------------------------------------------------------ footer / overlays

function renderFooterStats(): void {
  const el = document.getElementById('footer-stats');
  if (!el) return;
  if (!effectiveDeployment()) {
    el.innerHTML = '';
    return;
  }
  if (statsError) {
    el.innerHTML = `<span class="err">Stats unavailable</span>`;
    return;
  }
  if (!stats) {
    el.innerHTML = '<span class="muted">Loading stats…</span>';
    return;
  }
  const unaccounted =
    stats.unaccountedBalance > 0n
      ? ` · <span class="warn-text">unaccounted ${F.formatQie(stats.unaccountedBalance)} QIE</span>`
      : '';
  const technical = route.name === 'developer' ? ` · <span>escrow ${F.formatQie(stats.totalEscrow)} QIE</span>${unaccounted}` : '';
  el.innerHTML = `<span>${stats.marketCount.toString()} ${stats.marketCount === 1n ? 'market' : 'markets'}</span> · <span>${F.formatQie(
    stats.totalStakeReceived,
  )} QIE staked</span>${technical}`;
}

let txDockRoot: HTMLElement | null = null;
let modalRoot: HTMLElement | null = null;

function ensureBodyRoot(id: string, tag: 'div' | 'section', className: string): HTMLElement {
  const existing = document.getElementById(id);
  if (existing instanceof HTMLElement) return existing;
  const element = document.createElement(tag);
  element.id = id;
  element.className = className;
  document.body.append(element);
  return element;
}

function ensureToast(): HTMLElement {
  return ensureBodyRoot('toast', 'div', 'toast');
}

function txStatusText(status: TxStatus): string {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'success':
      return 'success';
    case 'reverted':
      return 'reverted';
    case 'unknown':
      return 'unknown';
  }
}

function renderTxDock(): void {
  const txRecords = transactions.records;
  const expanded = txDockExpanded ?? txRecords.some((record) => record.status === 'pending' || record.status === 'unknown' || (record.status === 'success' && !record.notified));
  const root = (txDockRoot ??= ensureBodyRoot('tx-dock', 'section', 'tx-dock'));
  if (txRecords.length === 0) {
    root.hidden = true;
    root.innerHTML = '';
    return;
  }
  root.hidden = false;
  root.dataset.expanded = String(expanded);
  root.innerHTML = `
    <div class="tx-dock-head">
      <strong>Transactions <span class="muted">(${txRecords.length})</span></strong>
      <div class="row"><button class="btn tiny ghost" type="button" data-action="tx-clear">Clear</button><button class="icon-btn tx-toggle" type="button" data-action="tx-toggle" aria-label="${expanded ? 'Collapse' : 'Expand'} transaction history" aria-expanded="${expanded}" aria-controls="tx-list">${icon('chevron', 17)}</button></div>
    </div>
    <div id="tx-list" class="tx-list" ${expanded ? '' : 'hidden'}>
      ${txRecords
        .map(
          (record) => `
            <div class="tx-item ${record.status}">
              <div class="tx-item-top">
                <span>${F.escapeHtml(record.label)}</span>
                <span class="tx-status ${record.status}">${txStatusText(record.status)}</span>
              </div>
              <div class="tx-item-meta">
                ${hashLink(record.hash)}
                ${record.blockNumber !== null ? `<span class="muted">block #${record.blockNumber.toString()}</span>` : ''}
              </div>
              ${record.error ? `<div class="tx-item-error">${F.escapeHtml(record.error)}</div>` : ''}
              <div class="tx-item-actions">
                ${record.status === 'pending' || record.status === 'unknown' || (record.status === 'success' && !record.notified)
                  ? `<button class="btn tiny" type="button" data-action="tx-check" data-hash="${record.hash}" ${record.processing ? 'disabled' : ''}>${record.status === 'success' ? 'Recover result' : 'Check receipt'}</button>`
                  : ''}
                ${record.status === 'reverted' || (record.status === 'success' && record.notified)
                  ? `<button class="btn tiny ghost" type="button" data-action="tx-dismiss" data-hash="${record.hash}">Remove</button>`
                  : ''}
              </div>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
}

async function checkTx(hash: string): Promise<void> {
  try {
    const receipt = await transactions.check(hash);
    const record = transactions.get(hash);
    if (record?.error && receipt.status === 'success') {
      showToast(record.error, 'warn');
      return;
    }
    showToast(`Receipt found: ${receipt.status === 'success' ? 'success' : 'reverted'}.`, receipt.status === 'success' ? 'ok' : 'err');
  } catch (error) {
    showToast(`Receipt not available: ${F.errorMessage(error)}`, 'info');
  }
}

function dismissTx(hash: string): void {
  if (!transactions.remove(hash)) showToast('This transaction still needs monitoring or recovery.', 'warn');
}

function clearTx(): void {
  txDockExpanded = null;
  transactions.clear();
}

async function sendWrite(
  label: string,
  tx: WalletTransaction,
  onMined: (receipt: TransactionReceipt) => Promise<void>,
  expectedAccount: Address,
): Promise<string> {
  if (writePending) throw new Error('Another transaction is being sent. Wait for your wallet to return its hash.');
  if (network.status !== 'ok') throw new Error('QIE Testnet RPC has not been verified. Transactions are unavailable.');
  const session = requireSession(expectedAccount);
  writePending = true;
  try {
    const hash = await session.sendTransaction(tx);
    transactions.add(hash, label, onMined);
    void transactions.watch(hash);
    showToast(`${label}: Transaction sent ${F.shortAddress(hash, 10, 8)}`, 'info');
    return hash;
  } finally {
    writePending = false;
  }
}

// -------------------------------------------------------------------- modal UI

function openModal(state: ModalState): void {
  previousModalFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  currentModal = state;
  modalError = '';
  modalBusy = false;
  renderModal();
}

function closeModal(): void {
  if (modalBusy) return;
  currentModal = null;
  modalError = '';
  renderModal();
}

function renderModal(): void {
  const root = (modalRoot ??= ensureBodyRoot('modal-root', 'div', 'modal-root'));
  app.inert = !!currentModal;
  if (!currentModal) {
    root.hidden = true;
    root.innerHTML = '';
    document.body.classList.remove('modal-open');
    if (previousModalFocus?.isConnected) previousModalFocus.focus({preventScroll: true});
    previousModalFocus = null;
    return;
  }
  root.hidden = false;
  document.body.classList.add('modal-open');
  const modal = currentModal;
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop="true">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head">
          <h2 id="modal-title">${F.escapeHtml(modal.title)}</h2>
          <button class="icon-btn" type="button" data-action="modal-close" aria-label="Close" ${modalBusy ? 'disabled' : ''}>×</button>
        </div>
        <div class="modal-body">${modal.body}</div>
        ${modalError ? `<div class="modal-error">${F.escapeHtml(modalError)}</div>` : ''}
        <div class="modal-actions">
          <button class="btn ghost" type="button" data-action="modal-close" ${modalBusy ? 'disabled' : ''}>Cancel</button>
          <button class="btn ${modal.tone === 'danger' ? 'danger' : 'primary'}" type="button" data-action="modal-confirm" ${modalBusy ? 'disabled' : ''}>
            ${modalBusy ? 'Processing…' : F.escapeHtml(modal.confirmLabel)}
          </button>
        </div>
      </div>
    </div>
  `;
  root.querySelector<HTMLButtonElement>('[data-action="modal-confirm"]')?.focus({preventScroll: true});
}

async function confirmModal(): Promise<void> {
  if (!currentModal || modalBusy) return;
  modalBusy = true;
  modalError = '';
  renderModal();
  const modal = currentModal;
  try {
    await modal.onConfirm();
    currentModal = null;
  } catch (error) {
    modalError = F.contractErrorText(F.errorMessage(error));
  } finally {
    modalBusy = false;
    renderModal();
  }
}

// ---------------------------------------------------------------- review flows

function reviewCreate(): void {
  const validation = validateCreateDraft();
  if (!validation.ok) {
    renderCreateErrors(validation.errors);
    showToast('Check the market fields first.', 'err');
    return;
  }
  renderCreateErrors([]);
  const account = walletAccount();
  if (!account) throw new Error('Connect your QIE wallet first.');
  requireSession(account);
  const target = requireDeploymentAddress();
  const input = validation.input;
  openModal({
    title: 'Review new market',
    confirmLabel: 'Create market',
    tone: 'primary',
    body: `
      <p>The question, rules, resolver, and times are <b>permanent</b> once the transaction succeeds.</p>
      <div class="review-block">
        <h3>${F.escapeHtml(input.question)}</h3>
        <div class="prewrap muted">${F.escapeHtml(input.criteria)}</div>
        <div class="prewrap muted">${F.escapeHtml(input.source)}</div>
      </div>
      <div class="kv-list">
        <div><span>Contract</span><strong class="mono">${F.escapeHtml(target)}</strong></div>
        <div><span>Resolver</span><strong class="mono">${F.escapeHtml(input.resolver)}</strong></div>
        <div><span>closeTime</span><strong>${F.formatDateTime(input.closeTime)}</strong></div>
        <div><span>resolveDeadline</span><strong>${F.formatDateTime(input.resolveDeadline)}</strong></div>
        <div><span>Metadata bytes</span><strong>${F.utcByteLength(input.question)} / ${F.utcByteLength(
          input.criteria,
        )} / ${F.utcByteLength(input.source)}</strong></div>
      </div>
      <p class="hint">There are no admin withdrawals, upgrades, or result overrides. The resolver can only select an outcome.</p>
    `,
    onConfirm: async () => {
      const chainNow = await readChainTime();
      if (input.closeTime <= BigInt(chainNow)) {
        throw new Error('The closing time has passed according to the chain. Update it and review again.');
      }
      await sendWrite('createMarket', {to: target, data: encodeCreateMarket(input)}, async (receipt) => {
        const marketId = marketIdFromReceipt(receipt, target);
        if (marketId === null) {
          throw new Error('No MarketCreated event from the target contract was found. The market ID has not been verified.');
        }
        invalidateMarkets();
        stats = null;
        statsError = null;
        draft = defaultDraft();
        navigateToMarket(marketId);
        void refreshGlobalStats();
        showToast(`Market #${marketId.toString()} created.`, 'ok');
      }, account);
    },
  });
}

async function reviewStake(id: bigint, side: Side): Promise<void> {
  const target = requireDeploymentAddress();
  const account = walletAccount();
  if (!account) throw new Error('Connect your QIE wallet first.');
  requireSession(account);
  const input = document.getElementById('stake-amount');
  if (!(input instanceof HTMLInputElement)) throw new Error('Stake input not found.');
  const amount = F.parseQie(input.value);
  if (amount <= 0n) throw new Error('Stake must be greater than zero.');
  const [market, balance] = await Promise.all([readMarket(target, id), readNativeBalance(account)]);
  const chainNow = await readChainTime();
  if (F.marketPhase(market, chainNow) !== 'OPEN') {
    throw new Error('This market is closed to stakes according to the chain timestamp.');
  }
  if (amount > balance) {
    throw new Error(`Wallet balance ${F.formatQie(balance)} QIE is less than the stake of ${F.formatQie(amount)} QIE (excluding gas).`);
  }
  const sideLabel = side === 0 ? 'YES' : 'NO';
  const estimate = F.estimatePayoutForStake(market.yesStake, market.noStake, side, amount);
  requireSession(account);
  openModal({
    title: `Review stake ${sideLabel}`,
    confirmLabel: `Stake ${sideLabel}`,
    tone: side === 0 ? 'primary' : 'danger',
    body: `
      <p>Stake <b>${F.formatQie(amount)} QIE</b> on <b class="${side === 0 ? 'yes-text' : 'no-text'}">${sideLabel}</b>.</p>
      <div class="kv-list">
        <div><span>Market</span><strong class="mono">#${id.toString()}</strong></div>
        <div><span>Question</span><strong>${F.escapeHtml(market.question)}</strong></div>
        <div><span>Current pool</span><strong>YES ${F.formatQie(market.yesStake)} · NO ${F.formatQie(market.noStake)} QIE</strong></div>
        <div><span>Estimated payout if you win</span><strong>${F.formatQie(estimate)} QIE</strong></div>
        <div><span>Wallet balance</span><strong>${F.formatQie(balance)} QIE</strong></div>
      </div>
      <p class="hint">Final payouts depend on the pool at resolution. If your side loses, your stake is not returned. Estimates are not guaranteed.</p>
    `,
    onConfirm: async () => {
      const fresh = await readMarket(target, id);
      const now = await readChainTime();
      if (F.marketPhase(fresh, now) !== 'OPEN') {
        throw new Error('The market has closed according to the chain. Your stake was not sent.');
      }
      await sendWrite(`Stake ${sideLabel} #${id.toString()}`, {
        to: target,
        data: encodeStake(id, side),
        value: amount,
      }, async () => {
        refreshAfterWrite(`Stake ${F.formatQie(amount)} QIE on ${sideLabel} confirmed.`);
      }, account);
    },
  });
}

async function reviewResolve(id: bigint, outcome: 1 | 2 | 3): Promise<void> {
  const target = requireDeploymentAddress();
  const account = walletAccount();
  if (!account) throw new Error('Connect your QIE wallet first.');
  requireSession(account);
  const market = await readMarket(target, id);
  const chainNow = await readChainTime();
  if (!sameAddress(market.resolver, account)) throw new Error('This wallet is not the market’s resolver.');
  if (F.marketPhase(market, chainNow) !== 'AWAITING_RESOLUTION') {
    throw new Error('The resolution window is not active according to the chain timestamp.');
  }
  const label = F.outcomeLabel(outcome);
  requireSession(account);
  openModal({
    title: `Review resolution ${label}`,
    confirmLabel: `Resolve ${label}`,
    tone: outcome === 3 ? 'danger' : 'primary',
    body: `
      <p>The outcome is <b>final</b>. It cannot be changed, cancelled, or overridden by an admin.</p>
      <div class="kv-list">
        <div><span>Market</span><strong>#${id.toString()} — ${F.escapeHtml(market.question)}</strong></div>
        <div><span>Outcome</span><strong>${label}</strong></div>
        <div><span>Pool</span><strong>YES ${F.formatQie(market.yesStake)} · NO ${F.formatQie(market.noStake)} QIE</strong></div>
        <div><span>Escrow</span><strong>${F.formatQie(market.remainingEscrow)} QIE</strong></div>
      </div>
      ${
        outcome === 3
          ? `<p class="hint">INVALID enables a full YES + NO refund for every unsettled position.</p>`
          : `<p class="hint">Losing stakes are not refundable. If the winning side has no stakes, refunds are automatically enabled for every position.</p>`
      }
    `,
    onConfirm: async () => {
      const fresh = await readMarket(target, id);
      const now = await readChainTime();
      if (!sameAddress(fresh.resolver, account)) throw new Error('This wallet is no longer the resolver.');
      if (F.marketPhase(fresh, now) !== 'AWAITING_RESOLUTION') {
        throw new Error('The resolution window is no longer active. The result was not sent.');
      }
      await sendWrite(`Resolve #${id.toString()} ${label}`, {
        to: target,
        data: encodeResolve(id, outcome),
      }, async () => {
        refreshAfterWrite(`Market #${id.toString()} resolved: ${label}.`);
      }, account);
    },
  });
}

async function reviewCancel(id: bigint): Promise<void> {
  const target = requireDeploymentAddress();
  const account = walletAccount();
  if (!account) throw new Error('Connect your QIE wallet first.');
  requireSession(account);
  const market = await readMarket(target, id);
  const chainNow = await readChainTime();
  if (F.marketPhase(market, chainNow) !== 'EXPIRED_UNRESOLVED') {
    throw new Error('The market cannot be cancelled yet according to the chain timestamp.');
  }
  requireSession(account);
  openModal({
    title: 'Review market cancellation',
    confirmLabel: 'Cancel & enable refunds',
    tone: 'danger',
    body: `
      <p>Market <b>#${id.toString()}</b> is unresolved and past its resolution deadline.</p>
      <div class="kv-list">
        <div><span>Question</span><strong>${F.escapeHtml(market.question)}</strong></div>
        <div><span>closeTime</span><strong>${F.formatDateTime(market.closeTime)}</strong></div>
        <div><span>resolveDeadline</span><strong>${F.formatDateTime(market.resolveDeadline)}</strong></div>
        <div><span>Escrow</span><strong>${F.formatQie(market.remainingEscrow)} QIE</strong></div>
      </div>
      <p class="hint">Cancellation does not move funds. Each position owner must request their refund. Cancellation is permanent.</p>
    `,
    onConfirm: async () => {
      const fresh = await readMarket(target, id);
      const now = await readChainTime();
      if (F.marketPhase(fresh, now) !== 'EXPIRED_UNRESOLVED') {
        throw new Error('The market cannot be cancelled in its current phase. The transaction was not sent.');
      }
      await sendWrite(`Cancel #${id.toString()}`, {
        to: target,
        data: encodeCancelIfExpired(id),
      }, async () => {
        refreshAfterWrite(`Market #${id.toString()} cancelled; refunds enabled.`);
      }, account);
    },
  });
}

async function reviewClaim(id: bigint): Promise<void> {
  const target = requireDeploymentAddress();
  const account = walletAccount();
  if (!account) throw new Error('Connect your QIE wallet first.');
  requireSession(account);
  const [market, state] = await Promise.all([readMarket(target, id), readMarketAccountState(target, id, account)]);
  if (state.projectedPayout <= 0n) throw new Error('No payout is available to claim.');
  const input = document.getElementById('recipient-input');
  const rawRecipient = input instanceof HTMLInputElement ? input.value : '';
  const recipient = parseRecipient(rawRecipient, target);
  requireSession(account);
  openModal({
    title: 'Review payout claim',
    confirmLabel: recipient ? 'Send claim to recipient' : 'Claim payout',
    tone: 'primary',
    body: `
      <p>Claim payout <b>${F.formatQie(state.projectedPayout)} QIE</b> from market <b>#${id.toString()}</b>.</p>
      <div class="kv-list">
        <div><span>Outcome</span><strong>${F.outcomeLabel(market.outcome)}</strong></div>
        <div><span>Question</span><strong>${F.escapeHtml(market.question)}</strong></div>
        <div><span>Recipient</span><strong class="mono">${F.escapeHtml(recipient ?? account)}</strong></div>
        <div><span>Winning stake</span><strong>YES ${F.formatQie(state.position.yes)} · NO ${F.formatQie(
          state.position.no,
        )} QIE</strong></div>
      </div>
      <p class="hint">Only the entitled account can claim. The contract recalculates the payout when the transaction executes.</p>
    `,
    onConfirm: async () => {
      const fresh = await readMarketAccountState(target, id, account);
      if (fresh.projectedPayout <= 0n) throw new Error('The payout is no longer available. The contract state changed before the transaction was sent.');
      await sendWrite(`Claim #${id.toString()}`, {
        to: target,
        data: recipient ? encodeClaimTo(id, recipient) : encodeClaim(id),
      }, async () => {
        refreshAfterWrite(`Claim #${id.toString()} confirmed.`);
      }, account);
    },
  });
}

async function reviewRefund(id: bigint): Promise<void> {
  const target = requireDeploymentAddress();
  const account = walletAccount();
  if (!account) throw new Error('Connect your QIE wallet first.');
  requireSession(account);
  const [market, state] = await Promise.all([readMarket(target, id), readMarketAccountState(target, id, account)]);
  if (!market.refundable) throw new Error('Refunds are not enabled for this market.');
  if (state.projectedRefund <= 0n) throw new Error('No stake is currently available to refund.');
  const input = document.getElementById('recipient-input');
  const rawRecipient = input instanceof HTMLInputElement ? input.value : '';
  const recipient = parseRecipient(rawRecipient, target);
  requireSession(account);
  openModal({
    title: 'Review refund',
    confirmLabel: recipient ? 'Send refund to recipient' : 'Request refund',
    tone: 'primary',
    body: `
      <p>Full refund <b>${F.formatQie(state.projectedRefund)} QIE</b> from market <b>#${id.toString()}</b>.</p>
      <div class="kv-list">
        <div><span>Refund reason</span><strong>${market.cancelled ? 'Market cancelled' : F.outcomeLabel(market.outcome)}</strong></div>
        <div><span>Question</span><strong>${F.escapeHtml(market.question)}</strong></div>
        <div><span>Stake YES + NO</span><strong>${F.formatQie(state.position.yes)} + ${F.formatQie(
          state.position.no,
        )} QIE</strong></div>
        <div><span>Recipient</span><strong class="mono">${F.escapeHtml(recipient ?? account)}</strong></div>
      </div>
      <p class="hint">Refund returns all YES + NO stakes for this wallet. The position is then settled and cannot be refunded again.</p>
    `,
    onConfirm: async () => {
      const fresh = await readMarketAccountState(target, id, account);
      if (fresh.projectedRefund <= 0n) throw new Error('Refund is no longer available. Contract state changed before the transaction was sent.');
      await sendWrite(`Refund #${id.toString()}`, {
        to: target,
        data: recipient ? encodeRefundTo(id, recipient) : encodeRefund(id),
      }, async () => {
        refreshAfterWrite(`Refund #${id.toString()} confirmed.`);
      }, account);
    },
  });
}

// -------------------------------------------------------------------- actions


function readBookmarks(): Set<string> {
  try { return parseBookmarks(localStorage.getItem('qie-predict:bookmarks:v1')); }
  catch { return new Set(); }
}

function bookmarkButtonHtml(key: string): string {
  const saved = bookmarks.has(key);
  return `<button class="icon-btn bookmark-button ${saved ? 'is-saved' : ''}" type="button" data-action="bookmark" data-key="${F.escapeHtml(key)}" aria-label="${saved ? 'Remove from watchlist' : 'Save market'}" aria-pressed="${saved}">${icon('bookmark', 18)}</button>`;
}

function categoryNavHtml(): string {
  return CATEGORIES.map((category) => `<button class="category-button ${listState.category === category.id ? 'active' : ''}" type="button" data-action="category" data-category="${category.id}" aria-pressed="${listState.category === category.id}">${icon(category.icon, 17)} ${category.label}</button>`).join('');
}

function featuredHtml(): string {
  const collections = [
    {category: 'crypto', image: 'crypto', label: 'Crypto', title: 'The next big move.', description: 'Bitcoin, Ethereum & beyond', glyph: 'bitcoin'},
    {category: 'sports', image: 'sports', label: 'Sports', title: 'Every game. Every angle.', description: 'Final whistles & defining moments', glyph: 'trophy'},
    {category: 'technology', image: 'technology', label: 'Technology', title: 'Ahead of the curve.', description: 'AI breakthroughs & new frontiers', glyph: 'chip'},
  ];
  return collections.map((item) => `<button class="collection-card collection-${item.category}" type="button" data-action="category" data-category="${item.category}" aria-label="Explore ${item.label.toLowerCase()} markets"><img src="/media/${item.image}.webp" alt="" width="960" height="480" fetchpriority="${item.category === 'crypto' ? 'high' : 'auto'}" /><span class="collection-shade"></span><span class="collection-label">${icon(item.glyph, 15)} ${item.label}</span><span class="collection-copy"><strong>${item.title}</strong><span>${item.description}</span></span><span class="collection-arrow">${icon('arrow', 19)}</span></button>`).join('');
}

function ideaCardHtml(idea: MarketIdea): string {
  const category = CATEGORIES.find((item) => item.id === idea.category)!;
  return `<article class="market-card idea-card"><div class="market-card-top"><span class="topic-icon topic-${idea.category}">${icon(category.icon, 22)}</span><span class="market-category">${category.label}</span>${bookmarkButtonHtml(`idea:${idea.id}`)}</div>
    <button class="market-question idea-question" type="button" data-action="use-idea" data-idea="${idea.id}"><h3>${F.escapeHtml(idea.title)}</h3></button>
    <p class="idea-description">${F.escapeHtml(idea.description)}</p>
    <div class="idea-state"><span class="idea-tag"><span class="status-dot"></span> Starter idea</span><span>Not open for stakes</span></div>
    <button class="idea-start" type="button" data-action="use-idea" data-idea="${idea.id}">Create this market ${icon('arrow', 17)}</button>
    <div class="market-card-foot"><span>${icon('clock', 14)} ${idea.days}-day template</span><span>Define the rules</span></div></article>`;
}

function emptyDiscoveryHtml(): string {
  return `<div class="card empty-state"><span class="empty-icon">${icon(route.name === 'watchlist' ? 'bookmark' : 'search', 30)}</span><h2>${route.name === 'watchlist' ? 'Your watchlist is empty.' : 'No matching markets.'}</h2><p>${route.name === 'watchlist' ? 'Save a market or starter idea to follow it here.' : 'Try another keyword or explore a different category.'}</p><button class="btn" type="button" data-action="clear-filters">Reset filters</button><a class="text-btn" href="#/">Explore all markets ${icon('arrow', 15)}</a></div>`;
}

function ideasHtml(): string {
  const saved = route.name === 'watchlist';
  const ideas = listState.phase !== 'ALL' ? [] : filterIdeas(listState.query, listState.category).filter((idea) => !saved || bookmarks.has(`idea:${idea.id}`));
  return `${saved ? '' : `<div class="explore-notice">${icon('sparkles', 19)}<span><strong>Start with an idea.</strong> These are market templates. Add rules and publish to open for stakes.</span><a href="#/network">Connection help ${icon('arrow', 15)}</a></div>`}
    ${ideas.length ? `<div class="list-meta"><span>${ideas.length} ${saved ? 'saved ideas' : 'starter ideas'}</span><span>Native QIE · On-chain settlement</span></div><div class="market-grid">${ideas.map(ideaCardHtml).join('')}</div>` : emptyDiscoveryHtml()}`;
}

function startIdea(id: string): void {
  const idea = MARKET_IDEAS.find((item) => item.id === id);
  if (!idea) throw new Error('Market idea not found.');
  const close = BigInt(F.nowSec() + idea.days * 86_400);
  draft = {...defaultDraft(), question: idea.title, closeTime: F.toDateTimeLocal(close),
    resolveDeadline: F.toDateTimeLocal(close + 7n * 86_400n), resolver: walletAccount() ?? ''};
  if (location.hash === '#/create') renderCreatePage();
  else location.hash = '#/create';
  showToast('Draft ready. Add resolution criteria and a source before publishing.', 'info');
}

function renderLearnPage(): void {
  const view = document.getElementById('view');
  if (!view) return;
  view.innerHTML = `<section class="page-head learn-head"><div class="eyebrow">HOW IT WORKS</div><h1>A question. Two sides. Your call.</h1><p>QIE Predict brings different views together in simple, on-chain prediction pools.</p></section>
    <div class="learn-steps"><article><span class="step-number">01</span>${icon('search', 28)}<h2>Find your question.</h2><p>Explore a market. Read its resolution criteria, reference source, closing time, and designated resolver.</p></article><article><span class="step-number">02</span>${icon('wallet', 28)}<h2>Take a side.</h2><p>Connect on QIE Testnet. Choose YES or NO, enter your stake in QIE, then review and approve in your wallet.</p></article><article><span class="step-number">03</span>${icon('trophy', 28)}<h2>Follow the result.</h2><p>After resolution, the winning side shares the pool in proportion to its stakes. Claim your payout from your portfolio.</p></article></div>
    <section class="faq-section"><div><div class="eyebrow">BEFORE YOU START</div><h2>Good questions.</h2><p class="muted">Get to know the rules behind the market.</p><a class="btn primary" href="#/">Explore markets ${icon('arrow', 17)}</a></div><div class="faq-list">
      <details open><summary>Are the YES/NO percentages winning odds?</summary><p>They show each side’s share of the staked pool. They are not probabilities or share prices. Pool shares and payout estimates can change until staking closes.</p></details>
      <details><summary>How are payouts calculated?</summary><p>Payout = your winning stake × total pool ÷ total winning stake, rounded down. Losing stakes are not returned after a valid result. Rounding dust stays in escrow.</p></details>
      <details><summary>Who decides the result?</summary><p>The resolver selected by the market creator. This is a manual role, so choose a resolver you trust. The result is final once set.</p></details>
      <details><summary>What happens if a market is not resolved?</summary><p>After the resolution deadline, anyone can cancel an unresolved market. Position owners can then request a full refund. INVALID results and winning sides with no stakes also enable refunds.</p></details>
      <details><summary>Does this use real money?</summary><p>This platform uses QIE Testnet, chain 1983. Get test QIE from the faucet to try it. Do not send assets from another network.</p><a href="${C.QIE_FAUCET}" target="_blank" rel="noopener noreferrer">Open QIE faucet ${icon('external', 14)}</a></details>
      <details><summary>What is a starter idea?</summary><p>A draft question you can turn into a market. Ideas have no pool, accept no stakes, and offer no payouts. Add criteria and a source, then publish to a verified contract to open a market.</p></details>
    </div></section>`;
}

async function importPlatformManifest(): Promise<void> {
  const input = document.getElementById('manifest-json');
  if (!(input instanceof HTMLTextAreaElement)) throw new Error('Configuration form not found.');
  const parsed = parseManifestJson(input.value);
  if (parsed.kind !== 'ACTIVE') throw new Error(parsed.kind === 'INVALID' ? parsed.reason : 'Configuration must specify an ACTIVE contract.');
  showToast('Verifying the contract and accounting on QIE Testnet…');
  const verification = await verifyContractRuntime(getAddress(parsed.manifest.address), parsed.manifest.artifact.runtimeBytecodeKeccak256);
  networkRequest += 1;
  network = {status: 'ok', chainId: C.QIE_CHAIN_ID, blockNumber: verification.blockNumber, error: null};
  statsRequest += 1;
  sessionDeployment = {manifest: parsed.manifest, verification};
  invalidateMarkets();
  stats = verification.stats;
  statsError = null;
  render();
  showToast('Contract verified. The platform is ready for this session.', 'ok');
}

function blankWalletSnapshot(): WalletSnapshot {
  return {phase: 'disconnected', account: null, chainId: null, error: null, info: null};
}

function dataHash(el: HTMLElement): string {
  const raw = el.dataset.hash;
  if (!raw || !/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error('Invalid transaction hash');
  return raw;
}

function isCreateField(value: string): value is keyof CreateDraft {
  return (
    value === 'question' ||
    value === 'criteria' ||
    value === 'source' ||
    value === 'resolver' ||
    value === 'closeTime' ||
    value === 'resolveDeadline'
  );
}

function parseListPhase(value: string): ListPhase | null {
  if (value === 'ALL' || value === 'OPEN' || value === 'AWAITING_RESOLUTION' || value === 'EXPIRED_UNRESOLVED' || value === 'RESOLVED') {
    return value;
  }
  return null;
}

function parseListSort(value: string): ListSort | null {
  if (value === 'newest' || value === 'closing' || value === 'pool') return value;
  return null;
}

async function connectWallet(uuid: string | undefined): Promise<void> {
  if (!uuid) throw new Error('The selected wallet has no identifier.');
  const info = wallets.find((wallet) => wallet.uuid === uuid);
  if (!info) throw new Error('Wallet not found. Reload the page and try again.');
  walletSession?.dispose();
  currentDetail = null;
  invalidatePortfolio();
  const session = createWalletSession(info, C.QIE_CHAIN_ID, (snapshot) => {
    const previous = walletSnapshot;
    walletSnapshot = snapshot;
    if (snapshot.phase !== 'ready' || !sameAddress(previous.account, snapshot.account)) {
      currentDetail = null;
      invalidatePortfolio();
    }
    render();
  });
  walletSession = session;
  await session.connect(info, C.QIE_CHAIN_ID);
  const snapshot = session.snapshot();
  if (snapshot.phase === 'ready') {
    showToast(`Wallet connected: ${F.shortAddress(snapshot.account ?? '')} · chain 1983`, 'ok');
    return;
  }
  if (snapshot.error) showToast(walletErrorText(snapshot.error), 'err');
}

function disconnectWallet(): void {
  walletSession?.dispose();
  walletSession = null;
  walletSnapshot = blankWalletSnapshot();
  currentDetail = null;
  invalidatePortfolio();
  render();
  showToast('Wallet disconnected. Your account session has been cleared.', 'info');
}

async function handleAction(action: string, el: HTMLElement): Promise<void> {
  switch (action) {
    case 'skip-to-content': {
      const view = document.getElementById('view');
      view?.focus({preventScroll: true});
      view?.scrollIntoView({block: 'start'});
      return;
    }
    case 'category': {
      const category = el.dataset.category ?? '';
      if (!isCategory(category)) return;
      listState.category = category;
      listState.page = 0;
      const clickedNav = el.closest('.category-nav');
      document.querySelectorAll('.category-nav').forEach((nav) => { nav.innerHTML = categoryNavHtml(); });
      clickedNav?.querySelector<HTMLButtonElement>(`[data-category="${category}"]`)?.focus({preventScroll: true});
      if (route.name !== 'list' && route.name !== 'watchlist') location.hash = '#/';
      else renderListResults();
      return;
    }
    case 'bookmark': {
      const key = el.dataset.key ?? '';
      if (parseBookmarks(JSON.stringify([key])).size !== 1) return;
      if (bookmarks.has(key)) bookmarks.delete(key); else bookmarks.add(key);
      try { localStorage.setItem(BOOKMARK_STORAGE, JSON.stringify([...bookmarks])); }
      catch { showToast('Saved for this session. Browser storage is unavailable.', 'warn'); }
      renderListResults();
      const nextFocus = [...document.querySelectorAll<HTMLButtonElement>('[data-action="bookmark"]')].find((button) => button.dataset.key === key);
      (nextFocus ?? document.getElementById('markets-heading'))?.focus({preventScroll: true});
      return;
    }
    case 'use-idea':
      startIdea(el.dataset.idea ?? '');
      return;
    case 'view-market':
      preferredStakeSide = dataSide(el);
      navigateToMarket(dataId(el));
      return;
    case 'stake-amount': {
      const input = document.getElementById('stake-amount');
      if (input instanceof HTMLInputElement) {
        input.value = el.dataset.amount ?? '';
        updateStakeEstimate();
        input.focus();
      }
      return;
    }
    case 'import-manifest':
      await importPlatformManifest();
      return;
    case 'connect':
      await connectWallet(el.dataset.uuid);
      return;
    case 'connect-first': {
      if (walletsLoading) {
        showToast('Discovering wallets. Try again in a moment.');
        return;
      }
      if (wallets.length > 0) {
        await connectWallet(wallets[0]!.uuid);
        return;
      }
      openModal({title: 'Connect QIE Wallet', confirmLabel: 'Find wallets again', tone: 'primary',
        body: `<div class="connect-illustration">${icon('wallet', 42)}</div><p>Use QIE Wallet to make predictions and manage your positions.</p><ol class="step-list"><li>Install or open the QIE Wallet extension.</li><li>Enable Testnet in your wallet settings.</li><li>Return here and connect your wallet.</li></ol><a class="btn" href="${C.QIE_WALLET_URL}" target="_blank" rel="noopener noreferrer">Visit QIE ${icon('external', 16)}</a>`,
        onConfirm: loadWallets});
      return;
    }
    case 'disconnect':
      disconnectWallet();
      return;
    case 'refresh-chain':
      if (!walletSession) throw new Error('No wallet session is active.');
      await walletSession.refreshChain();
      showToast('Wallet network status updated.', 'info');
      return;
    case 'retry-platform':
      await refreshNetwork();
      await loadDeployment();
      return;
    case 'refresh-network':
      await refreshNetwork();
      return;
    case 'refresh-deployment':
      await loadDeployment();
      return;
    case 'refresh-markets':
      invalidateMarkets();
      render();
      return;
    case 'refresh-detail':
      render();
      return;
    case 'refresh-portfolio':
      invalidatePortfolio();
      render();
      return;
    case 'refresh-resolver':
      invalidateMarkets();
      render();
      return;
    case 'list-prev':
      listState.page = Math.max(0, listState.page - 1);
      renderListResults();
      return;
    case 'list-next':
      listState.page += 1;
      renderListResults();
      return;
    case 'clear-filters':
      listState = {page: 0, pageSize: listState.pageSize, query: '', phase: 'ALL', sort: 'newest', category: 'all'};
      render();
      return;
    case 'use-my-address': {
      const account = walletAccount();
      if (!account) throw new Error('Connect your QIE wallet first.');
      draft.resolver = account;
      const input = document.getElementById('create-resolver');
      if (input instanceof HTMLInputElement) input.value = account;
      showToast('Resolver set to your active wallet address.', 'info');
      return;
    }
    case 'reset-create':
      draft = defaultDraft();
      renderCreatePage();
      showToast('Market draft reset.', 'info');
      return;
    case 'stake-review':
      await reviewStake(dataId(el), dataSide(el));
      return;
    case 'resolve-review':
      await reviewResolve(dataId(el), dataOutcome(el));
      return;
    case 'cancel-review':
      await reviewCancel(dataId(el));
      return;
    case 'claim-review':
      await reviewClaim(dataId(el));
      return;
    case 'refund-review':
      await reviewRefund(dataId(el));
      return;
    case 'deploy-review':
      reviewDeploy();
      return;
    case 'download-manifest':
      downloadManifest();
      return;
    case 'verify-deployment':
      await verifyCurrentDeployment();
      return;
    case 'modal-close':
      closeModal();
      return;
    case 'modal-confirm':
      await confirmModal();
      return;
    case 'tx-check':
      await checkTx(dataHash(el));
      return;
    case 'tx-toggle':
      txDockExpanded = txDockRoot?.dataset.expanded !== 'true';
      renderTxDock();
      return;
    case 'tx-dismiss':
      dismissTx(dataHash(el));
      return;
    case 'tx-clear':
      clearTx();
      return;
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// --------------------------------------------------------------- event wiring

function routeKey(value: Route): string {
  return value.name === 'detail' ? `detail:${value.id.toString()}` : value.name;
}

function onDocumentClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const backdrop = target.closest('[data-modal-backdrop]');
  if (backdrop && target === backdrop) {
    closeModal();
    return;
  }

  const actionEl = target.closest('[data-action]');
  if (!(actionEl instanceof HTMLElement)) return;
  const action = actionEl.dataset.action;
  if (!action) return;
  if (actionEl instanceof HTMLButtonElement && actionEl.disabled) return;
  event.preventDefault();
  runAction(() => handleAction(action, actionEl));
}

function onDocumentSubmit(event: SubmitEvent): void {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === 'search-form') {
    event.preventDefault();
    const input = document.getElementById('list-search');
    if (input instanceof HTMLInputElement) {
      listState.query = input.value;
      listState.page = 0;
      if (route.name !== 'list' && route.name !== 'watchlist') location.hash = '#/';
      else renderListResults();
    }
    return;
  }
  if (form.id === 'create-form') {
    event.preventDefault();
    runAction(async () => reviewCreate());
  }
}

function onDocumentInput(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

  if (target.id === 'list-search' && target instanceof HTMLInputElement) {
    listState.query = target.value;
    listState.page = 0;
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      renderListResults();
    }, 180);
    return;
  }

  if (target.id === 'stake-amount') {
    updateStakeEstimate();
    return;
  }

  const field = target.dataset.createField;
  if (field && isCreateField(field)) {
    draft[field] = target.value;
    updateCreateCounters();
  }
}

function onDocumentChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.id === 'list-phase') {
    const phase = parseListPhase(target.value);
    if (!phase) return;
    listState.phase = phase;
    listState.page = 0;
    renderListResults();
    return;
  }
  if (target.id === 'list-sort') {
    const sort = parseListSort(target.value);
    if (!sort) return;
    listState.sort = sort;
    listState.page = 0;
    renderListResults();
  }
}

function bindGlobalEvents(): void {
  window.addEventListener('hashchange', () => {
    const next = parseRoute();
    if (routeKey(next) === routeKey(route)) return;
    route = next;
    render();
    window.scrollTo({top: 0, behavior: 'smooth'});
  });
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('submit', onDocumentSubmit);
  document.addEventListener('input', onDocumentInput);
  document.addEventListener('change', onDocumentChange);
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !currentModal && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) {
      const search = document.getElementById('list-search');
      if (search instanceof HTMLInputElement) {event.preventDefault(); search.focus();}
    }
    if (event.key === 'Escape' && currentModal) closeModal();
    if (event.key === 'Tab' && currentModal) {
      const controls = [...(modalRoot?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') ?? [])];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first && last) {event.preventDefault(); last.focus();}
      else if (!event.shiftKey && document.activeElement === last && first) {event.preventDefault(); first.focus();}
    }
  });
  window.addEventListener('beforeunload', () => walletSession?.dispose());
}

bindGlobalEvents();
render();
void bootLoad();
