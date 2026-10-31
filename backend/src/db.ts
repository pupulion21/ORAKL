// ORAKL P1 — PrismaClient construction via the Postgres driver adapter.
//
// The embedded Rust query engine is bypassed entirely: all queries flow
// through @prisma/adapter-pg (pure Node sockets), which is both the P1
// hardening choice (no native binary in the query path) and the only path
// that works under this environment's sandbox profile. Migrations are
// applied with psql against prisma/migrations/, never migrate dev.
//
// uint256 / wei support: PostgreSQL BIGINT (signed 64-bit) overflows at ~9.22 ether.
// All financial wei fields are stored as NUMERIC(78, 0) in Postgres and Decimal in Prisma,
// while transparently accepting and returning native BigInt on all reads and writes.
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@prisma/client";

export const DECIMAL_FIELDS = new Set([
  "deposited",
  "returned",
  "slashed",
  "amount",
  "yesContribution",
  "noContribution",
  "claimedAmount",
  "refundedAmount",
  "totalChallengeStake",
  "proposalBond",
  "challengeBond",
  "bondAmount",
  "prefixBefore",
  "value",
  "gasUsed",
  "totalContributions",
  "totalParticipantPaid",
  "totalFeesAccrued",
  "totalFeesWithdrawn",
  "totalBondsDeposited",
  "totalBondsPaid",
  "bondLiability",
  "feeLiability",
  "participantLiability",
  "totalUnresolvedExposure",
  "unaccountedBalance",
  "contractBalance",
]);

function toDecimalFields(val: unknown, key?: string): unknown {
  if (val == null) return val;
  if (val instanceof Date) return val;
  if (val instanceof Prisma.Decimal) return val;
  if (typeof val === "bigint" && key && DECIMAL_FIELDS.has(key)) {
    return new Prisma.Decimal(val.toString());
  }
  if (Array.isArray(val)) return val.map((v) => toDecimalFields(v, key));
  if (typeof val === "object" && Object.prototype.toString.call(val) === "[object Object]") {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (k === "increment" || k === "decrement" || k === "set") {
        res[k] = toDecimalFields(v, key);
      } else {
        res[k] = toDecimalFields(v, k);
      }
    }
    return res;
  }
  return val;
}

function toBigInt(val: unknown): bigint {
  if (val == null) return 0n;
  if (typeof (val as { toFixed?: unknown })?.toFixed === "function") {
    return BigInt((val as { toFixed: () => string }).toFixed());
  }
  return BigInt(val.toString());
}

function toBigIntOrNull(val: unknown): bigint | null {
  if (val == null) return null;
  if (typeof (val as { toFixed?: unknown })?.toFixed === "function") {
    return BigInt((val as { toFixed: () => string }).toFixed());
  }
  return BigInt(val.toString());
}

