#!/usr/bin/env node
/** Deploy the ORAKL P1 selected protocol on an ISOLATED local Anvil chain.
 *
 *  Guard rails (enforced, not advisory):
 *   - refuses any chain id other than 31337;
 *   - never reads, writes or derives a private key — every transaction goes
 *     through Anvil's unlocked development accounts via eth_sendTransaction;
 *   - leaves financial activity DISABLED until the real release review delay
 *     (ProtocolConfig.RECOVERY_DELAY, 24h) has elapsed on the local clock;
 *   - never touches the legacy QIE Testnet deployment or manifest.
 *
 *  Usage: node scripts/p1/deploy-local-selected.mjs
 */
import {encodeFunctionData, keccak256, toHex} from 'viem';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  LOCAL_CHAIN_ID,
  LOCAL_PARAMETERS,
  LOCAL_ROLES,
  LOCAL_RPC_URL,
  RELEASE_LABEL,
  REPO_ROOT,
  artifact,
  assert,
  fail,
  log,
  makeClients,
  multisigExecute,
  requireLocalChain,
  sha256,
  verifyRuntimeCode,
} from './lib.mjs';

const {publicClient, walletClient, request} = makeClients();
const deployer = LOCAL_ROLES.deployer;
const release = keccak256(toHex(RELEASE_LABEL));

const configArtifact = artifact('ProtocolConfig');
const factoryArtifact = artifact('SelectedMarketFactory');
const mockArtifact = artifact('LocalRoleMock');

async function deploy(abi, bytecode, args, label) {
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args,
    account: deployer,
    chain: publicClient.chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({hash});
  assert(receipt.status === 'success', `${label}: deployment reverted (${hash})`);
  assert(receipt.contractAddress, `${label}: no contract address in receipt`);
  log(`deploy ${label}`, `${receipt.contractAddress} @ block ${receipt.blockNumber}`);
  return {address: receipt.contractAddress, txHash: hash, blockNumber: receipt.blockNumber};
}

