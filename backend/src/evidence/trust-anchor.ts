/**
 * ORAKL Independent Deployment Trust Anchor
 *
 * Establishes an independent, immutable root of trust for deployment verification.
 * The deployment manifest is an operational declaration, NOT a trust anchor.
 * Manifest declarations must be verified against this independent trust anchor
 * before the runtime accepts any factory address, ABI, or runtime codehash.
 */

export interface TrustAnchor {
  chainId: number;
  approvedFactoryAbiSha256: string;
  approvedConfigAbiSha256?: string;
  expectedFactoryCodehash: string;
  expectedConfigCodehash?: string;
  description: string;
}

export const CANONICAL_TRUST_ANCHORS: Readonly<Record<number, TrustAnchor>> = Object.freeze({
  31337: Object.freeze({
    chainId: 31337,
    approvedFactoryAbiSha256: "0x6c2afa5a7277da5962e6e9364aa6bd66fd289ada21fcc229d336023ffe3c7fdc",
    approvedConfigAbiSha256: "0xc9cfb7dbff2c16fe6f1b8aa5b0be64e355f164e052f7af3aaf4fa04a6e176b8d",
    expectedFactoryCodehash: "0xb8a5bfea3c87dd1a6ff557e0c389166d8fe799efeba166edad200f1669f4a21a",
    expectedConfigCodehash: "0x418d1b9ebdf9fcdf2ce444d4bd898042aad86651aebb21d3f56b98c8c9950b5e",
    description: "Local Anvil Chain 31337 Pinned SelectedMarketFactory & ProtocolConfig Trust Anchor",
  }),
});

export function getTrustAnchor(chainId: number, customAnchor?: Partial<TrustAnchor>): TrustAnchor {
  const canonical = CANONICAL_TRUST_ANCHORS[chainId];
  if (!canonical && !customAnchor) {
    throw new Error(`No canonical trust anchor configured for chain ID ${chainId}`);
  }
  return {
    chainId,
    approvedFactoryAbiSha256: customAnchor?.approvedFactoryAbiSha256 ?? canonical?.approvedFactoryAbiSha256 ?? "",
    approvedConfigAbiSha256: customAnchor?.approvedConfigAbiSha256 ?? canonical?.approvedConfigAbiSha256,
    expectedFactoryCodehash: customAnchor?.expectedFactoryCodehash ?? canonical?.expectedFactoryCodehash ?? "",
    expectedConfigCodehash: customAnchor?.expectedConfigCodehash ?? canonical?.expectedConfigCodehash,
    description: customAnchor?.description ?? canonical?.description ?? `Custom Trust Anchor for Chain ${chainId}`,
  };
}

export interface TrustAnchorValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateManifestAgainstTrustAnchor(
  manifest: any,
  anchor: TrustAnchor,
): TrustAnchorValidationResult {
  const errors: string[] = [];

  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["manifest is null or not an object"] };
  }

  // 1. Chain ID
  if (manifest.network?.chainId !== anchor.chainId) {
    errors.push(
      `manifest chainId (${manifest.network?.chainId}) does not match trust anchor chainId (${anchor.chainId})`,
    );
  }

  // 2. Factory ABI Hash
  const manifestFactoryAbiSha = manifest.contracts?.selectedMarketFactory?.abiSha256?.toLowerCase();
  const expectedFactoryAbiSha = anchor.approvedFactoryAbiSha256?.toLowerCase();
  if (!manifestFactoryAbiSha || manifestFactoryAbiSha !== expectedFactoryAbiSha) {
    errors.push(
      `manifest factory abiSha256 (${manifestFactoryAbiSha}) does not match independent trust anchor (${expectedFactoryAbiSha})`,
    );
  }

  // 3. Factory Runtime Codehash
  const manifestFactoryCodehash = manifest.contracts?.selectedMarketFactory?.runtimeCodeKeccak256?.toLowerCase();
  const expectedFactoryCodehash = anchor.expectedFactoryCodehash?.toLowerCase();
  if (!manifestFactoryCodehash || manifestFactoryCodehash !== expectedFactoryCodehash) {
    errors.push(
      `manifest factory runtimeCodeKeccak256 (${manifestFactoryCodehash}) does not match independent trust anchor (${expectedFactoryCodehash})`,
    );
  }

  // 4. Config ABI Hash (if configured)
  if (anchor.approvedConfigAbiSha256) {
    const manifestConfigAbiSha = manifest.contracts?.protocolConfig?.abiSha256?.toLowerCase();
    const expectedConfigAbiSha = anchor.approvedConfigAbiSha256.toLowerCase();
    if (!manifestConfigAbiSha || manifestConfigAbiSha !== expectedConfigAbiSha) {
      errors.push(
        `manifest protocolConfig abiSha256 (${manifestConfigAbiSha}) does not match independent trust anchor (${expectedConfigAbiSha})`,
      );
    }
  }

  // 5. Config Runtime Codehash (if configured)
  if (anchor.expectedConfigCodehash) {
    const manifestConfigCodehash = manifest.contracts?.protocolConfig?.runtimeCodeKeccak256?.toLowerCase();
    const expectedConfigCodehash = anchor.expectedConfigCodehash.toLowerCase();
    if (!manifestConfigCodehash || manifestConfigCodehash !== expectedConfigCodehash) {
      errors.push(
        `manifest protocolConfig runtimeCodeKeccak256 (${manifestConfigCodehash}) does not match independent trust anchor (${expectedConfigCodehash})`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
