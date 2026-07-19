// Calculates and shapes profit for automated Tatum crypto trades.
//
// SELL: profit starts as fee-only at webhook success (gas isn't known yet —
// sweep hasn't run), then gets corrected down once the sweep actually
// broadcasts and gas is spent. Tatum's API never exposes actual gas paid,
// so the pre-sweep estimate is the final number we'll ever have.
//
// BUY: profit is fee-only, permanently — there's no gas cost tracked on
// the send side (out of scope, flagged separately).
export interface ProfitBreakdown {
  serviceFeeNGN: number;
  gasCostNGN: number;
  profit: number;
  gasCostSource: "none" | "estimated";
}

export class CryptoProfitCalculatorService {
  static calculateProvisional(serviceFeeNGN: number): ProfitBreakdown {
    return {
      serviceFeeNGN,
      gasCostNGN: 0,
      profit: serviceFeeNGN,
      gasCostSource: "none",
    };
  }

  static calculateWithGas(
    serviceFeeNGN: number,
    gasCostUsd: number,
    ngnRate: number,
  ): ProfitBreakdown {
    const gasCostNGN = gasCostUsd * ngnRate;
    return {
      serviceFeeNGN,
      gasCostNGN,
      profit: serviceFeeNGN - gasCostNGN, // deliberately not floored at 0 — see chat note
      gasCostSource: "estimated",
    };
  }
}
