/**
 * Bounded read-only QIE EVM compatibility and RPC probe.
 * Probes QIE Testnet (1983) and QIE Mainnet (1990) for EVM profile facts.
 * NO state-changing calls, NO keys, NO transactions.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

export async function rpcCall(endpoint, method, params = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (json.error) throw new Error(`RPC Error: ${json.error.message || JSON.stringify(json.error)}`);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes a single opcode byte vector and classifies the response with strict failure separation.
 * Transport errors, malformed responses, and method errors are NEVER classified as opcode incompatibility.
 */
export async function probeSingleOpcode(endpoint, name, bytecode, expectedReturn = '0x42') {
  const req = {
    jsonrpc: '2.0',
    id: 100 + Math.floor(Math.random() * 899),
    method: 'eth_call',
    params: [{ data: bytecode }, 'latest'],
  };

  let rawRes = null;
  let fetchError = null;

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch (err) {
    return {
      name,
      bytecode,
      classification: 'TRANSPORT_ERROR',
      status: 'ERROR',
      isOpcodeUnsupported: false,
      rawRequest: req,
      rawResponse: null,
      errorDetail: err.message,
    };
  }

  if (!res.ok) {
    return {
      name,
      bytecode,
      classification: 'TRANSPORT_ERROR',
      status: 'ERROR',
      isOpcodeUnsupported: false,
      rawRequest: req,
      rawResponse: null,
      errorDetail: `HTTP ${res.status} ${res.statusText}`,
    };
  }

  let text = '';
  try {
    text = await res.text();
    rawRes = JSON.parse(text);
  } catch (err) {
    return {
      name,
      bytecode,
      classification: 'MALFORMED_RESPONSE',
      status: 'ERROR',
      isOpcodeUnsupported: false,
      rawRequest: req,
      rawResponse: text,
      errorDetail: `Malformed JSON response: ${err.message}`,
    };
  }

  // Validate JSON-RPC structure
  if (!rawRes || typeof rawRes !== 'object' || (rawRes.result === undefined && rawRes.error === undefined)) {
    return {
      name,
      bytecode,
      classification: 'MALFORMED_RESPONSE',
      status: 'ERROR',
      isOpcodeUnsupported: false,
      rawRequest: req,
      rawResponse: rawRes,
      errorDetail: 'RPC response is not valid JSON-RPC 2.0',
    };
  }

  // Check for successful execution
  if (rawRes.result === expectedReturn) {
    return {
      name,
      bytecode,
      classification: 'SUPPORTED',
      status: 'SUPPORTED',
      isOpcodeUnsupported: false,
      rawRequest: req,
      rawResponse: rawRes,
      errorDetail: null,
    };
  }

  // Handle JSON-RPC Error with explicit categorization
  if (rawRes.error) {
    const code = rawRes.error.code;
    const msg = String(rawRes.error.message || '');
    const data = typeof rawRes.error.data === 'string' ? rawRes.error.data : JSON.stringify(rawRes.error.data || '');
    const fullErr = `${msg} ${data}`.toLowerCase();

    // 1. Method Not Found / Unsupported Method
    if (code === -32601 || /method.*not (found|supported)|unsupported method/i.test(msg)) {
      return {
        name,
        bytecode,
        classification: 'METHOD_NOT_SUPPORTED',
        status: 'ERROR',
        isOpcodeUnsupported: false,
        rawRequest: req,
        rawResponse: rawRes,
        errorDetail: msg,
      };
    }

    // 2. Explicit Invalid Opcode error
    // Only report opcode unsupported when evidence specifically establishes invalid opcode behavior
    const isInvalidOpcode =
      /invalid opcode|opcode 0x[0-9a-f]+ not defined|bad opcode|instruction not supported|invalid instruction/i.test(
        fullErr,
      );

    if (isInvalidOpcode) {
      return {
        name,
        bytecode,
        classification: 'INVALID_OPCODE',
        status: 'UNSUPPORTED',
        isOpcodeUnsupported: true,
        rawRequest: req,
        rawResponse: rawRes,
        errorDetail: msg,
      };
    }

    // 3. Other EVM execution failures / reverts (NOT opcode incompatibility)
    return {
      name,
      bytecode,
      classification: 'EXECUTION_REVERT',
      status: 'EXECUTION_REVERT',
      isOpcodeUnsupported: false,
      rawRequest: req,
      rawResponse: rawRes,
      errorDetail: msg,
    };
  }

  // Returned unexpected result
  return {
    name,
    bytecode,
    classification: 'EXECUTION_REVERT',
    status: 'UNEXPECTED_RESULT',
    isOpcodeUnsupported: false,
    rawRequest: req,
    rawResponse: rawRes,
    errorDetail: `Observed ${rawRes.result}, expected ${expectedReturn}`,
  };
}

