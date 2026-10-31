# Atomic Multi-Challenger Projection Ingestion

In M1 multi-challenger economics, each accepted challenge deposit receives an immutable prefix offset (`prefixBefore`) while incrementing aggregate market challenge stake. To prevent projection reads from observing inconsistent intermediate state during heavy event indexing or reorg replay, the indexer writes per-challenger tranche rows (`ChallengerStake`) and updates parent `Market` aggregate totals in a single atomic database transaction.
