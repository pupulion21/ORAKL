// ORAKL P1 — deployment manifest reader for the indexer/API (fail-closed).
// Only LOCAL_SIMULATION manifests are accepted, and only for the configured
// loopback chain. No other mode exists here by design.
import { readFile } from "node:fs/promises";
import path from "node:path";

export type DeploymentManifest = {
  schemaVersion: number;
  status: string;
  mode: string;
  network: { chainId: number; chainName?: string; rpcUrl: string };
  contracts: {
    selectedMarketFactory: { address: string; startBlock: number; [k: string]: unknown };
    protocolConfig: { address: string; startBlock: number; [k: string]: unknown };
  };
  release?: { digest?: string; label?: string; [k: string]: unknown };
  roleMocks?: { arbitrator?: { address?: string; [k: string]: unknown }; [k: string]: unknown };
  state?: { financialActive?: boolean; paused?: boolean; [k: string]: unknown };
};

export async function readDeploymentManifest(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeploymentManifest> {
  const file = env.DEPLOYMENT_MANIFEST ?? path.resolve(process.cwd(), "deployments/local-selected.json");
  const manifest = JSON.parse(await readFile(file, "utf8")) as DeploymentManifest;
  if (manifest.status !== "LOCAL_SIMULATION" || manifest.mode !== "local-selected") {
    throw new Error(
      `refusing to run: manifest is not LOCAL_SIMULATION/local-selected (${manifest.status}/${manifest.mode})`,
    );
  }
  const expected = Number(env.LOCAL_CHAIN_ID ?? String(manifest.network.chainId));
  if (manifest.network.chainId !== expected) {
    throw new Error(`refusing to run: manifest chainId ${manifest.network.chainId} != configured ${expected}`);
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(manifest.network.rpcUrl)) {
    throw new Error(`refusing to run: manifest rpcUrl is not loopback (${manifest.network.rpcUrl})`);
  }
  return manifest;
}
