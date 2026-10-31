# Blocking End-to-End Verification Test Gates

Before P1 implementation code can be considered complete or submitted for two-axis code review, the test suite must pass three mandatory automated verification gates against a local PostgreSQL and Anvil environment: (1) full clean lifecycle execution from market creation to fee and reward claim, (2) simulated 10-block reorg rollback and deterministic replay recovery, and (3) cross-runtime golden-vector matching ensuring byte-for-byte RFC 8785 and Keccak-256 parity between backend and frontend.
