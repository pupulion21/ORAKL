import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toHex } from 'viem';

import {
  verifyMetadataCommitment,
  verifyMetadataIntegrity,
  saveLocalManifest,
  getLocalManifest,
  clearLocalManifestCache,
} from '../src/local/metadata-trust.ts';

import {
  canonicalizeMarketMetadata,
  type MarketMetadataManifest,
} from '../src/local/navigation.ts';

// Mock localStorage for Node test runner
const mockStorage: Record<string, string> = {};
globalThis.localStorage = {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => { mockStorage[key] = value; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => { Object.keys(mockStorage).forEach((k) => delete mockStorage[k]); },
  key: (index: number) => Object.keys(mockStorage)[index] ?? null,
  length: 0,
} as Storage;

describe('ORAKL Metadata Trust & Integrity Engine', () => {
  const sampleManifest: MarketMetadataManifest = {
    schema: 'orakl-market-metadata-v1',
    chainId: '31337',
    factory: '0xdc64a140aa3e981100a9beca4e685f962f0cf6c9',
    question: 'Will London Gold Fixing PM (XAU/USD) exceed $2,800.00 on 2026-12-31?',
    description: 'LBMA Gold Price PM benchmark settlement for December 31, 2026.',
    category: 'finance',
    resolutionCriteria: '[YES OUTCOME CRITERIA]\nGold PM >= $2800\n\n[NO OUTCOME CRITERIA]\nGold PM < $2800',
    sources: ['https://www.lbma.org.uk/prices-and-data/precious-metal-prices'],
    creator: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    createdAt: '1730000000',
  };

  const canonicalString = canonicalizeMarketMetadata(sampleManifest);
  const validHash = keccak256(toHex(canonicalString)).toLowerCase();
  const validURI = `ipfs://orakl-local-artifact/${validHash.slice(2)}`;

  beforeEach(() => {
    clearLocalManifestCache();
  });

  describe('1. Cryptographic Commitment Verification (RFC 8785 + Keccak-256)', () => {
    it('computes exact deterministic commitment matching expected on-chain hash', () => {
      const res = verifyMetadataCommitment(sampleManifest, validHash);
      assert.equal(res.verified, true);
      assert.equal(res.computedHash, validHash);
      assert.ok(res.canonical.includes('"category":"finance"'));
      assert.ok(res.canonical.includes('"question":"Will London Gold Fixing PM'));
    });

    it('rejects commitment mismatch when hash differs', () => {
      const bogusHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const res = verifyMetadataCommitment(sampleManifest, bogusHash);
      assert.equal(res.verified, false);
      assert.notEqual(res.computedHash, bogusHash);
    });

    it('handles uppercase/lowercase address normalization in commitment verification', () => {
      const upperHash = validHash.toUpperCase();
      const res = verifyMetadataCommitment(sampleManifest, upperHash);
      assert.equal(res.verified, true);
    });
  });

  describe('2. Negative-Path: Cache Tampering & Commitment Mismatch Detection', () => {
    it('detects tampering when cached question is altered in storage', () => {
      const tamperedManifest: MarketMetadataManifest = {
        ...sampleManifest,
        question: 'Tampered question: Will Gold crash to zero?', // Changed!
      };

      const result = verifyMetadataIntegrity({
        onchainHash: validHash,
        onchainURI: validURI,
        cachedManifest: tamperedManifest,
      });

      assert.equal(result.status, 'unverified');
      assert.equal(result.isTampered, true);
      assert.equal(result.hasMetadata, false);
      assert.equal(result.question, 'Market metadata commitment mismatch');
      assert.ok(result.reason?.includes('Metadata commitment mismatch'));
    });

    it('detects tampering when resolution criteria are secretly modified', () => {
      const tamperedManifest: MarketMetadataManifest = {
        ...sampleManifest,
        resolutionCriteria: '[YES OUTCOME CRITERIA]\nSecret malicious criteria!',
      };

      const result = verifyMetadataIntegrity({
        onchainHash: validHash,
        onchainURI: validURI,
        cachedManifest: tamperedManifest,
      });

      assert.equal(result.status, 'unverified');
      assert.equal(result.isTampered, true);
      assert.notEqual(result.computedHash, validHash);
    });

    it('detects tampering when source URLs are altered in manifest', () => {
      const tamperedManifest: MarketMetadataManifest = {
        ...sampleManifest,
        sources: ['https://malicious-phishing-source.com'],
      };

      const result = verifyMetadataIntegrity({
        onchainHash: validHash,
        onchainURI: validURI,
        cachedManifest: tamperedManifest,
      });

      assert.equal(result.status, 'unverified');
      assert.equal(result.isTampered, true);
    });
  });

  describe('3. Verified / Unverified / Unavailable Status Distinctions', () => {
    it('marks fully matching cached manifest as "verified"', () => {
      const result = verifyMetadataIntegrity({
        onchainHash: validHash,
        onchainURI: validURI,
        cachedManifest: sampleManifest,
      });

      assert.equal(result.status, 'verified');
      assert.equal(result.hasMetadata, true);
      assert.equal(result.isTampered, false);
      assert.equal(result.question, sampleManifest.question);
      assert.equal(result.category, 'finance');
    });

    it('marks API item with verifiedMetadata=true as "verified"', () => {
      const result = verifyMetadataIntegrity({
        onchainHash: validHash,
        onchainURI: validURI,
        apiItem: {
          question: sampleManifest.question,
          description: sampleManifest.description,
          category: 'finance',
          metadataHash: validHash,
          metadataURI: validURI,
          verifiedMetadata: true,
        },
      });

      assert.equal(result.status, 'verified');
      assert.equal(result.hasMetadata, true);
      assert.equal(result.isTampered, false);
      assert.equal(result.question, sampleManifest.question);
    });

    it('marks API item with mismatched metadataHash as "unverified" with tampering flag', () => {
      const result = verifyMetadataIntegrity({
        onchainHash: validHash,
        onchainURI: validURI,
        apiItem: {
          question: 'Phony question from diverging API',
          description: null,
          category: 'crypto',
          metadataHash: '0x9999999999999999999999999999999999999999999999999999999999999999',
          metadataURI: validURI,
          verifiedMetadata: true,
        },
      });

      assert.equal(result.status, 'unverified');
      assert.equal(result.isTampered, true);
      assert.equal(result.hasMetadata, false);
      assert.ok(result.reason?.includes('API metadata commitment mismatch'));
    });

    it('marks API item with verifiedMetadata=false as "unverified"', () => {
      const result = verifyMetadataIntegrity({
        onchainHash: validHash,
        onchainURI: validURI,
        apiItem: {
          question: 'Unverified Question Candidate',
          description: null,
          category: 'crypto',
          metadataHash: validHash,
          metadataURI: validURI,
          verifiedMetadata: false,
        },
      });

      assert.equal(result.status, 'unverified');
      assert.equal(result.hasMetadata, false);
      assert.equal(result.isTampered, false);
      assert.ok(result.reason?.includes('unverified against on-chain hash commitment'));
    });

    it('marks completely missing metadata as "unavailable" without inventing titles', () => {
      const result = verifyMetadataIntegrity({
        onchainHash: validHash,
        onchainURI: validURI,
      });

      assert.equal(result.status, 'unavailable');
      assert.equal(result.hasMetadata, false);
      assert.equal(result.isTampered, false);
      assert.equal(result.question, 'Market metadata unavailable');
      assert.notEqual(result.question, validURI); // Never render raw URI as title!
      assert.ok(result.reason?.includes('unavailable via the indexer'));
    });
  });

  describe('4. Local Manifest Cache Persistence & Survival', () => {
    it('saves and retrieves manifest by commitment hash and URI', () => {
      saveLocalManifest(sampleManifest, validHash);
      saveLocalManifest(sampleManifest, validURI);

      const fromHash = getLocalManifest(validHash);
      assert.ok(fromHash);
      assert.equal(fromHash.question, sampleManifest.question);

      const fromURI = getLocalManifest(validURI);
      assert.ok(fromURI);
      assert.equal(fromURI.question, sampleManifest.question);
    });

    it('returns null when retrieving non-existent manifest', () => {
      const nonExistent = getLocalManifest('0x0000000000000000000000000000000000000000000000000000000000000000');
      assert.equal(nonExistent, null);
    });

    it('clears storage completely on clearLocalManifestCache', () => {
      saveLocalManifest(sampleManifest, validHash);
      assert.ok(getLocalManifest(validHash));

      clearLocalManifestCache();
      assert.equal(getLocalManifest(validHash), null);
    });
  });
});
