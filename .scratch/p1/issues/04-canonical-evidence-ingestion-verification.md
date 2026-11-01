# 04: Canonical RFC 8785 Evidence Ingestion and Verification Tracer Bullet

**What to build:** An end-to-end off-chain evidence pipeline adhering to `orakl-evidence-v1`. Users and participants can author and submit evidence manifests with sources and claims. The backend validates the manifest, canonicalizes it via RFC 8785 (JCS) with zero JSON numbers, calculates the Keccak-256 commitment hash, stores the artifact locally, and allows anyone to retrieve and verify the exact canonical bytes through the Fastify API and frontend.

**Blocked by:** 02 (Market Creation and Initial Liquidity Tracer Bullet).

**Status:** ready-for-agent

- [ ] Fastify `POST /api/v1/evidence` endpoint accepts signed evidence manifests, rejects JSON numbers, and verifies UTF-8 property sorting without BOM (ADR-0003).
- [ ] Backend computes `keccak256(canonicalBytes)` and stores the manifest artifact under local evidence storage.
- [ ] Fastify `GET /api/v1/evidence/:commitment` retrieves the verified manifest by its 0x-prefixed Keccak-256 hash.
- [ ] Frontend evidence modal validates manifests locally, matches backend commitment byte-for-byte, and passes cross-runtime golden vector tests.
- [ ] Rate limiting is enforced on evidence publication endpoints to prevent local denial of service.
