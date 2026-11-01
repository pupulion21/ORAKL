#!/usr/bin/env node

/**
 * @file verify-evidence-manifest.mjs
 * @description Validates cryptographic integrity of all artifacts in docs/p1/evidence/MANIFEST.json.
 * Fails with exit code 1 if any file is missing, byte size mismatches, or SHA-256 checksum mismatches.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../..');
const EVIDENCE_DIR = resolve(REPO_ROOT, 'docs/p1/evidence');
const MANIFEST_PATH = resolve(EVIDENCE_DIR, 'MANIFEST.json');

function computeSha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function verifyManifest() {
  console.log('[MANIFEST-VERIFY] Reading manifest from:', MANIFEST_PATH);
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`[FAIL] Manifest file does not exist: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  let manifest;
  try {
    const raw = readFileSync(MANIFEST_PATH, 'utf8');
    manifest = JSON.parse(raw);
  } catch (err) {
    console.error(`[FAIL] Failed to parse MANIFEST.json:`, err);
    process.exit(1);
  }

  if (!manifest.artifacts || !Array.isArray(manifest.artifacts)) {
    console.error(`[FAIL] Invalid MANIFEST.json: missing 'artifacts' array`);
    process.exit(1);
  }

  console.log(`[MANIFEST-VERIFY] Checking ${manifest.artifacts.length} artifacts...`);
  let errors = 0;
  let verified = 0;

  for (const artifact of manifest.artifacts) {
    const filePath = resolve(EVIDENCE_DIR, artifact.file);
    if (!existsSync(filePath)) {
      console.error(`[FAIL] Missing artifact file: ${artifact.file} at ${filePath}`);
      errors++;
      continue;
    }

    const fileBuffer = readFileSync(filePath);
    const actualBytes = fileBuffer.length;
    const actualSha256 = computeSha256(fileBuffer);

    if (actualBytes !== artifact.bytes) {
      console.error(`[FAIL] Byte size mismatch for ${artifact.file}: expected ${artifact.bytes}, got ${actualBytes}`);
      errors++;
      continue;
    }

    if (actualSha256 !== artifact.sha256) {
      console.error(`[FAIL] SHA-256 mismatch for ${artifact.file}:\n  expected: ${artifact.sha256}\n  actual:   ${actualSha256}`);
      errors++;
      continue;
    }

    console.log(`[OK] ${artifact.file} (${actualBytes} bytes, SHA-256: ${actualSha256.slice(0, 16)}...)`);
    verified++;
  }

  // Also verify CHECKSUMS.txt if present
  const checksumsPath = resolve(EVIDENCE_DIR, 'CHECKSUMS.txt');
  if (existsSync(checksumsPath)) {
    const lines = readFileSync(checksumsPath, 'utf8').trim().split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length === 2) {
        const [expectedHash, relFile] = parts;
        const filePath = resolve(EVIDENCE_DIR, relFile);
        if (existsSync(filePath)) {
          const buf = readFileSync(filePath);
          const hash = computeSha256(buf);
          if (hash !== expectedHash) {
            console.error(`[FAIL] CHECKSUMS.txt mismatch for ${relFile}`);
            errors++;
          }
        }
      }
    }
  }

  if (errors > 0) {
    console.error(`\n[VERIFICATION FAILED] ${errors} integrity error(s) detected.`);
    process.exit(1);
  }

  console.log(`\n[VERIFICATION PASSED] All ${verified} artifacts match MANIFEST.json and CHECKSUMS.txt exactly.`);
  process.exit(0);
}

verifyManifest();
