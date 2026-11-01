export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface VerificationResult {
  success: boolean;
  mode: 'artifact-only' | 'onchain-required';
  onchainStatus: 'VERIFIED' | 'UNVERIFIED' | 'FAILED';
  checks: VerificationCheck[];
  errors: string[];
}

export interface VerifyDeploymentOptions {
  mode?: 'artifact-only' | 'onchain-required';
  manifestPath?: string;
  rpcUrl?: string;
  silent?: boolean;
}

export function sha256Hex(bufferOrStr: Buffer | string): string;
export function rpcCall(endpoint: string, method: string, params?: unknown[]): Promise<any>;
export function verifyDeployment(options?: VerifyDeploymentOptions): Promise<VerificationResult>;
