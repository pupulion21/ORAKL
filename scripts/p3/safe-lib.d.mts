export const SAFE_SINGLETON_ARTIFACT: any;
export const SAFE_PROXY_FACTORY_ARTIFACT: any;
export const SAFE_PROXY_ARTIFACT: any;
export const CANONICAL_SAFE_CODEHASH: string;
export const CANONICAL_FACTORY_CODEHASH: string;

export function deploySafeInfrastructure(
  walletClient: any,
  publicClient: any
): Promise<{ singletonAddress: `0x${string}`; factoryAddress: `0x${string}` }>;

export function deployRoleSafe(
  walletClient: any,
  publicClient: any,
  options: {
    factoryAddress: `0x${string}`;
    singletonAddress: `0x${string}`;
    owners: string[];
    threshold?: bigint;
    saltNonce?: bigint;
    fallbackHandler?: string;
  }
): Promise<`0x${string}`>;

export function verifySafeInstance(
  publicClient: any,
  proxyAddress: string,
  expectedOwners: string[],
  expectedThreshold: number | bigint
): Promise<{
  proxyAddress: `0x${string}`;
  owners: string[];
  threshold: number;
  nonce: number;
  ownersMatch: boolean;
  thresholdMatch: boolean;
  boundMasterCopy: string;
}>;

export function executeSafeTransaction(
  walletClient: any,
  publicClient: any,
  options: {
    safeAddress: `0x${string}`;
    to: `0x${string}`;
    value?: bigint;
    data?: `0x${string}`;
    operation?: number;
    safeTxGas?: bigint;
    baseGas?: bigint;
    gasPrice?: bigint;
    gasToken?: `0x${string}`;
    refundReceiver?: `0x${string}`;
    signers: any[];
    customNonce?: bigint | null;
  }
): Promise<{
  txHash: `0x${string}`;
  receipt: any;
  signatures: `0x${string}`;
  nonce: bigint;
}>;
