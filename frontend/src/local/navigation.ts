/** ORAKL Predict — Local Navigation & Resolution State Helpers */

export type Route =
  | {name: 'list'}
  | {name: 'market'; id: bigint}
  | {name: 'arbitration'; filter?: 'all' | 'disputed' | 'proposed' | 'finalized'}
  | {name: 'arbitration-case'; id: bigint}
  | {name: 'create'}
  | {name: 'evidence'}
  | {name: 'status'}
  | {name: 'portfolio'};

/** Parses a browser location hash into an application Route. */
export function parseRoute(hashOverride?: string): Route {
  const hash = (hashOverride ?? (typeof location !== 'undefined' ? location.hash : '')).replace(/^#/, '');
  const marketMatch = /^\/market\/(\d+)$/.exec(hash);
  if (marketMatch?.[1]) return {name: 'market', id: BigInt(marketMatch[1])};
  const arbCaseMatch = /^\/arbitration\/(\d+)$/.exec(hash);
  if (arbCaseMatch?.[1]) return {name: 'arbitration-case', id: BigInt(arbCaseMatch[1])};
  if (hash.startsWith('/arbitration')) {
    const qIdx = hash.indexOf('?');
    let filter: 'all' | 'disputed' | 'proposed' | 'finalized' = 'all';
    if (qIdx !== -1) {
      const params = new URLSearchParams(hash.slice(qIdx));
      const f = params.get('filter');
      if (f === 'disputed' || f === 'proposed' || f === 'finalized' || f === 'all') {
        filter = f;
      }
    }
    return {name: 'arbitration', filter};
  }
  if (hash === '/create') return {name: 'create'};
  if (hash === '/evidence') return {name: 'evidence'};
  if (hash === '/status') return {name: 'status'};
  if (hash === '/portfolio') return {name: 'portfolio'};
  return {name: 'list'};
}

/** Maps a numerical stored market state to visual tone. */
export function stateTone(storedState: number): string {
  switch (storedState) {
    case 0:
      return 'open';
    case 1:
      return 'wait';
    case 2:
    case 3:
      return 'expired';
    default:
      return 'done';
  }
}

/** Calculates proportional pool distribution without guaranteed probability claims. */
export function calculatePoolShares(yesPool: bigint, noPool: bigint): {
  total: bigint;
  yesPct: number | null;
  noPct: number | null;
} {
  const total = yesPool + noPool;
  if (total === 0n) {
    return {total: 0n, yesPct: null, noPct: null};
  }
  const yesPct = Number((yesPool * 10_000n) / total) / 100;
  const noPct = 100 - yesPct;
  return {total, yesPct, noPct};
}

/** Case-insensitive check if an account is in the arbitrator multisig owners list. */
export function isArbitratorOwner(account: string | null | undefined, owners: readonly string[]): boolean {
  if (!account) return false;
  const normalized = account.toLowerCase();
  return owners.some((owner) => owner.toLowerCase() === normalized);
}
