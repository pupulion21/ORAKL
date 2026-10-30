/** EIP-6963 / EIP-1193 wallet session for QIE Predict.
 *
 *  Rules enforced here:
 *  - discovery never connects; `eth_requestAccounts` runs only after a user click;
 *  - QIE Wallet is preferred by its EIP-6963 rdns `me.qiewallet`, never by
 *    sniffing `isMetaMask`;
 *  - `eth_chainId` must be 1983 before any write; the app never switches networks
 *    silently and never calls `wallet_addEthereumChain`;
 *  - 4902 is surfaced as "testnet is not enabled in the wallet", because QIE Wallet hides
 *    testnet until its testnet toggle is enabled;
 *  - account/chain changes invalidate account-scoped UI state;
 *  - a write is sent at most once per user confirmation; there is no auto-retry.
 */

import {QIE_CHAIN_ID, QIE_WALLET_RDNS} from './constants.ts';

export interface Eip1193Provider {
  request(args: {method: string; params?: unknown[]}): Promise<unknown>;
  on?(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
}

export interface WalletInfo {
  uuid: string;
  name: string;
  rdns: string;
  icon?: string;
  provider: Eip1193Provider;
}

export type WalletPhase = 'disconnected' | 'connecting' | 'ready' | 'wrong-chain';

export type WalletErrorKind =
  | 'USER_REJECTED'
  | 'WRONG_CHAIN'
  | 'CHAIN_UNKNOWN'
  | 'REQUEST_PENDING'
  | 'PROVIDER_ERROR'
  | 'MALFORMED';

export interface WalletError {
  kind: WalletErrorKind;
  message: string;
  code?: number;
  expectedChainId?: number;
  observedChainId?: number | null;
}

export interface WalletSnapshot {
  phase: WalletPhase;
  account: string | null;
  chainId: number | null;
  error: WalletError | null;
  info: WalletInfo | null;
}

export interface WalletTransaction {
  /** Omit for contract creation. */
  to?: string;
  data: string;
  value?: bigint;
}

export interface WalletSession {
  snapshot(): WalletSnapshot;
  connect(info: WalletInfo, expectedChainId: number): Promise<void>;
  disconnect(): void;
  refreshChain(): Promise<void>;
  request<T>(method: string, params?: unknown[]): Promise<T>;
  sendTransaction(tx: WalletTransaction): Promise<string>;
  dispose(): void;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

function initialSnapshot(): WalletSnapshot {
  return {phase: 'disconnected', account: null, chainId: null, error: null, info: null};
}

function walletErrorMessage(error: WalletError): string {
  switch (error.kind) {
    case 'USER_REJECTED':
      return 'Request cancelled in your wallet. No transaction was sent.';
    case 'WRONG_CHAIN':
      return `Your wallet is on chain ${error.observedChainId ?? 'unknown'}, instead of QIE Testnet (${QIE_CHAIN_ID}). Switch networks in your wallet and reconnect.`;
    case 'CHAIN_UNKNOWN':
      return 'QIE Testnet is not enabled (error 4902). Turn on the Testnet toggle in QIE Wallet, then reconnect. The app does not add networks automatically.';
    case 'REQUEST_PENDING':
      return 'Your wallet has a pending request. Open it and finish that request first.';
    case 'MALFORMED':
      return `Invalid wallet response: ${error.message}`;
    case 'PROVIDER_ERROR':
      return `Wallet menolak permintaan: ${error.message}`;
  }
}

export function walletErrorText(error: WalletError | null): string {
  return error ? walletErrorMessage(error) : '';
}

function classifyError(error: unknown, expectedChainId: number, observedChainId?: number | null): WalletError {
  const value = error as {code?: number; message?: string; shortMessage?: string; details?: string} | null;
  const code = typeof value?.code === 'number' ? value.code : undefined;
  const message = value?.shortMessage ?? value?.message ?? value?.details ?? String(error);

  if (code === 4001) return {kind: 'USER_REJECTED', message, code, expectedChainId};
  if (code === 4902) return {kind: 'CHAIN_UNKNOWN', message, code, expectedChainId};
  if (code === -32002) return {kind: 'REQUEST_PENDING', message, code, expectedChainId};
  if (code === 4900 || code === 4901) {
    return {kind: 'PROVIDER_ERROR', message, code, expectedChainId, observedChainId};
  }
  return {kind: 'PROVIDER_ERROR', message, code, expectedChainId, observedChainId};
}

function parsedChainId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 16);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function quantity(value: bigint): string {
  if (value < 0n) throw new Error('Negative value is invalid');
  return `0x${value.toString(16)}`;
}

function addressFromAccounts(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  return typeof first === 'string' && ADDRESS_RE.test(first) ? first : null;
}

interface Eip6963Detail {
  info?: {uuid?: string; name?: string; icon?: string; rdns?: string};
  provider?: Eip1193Provider;
}

/** Discover injected wallets via EIP-6963. `window.qie` / `window.ethereum` are
 *  only fallbacks; they are never used to identify a wallet as MetaMask. */
export async function discoverWallets(timeoutMs = 350): Promise<WalletInfo[]> {
  if (typeof window === 'undefined') return [];

  const found = new Map<string, WalletInfo>();
  const providers = new Set<Eip1193Provider>();

  const remember = (info: WalletInfo) => {
    if (providers.has(info.provider)) return;
    const key = `${info.rdns}:${info.uuid}`;
    if (found.has(key)) return;
    found.set(key, info);
    providers.add(info.provider);
  };

  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Detail>).detail;
    if (!detail?.provider || !detail.info?.rdns) return;
    remember({
      uuid: detail.info.uuid ?? detail.info.rdns,
      name: detail.info.name ?? detail.info.rdns,
      rdns: detail.info.rdns,
      icon: detail.info.icon,
      provider: detail.provider,
    });
  };

  window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  window.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener);

  const legacy = window as unknown as {qie?: Eip1193Provider; ethereum?: Eip1193Provider};
  const hasQie = [...found.values()].some((wallet) => wallet.rdns === QIE_WALLET_RDNS);
  if (legacy.qie && !hasQie) {
    remember({uuid: 'window.qie', name: 'QIE Wallet', rdns: QIE_WALLET_RDNS, provider: legacy.qie});
  }
  if (legacy.ethereum && !providers.has(legacy.ethereum)) {
    remember({uuid: 'window.ethereum', name: 'Injected wallet', rdns: 'injected', provider: legacy.ethereum});
  }

  return [...found.values()].sort((a, b) => {
    const aQie = a.rdns === QIE_WALLET_RDNS ? 0 : 1;
    const bQie = b.rdns === QIE_WALLET_RDNS ? 0 : 1;
    if (aQie !== bQie) return aQie - bQie;
    return a.name.localeCompare(b.name);
  });
}

