declare module "*scripts/p3/test-real-safe.mjs" {
  export function runRealSafeTestSuite(): Promise<boolean>;
}

declare module "*scripts/p4/test-security-mutations.mjs" {
  export interface MutationResult {
    id: number;
    name: string;
    expected: string;
    observed: string;
    gate: string;
    status: 'DETECTED' | 'NOT_DETECTED';
  }
  export function runSecurityMutationsSuite(): Promise<{
    success: boolean;
    results: MutationResult[];
  }>;
}

declare module "*scripts/p2/verify-deployment.mjs" {
  export const CANONICAL_TRUST_ANCHORS: any;
  export function sha256Hex(bufferOrStr: any): string;
  export function rpcCall(endpoint: string, method: string, params?: any[]): Promise<any>;
  export function verifyDeployment(options?: any): Promise<any>;
}

declare module "*scripts/p3/safe-lib.mjs" {
  export const SAFE_SINGLETON_ARTIFACT: any;
  export const SAFE_PROXY_FACTORY_ARTIFACT: any;
  export const CANONICAL_SAFE_CODEHASH: string;
  export const CANONICAL_FACTORY_CODEHASH: string;
  export function deploySafeInfrastructure(walletClient: any, publicClient: any): Promise<any>;
  export function deployRoleSafe(walletClient: any, publicClient: any, options: any): Promise<any>;
  export function verifySafeInstance(publicClient: any, proxyAddress: any, expectedOwners: any, expectedThreshold: any, options?: any): Promise<any>;
  export function executeSafeTransaction(walletClient: any, publicClient: any, options: any): Promise<any>;
}
