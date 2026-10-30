// ORAKL P1 — selected factory + protocol config event catalog.
// LOCAL SIMULATION ONLY (Anvil, chainId 31337). Not a public deployment.
import type { Abi, Log } from "viem";
import { decodeEventLog } from "viem";

import factoryAbi from "../../abis/selected/SelectedMarketFactory.abi.json" with { type: "json" };
import configAbi from "../../abis/selected/ProtocolConfig.abi.json" with { type: "json" };

export const FACTORY_ABI = factoryAbi as Abi;
export const CONFIG_ABI = configAbi as Abi;

export const FACTORY_EVENT_NAMES = new Set<string>(
  (FACTORY_ABI.filter((a) => a.type === "event") as { name: string }[]).map((e) => e.name),
);

export const CONFIG_EVENT_NAMES = new Set<string>(
  (CONFIG_ABI.filter((a) => a.type === "event") as { name: string }[]).map((e) => e.name),
);

export type DecodedEvent = {
  eventName: string;
  args: Record<string, unknown>;
};

/**
 * Decode a raw log. Unknown signatures are SKIPPED (never stored as dangling
 * rows): the raw ingest only records events present in the shipped ABIs, and
 * the projection layer is the sole consumer of stored rows, so its inputs are
 * always well-formed. Returns null for events outside the catalog.
 */
export function decodeLog(log: Log<any, any, any>): DecodedEvent | null {
  try {
    const decoded = decodeEventLog({
      data: log.data,
      topics: log.topics,
      abi: (FACTORY_ABI as unknown[]).concat(CONFIG_ABI as unknown[]) as Abi,
    });
    if (!decoded.eventName) return null;
    if (!FACTORY_EVENT_NAMES.has(decoded.eventName) && !CONFIG_EVENT_NAMES.has(decoded.eventName)) {
      return null;
    }
    return { eventName: decoded.eventName, args: decoded.args as unknown as Record<string, unknown> };
  } catch {
    return null;
  }
}
