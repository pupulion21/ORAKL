import {createPublicClient, defineChain, fallback, http, type PublicClient} from 'viem';
import {
  QIE_CHAIN_ID,
  QIE_CHAIN_NAME,
  QIE_EXPLORER,
  QIE_NATIVE_DECIMALS,
  QIE_NATIVE_SYMBOL,
} from './constants.ts';

/** The only product network: QIE EVM Testnet (chain id 1983).
 *
 *  There is no mainnet and no local-chain fallback. `VITE_QIE_RPC_URL` may replace
 *  the official endpoint list, but the app still refuses to run unless eth_chainId
 *  reports 1983. rpc1 was observed failing TLS on 2026-10-29; rpc2/4/5 answered
 *  eth_chainId 0x7bf. All defaults are official QIE testnet endpoints.
 */
const DEFAULT_RPC_URLS = [
  'https://rpc2testnet.qie.digital/',
  'https://rpc4testnet.qie.digital/',
  'https://rpc5testnet.qie.digital/',
] as const;

const env = (import.meta as ImportMeta & {env?: Record<string, string | undefined>}).env;
const overrideRpc = env?.VITE_QIE_RPC_URL?.trim();

export const QIE_RPC_URLS: readonly string[] = overrideRpc ? [overrideRpc] : DEFAULT_RPC_URLS;
export const QIE_RPC_IS_OVERRIDE = Boolean(overrideRpc);

export const QIE_TESTNET = defineChain({
  id: QIE_CHAIN_ID,
  name: QIE_CHAIN_NAME,
  nativeCurrency: {name: 'QIE', symbol: QIE_NATIVE_SYMBOL, decimals: QIE_NATIVE_DECIMALS},
  rpcUrls: {default: {http: QIE_RPC_URLS}},
  blockExplorers: {default: {name: 'QIE Testnet Explorer', url: QIE_EXPLORER}},
  testnet: true,
});

const transports = QIE_RPC_URLS.map((url) =>
  http(url, {
    timeout: 20_000,
    retryCount: 1,
    retryDelay: 300,
  }),
);

/** Read-only client used by the UI and by deployment verification. */
export const publicClient: PublicClient = createPublicClient({
  chain: QIE_TESTNET,
  transport: fallback(transports, {rank: false, retryCount: 1}),
});

export function shortRpcLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
