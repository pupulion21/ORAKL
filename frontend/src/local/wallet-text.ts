/** Local-app wallet text.
 *
 *  The shared wallet session in src/wallet.ts is frozen and its built-in error
 *  strings name QIE Testnet (chain 1983). This module wraps the session's
 *  error kinds and rewrites them for the local Anvil context without editing
 *  the frozen module.
 */

import type {WalletError, WalletSnapshot} from '../wallet.ts';
import {LOCAL_CHAIN_ID} from './config.ts';

export function walletErrorTextLocal(error: WalletError | null): string {
  if (!error) return '';
  switch (error.kind) {
    case 'USER_REJECTED':
      return 'Request cancelled in your wallet. No transaction was sent.';
    case 'WRONG_CHAIN':
      return `Your wallet is on chain ${error.observedChainId ?? 'unknown'}, instead of the local Anvil chain (${LOCAL_CHAIN_ID}). Switch networks in your wallet and reconnect.`;
    case 'CHAIN_UNKNOWN':
      return `The local Anvil chain (${LOCAL_CHAIN_ID}) is not enabled in your wallet (error 4902). Add it with RPC ${location.origin === 'null' ? 'http://127.0.0.1:8546' : location.origin} and chain id ${LOCAL_CHAIN_ID}, then reconnect.`;
    case 'REQUEST_PENDING':
      return 'Your wallet has a pending request. Open it and finish that request first.';
    case 'MALFORMED':
      return `Invalid wallet response: ${error.message}`;
    case 'PROVIDER_ERROR':
      return `Wallet rejected the request: ${error.message}`;
  }
}

export function walletPhaseText(snapshot: WalletSnapshot): string {
  switch (snapshot.phase) {
    case 'disconnected':
      return 'Not connected';
    case 'connecting':
      return 'Connecting…';
    case 'ready':
      return 'Connected';
    case 'wrong-chain':
      return 'Wrong network';
  }
}
