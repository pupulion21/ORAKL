export type OpcodeClassification =
  | 'SUPPORTED'
  | 'INVALID_OPCODE'
  | 'EXECUTION_REVERT'
  | 'METHOD_NOT_SUPPORTED'
  | 'MALFORMED_RESPONSE'
  | 'TRANSPORT_ERROR';

export interface SingleOpcodeProbeResult {
  name: string;
  bytecode: string;
  classification: OpcodeClassification;
  status: string;
  isOpcodeUnsupported: boolean;
  rawRequest: any;
  rawResponse: any;
  errorDetail: string | null;
}

export interface OpcodeProbeSuiteResult {
  push0: SingleOpcodeProbeResult;
  tstore: SingleOpcodeProbeResult;
  fullHardforkClaim: string;
  opcodeObservation: string;
}

export interface NetworkProbeResult {
  network: string;
  expectedChainId: number;
  probedAt: string;
  endpoints: Record<string, any>;
  effectiveActiveEndpoint: string | null;
  profile: any;
  error?: string;
  profileError?: string;
}

export function rpcCall(endpoint: string, method: string, params?: unknown[]): Promise<any>;
export function probeSingleOpcode(
  endpoint: string,
  name: string,
  bytecode: string,
  expectedReturn?: string,
): Promise<SingleOpcodeProbeResult>;
export function probeOpcodes(activeEp: string): Promise<OpcodeProbeSuiteResult>;
export function probeNetwork(
  name: string,
  expectedChainId: number,
  endpoints: string[],
): Promise<NetworkProbeResult>;
export function runProbeCLI(): Promise<void>;