export async function probeOpcodes(activeEp) {
  const push0Bytecode = '0x60425f5360015ff3'; // PUSH1 0x42, PUSH0, MSTORE8, PUSH1 0x01, PUSH0, RETURN
  const tstoreBytecode = '0x604260005d60005c60005360016000f3'; // TSTORE & TLOAD sequence

  const push0 = await probeSingleOpcode(activeEp, 'push0', push0Bytecode, '0x42');
  const tstore = await probeSingleOpcode(activeEp, 'tstore', tstoreBytecode, '0x42');

  let opcodeObservation = '';
  if (push0.classification === 'SUPPORTED' && tstore.classification === 'INVALID_OPCODE') {
    opcodeObservation =
      'PUSH0 (0x5f) supported; TSTORE (0x5d) confirmed invalid opcode. Opcode-level observation only; does not establish full Shanghai hardfork compliance.';
  } else if (push0.classification === 'SUPPORTED' && tstore.classification === 'SUPPORTED') {
    opcodeObservation =
      'PUSH0 (0x5f) and TSTORE (0x5d) both supported. Opcode-level observation only; does not establish full Cancun hardfork compliance.';
  } else if (tstore.classification === 'TRANSPORT_ERROR') {
    opcodeObservation = `PUSH0 ${push0.status}; TSTORE probe inconclusive due to transport error (${tstore.errorDetail}).`;
  } else {
    opcodeObservation = `Opcode observations: PUSH0=${push0.classification}, TSTORE=${tstore.classification}.`;
  }

  return {
    push0,
    tstore,
    fullHardforkClaim: 'UNVERIFIED',
    opcodeObservation,
  };
}

