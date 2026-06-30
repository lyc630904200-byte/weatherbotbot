import { describe, expect, it } from "vitest";

function unrealized(entryPrice: number, currentPrice: number, amount: number) {
  const shares = amount / entryPrice;
  return (currentPrice - entryPrice) * shares;
}

describe("paper trading pnl", () => {
  it("calculates unrealized pnl from share exposure", () => {
    expect(unrealized(0.5, 0.6, 10)).toBeCloseTo(2);
    expect(unrealized(0.8, 0.6, 20)).toBeCloseTo(-5);
  });
});
