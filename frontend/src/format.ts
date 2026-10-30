/** Pure formatting / math helpers (unit-tested, no chain access). */

export type Outcome = 0 | 1 | 2 | 3; // UNRESOLVED | YES | NO | INVALID
export type MarketPhase = 'OPEN' | 'AWAITING_RESOLUTION' | 'EXPIRED_UNRESOLVED' | 'RESOLVED';

export interface PhaseInput {
  closeTime: bigint;
  resolveDeadline: bigint;
  outcome: number;
  cancelled: boolean;
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Floor division share of a pool: numerator/denominator as basis points (0..10000). */
export function poolShareBps(part: bigint, total: bigint): number | null {
  if (total === 0n) return null;
  return Number((part * 10_000n) / total);
}

/** Truncating decimal string for UI display (never rounds up balances). */
export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0');
  const trimmed = frac.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${trimmed ? '.' + trimmed : ''}`;
}

/** Parses a human decimal amount into integer units. Throws on garbage. */
export function parseUnits(text: string, decimals: number): bigint {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error('Enter a valid decimal amount');
  const [wholeRaw, frac = ''] = t.split('.');
  const whole = wholeRaw ?? '';
  if (frac.length > decimals) throw new Error(`At most ${decimals} decimal places`);
  const base = 10n ** BigInt(decimals);
  return BigInt(whole) * base + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals));
}

export function parseQie(text: string): bigint {
  return parseUnits(text, 18);
}

/** Human QIE amount with at most `maxFractionDigits`; keeps tiny dust visible. */
export function formatQie(value: bigint, maxFractionDigits = 6): string {
  if (value === 0n) return '0';
  const full = formatUnits(value, 18);
  const [whole = '0', frac = ''] = full.split('.');
  const fraction = frac.slice(0, maxFractionDigits).replace(/0+$/, '');
  if (whole === '0' && fraction === '' && value > 0n) {
    return `<0.${'0'.repeat(Math.max(0, maxFractionDigits - 1))}1`;
  }
  return fraction ? `${whole}.${fraction}` : whole;
}

export function formatQieInput(value: bigint): string {
  return formatUnits(value, 18);
}

export function formatBps(bps: number | null): string {
  if (bps === null) return '—';
  return `${(bps / 100).toFixed(2)}%`;
}

export function shortAddress(address: string, head = 6, tail = 4): string {
  return address.length >= head + tail + 1 ? `${address.slice(0, head)}…${address.slice(-tail)}` : address;
}

export function addressEq(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export function isAddressLike(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function isZeroAddress(value: string): boolean {
  return value.toLowerCase() === '0x0000000000000000000000000000000000000000';
}

export const OUTCOME_LABELS: Record<number, string> = {
  0: 'UNRESOLVED',
  1: 'YES WINS',
  2: 'NO WINS',
  3: 'INVALID — REFUND',
};

export function outcomeLabel(outcome: number): string {
  return OUTCOME_LABELS[outcome] ?? 'UNKNOWN';
}

export function marketPhase(m: PhaseInput, current = nowSec()): MarketPhase {
  const close = Number(m.closeTime);
  const deadline = Number(m.resolveDeadline);
  if (m.outcome !== 0 || m.cancelled) return 'RESOLVED';
  if (current < close) return 'OPEN';
  if (current < deadline) return 'AWAITING_RESOLUTION';
  return 'EXPIRED_UNRESOLVED';
}

export function phaseLabel(phase: MarketPhase): string {
  switch (phase) {
    case 'OPEN':
      return 'Open';
    case 'AWAITING_RESOLUTION':
      return 'Awaiting resolver';
    case 'EXPIRED_UNRESOLVED':
      return 'Expired · cancellation available';
    case 'RESOLVED':
      return 'Resolved';
  }
}

export function phaseTone(phase: MarketPhase): 'open' | 'wait' | 'expired' | 'done' {
  switch (phase) {
    case 'OPEN':
      return 'open';
    case 'AWAITING_RESOLUTION':
      return 'wait';
    case 'EXPIRED_UNRESOLVED':
      return 'expired';
    case 'RESOLVED':
      return 'done';
  }
}

export function formatDateTime(unixSeconds: bigint): string {
  const date = new Date(Number(unixSeconds) * 1000);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {dateStyle: 'medium', timeStyle: 'short'}).format(date);
}

export function toDateTimeLocal(unixSeconds: bigint): string {
  const d = new Date(Number(unixSeconds) * 1000);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function utcByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]!,
  );
}

/** Pari-mutuel estimate for a new stake, using current pools. Floor division. */
export function estimatePayoutForStake(
  yesStake: bigint,
  noStake: bigint,
  side: 0 | 1,
  amount: bigint,
): bigint {
  if (amount <= 0n) return 0n;
  const totalPool = yesStake + noStake + amount;
  const winningStake = (side === 0 ? yesStake : noStake) + amount;
  if (winningStake === 0n) return 0n;
  return (amount * totalPool) / winningStake;
}

/** Exact split of the remaining pool after a resolution, for display only. */
export function impliedMultiplier(winningStake: bigint, totalPool: bigint): number | null {
  if (winningStake === 0n) return null;
  return Number((totalPool * 10_000n) / winningStake) / 10_000;
}

export function formatMultiplier(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}×`;
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const anyError = error as {
      shortMessage?: string;
      message?: string;
      code?: number;
      details?: string;
      cause?: {shortMessage?: string; message?: string};
    };
    if (anyError.code === 4001) return 'Cancelled in your wallet. No transaction was sent.';
    if (anyError.code === 4902) {
      return 'QIE Testnet is not enabled (4902). Turn on the Testnet toggle in QIE Wallet, then reconnect.';
    }
    if (anyError.code === -32002) {
      return 'Your wallet has a pending request. Open it and finish that request first.';
    }
    return (
      anyError.shortMessage ??
      anyError.cause?.shortMessage ??
      anyError.message ??
      anyError.details ??
      String(error)
    );
  }
  return String(error);
}

