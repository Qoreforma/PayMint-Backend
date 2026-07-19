import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import { SWEEP_CONFIG } from "@/config/sweepConfig";
import { GasFeeEstimationService } from "./GasFeeEstimationService";
import { CryptoProfitCalculatorService } from "../CryptoProfitCalculatorService";
import { registerKmsTransaction } from "@/routes/client/tatum";

function getDeps() {
  return {
    cryptoTransactionRepository:
      ServiceContainer.getCryptoTransactionRepository(),
    tatumService: ServiceContainer.getTatumService(),
    networkRepository: ServiceContainer.getNetworkRepository(),
  };
}

export interface SweepableDeposit {
  id?: any;
  reference: string;
  cryptoAmount: number;
  tatumDepositAddress?: string;
  network: { networkId: any };
  meta?: any;
}

export interface SweepableCrypto {
  code: string;
  minSweepThresholdUsd?: number;
}

/**
 * Result of a sweep attempt
 */
export interface SweepResult {
  txHash?: string;
  skipped?: boolean;
  reason?: string;
  retryAt?: Date;
}

/**
 * Returns true if a deposit's USD value meets/exceeds its sweep threshold.
 * Shared by both the daily batch sweep and the immediate-sweep path so the
 * "is this big enough to sweep" rule only lives in one place.
 */
export function meetsSweepThreshold(
  depositUsdAmount: number | null | undefined,
  crypto: SweepableCrypto,
): boolean {
  if (depositUsdAmount == null) return false;
  const threshold = crypto.minSweepThresholdUsd || 50;
  return depositUsdAmount >= threshold;
}

/**
 * Calculate tiered gas fee cap based on deposit USD amount
 * Uses tiers from SWEEP_CONFIG
 */
export function calculateFeeCapForAmount(depositUsdAmount: number): number {
  const feeTiers = SWEEP_CONFIG.FEE_TIERS;

  for (const tier of feeTiers) {
    const maxUsd = tier.maxUsd || Infinity;
    if (depositUsdAmount >= tier.minUsd && depositUsdAmount < maxUsd) {
      return (depositUsdAmount * tier.capPercent) / 100;
    }
  }

  // Fallback (shouldn't happen if tiers cover all ranges)
  return (depositUsdAmount * 2.5) / 100; // 2.5%
}

/**
 * Sweeps a single confirmed deposit to its chain's master wallet.
 *
 * Caller is responsible for checking eligibility first (status, threshold
 * via meetsSweepThreshold, etc.) — this function just executes the sweep
 * and marks the deposit as sweepStatus: "pending".
 *
 * OPTIONAL: If SWEEP_CONFIG.USE_FEE_CAP is true, will estimate gas cost
 * before sweeping and skip the sweep if gas exceeds tiered caps.
 *
 * Used by:
 *  - the daily batch cron (tatumCron.ts)
 *  - the immediate-sweep path (Tatumwebhookservice.ts), when
 *    SWEEP_MODE === "immediate"
 *
 * Returns:
 *  - { txHash } if sweep was executed successfully
 *  - { skipped: true, reason, retryAt } if swept was skipped due to fee cap
 *  - null if an error occurred
 */
