import { describe, expect, it } from "vitest";

// Trivial test proving the vitest harness runs in CI (XXX-13).
describe("test harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
