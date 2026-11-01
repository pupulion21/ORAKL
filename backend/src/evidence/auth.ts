// ORAKL P1 — Replay-Resistant Publication Authorization (EIP-712 / EIP-191).
// LOCAL SIMULATION ONLY.
//
// Binds:
//   - Application identifier ("ORAKL")
//   - Authorization version ("1")
//   - Action type ("evidence" | "metadata")
//   - Chain ID
//   - Selected factory address
//   - Publisher address
//   - Exact payload commitment
//   - Single-use Nonce
//   - Expiration timestamp (deadline)

import { verifyTypedData, verifyMessage, type Address, type Hex } from "viem";
import { HttpError } from "../lib/format.js";

export const PUBLICATION_APP_ID = "ORAKL";
export const PUBLICATION_AUTH_VERSION = "1";

export type PublicationAction = "evidence" | "metadata";

export interface PublicationAuth {
  app: string;
  version: string;
  action: PublicationAction;
  chainId: number;
  factory: string;
  publisher: string;
  commitment: string;
  nonce: string;
  deadline: number; // Unix timestamp in seconds
}

export const EIP712_DOMAIN = (chainId: number, factory: Address) =>
  ({
    name: "ORAKL Publication Authorization",
    version: PUBLICATION_AUTH_VERSION,
    chainId: BigInt(chainId),
    verifyingContract: factory,
  }) as const;

