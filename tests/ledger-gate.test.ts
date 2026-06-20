import { describe, expect, it } from "vitest";
import { gateEnvFallback } from "@/lib/ledger/policy";

describe("gateEnvFallback — free-allotment gate for the bridge-default key", () => {
  it("ledger off → allow, unmetered (today's behavior)", () => {
    expect(gateEnvFallback({ ledgerEnabled: false, balance: null })).toEqual({
      kind: "allow",
      meter: false,
    });
    // even a 0 balance is irrelevant when the ledger is off
    expect(gateEnvFallback({ ledgerEnabled: false, balance: 0 })).toEqual({
      kind: "allow",
      meter: false,
    });
  });

  it("ledger on, has balance → allow, metered", () => {
    expect(gateEnvFallback({ ledgerEnabled: true, balance: 5 })).toEqual({
      kind: "allow",
      meter: true,
    });
  });

  it("ledger on, spent → blocked", () => {
    expect(gateEnvFallback({ ledgerEnabled: true, balance: 0 })).toEqual({
      kind: "blocked",
      balance: 0,
    });
  });

  it("ledger on, unknown balance (unreachable) → allow, metered (fail open)", () => {
    expect(gateEnvFallback({ ledgerEnabled: true, balance: null })).toEqual({
      kind: "allow",
      meter: true,
    });
  });
});
