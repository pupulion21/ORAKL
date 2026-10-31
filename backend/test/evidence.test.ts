// ORAKL P1 — unit tests: strict JSON parser + evidence profile v1 vectors.
// Fixture (backend/test/fixtures/evidence-vectors.json) is exported from the
// FRONTEND implementation via scripts/p1/evidence-vector-export.mjs, so the
// backend and frontend canonicalizations must agree byte-for-byte forever.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { parseStrictJson } from "../src/evidence/strict-json.js";
import {
  canonicalizeEvidence,
  evidenceCommitment,
  evidenceContentHash,
  validateEvidenceManifest,
  type EvidenceManifest,
} from "../src/evidence/evidence.js";

const fixture = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "test", "fixtures", "evidence-vectors.json"), "utf8"),
) as { schema: string; vectors: {
  manifest: EvidenceManifest;
  valid: boolean;
  errors: string[];
  canonicalUtf8: string;
  commitment: string;
}[] };

const vectors = fixture.vectors;

describe("strict JSON parser", () => {
  test("accepts valid JSON without numbers", () => {
    expect(parseStrictJson('{"a":"1","b":null,"c":[true,false]}')).toEqual({ a: "1", b: null, c: [true, false] });
  });

  test("rejects duplicate keys", () => {
    expect(() => parseStrictJson('{"b":"1","b":"2"}')).toThrow(/duplicate object key: b/);
  });

  test("rejects JSON numbers (the v1 profile) everywhere", () => {
    expect(() => parseStrictJson('{"a":1}')).toThrow(/numbers are not allowed/);
    expect(() => parseStrictJson('[0.5]')).toThrow(/numbers are not allowed/);
    expect(() => parseStrictJson('{"a":-2}')).toThrow(/numbers are not allowed/);
    expect(() => parseStrictJson('{"a":1e3}')).toThrow();
  });

  test("rejects trailing content and empty input", () => {
    expect(() => parseStrictJson('{"a":"1"} x')).toThrow(/trailing content/);
    expect(() => parseStrictJson("")).toThrow();
    expect(() => parseStrictJson("   ")).toThrow();
  });

  test("rejects raw control characters and bad escapes", () => {
    expect(() => parseStrictJson('{"a":"x' + String.fromCharCode(9) + 'y"}')).toThrow(/raw control character/); // raw TAB
    expect(() => parseStrictJson('{"a":"\\u00zz"}')).toThrow();
    expect(() => parseStrictJson('{"a":"\\x"}')).toThrow();
  });

  test("handles unicode escapes deterministically", () => {
    expect(parseStrictJson('{"a":"\\u0041\\u00e9"}')).toEqual({ a: "Aé" });
  });
});

describe("evidence profile v1", () => {
  test("frontend-exported vectors: validation, canonicalization, commitment", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(4);
    for (const v of vectors) {
      const validation = validateEvidenceManifest(v.manifest);
      expect(validation.ok, `${JSON.stringify(validation.errors)} for ${v.manifest.kind}`).toBe(v.valid);
      if (!v.valid) {
        expect(validation.errors).toEqual(v.errors);
        continue;
      }
      expect(new TextDecoder().decode(canonicalizeEvidence(v.manifest))).toBe(v.canonicalUtf8);
      expect(evidenceCommitment(v.manifest)).toBe(v.commitment);
    }
  });

  test("content hash is keccak over exact bytes", () => {
    expect(evidenceContentHash("")).toBe("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    // Same string in both backends must hash identically.
    expect(evidenceContentHash("ANKARA IS THE CAPITAL OF TURKEY")).toBe(evidenceContentHash("ANKARA IS THE CAPITAL OF TURKEY"));
    expect(evidenceContentHash("ANKARA IS THE CAPITAL OF TURKEY\n")).not.toBe(evidenceContentHash("ANKARA IS THE CAPITAL OF TURKEY"));
  });

  test("rejects unknown and missing fields", () => {
    const base: EvidenceManifest = {
      schema: "orakl-evidence-v1",
      chainId: "31337",
      contract: "0x0000000000000000000000000000000000000001",
      marketId: "0",
      kind: "supplement",
      claim: "YES",
      proposedOutcome: "NONE",
      sources: [],
      publishedAt: "0",
      publisher: "0x0000000000000000000000000000000000000002",
      contentHash: "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
      contentMediaType: "text/plain",
      media: [],
    };
    expect(validateEvidenceManifest({ ...base, extra: true }).errors).toContainEqual("unknown field: extra");
    const { extra: _drop, ...withoutSources } = base as never as Record<string, unknown>;
    void _drop;
    delete withoutSources.sources;
    const missing = validateEvidenceManifest(withoutSources);
    expect(missing.ok).toBe(false);
    expect(missing.errors).toContainEqual("missing required field: sources");
    expect(validateEvidenceManifest({ ...base, kind: "proposal", proposedOutcome: "NONE" }).errors.length).toBeGreaterThan(0);
  });

  test("rejects unsafe URI schemes (SSRF surface)", () => {
    const v = vectors.find((x) => x.valid)!;
    const bad = { ...v.manifest, sources: ["file:///etc/passwd"] };
    expect(validateEvidenceManifest(bad).errors.some((e) => e.includes("allowed scheme"))).toBe(true);
    const javascript = { ...v.manifest, media: ["javascript:alert(1)"] };
    expect(validateEvidenceManifest(javascript).errors.some((e) => e.includes("allowed scheme"))).toBe(true);
  });
});