export const EIP712_TYPES = {
  PublicationAuth: [
    { name: "app", type: "string" },
    { name: "version", type: "string" },
    { name: "action", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "factory", type: "address" },
    { name: "publisher", type: "address" },
    { name: "commitment", type: "bytes32" },
    { name: "nonce", type: "string" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function publicationAuthMessage(auth: PublicationAuth): string {
  return [
    "ORAKL PUBLICATION AUTHORIZATION",
    `app: ${auth.app}`,
    `version: ${auth.version}`,
    `action: ${auth.action}`,
    `chainId: ${auth.chainId}`,
    `factory: ${auth.factory.toLowerCase()}`,
    `publisher: ${auth.publisher.toLowerCase()}`,
    `commitment: ${auth.commitment.toLowerCase()}`,
    `nonce: ${auth.nonce}`,
    `deadline: ${auth.deadline}`,
  ].join("\n");
}

export function createPublicationAuth(params: {
  action: PublicationAction;
  chainId: number;
  factory: string;
  publisher: string;
  commitment: string;
  nonce?: string;
  ttlSeconds?: number;
}): PublicationAuth {
  const now = Math.floor(Date.now() / 1000);
  const nonce = params.nonce ?? `auth_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return {
    app: PUBLICATION_APP_ID,
    version: PUBLICATION_AUTH_VERSION,
    action: params.action,
    chainId: params.chainId,
    factory: params.factory.toLowerCase(),
    publisher: params.publisher.toLowerCase(),
    commitment: params.commitment.toLowerCase(),
    nonce,
    deadline: now + (params.ttlSeconds ?? 3600),
  };
}

export async function signPublicationAuthEip712(
  account: { signTypedData: (params: any) => Promise<Hex> },
  auth: PublicationAuth,
): Promise<Hex> {
  return account.signTypedData({
    domain: EIP712_DOMAIN(auth.chainId, auth.factory as Address),
    types: EIP712_TYPES,
    primaryType: "PublicationAuth",
    message: {
      app: auth.app,
      version: auth.version,
      action: auth.action,
      chainId: BigInt(auth.chainId),
      factory: auth.factory as Address,
      publisher: auth.publisher as Address,
      commitment: auth.commitment as Hex,
      nonce: auth.nonce,
      deadline: BigInt(auth.deadline),
    },
  });
}

export async function signPublicationAuthEip191(
  account: { signMessage: (params: { message: string }) => Promise<Hex> },
  auth: PublicationAuth,
): Promise<Hex> {
  const message = publicationAuthMessage(auth);
  return account.signMessage({ message });
}

export async function verifyAndConsumePublicationAuth(
  prisma: any,
  rawAuth: unknown,
  rawSignature: unknown,
  expected: {
    action: PublicationAction;
    chainId: number;
    factory: string;
    publisher: string;
    commitment: string;
  },
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<PublicationAuth> {
  const auth = (rawAuth && typeof rawAuth === "object" ? rawAuth : null) as Partial<PublicationAuth> | null;
  const signature =
    typeof rawSignature === "string"
      ? rawSignature
      : typeof (auth as any)?.signature === "string"
        ? (auth as any).signature
        : null;

  if (!signature || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new HttpError(401, "INVALID_SIGNATURE", "signature must be a 0x-prefixed hex string");
  }

  if (!auth) {
    throw new HttpError(400, "MISSING_AUTHORIZATION", "publication authorization with nonce and deadline is required");
  }

  if (!auth.app) {
    throw new HttpError(400, "INVALID_AUTHORIZATION", "app identifier is required and must be ORAKL");
  }
  if (auth.app !== PUBLICATION_APP_ID) {
    throw new HttpError(400, "INVALID_AUTHORIZATION", `app must be ${PUBLICATION_APP_ID}`);
  }
  if (auth.version !== PUBLICATION_AUTH_VERSION) {
    throw new HttpError(400, "INVALID_AUTHORIZATION", `version must be ${PUBLICATION_AUTH_VERSION}`);
  }
  if (auth.action !== expected.action) {
    throw new HttpError(400, "WRONG_ACTION", `action mismatch: expected ${expected.action}, got ${auth.action}`);
  }
  if (Number(auth.chainId) !== expected.chainId) {
    throw new HttpError(400, "WRONG_CHAIN", `chainId mismatch: expected ${expected.chainId}, got ${auth.chainId}`);
  }
  if (!auth.factory || auth.factory.toLowerCase() !== expected.factory.toLowerCase()) {
    throw new HttpError(400, "WRONG_FACTORY", `factory mismatch: expected ${expected.factory}, got ${auth.factory}`);
  }
  if (!auth.publisher || auth.publisher.toLowerCase() !== expected.publisher.toLowerCase()) {
    throw new HttpError(401, "UNAUTHORIZED_PUBLISHER", `publisher mismatch: declared ${expected.publisher}, got ${auth.publisher}`);
  }
  if (!auth.commitment || auth.commitment.toLowerCase() !== expected.commitment.toLowerCase()) {
    throw new HttpError(400, "PAYLOAD_MISMATCH", `commitment mismatch: expected ${expected.commitment}, got ${auth.commitment}`);
  }
  if (typeof auth.nonce !== "string" || auth.nonce.trim().length === 0) {
    throw new HttpError(400, "INVALID_NONCE", "nonce must be a non-empty string");
  }
  const deadline = Number(auth.deadline);
  if (!Number.isInteger(deadline) || deadline <= 0) {
    throw new HttpError(400, "INVALID_DEADLINE", "deadline must be a positive integer timestamp");
  }
  if (deadline < nowSec) {
    throw new HttpError(401, "EXPIRED_SIGNATURE", `signature expired at ${deadline}, current time ${nowSec}`);
  }

  const fullAuth: PublicationAuth = {
    app: auth.app,
    version: auth.version,
    action: auth.action,
    chainId: Number(auth.chainId),
    factory: auth.factory.toLowerCase(),
    publisher: auth.publisher.toLowerCase(),
    commitment: auth.commitment.toLowerCase(),
    nonce: auth.nonce.trim(),
    deadline,
  };

  // 1. Verify cryptographic signature
  let valid = false;
  try {
    valid = await verifyTypedData({
      address: fullAuth.publisher as Address,
      domain: EIP712_DOMAIN(fullAuth.chainId, fullAuth.factory as Address),
      types: EIP712_TYPES,
      primaryType: "PublicationAuth",
      message: {
        app: fullAuth.app,
        version: fullAuth.version,
        action: fullAuth.action,
        chainId: BigInt(fullAuth.chainId),
        factory: fullAuth.factory as Address,
        publisher: fullAuth.publisher as Address,
        commitment: fullAuth.commitment as Hex,
        nonce: fullAuth.nonce,
        deadline: BigInt(fullAuth.deadline),
      },
      signature: signature as Hex,
    });
  } catch {
    valid = false;
  }

  if (!valid) {
    try {
      const msg = publicationAuthMessage(fullAuth);
      valid = await verifyMessage({
        address: fullAuth.publisher as Address,
        message: msg,
        signature: signature as Hex,
      });
    } catch {
      valid = false;
    }
  }

  if (!valid) {
    throw new HttpError(401, "INVALID_SIGNATURE", `signature does not verify for declared publisher (${expected.publisher})`);
  }

  // 2. Consume nonce atomically in PostgreSQL
  await prisma.user.upsert({
    where: { walletAddress: fullAuth.publisher },
    create: { walletAddress: fullAuth.publisher },
    update: { lastSeenAt: new Date() },
  });

  try {
    await prisma.authNonce.create({
      data: {
        walletAddress: fullAuth.publisher,
        nonce: fullAuth.nonce,
        expiresAt: new Date(fullAuth.deadline * 1000),
        consumedAt: new Date(),
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002" || err?.message?.includes("Unique constraint")) {
      throw new HttpError(409, "REUSED_NONCE", `nonce ${fullAuth.nonce} has already been consumed`);
    }
    throw err;
  }

  return fullAuth;
}
