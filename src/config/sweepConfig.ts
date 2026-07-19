// Controls when qualifying deposits (>= crypto.minSweepThresholdUsd) get
// swept from their individual deposit address to the chain's master wallet.
//
//   "immediate" -> sweep right away once a deposit is credited, if it's
//                  above threshold. Smaller deposits still wait and get
//                  picked up by the daily batch sweep.
//   "batch"     -> (default) every deposit waits for the daily 2 AM sweep,
//                  regardless of amount.
//
// Set per deployment via env var — e.g. flip to "immediate" for clients
// who want large deposits consolidated right away, leave as "batch" for
// clients who'd rather save on gas by batching everything overnight.
// export const SWEEP_MODE: "immediate" | "batch" =
//   process.env.TATUM_SWEEP_MODE === "immediate" ? "immediate" : "batch";

import logger from "@/logger";

export const SWEEP_MODE: "immediate" | "batch" = "immediate"; // TODO: remove this line and uncomment the above lines when we want to switch back to batch mode

const DEFAULT_FEE_TIERS = [
  { minUsd: 0, maxUsd: 1000, capPercent: 0.5 },
  { minUsd: 1000, maxUsd: 5000, capPercent: 1.0 },
  { minUsd: 5000, maxUsd: 10000, capPercent: 1.5 },
  { minUsd: 10000, maxUsd: 50000, capPercent: 2.0 },
  { minUsd: 50000, maxUsd: null, capPercent: 2.5 },
];

export const SWEEP_CONFIG = {
  USE_FEE_CAP: process.env.TATUM_USE_FEE_CAP === "true",

  FEE_TIERS: (() => {
    if (!process.env.TATUM_SWEEP_FEE_TIERS) return DEFAULT_FEE_TIERS;
    try {
      return JSON.parse(process.env.TATUM_SWEEP_FEE_TIERS);
    } catch {
      logger.error("Invalid TATUM_SWEEP_FEE_TIERS, falling back to defaults");
      return DEFAULT_FEE_TIERS;
    }
  })(),
};
