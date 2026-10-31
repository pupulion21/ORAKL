// ORAKL P1 — Prisma client factory (single shared client per process).
import { PrismaClient } from "@prisma/client";

let shared: PrismaClient | null = null;

export function createDbClient(): PrismaClient {
  if (shared == null) shared = new PrismaClient();
  return shared;
}

export async function disconnectDb(): Promise<void> {
  if (shared != null) {
    await shared.$disconnect();
    shared = null;
  }
}
