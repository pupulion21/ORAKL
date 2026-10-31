// ORAKL P1 — response normalization helpers.
// Native base-unit values are always serialized as exact decimal
// strings; no JavaScript floating point ever touches a uint256.

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function transform(value: unknown): Json {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : String(value);
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || value == null) return value as null | boolean;
  if (Array.isArray(value)) return value.map((v) => transform(v));
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toFixed?: unknown })?.toFixed === "function") return (value as { toFixed: (dp?: number) => string }).toFixed();
  if (typeof value === "object") {
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = transform(v);
    return out;
  }
  return String(value);
}

export const serialize = transform;

/** Trim untrusted free strings into safe, bounded display text. */
export function sanitizeText(input: unknown, maxLength = 512): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/[\u0000-\u0008\u000e-\u001f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

export class HttpError extends Error {
  public status: number;
  public code: string;
  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/** Redact database URLs, RPC secrets, passwords, and sensitive paths from error text. */
export function redactSecrets(text: string): string {
  if (typeof text !== "string" || text.length === 0) return "";
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/https?:\/\/[^\s"'`]*(?:key|token|secret|auth|apikey)[^\s"'`]*/gi, "[REDACTED_RPC_URL]")
    .replace(/(private[_-]?key|secret|password|mnemonic|seed[_-]?phrase|bearer)\s*[:=]\s*['"]?[^\s"',`]+/gi, "$1=[REDACTED]")
    .replace(/\/(?:home|Users)\/[^\s:"'`]+/g, "[REDACTED_PATH]");
}

export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, "BAD_REQUEST", redactSecrets(message));
  }
}

export function parsePagination(searchParams: URLSearchParams, defaults = { page: 1, pageSize: 20 }, maxPageSize = 100) {
  const rawPage = Number(searchParams.get("page") ?? defaults.page);
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : defaults.page;
  const rawSize = Number(searchParams.get("pageSize") ?? defaults.pageSize);
  const size = Number.isFinite(rawSize) ? Math.floor(rawSize) : defaults.pageSize;
  const pageSize = Math.min(maxPageSize, Math.max(1, size));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function requireBigintParam(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) throw new HttpError(400, "INVALID_PARAM", `${label} must be a non-negative decimal integer`);
  return BigInt(value);
}

export function requireAddressParam(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new HttpError(400, "INVALID_PARAM", "address must be 0x + 40 hex chars");
  return value.toLowerCase();
}
