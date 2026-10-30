// Shared viem client + types shim for the local indexer. No wallets, no keys.
import { createPublicClient as vCreatePublicClient, http, type Chain, type Transport } from "viem";

export type LocalTransportConfig = {
  transport: Transport;
  chain?: Chain;
};

export const createPublicClient = vCreatePublicClient;

export type PublicClient = ReturnType<typeof vCreatePublicClient<Transport, Chain | undefined>>;

/** Deliberately unused placeholder — the P1 indexer is a read-only process. */
export function createWalletClientsUnused(): never {
  throw new Error("wallet clients are prohibited in the indexer (read-only service)");
}