async function main() {
  await requireLocalChain(request);
  log('preflight', `eth_chainId=${LOCAL_CHAIN_ID} rpc=${LOCAL_RPC_URL}`);

  const parameters = [
    LOCAL_PARAMETERS.feeBps,
    LOCAL_PARAMETERS.creationBond,
    LOCAL_PARAMETERS.proposalBond,
    LOCAL_PARAMETERS.challengeBond,
    LOCAL_PARAMETERS.minContribution,
    LOCAL_PARAMETERS.poolCap,
    LOCAL_PARAMETERS.challengePeriod,
    LOCAL_PARAMETERS.arbitrationPeriod,
  ];
  // The arbitrator address is the deployed role mock, so the full tuple is
  // assembled once the mocks exist.

  const governance = await deploy(
    mockArtifact.abi,
    mockArtifact.bytecode.object,
    [LOCAL_ROLES.governanceOwners, 2],
    'LocalRoleMock(governance)',
  );
  const compliance = await deploy(
    mockArtifact.abi,
    mockArtifact.bytecode.object,
    [LOCAL_ROLES.complianceOwners, 2],
    'LocalRoleMock(compliance)',
  );
  const arbitrator = await deploy(
    mockArtifact.abi,
    mockArtifact.bytecode.object,
    [LOCAL_ROLES.arbitratorOwners, 2],
    'LocalRoleMock(arbitrator)',
  );

  // Owner sets must be pairwise disjoint for ProtocolConfig._roleState.
  const ownerSets = [
    LOCAL_ROLES.governanceOwners,
    LOCAL_ROLES.complianceOwners,
    LOCAL_ROLES.arbitratorOwners,
  ].map((set) => new Set(set.map((a) => a.toLowerCase())));
  for (let i = 0; i < ownerSets.length; i += 1) {
    for (let j = i + 1; j < ownerSets.length; j += 1) {
      for (const address of ownerSets[i]) {
        assert(!ownerSets[j].has(address), 'role owner sets must be disjoint');
      }
    }
  }
  for (const set of ownerSets) {
    assert(!set.has(LOCAL_ROLES.guardian.toLowerCase()), 'guardian must not be a role owner');
  }

  const finalParameters = [...parameters, arbitrator.address];

  const config = await deploy(
    configArtifact.abi,
    configArtifact.bytecode.object,
    [governance.address, compliance.address, LOCAL_ROLES.guardian, finalParameters],
    'ProtocolConfig',
  );

  const factory = await deploy(
    factoryArtifact.abi,
    factoryArtifact.bytecode.object,
    [config.address],
    'SelectedMarketFactory',
  );

  const configAbi = configArtifact.abi;
  const read = (address, abi, functionName, args = []) =>
    publicClient.readContract({address, abi, functionName, args});

  // --- factory binding: governance is a contract, so this is an n-of-m call ---
  const bindData = encodeFunctionData({
    abi: configAbi,
    functionName: 'bindFactory',
    args: [factory.address],
  });
  const bindResult = await multisigExecute({
    walletClient,
    publicClient,
    mock: governance.address,
    owners: LOCAL_ROLES.governanceOwners,
    to: config.address,
    data: bindData,
    observed: () => read(config.address, configAbi, 'factory'),
  });
  assert(bindResult.executed, 'bindFactory did not execute');
  log('bindFactory', `by ${bindResult.by}`);

  // --- release review: compliance approves, then the real 24h delay must pass ---
  const approveData = encodeFunctionData({
    abi: configAbi,
    functionName: 'approveRelease',
    args: [release],
  });
  const approveResult = await multisigExecute({
    walletClient,
    publicClient,
    mock: compliance.address,
    owners: LOCAL_ROLES.complianceOwners,
    to: config.address,
    data: approveData,
    observed: () => read(config.address, configAbi, 'approvedRelease'),
  });
  assert(approveResult.executed, 'approveRelease did not execute');
  const activationAfter = await read(config.address, configAbi, 'activationAfter');
  log('approveRelease', `activationAfter=${activationAfter}`);

  const currentBlock = await request('eth_blockNumber');
  const beforeDelay = Number.parseInt(currentBlock, 16);
  const recoveryDelay = Number(await read(config.address, configAbi, 'RECOVERY_DELAY'));
  await request('evm_increaseTime', [recoveryDelay]);
  await request('evm_mine', []);
  const afterDelayBlock = Number.parseInt(await request('eth_blockNumber'), 16);
  const latestBlock = await request('eth_getBlockByNumber', ['latest', false]);
  const chainTime = Number.parseInt(latestBlock.timestamp, 16);
  assert(
    chainTime >= Number(activationAfter),
    `local clock ${chainTime} has not reached activationAfter ${activationAfter}`,
  );
  log('recovery delay', `${recoveryDelay}s elapsed on the local clock (blocks ${beforeDelay} -> ${afterDelayBlock})`);

  // --- governance activation ---
  const activateData = encodeFunctionData({
    abi: configAbi,
    functionName: 'activateFinance',
    args: [release],
  });
  const activateResult = await multisigExecute({
    walletClient,
    publicClient,
    mock: governance.address,
    owners: LOCAL_ROLES.governanceOwners,
    to: config.address,
    data: activateData,
    observed: () => read(config.address, configAbi, 'financialActive'),
  });
  assert(activateResult.executed, 'activateFinance did not execute');
  log('activateFinance', `by ${activateResult.by}`);

  // --- identity + runtime verification -------------------------------------
  const boundFactory = await read(config.address, configAbi, 'factory');
  const boundConfig = await read(factory.address, factoryArtifact.abi, 'protocolConfig');
  assert(boundFactory.toLowerCase() === factory.address.toLowerCase(), 'config.factory() mismatch');
  assert(boundConfig.toLowerCase() === config.address.toLowerCase(), 'factory.protocolConfig() mismatch');

  const financialActive = await read(config.address, configAbi, 'financialActive');
  const paused = await read(config.address, configAbi, 'paused');
  const deploymentChainId = await read(config.address, configAbi, 'deploymentChainId');
  assert(financialActive === true, 'financial activity is not active');
  assert(paused === false, 'protocol is paused');
  assert(Number(deploymentChainId) === LOCAL_CHAIN_ID, 'deploymentChainId mismatch');

  const configCode = await request('eth_getCode', [config.address, 'latest']);
  const factoryCode = await request('eth_getCode', [factory.address, 'latest']);
  assert(configCode && configCode !== '0x', 'ProtocolConfig has no runtime code');
  assert(factoryCode && factoryCode !== '0x', 'SelectedMarketFactory has no runtime code');

  const configRuntime = verifyRuntimeCode('ProtocolConfig', configCode, [
    BigInt(governance.address),
    BigInt(compliance.address),
    BigInt(LOCAL_ROLES.guardian),
    BigInt(LOCAL_CHAIN_ID),
  ]);
  const cap = LOCAL_PARAMETERS.poolCap;
  const factoryRuntime = verifyRuntimeCode('SelectedMarketFactory', factoryCode, [
    BigInt(config.address),
    cap,
    cap * 3n,
    cap * 2n,
  ]);
  log('runtime verification', 'immutable-patched template comparison PASS');

  // --- economic invariants from the deployed contract ------------------------
  const pilotPoolCap = await read(factory.address, factoryArtifact.abi, 'pilotPoolCap');
  const globalCap = await read(factory.address, factoryArtifact.abi, 'globalUnresolvedCap');
  const perArbCap = await read(factory.address, factoryArtifact.abi, 'perArbitratorUnresolvedCap');
  assert(pilotPoolCap === cap, 'pilotPoolCap mismatch');
  assert(globalCap === cap * 3n, 'globalUnresolvedCap mismatch');
  assert(perArbCap === cap * 2n, 'perArbitratorUnresolvedCap mismatch');
  const marketCount = await read(factory.address, factoryArtifact.abi, 'marketCount');
  assert(marketCount === 0n, 'expected a fresh factory');
  const parametersOnChain = await read(config.address, configAbi, 'parameters');
  assert(parametersOnChain.feeBps === LOCAL_PARAMETERS.feeBps, 'feeBps mismatch');
  assert(parametersOnChain.poolCap === LOCAL_PARAMETERS.poolCap, 'poolCap mismatch');
  assert(parametersOnChain.challengePeriod === LOCAL_PARAMETERS.challengePeriod, 'challengePeriod mismatch');
  assert(parametersOnChain.arbitrationPeriod === LOCAL_PARAMETERS.arbitrationPeriod, 'arbitrationPeriod mismatch');
  assert(
    parametersOnChain.arbitrator.toLowerCase() === arbitrator.address.toLowerCase(),
    'arbitrator mismatch',
  );

  const activityEpoch = await read(config.address, configAbi, 'activityEpoch');
  const approvedDigest = await read(config.address, configAbi, 'approvedDigest');

  const factoryArtifactSha = sha256(readFileSync(resolve(REPO_ROOT, 'contracts/out/SelectedMarketFactory.sol/SelectedMarketFactory.json')));
  const configArtifactSha = sha256(readFileSync(resolve(REPO_ROOT, 'contracts/out/ProtocolConfig.sol/ProtocolConfig.json')));
  const factoryAbiSha = sha256(Buffer.from(JSON.stringify(factoryArtifact.abi)));
  const configAbiSha = sha256(Buffer.from(JSON.stringify(configArtifact.abi)));

  const manifest = {
    schemaVersion: 1,
    status: 'LOCAL_SIMULATION',
    mode: 'local-selected',
    safety: {
      publicDeployment: false,
      productionApproval: false,
      realFunds: false,
      note: 'Isolated Anvil development fixture. Not QIE Testnet, not QIE Mainnet, not an approved release.',
    },
    network: {
      name: 'ORAKL Local Selected (Anvil)',
      chainId: LOCAL_CHAIN_ID,
      rpcUrl: LOCAL_RPC_URL,
      nativeSymbol: 'ETH',
      nativeDecimals: 18,
    },
    release: {
      label: RELEASE_LABEL,
      digest: approvedDigest,
      recoveryDelaySeconds: recoveryDelay,
      activationAfter: Number(activationAfter),
      activatedAt: new Date(chainTime * 1000).toISOString(),
      activatedBy: governance.address,
      activatedByOwners: LOCAL_ROLES.governanceOwners,
    },
    contracts: {
      selectedMarketFactory: {
        address: factory.address,
        creationTxHash: factory.txHash,
        startBlock: Number(factory.blockNumber),
        runtimeCodeKeccak256: keccak256(factoryCode),
        artifactSha256: factoryArtifactSha,
        abiSha256: factoryAbiSha,
        compiler: factoryArtifact.metadata.compiler.version,
        optimizerRuns: factoryArtifact.metadata.settings.optimizer.runs,
        runtimeBytes: factoryRuntime.runtimeBytes,
        immutableAssignment: factoryRuntime.immutableAssignment,
      },
      protocolConfig: {
        address: config.address,
        creationTxHash: config.txHash,
        startBlock: Number(config.blockNumber),
        runtimeCodeKeccak256: keccak256(configCode),
        artifactSha256: configArtifactSha,
        abiSha256: configAbiSha,
        compiler: configArtifact.metadata.compiler.version,
        optimizerRuns: configArtifact.metadata.settings.optimizer.runs,
        runtimeBytes: configRuntime.runtimeBytes,
        immutableAssignment: configRuntime.immutableAssignment,
      },
    },
    roleMocks: {
      note: 'LOCAL TEST MOCKS — not Safe implementations, not verified multisigs.',
      governance: {address: governance.address, owners: LOCAL_ROLES.governanceOwners, threshold: 2},
      compliance: {address: compliance.address, owners: LOCAL_ROLES.complianceOwners, threshold: 2},
      arbitrator: {address: arbitrator.address, owners: LOCAL_ROLES.arbitratorOwners, threshold: 2},
    },
    roles: {
      deployer: LOCAL_ROLES.deployer,
      guardian: LOCAL_ROLES.guardian,
      creator: LOCAL_ROLES.creator,
      yesParticipant: LOCAL_ROLES.yesParticipant,
      noParticipant: LOCAL_ROLES.noParticipant,
      proposer: LOCAL_ROLES.proposer,
      challengerA: LOCAL_ROLES.challengerA,
      challengerB: LOCAL_ROLES.challengerB,
      spare: LOCAL_ROLES.spare,
    },
    parameters: {
      feeBps: LOCAL_PARAMETERS.feeBps,
      creationBond: LOCAL_PARAMETERS.creationBond.toString(),
      proposalBond: LOCAL_PARAMETERS.proposalBond.toString(),
      challengeBond: LOCAL_PARAMETERS.challengeBond.toString(),
      minContribution: LOCAL_PARAMETERS.minContribution.toString(),
      poolCap: LOCAL_PARAMETERS.poolCap.toString(),
      challengePeriod: LOCAL_PARAMETERS.challengePeriod,
      arbitrationPeriod: LOCAL_PARAMETERS.arbitrationPeriod,
      globalUnresolvedCap: globalCap.toString(),
      perArbitratorUnresolvedCap: perArbCap.toString(),
    },
    state: {
      financialActive,
      paused,
      activityEpoch: Number(activityEpoch),
      marketCount: Number(marketCount),
      observedAt: new Date().toISOString(),
    },
    verification: {
      chainIdChecked: true,
      factoryConfigLinkage: true,
      configFactoryBinding: true,
      runtimeCodePresent: true,
      immutablePatchedRuntimeMatch: true,
      financialEntryActive: true,
      verifier: 'scripts/p1/deploy-local-selected.mjs',
    },
  };

  const targets = process.env.ORAKL_MANIFEST_OUT
    ? process.env.ORAKL_MANIFEST_OUT.split(',').map((s) => resolve(REPO_ROOT, s.trim()))
    : [
        resolve(REPO_ROOT, 'frontend/public/deployments/local-selected.json'),
        resolve(REPO_ROOT, 'backend/deployments/local-selected.json'),
      ];
  for (const target of targets) {
    mkdirSync(resolve(target, '..'), {recursive: true});
    writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
    log('manifest', target.replace(`${REPO_ROOT}/`, ''));
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'LOCAL_DEPLOYMENT_OK',
        chainId: LOCAL_CHAIN_ID,
        factory: factory.address,
        config: config.address,
        startBlock: Number(factory.blockNumber),
        financialActive,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`[p1-local] DEPLOY FAILED: ${error.stack ?? error}\n`);
  process.exit(1);
});