export function enhancePrisma(base: PrismaClient): any {
  const extension: any = {
    query: {
      $allModels: {
        async $allOperations({ query, args }: any) {
          return query(toDecimalFields(args) as never);
        },
      },
    },
    result: {
      market: {
        totalChallengeStake: {
          needs: { totalChallengeStake: true },
          compute(m: any) { return toBigInt(m.totalChallengeStake); },
        },
      },
      marketPosition: {
        yesContribution: {
          needs: { yesContribution: true },
          compute(p: any) { return toBigInt(p.yesContribution); },
        },
        noContribution: {
          needs: { noContribution: true },
          compute(p: any) { return toBigInt(p.noContribution); },
        },
        claimedAmount: {
          needs: { claimedAmount: true },
          compute(p: any) { return toBigInt(p.claimedAmount); },
        },
        refundedAmount: {
          needs: { refundedAmount: true },
          compute(p: any) { return toBigInt(p.refundedAmount); },
        },
      },
      contribution: {
        amount: {
          needs: { amount: true },
          compute(c: any) { return toBigInt(c.amount); },
        },
      },
      bond: {
        deposited: {
          needs: { deposited: true },
          compute(b: any) { return toBigInt(b.deposited); },
        },
        returned: {
          needs: { returned: true },
          compute(b: any) { return toBigInt(b.returned); },
        },
        slashed: {
          needs: { slashed: true },
          compute(b: any) { return toBigInt(b.slashed); },
        },
      },
      claim: {
        amount: {
          needs: { amount: true },
          compute(c: any) { return toBigInt(c.amount); },
        },
      },
      marketActivity: {
        amount: {
          needs: { amount: true },
          compute(a: any) { return toBigIntOrNull(a.amount); },
        },
      },
      prediction: {
        amount: {
          needs: { amount: true },
          compute(p: any) { return toBigInt(p.amount); },
        },
      },
      resolution: {
        proposalBond: {
          needs: { proposalBond: true },
          compute(r: any) { return toBigInt(r.proposalBond); },
        },
        challengeBond: {
          needs: { challengeBond: true },
          compute(r: any) { return toBigInt(r.challengeBond); },
        },
      },
      dispute: {
        bondAmount: {
          needs: { bondAmount: true },
          compute(d: any) { return toBigInt(d.bondAmount); },
        },
      },
      challengeStake: {
        amount: {
          needs: { amount: true },
          compute(s: any) { return toBigInt(s.amount); },
        },
        prefixBefore: {
          needs: { prefixBefore: true },
          compute(s: any) { return toBigInt(s.prefixBefore); },
        },
      },
      marketSettlement: {
        totalChallengeStake: {
          needs: { totalChallengeStake: true },
          compute(s: any) { return toBigInt(s.totalChallengeStake); },
        },
        proposalBond: {
          needs: { proposalBond: true },
          compute(s: any) { return toBigInt(s.proposalBond); },
        },
      },
      exposureSnapshot: {
        amount: {
          needs: { amount: true },
          compute(e: any) { return toBigInt(e.amount); },
        },
      },
      protocolFeeAccrual: {
        amount: {
          needs: { amount: true },
          compute(f: any) { return toBigInt(f.amount); },
        },
      },
      transactionRecord: {
        value: {
          needs: { value: true },
          compute(t: any) { return toBigInt(t.value); },
        },
        gasUsed: {
          needs: { gasUsed: true },
          compute(t: any) { return toBigInt(t.gasUsed); },
        },
      },
      accountingSnapshot: {
        totalContributions: {
          needs: { totalContributions: true },
          compute(s: any) { return toBigInt(s.totalContributions); },
        },
        totalParticipantPaid: {
          needs: { totalParticipantPaid: true },
          compute(s: any) { return toBigInt(s.totalParticipantPaid); },
        },
        totalFeesAccrued: {
          needs: { totalFeesAccrued: true },
          compute(s: any) { return toBigInt(s.totalFeesAccrued); },
        },
        totalFeesWithdrawn: {
          needs: { totalFeesWithdrawn: true },
          compute(s: any) { return toBigInt(s.totalFeesWithdrawn); },
        },
        totalBondsDeposited: {
          needs: { totalBondsDeposited: true },
          compute(s: any) { return toBigInt(s.totalBondsDeposited); },
        },
        totalBondsPaid: {
          needs: { totalBondsPaid: true },
          compute(s: any) { return toBigInt(s.totalBondsPaid); },
        },
        bondLiability: {
          needs: { bondLiability: true },
          compute(s: any) { return toBigInt(s.bondLiability); },
        },
        feeLiability: {
          needs: { feeLiability: true },
          compute(s: any) { return toBigInt(s.feeLiability); },
        },
        participantLiability: {
          needs: { participantLiability: true },
          compute(s: any) { return toBigInt(s.participantLiability); },
        },
        totalUnresolvedExposure: {
          needs: { totalUnresolvedExposure: true },
          compute(s: any) { return toBigInt(s.totalUnresolvedExposure); },
        },
        unaccountedBalance: {
          needs: { unaccountedBalance: true },
          compute(s: any) { return toBigInt(s.unaccountedBalance); },
        },
        contractBalance: {
          needs: { contractBalance: true },
          compute(s: any) { return toBigInt(s.contractBalance); },
        },
      },
    },
  };
  return (base as any).$extends(extension);
}

export type PrismaDb = PrismaClient;

export function makePrisma(databaseUrl?: string): PrismaDb {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (url == null || url.length === 0) throw new Error("DATABASE_URL is required");
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) as never });
  return enhancePrisma(raw) as unknown as PrismaDb;
}