export async function sweepSingleDeposit(
  deposit: SweepableDeposit,
  crypto: SweepableCrypto,
): Promise<SweepResult | null> {
  const { cryptoTransactionRepository, tatumService, networkRepository } =
    getDeps();

  if (!deposit.tatumDepositAddress) {
    logger.error(`Sweep: deposit has no source address`, {
      depositId: deposit.id,
      reference: deposit.reference,
    });
    return null;
  }

  // deposit.network.networkId is the Network document's own semantic
  // string field (e.g. "BITCOIN"), not a Mongo _id — findById() does an
  // ObjectId cast and throws on every call. findByNetworkId() is the
  // correct lookup for this field, same fix already applied in
  // Tatumwebhookservice.ts for the identical mistake.
  const network = await networkRepository.findByNetworkId(
    deposit.network.networkId,
  );

  if (!network) {
    logger.error(`Sweep: network not found`, {
      networkId: deposit.network.networkId,
      depositId: deposit.id,
    });
    return null;
  }

  const masterWalletAddress = network.platformDepositAddress;

  if (!masterWalletAddress) {
    logger.error(`Sweep: master wallet address not configured`, {
      networkName: network.name,
      depositId: deposit.id,
    });
    return null;
  }

  // Gas Fee Estimation (cap-check + profit tracking)
  // Always estimated when we know the deposit's USD value, so profit can be
  // corrected for actual sweep cost — this now runs even when
  // SWEEP_CONFIG.USE_FEE_CAP is off. The cap is only used to SKIP the sweep
  // when USE_FEE_CAP is true.
  const depositUsdAmount = deposit.meta?.fiatBreakdown?.usdAmount;
  let gasFeeEstimation: {
    gasCostUsd: number;
    gasPrice: string;
    confidence: "high" | "medium" | "low";
  } | null = null;

  if (depositUsdAmount != null) {
    try {
      const gasFeeEstimationService = new GasFeeEstimationService(tatumService);
      gasFeeEstimation = await gasFeeEstimationService.estimateGasCostUsd({
        network,
        fromAddress: deposit.tatumDepositAddress,
        toAddress: masterWalletAddress,
        cryptoAmount: deposit.cryptoAmount,
      });

      if (!gasFeeEstimation) {
        logger.warn(`Gas estimation unavailable, proceeding with sweep`, {
          reference: deposit.reference,
          depositId: deposit.id,
        });
      } else if (SWEEP_CONFIG.USE_FEE_CAP) {
        const feeCap = calculateFeeCapForAmount(depositUsdAmount);
        const feePercentage = (
          (gasFeeEstimation.gasCostUsd / depositUsdAmount) *
          100
        ).toFixed(2);

        logger.info(`Gas fee estimated`, {
          reference: deposit.reference,
          depositId: deposit.id,
          gasCostUsd: gasFeeEstimation.gasCostUsd.toFixed(2),
          feeCap: feeCap.toFixed(2),
          usdAmount: depositUsdAmount,
          feePercentage: `${feePercentage}%`,
          confidence: gasFeeEstimation.confidence,
        });

        if (gasFeeEstimation.gasCostUsd > feeCap) {
          logger.info(`Sweep skipped: gas fee exceeds tiered cap`, {
            reference: deposit.reference,
            depositId: deposit.id,
            gasCostUsd: gasFeeEstimation.gasCostUsd.toFixed(2),
            feeCap: feeCap.toFixed(2),
            usdAmount: depositUsdAmount,
            feePercentage: `${feePercentage}%`,
          });

          const retryAt = new Date(Date.now() + 3600000);
          await cryptoTransactionRepository.update(deposit.id.toString(), {
            meta: {
              ...deposit.meta,
              gasEstimation: {
                gasCostUsd: gasFeeEstimation.gasCostUsd,
                gasPrice: gasFeeEstimation.gasPrice,
                confidence: gasFeeEstimation.confidence,
                feeCap: feeCap,
                feePercentage: parseFloat(feePercentage),
                skippedDueToFeeCap: true,
                skippedAt: new Date().toISOString(),
                retryAfter: retryAt.toISOString(),
              },
            },
          });

          return {
            skipped: true,
            reason: `Gas exceeds cap: $${gasFeeEstimation.gasCostUsd.toFixed(2)} > $${feeCap.toFixed(2)}`,
            retryAt,
          };
        }

        deposit.meta = {
          ...deposit.meta,
          gasEstimation: {
            gasCostUsd: gasFeeEstimation.gasCostUsd,
            gasPrice: gasFeeEstimation.gasPrice,
            confidence: gasFeeEstimation.confidence,
            feeCap: feeCap,
            feePercentage: parseFloat(feePercentage),
            estimatedAt: new Date().toISOString(),
            withinCap: true,
          },
        };
      } else {
        // Cap disabled — still record the estimate for profit tracking,
        // just don't use it to skip the sweep.
        deposit.meta = {
          ...deposit.meta,
          gasEstimation: {
            gasCostUsd: gasFeeEstimation.gasCostUsd,
            gasPrice: gasFeeEstimation.gasPrice,
            confidence: gasFeeEstimation.confidence,
            estimatedAt: new Date().toISOString(),
            capEnforced: false,
          },
        };
      }
    } catch (gasEstimationError: any) {
      logger.error(`Gas estimation error`, {
        error: gasEstimationError.message,
        reference: deposit.reference,
        depositId: deposit.id,
      });
      // Proceed with sweep anyway — profit will just stay fee-only
    }
  }
  // END: Gas Fee Estimation

  const kmsSignatureId = tatumService.getKmsSignatureIdForChain(
    network.chainType,
  );

  logger.info(`Sweeping crypto to Master Wallet`, {
    reference: deposit.reference,
    amount: deposit.cryptoAmount,
    currency: crypto.code,
    from: deposit.tatumDepositAddress,
    chainType: network.chainType,
    networkPath: network.networkPath,
  });

  const { txHash, tatumPendingId } = await tatumService.sweepToMasterWallet({
    fromAddress: deposit.tatumDepositAddress,
    to: masterWalletAddress,
    amount: deposit.cryptoAmount.toString(),
    currency: crypto.code,
    signatureId: kmsSignatureId,
    chainType: network.chainType,
    networkPath: network.networkPath,
  });

  if (tatumPendingId) {
    await registerKmsTransaction(tatumPendingId);
  }

  logger.info(`Sweep initiated`, { reference: deposit.reference, txHash });

  // Correct profit now that gas is actually being spent (was fee-only
  // since webhook success)
  const serviceFeeNGN = deposit.meta?.fiatBreakdown?.serviceFeeNGN;
  const ngnRate = deposit.meta?.fiatBreakdown?.ngnRate;
  const sweepUpdate: Record<string, any> = {
    sweepStatus: "pending",
    tatumSweepTxHash: txHash,
    sweepInitiatedAt: new Date(),
  };

  if (gasFeeEstimation && serviceFeeNGN != null && ngnRate != null) {
    const profitBreakdown = CryptoProfitCalculatorService.calculateWithGas(
      serviceFeeNGN,
      gasFeeEstimation.gasCostUsd,
      ngnRate,
    );
    sweepUpdate.profit = profitBreakdown.profit;
    sweepUpdate.meta = {
      ...deposit.meta,
      sweep: { txHash, initiatedAt: new Date().toISOString() },
      profitBreakdown: {
        ...profitBreakdown,
        status: "final",
        calculatedAt: new Date().toISOString(),
      },
    };
  } else {
    sweepUpdate.meta = {
      ...deposit.meta,
      sweep: { txHash, initiatedAt: new Date().toISOString() },
    };
  }

  await cryptoTransactionRepository.update(deposit.id.toString(), sweepUpdate);

  return { txHash };
}
