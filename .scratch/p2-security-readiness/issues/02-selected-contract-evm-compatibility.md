# ORAKL-P2-02: Selected Smart Contract Bytecode & EVM Profile Compatibility

Status: resolved
Type: task
Blocked by: 01

## Description

Validate ORAKL Selected smart contracts (`SelectedMarketFactory.sol`, `ProtocolConfig.sol`) and library code against the observed and documented QIE EVM profile without public deployment.

## Objectives
1. Inspect `foundry.toml`, Solidity compiler versions (`0.8.28`), optimizer runs (`200`), and target `evm_version`.
2. Evaluate EVM hardfork targets (`cancun`, `shanghai`, `paris`, etc.) and specifically verify `PUSH0` opcode behavior.
3. Compute and record exact runtime bytecode sizes and verify EIP-170 limit compliance (<24,576 bytes).
4. Extract and record exact contract creation bytecode hashes and deployed runtime Keccak-256 codehashes.
5. Audit constructor parameters, immutable patching mechanisms, selected ABI functions, and revert selectors.
6. Create deliverables:
   - `docs/p2/SELECTED_CONTRACT_COMPATIBILITY.md`
   - `docs/p2/CONTRACT_BYTECODE_IDENTITY.md`
   - `docs/p2/DEPLOYMENT_CONSTRAINTS.md`

## Acceptance Criteria
- Full bytecode identity and size breakdown documented.
- Clear EVM hardfork constraints identified.
- Zero modification to approved selected contract economics without demonstration of defect.
