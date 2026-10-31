# Strict Environment and Network Segregation for Legacy Contract Preservation

To honor immutable protocol preservation requirements without breaking existing deployments, legacy testnet artifacts (Chain ID 1893, `QiePredictionMarket.sol`, `qie-testnet.json`) and P1 local simulation artifacts (Chain ID 31337, `local-selected.json`) are strictly segregated. All client, indexer, and API components must reject mismatched chain IDs or addresses, prohibit silent environment fallbacks, and preserve legacy contract ABIs, artifacts, and addresses unmodified.
