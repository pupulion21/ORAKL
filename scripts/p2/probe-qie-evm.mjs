/**
 * Bounded read-only QIE EVM compatibility and RPC probe.
 * Probes QIE Testnet (1983) and QIE Mainnet (1990) for EVM profile facts.
 * NO state-changing calls, NO keys, NO transactions.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

async function rpcCall(endpoint, method, params = []) {
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

async function probeOpcodes(activeEp) {
  const push0Bytecode = '0x60425f5360015ff3'; // PUSH1 0x42, PUSH0, MSTORE8, PUSH1 0x01, PUSH0, RETURN
  const tstoreBytecode = '0x604260005d60005c60005360016000f3'; // TSTORE & TLOAD sequence

  const push0Req = { jsonrpc: '2.0', id: 101, method: 'eth_call', params: [{ data: push0Bytecode }, 'latest'] };
  const tstoreReq = { jsonrpc: '2.0', id: 102, method: 'eth_call', params: [{ data: tstoreBytecode }, 'latest'] };

  let push0Res = null;
  let tstoreRes = null;

  try {
    const res = await fetch(activeEp, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(push0Req),
    });
    push0Res = await res.json();
  } catch (err) {
    push0Res = { error: { message: err.message } };
  }

  try {
    const res = await fetch(activeEp, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tstoreReq),
    });
    tstoreRes = await res.json();
  } catch (err) {
    tstoreRes = { error: { message: err.message } };
  }

  const push0Supported = push0Res?.result === '0x42';
  const tstoreSupported = tstoreRes?.result === '0x42';

  return {
    push0: {
      status: push0Supported ? 'SUPPORTED' : 'UNSUPPORTED',
      bytecode: push0Bytecode,
      rawRequest: push0Req,
      rawResponse: push0Res,
    },
    tstore: {
      status: tstoreSupported ? 'SUPPORTED' : 'UNSUPPORTED',
      bytecode: tstoreBytecode,
      rawRequest: tstoreReq,
      rawResponse: tstoreRes,
      errorDetail: tstoreRes?.error?.message || null,
    },
    evmHardforkObservation: push0Supported && !tstoreSupported ? 'Shanghai' : push0Supported && tstoreSupported ? 'Cancun' : 'Paris or Earlier',
  };
}

async function probeNetwork(name, expectedChainId, endpoints) {
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

async function main() {
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

main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
