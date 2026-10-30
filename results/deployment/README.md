# Live QIE Testnet deployment

Status: **DEPLOYED_AND_RUNTIME_VERIFIED**.

- Network: QIE Testnet, chain 1983.
- Contract: [`0x43A666a9a305232E6a10fae8507d67EF64F02C98`](https://testnet.qie.digital/address/0x43A666a9a305232E6a10fae8507d67EF64F02C98).
- Transaction: [`0x6b8d52be72cbb99137b047fd142f7cc83a3f5bf08daafdc4170caf307dbb71f1`](https://testnet.qie.digital/tx/0x6b8d52be72cbb99137b047fd142f7cc83a3f5bf08daafdc4170caf307dbb71f1).
- Deployment block: 9444227.
- Source: the reviewed `contracts/src/QiePredictionMarket.sol` build, Solidity 0.8.37, EVM Paris, optimizer disabled.
- Constructor arguments: none. Native value: 0 QIE. Gas paid: 0.000000000021452088 test QIE.

## Execution and verification

The user explicitly requested that the assistant deploy to QIE Testnet. A separate deployment-only wallet was created as a local encrypted Foundry keystore. It received 2 test QIE through the official faucet. One direct-creation transaction was broadcast with chain 1983 and a bounded fee below 0.01 test QIE. No user private key or seed was requested or printed.

`live-deployment.json` verifies the actual transaction hash, chain, zero native value, exact creation bytecode, expected sender/nonce/created address, successful receipt, observed canonical block hash, matching runtime bytecode at the deployment block, and current contract accounting at a single observed block.

The ACTIVE public manifest is at `frontend/public/deployments/qie-testnet.json`. The frontend verifies the contract before enabling transactions. The newly deployed contract starts with zero markets and zero escrow; starter ideas remain templates until a market is actually published.

## Local signing material

The encrypted keystore and its local password file are stored under `secrets/qie-testnet/`, with directory permissions 700 and file permissions 600. Git ignores this directory. These files are not copied into `frontend/public` or `frontend/dist`. Retain them securely if the deployment wallet will be used again. The contract has no deployer-admin withdrawal or upgrade role.

## Evidence limits

The official faucet page initially hydrated after the first input attempt, so no funding request was observed. After waiting for the client input handler, the same wallet received one successful 2-QIE claim. No new wallet was rotated to evade limits.

The recorded block and runtime/accounting reads are actual network observations. Explorer source verification has not been run; network finality is not inferred from the receipt or observed canonical block. Earlier `results/promax` screenshots use controlled wallet/RPC fixtures and remain separate from this live deployment evidence.