export async function probeNetwork(name, expectedChainId, endpoints) {
  const result = {
    network: name,
    expectedChainId,
    probedAt: new Date().toISOString(),
    endpoints: {},
    effectiveActiveEndpoint: null,
    profile: null,
  };

  for (const ep of endpoints) {
    try {
      const start = Date.now();
      const chainIdHex = await rpcCall(ep, 'eth_chainId');
      const latencyMs = Date.now() - start;
      const chainId = parseInt(chainIdHex, 16);
      result.endpoints[ep] = {
        reachable: true,
        chainId,
        latencyMs,
        chainMatch: chainId === expectedChainId,
      };
      if (!result.effectiveActiveEndpoint && chainId === expectedChainId) {
        result.effectiveActiveEndpoint = ep;
      }
    } catch (err) {
      result.endpoints[ep] = {
        reachable: false,
        error: err.message,
      };
    }
  }

  const activeEp = result.effectiveActiveEndpoint;
  if (!activeEp) {
    result.error = 'No reachable active endpoint matching chain ID';
    return result;
  }

  // Probe detailed EVM profile
  try {
    let clientVersion = 'UNAVAILABLE';
    try {
      clientVersion = await rpcCall(activeEp, 'web3_clientVersion');
    } catch {
      // web3_clientVersion may be disabled
    }

    const latestBlock = await rpcCall(activeEp, 'eth_getBlockByNumber', ['latest', false]);
    const blockNum = parseInt(latestBlock.number, 16);
    const gasPriceHex = await rpcCall(activeEp, 'eth_gasPrice');
    const gasPriceWei = BigInt(gasPriceHex).toString();

    let feeHistory = null;
    let eip1559Supported = false;
    try {
      feeHistory = await rpcCall(activeEp, 'eth_feeHistory', ['0x4', 'latest', [25, 50, 75]]);
      if (feeHistory && feeHistory.baseFeePerGas) {
        eip1559Supported = true;
      }
    } catch {
      eip1559Supported = false;
    }

    // Measure block times across last 5 blocks
    const blockSamples = [];
    for (let i = 0; i < 5; i++) {
      const bHex = '0x' + (blockNum - i).toString(16);
      try {
        const b = await rpcCall(activeEp, 'eth_getBlockByNumber', [bHex, false]);
        blockSamples.push({
          number: parseInt(b.number, 16),
          timestamp: parseInt(b.timestamp, 16),
          gasLimit: parseInt(b.gasLimit, 16),
          gasUsed: parseInt(b.gasUsed, 16),
          baseFeePerGas: b.baseFeePerGas ? BigInt(b.baseFeePerGas).toString() : null,
          extraData: b.extraData,
        });
      } catch {
        // Sample read error
      }
    }

    let avgBlockTimeSec = null;
    if (blockSamples.length >= 2) {
      const timeDiff = blockSamples[0].timestamp - blockSamples[blockSamples.length - 1].timestamp;
      const blockDiff = blockSamples[0].number - blockSamples[blockSamples.length - 1].number;
      avgBlockTimeSec = blockDiff > 0 ? (timeDiff / blockDiff).toFixed(2) : null;
    }

    const opcodeProbe = await probeOpcodes(activeEp);

    result.profile = {
      clientVersion,
      latestBlockNumber: blockNum,
      latestBlockHash: latestBlock.hash,
      blockGasLimit: parseInt(latestBlock.gasLimit, 16),
      gasPriceWei,
      eip1559Supported,
      baseFeePerGas: latestBlock.baseFeePerGas ? BigInt(latestBlock.baseFeePerGas).toString() : null,
      avgBlockTimeSec,
      sampleBlocks: blockSamples,
      feeHistorySample: feeHistory,
      opcodes: opcodeProbe,
    };
  } catch (err) {
    result.profileError = err.message;
  }

  return result;
}

export async function runProbeCLI() {
  console.log('--- Probing QIE Public Networks (Read-Only) ---');

  const testnet = await probeNetwork('qie-testnet', 1983, [
    'https://rpc1testnet.qie.digital/',
    'https://rpc2testnet.qie.digital/',
  ]);
  console.log('QIE Testnet:', testnet.effectiveActiveEndpoint ? 'PASS' : 'FAIL');

  const mainnet = await probeNetwork('qie-mainnet', 1990, [
    'https://rpc1mainnet.qie.digital/',
    'https://rpc2mainnet.qie.digital/',
  ]);
  console.log('QIE Mainnet:', mainnet.effectiveActiveEndpoint ? 'PASS' : 'FAIL');

  const fullReport = {
    generatedAt: new Date().toISOString(),
    purpose: 'ORAKL P2-01 QIE Compatibility & EVM Profile Assessment',
    safetyBoundary: 'Strictly read-only; no accounts, no private keys, zero public transactions.',
    networks: {
      'qie-testnet': testnet,
      'qie-mainnet': mainnet,
    },
  };

  const outPath = resolve(REPO_ROOT, 'docs/p2/RPC_VERIFICATION_RESULTS.json');
  writeFileSync(outPath, JSON.stringify(fullReport, null, 2) + '\n', 'utf8');
  console.log(`Saved RPC verification results to ${outPath}`);
}

if (process.argv[1]?.endsWith('probe-qie-evm.mjs')) {
  runProbeCLI().catch((err) => {
    console.error('Probe failed:', err);
    process.exit(1);
  });
}
