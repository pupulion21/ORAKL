# 01: Database Migration and Schema Precision Baseline

**What to build:** The foundational database schema baseline for ORAKL P1 local simulation. Applying the pending Prisma migration ensures all financial columns across all 21 models store EVM `uint256` token amounts and liabilities with exact `NUMERIC(78,0)` precision in PostgreSQL, eliminating silent floating-point truncation and schema drift.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] `prisma migrate deploy` executes cleanly against local PostgreSQL (`127.0.0.1:5432/orakl_p1`), applying migration `20261031100000_financial_columns_uint256_numeric` without errors (ADR-0005).
- [ ] `prisma migrate status` confirms 0 pending migrations and 0 unapplied schema alterations.
- [ ] Direct database reflection confirms all financial quantities (`totalYes`, `totalNo`, `poolCap`, `yesPool`, `noPool`, `creationBond`, `proposalBond`, `totalChallengeStake`, `amount`, `balance`) are formatted as PostgreSQL `NUMERIC(78,0)` (ADR-0001).
- [ ] PrismaClient generation is updated and verified in `backend/` with type-safe `Decimal` mappings.
