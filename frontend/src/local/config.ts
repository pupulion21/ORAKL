/** Local-app configuration for the ORAKL selected protocol on Anvil.
 *
 *  Chain: isolated Anvil, chain id 31337. No QIE Testnet fallback, no public
 *  RPC, no mainnet. The manifest (deployments/local-selected.json) is the only
 *  source of contract addresses, and it must pass the full verification gate
 *  before any read or write happens.
 */

import type {PublicClient} from 'viem';
import {createLocalPublicClient, LOCAL_CHAIN_ID, LOCAL_RPC_DEFAULT} from '../selected/chain.ts';

export const APP_TITLE = 'ORAKL Predict — Local';
export const WORKSPACE_LABEL = 'LOCAL';
export const NETWORK_LABEL = 'Anvil Local';
export const LOCAL_MODE = 'local-selected' as const;

const env = (import.meta as ImportMeta & {env?: Record<string, string | undefined>}).env;
const rpcOverride = env?.VITE_LOCAL_RPC_URL?.trim();

export const LOCAL_RPC_URL: string = rpcOverride && /^https?:\/\//.test(rpcOverride) ? rpcOverride : LOCAL_RPC_DEFAULT;
export const RPC_IS_OVERRIDE = Boolean(rpcOverride);

const apiOverride = env?.VITE_ORAKL_API_URL?.trim();
export const LOCAL_API_DEFAULT = 'http://127.0.0.1:4310';
export const LOCAL_API_URL: string = apiOverride && /^https?:\/\//.test(apiOverride) ? apiOverride : LOCAL_API_DEFAULT;

export const MANIFEST_URL = '/deployments/local-selected.json';

export const publicClient: PublicClient = createLocalPublicClient(LOCAL_RPC_URL);

export {LOCAL_CHAIN_ID};