/** Human explanation for the contract's custom errors, when present in the RPC text. */
export function contractErrorText(message: string): string {
  const known: Array<[RegExp, string]> = [
    [/MarketClosed/, 'The market is closed. New stakes are not accepted.'],
    [/ZeroAmount/, 'Stake must be greater than zero.'],
    [/MarketNotFound/, 'Market not found.'],
    [/ZeroResolver/, 'The resolver cannot be the zero address.'],
    [/CloseTimeNotInFuture/, 'Closing time must be in the future according to block.timestamp.'],
    [/ResolveDeadlineNotAfterClose/, 'Resolution deadline must be after closing time.'],
    [/EmptyQuestion/, 'Question cannot be empty.'],
    [/EmptyCriteria/, 'Criteria cannot be empty.'],
    [/EmptySource/, 'Source cannot be empty.'],
    [/QuestionTooLong/, 'Question exceeds 280 UTF-8 bytes.'],
    [/CriteriaTooLong/, 'Criteria exceed 2000 UTF-8 bytes.'],
    [/SourceTooLong/, 'Source exceeds 512 UTF-8 bytes.'],
    [/NotResolver/, 'Only this market’s resolver can set the result.'],
    [/ResolutionNotOpen/, 'Resolution has not opened yet. The market has not closed.'],
    [/ResolutionWindowClosed/, 'The resolution window has expired. The market can only be cancelled.'],
    [/AlreadyResolved/, 'The market is already resolved.'],
    [/InvalidOutcome/, 'Invalid resolution outcome.'],
    [/MarketNotResolved/, 'The market has not been resolved.'],
    [/WinningSideEmpty/, 'The winning side has no stakes. Request a refund.'],
    [/NothingToClaim/, 'No winning stake to claim.'],
    [/AlreadySettled/, 'This position has already been settled.'],
    [/RefundNotEnabled/, 'Refunds are not enabled for this market.'],
    [/NothingToRefund/, 'No stake to refund.'],
    [/AlreadyCancelled/, 'The market is already cancelled.'],
    [/ResolutionWindowStillOpen/, 'The resolution window is still open. Cancellation is not available yet.'],
    [/InvalidRecipient/, 'Invalid recipient (zero address or market contract).'],
    [/NativeTransferFailed/, 'QIE transfer to the recipient failed.'],
    [/DirectTransferRejected/, 'Direct QIE transfers to the contract are rejected. Use stake().'],
    [/TotalPoolCapExceeded/, 'The market pool exceeds the uint128 limit.'],
    [/ReentrancyGuardReentrantCall/, 'Reentrant call rejected.'],
  ];
  for (const [pattern, text] of known) {
    if (pattern.test(message)) return text;
  }
  return message;
}

export function txUrl(hash: string): string {
  return `https://testnet.qie.digital/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `https://testnet.qie.digital/address/${address}`;
}

export function externalLink(url: string, label: string, title?: string): string {
  const safeTitle = title ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"${safeTitle}>${escapeHtml(label)}</a>`;
}

export function formatBytes(bytes: number): string {
  return `${bytes} byte`;
}

export function countdownText(targetSec: number, currentSec = nowSec()): string {
  const delta = targetSec - currentSec;
  if (delta <= 0) return 'elapsed';
  const days = Math.floor(delta / 86_400);
  const hours = Math.floor((delta % 86_400) / 3_600);
  const minutes = Math.floor((delta % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}
