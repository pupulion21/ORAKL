import { describe, it, expect } from "vitest";
import { runSecurityMutationsSuite } from "../../scripts/p4/test-security-mutations.mjs";

describe("ORAKL P4 Security Mutation & Regression Test Suite (Live Anvil)", () => {
  it(
    "executes and detects all 12 controlled security mutations with fail-closed gates",
    async () => {
      const result = await runSecurityMutationsSuite();
      expect(result.success).toBe(true);
      expect(result.results.length).toBe(12);
      expect(result.results.every((r: { status: string }) => r.status === "DETECTED")).toBe(true);
    },
    120000
  );
});
