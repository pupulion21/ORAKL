import { describe, it, expect } from "vitest";
import { runRealSafeTestSuite } from "../../scripts/p3/test-real-safe.mjs";

describe("ORAKL P3 Canonical Safe v1.4.1 Execution Test Suite (Live Anvil)", () => {
  it(
    "executes all 28 canonical Safe governance, compliance, and arbitration scenarios",
    async () => {
      const result = await runRealSafeTestSuite();
      expect(result).toBe(true);
    },
    60000
  );
});
