# Mandating Prisma Migrate Deploy for Schema Evolution

To guarantee SQL migration script integrity and eliminate drift between schema files and database state, all automated test runners, CI pipelines, and local test harnesses must execute `prisma migrate deploy` rather than `prisma db push`. Every migration directory under `backend/prisma/migrations/` is evaluated and verified sequentially against PostgreSQL to ensure migrations are fully deterministic and reproducible.