export function createWalletSession(
  info: WalletInfo,
  expectedChainId: number,
  onChange: (snapshot: WalletSnapshot) => void,
): WalletSession {
  let snapshot: WalletSnapshot = {...initialSnapshot(), info};
  let generation = 0;
  let listenersAttached = false;
  let disposed = false;

  const emit = () => {
    if (!disposed) onChange({...snapshot});
  };

  const setSnapshot = (next: WalletSnapshot) => {
    snapshot = next;
    emit();
  };

  const readChainId = async (): Promise<number> => {
    const value = await info.provider.request({method: 'eth_chainId'});
    const chainId = parsedChainId(value);
    if (chainId === null) throw new Error(`eth_chainId is not valid hexadecimal: ${String(value)}`);
    return chainId;
  };

  const applyObservedChain = (observed: number, account: string | null) => {
    if (observed === expectedChainId) {
      if (account) {
        setSnapshot({phase: 'ready', account, chainId: observed, error: null, info});
      } else {
        setSnapshot({phase: 'disconnected', account: null, chainId: observed, error: null, info});
      }
      return;
    }
    setSnapshot({
      phase: 'wrong-chain',
      account: null,
      chainId: observed,
      error: {
        kind: 'WRONG_CHAIN',
        message: `chain ${observed} instead of ${expectedChainId}`,
        expectedChainId,
        observedChainId: observed,
      },
      info,
    });
  };

  const onAccountsChanged = (accounts: unknown) => {
    if (disposed) return;
    const account = addressFromAccounts(accounts);
    if (account === null) {
      generation += 1;
      setSnapshot({phase: 'disconnected', account: null, chainId: snapshot.chainId, error: null, info});
      return;
    }
    const accountGeneration = ++generation;
    setSnapshot({phase: 'connecting', account: null, chainId: null, error: null, info});
    void readChainId()
      .then((observed) => {
        if (disposed || accountGeneration !== generation) return;
        applyObservedChain(observed, account);
      })
      .catch((error: unknown) => {
        if (disposed || accountGeneration !== generation) return;
        setSnapshot({
          phase: 'wrong-chain',
          account: null,
          chainId: null,
          error: classifyError(error, expectedChainId),
          info,
        });
      });
  };

  const onChainChanged = (chainHex: unknown) => {
    if (disposed) return;
    generation += 1;
    const observed = parsedChainId(chainHex);
    if (observed === null) {
      setSnapshot({
        phase: 'wrong-chain',
        account: null,
        chainId: null,
        error: {kind: 'MALFORMED', message: `chainChanged: ${String(chainHex)}`, expectedChainId},
        info,
      });
      return;
    }
    // If the provider re-announces the expected chain while a ready account is
    // still known, keep it. A wrong-chain event has already dropped the account,
    // so recovering from wrong-chain still requires a deliberate reconnect.
    const account = observed === expectedChainId && snapshot.phase === 'ready' ? snapshot.account : null;
    applyObservedChain(observed, account);
  };

  const onDisconnect = () => {
    if (disposed) return;
    generation += 1;
    setSnapshot({phase: 'disconnected', account: null, chainId: null, error: null, info});
  };

  const attachListeners = () => {
    if (listenersAttached) return;
    info.provider.on?.('accountsChanged', onAccountsChanged);
    info.provider.on?.('chainChanged', onChainChanged);
    info.provider.on?.('disconnect', onDisconnect);
    listenersAttached = true;
  };

  const detachListeners = () => {
    if (!listenersAttached) return;
    info.provider.removeListener?.('accountsChanged', onAccountsChanged);
    info.provider.removeListener?.('chainChanged', onChainChanged);
    info.provider.removeListener?.('disconnect', onDisconnect);
    listenersAttached = false;
  };

  return {
    snapshot: () => ({...snapshot}),

    async connect(_info, expected) {
      if (disposed) throw new Error('Wallet session disposed');
      if (expected !== expectedChainId) throw new Error('Inconsistent expectedChainId');
      attachListeners();
      const connectGeneration = ++generation;
      setSnapshot({phase: 'connecting', account: null, chainId: null, error: null, info});

      try {
        const accounts = await info.provider.request({method: 'eth_requestAccounts'});
        if (connectGeneration !== generation) return;
        const account = addressFromAccounts(accounts);
        if (account === null) {
          throw new Error('The wallet returned an empty or invalid account list');
        }
        const observed = await readChainId();
        if (connectGeneration !== generation) return;
        if (observed !== expectedChainId) {
          setSnapshot({
            phase: 'wrong-chain',
            account: null,
            chainId: observed,
            error: {
              kind: 'WRONG_CHAIN',
              message: `chain ${observed} instead of ${expectedChainId}`,
              expectedChainId,
              observedChainId: observed,
            },
            info,
          });
          return;
        }
        setSnapshot({phase: 'ready', account, chainId: observed, error: null, info});
      } catch (error) {
        if (connectGeneration !== generation) return;
        setSnapshot({
          phase: 'disconnected',
          account: null,
          chainId: null,
          error: classifyError(error, expectedChainId),
          info,
        });
      }
    },

    disconnect() {
      generation += 1;
      detachListeners();
      setSnapshot({phase: 'disconnected', account: null, chainId: null, error: null, info});
    },

    async refreshChain() {
      const refreshGeneration = ++generation;
      try {
        const observed = await readChainId();
        if (disposed || refreshGeneration !== generation) return;
        applyObservedChain(observed, snapshot.account);
      } catch (error) {
        if (disposed || refreshGeneration !== generation) return;
        setSnapshot({
          phase: 'wrong-chain',
          account: null,
          chainId: null,
          error: classifyError(error, expectedChainId),
          info,
        });
      }
    },

    async request<T>(method: string, params?: unknown[]): Promise<T> {
      if (disposed || snapshot.phase !== 'ready' || !snapshot.account) {
        throw new Error('Wallet not ready. Connect on QIE Testnet first');
      }
      return (await info.provider.request({method, params})) as T;
    },

    async sendTransaction(tx) {
      if (disposed || snapshot.phase !== 'ready' || !snapshot.account) {
        throw new Error('Wallet not ready. Connect on QIE Testnet first');
      }
      if (tx.to !== undefined && !ADDRESS_RE.test(tx.to)) throw new Error('Invalid transaction destination');
      if (!/^0x[0-9a-fA-F]*$/.test(tx.data) || tx.data.length < 2) throw new Error('Invalid transaction calldata');

      const sendGeneration = generation;
      const from = snapshot.account;
      const observed = await readChainId();
      if (disposed || sendGeneration !== generation || snapshot.phase !== 'ready' || snapshot.account !== from) {
        throw new Error('Your wallet session changed. Review the transaction again before sending.');
      }
      if (observed !== expectedChainId) {
        setSnapshot({
          phase: 'wrong-chain',
          account: null,
          chainId: observed,
          error: {
            kind: 'WRONG_CHAIN',
            message: `chain ${observed} instead of ${expectedChainId}`,
            expectedChainId,
            observedChainId: observed,
          },
          info,
        });
        throw new Error(`Wallet chain changed to ${observed}; transaction not sent`);
      }

      const params: Record<string, string> = {from, data: tx.data};
      if (tx.to !== undefined) params.to = tx.to;
      if (tx.value !== undefined) params.value = quantity(tx.value);

      const hash = await info.provider.request({method: 'eth_sendTransaction', params: [params]});
      if (typeof hash !== 'string' || !HASH_RE.test(hash)) {
        throw new Error(`The wallet returned an invalid transaction hash: ${String(hash)}`);
      }
      return hash;
    },

    dispose() {
      disposed = true;
      generation += 1;
      detachListeners();
      snapshot = {...initialSnapshot(), info};
    },
  };
}
