import cron from "node-cron";
import logger from "@/logger";
import { CryptoService } from "@/services/client/crypto/CryptoService";
import ServiceContainer from "@/services/client/container";
import { TatumWebhookWorker } from "./TatumWebhookWorker";
import {
  meetsSweepThreshold,
  sweepSingleDeposit,
} from "@/services/client/crypto/sweep/SweepExecutor";

// Lock flags to prevent concurrent runs
let isSweepRunning = false;
let isStatusUpdateRunning = false;
let isHealthCheckRunning = false;
let isWebhookWorkerRunning = false;

const cryptoTransactionRepository =
  ServiceContainer.getCryptoTransactionRepository();
const cryptoRepository = ServiceContainer.getCryptoRepository();
const tatumService = ServiceContainer.getTatumService();
type TatumCronTask = ReturnType<typeof cron.schedule>;
// Daily sweep: Check deposits and sweep to Master Wallet if >= threshold
// Purpose: Consolidate user deposits to Master Wallet for efficiency
// Note: User already has their money from webhook, this is just consolidation
// Reduces gas fees by batching multiple sweeps into one transaction
// Runs: Daily at 2 AM UTC

async function runDailySweep(cryptoService: CryptoService): Promise<void> {
  if (isSweepRunning) {
    logger.warn("⚠️ Tatum daily sweep already running, skipping this cycle");
    return;
  }

  isSweepRunning = true;

  try {
    logger.info("🔄 Starting Tatum daily deposit sweep");

    const deposits = await cryptoTransactionRepository.find({
      status: "success",
      sweepStatus: { $exists: false },
      tradeType: "sell",
      tatumDepositAddress: { $exists: true },
    });

    if (!deposits || deposits.length === 0) {
      logger.info("No deposits to sweep");
      return;
    }

    logger.info(`Found ${deposits.length} deposits to sweep`);

    let sweptCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const deposit of deposits) {
      try {
        const crypto = await cryptoRepository.findById(
          deposit.cryptoId.toString(),
        );

        if (!crypto) {
          logger.warn(`Crypto not found for deposit`, {
            depositId: deposit.id,
            cryptoId: deposit.cryptoId,
          });
          failedCount++;
          continue;
        }

        const depositUsdAmount = deposit.meta?.fiatBreakdown?.usdAmount;

        if (depositUsdAmount == null) {
          logger.warn(`Skipping sweep: no USD amount recorded for deposit`, {
            reference: deposit.reference,
          });
          skippedCount++;
          continue;
        }

        if (!meetsSweepThreshold(depositUsdAmount, crypto)) {
          logger.debug(`Skipping sweep: amount below threshold`, {
            reference: deposit.reference,
            usdAmount: depositUsdAmount,
            threshold: crypto.minSweepThresholdUsd || 50,
          });
          skippedCount++;
          continue;
        }

        const result = await sweepSingleDeposit(deposit, crypto);

        if (result?.skipped) {
          logger.info(`Sweep skipped: ${result.reason}`, {
            depositId: deposit.id,
          });
          // Will retry next hour when cron runs again
          continue;
        }

        if (!result) {
          failedCount++;
          continue;
        }

        sweptCount++;
      } catch (error: any) {
        logger.error(`Sweep failed for deposit`, {
          error: error.message,
          depositId: deposit.id,
          reference: deposit.reference,
        });
        failedCount++;
      }
    }

    logger.info(` Daily sweep completed`, {
      sweptCount,
      failedCount,
      skippedCount,
      totalProcessed: deposits.length,
    });
  } catch (error: any) {
    logger.error(`Daily sweep job error`, {
      error: error.message,
      stack: error.stack,
    });
  } finally {
    isSweepRunning = false;
  }
}

// Hourly status update: Poll sweep transactions
// Purpose: Update sweep status on blockchain
// Note: User is already paid, this is just for accounting
// When sweep is confirmed:
// - Update sweepStatus to "confirmed"
// - Log for reconciliation
// Runs: Every hour at :00
async function runStatusUpdate(cryptoService: CryptoService): Promise<void> {
  if (isStatusUpdateRunning) {
    logger.warn("⚠️ Tatum status update already running, skipping this cycle");
    return;
  }

  isStatusUpdateRunning = true;

  try {
    logger.info("🔄 Starting Tatum sweep status update");

    // Find all pending sweeps
    const pendingSweeps = await cryptoTransactionRepository.find({
      sweepStatus: "pending",
      tatumSweepTxHash: { $exists: true },
    });

    if (!pendingSweeps || pendingSweeps.length === 0) {
      logger.debug("No pending sweeps to check");
      return;
    }

    logger.info(`Found ${pendingSweeps.length} pending sweeps to check`);

    let confirmedCount = 0;
    let pendingCount = 0;
    let failedCount = 0;

    for (const sweep of pendingSweeps) {
      try {
        // Get crypto info
        const crypto = await cryptoRepository.findById(
          sweep.cryptoId.toString(),
        );

        if (!crypto) {
          logger.warn(`Crypto not found for sweep`, {
            sweepId: sweep.id,
            cryptoId: sweep.cryptoId,
          });
          continue;
        }

        logger.debug(`Polling sweep status`, {
          reference: sweep.reference,
          txHash: sweep.tatumSweepTxHash,
        });

        const network = await ServiceContainer.getNetworkRepository().findById(
          sweep.network.networkId,
        );
        // Poll Tatum for status
        const status = await tatumService.getTransactionStatus(
          sweep.tatumSweepTxHash!,
          network?.chainType || "OTHER",
          network?.networkPath || "",
        );

        logger.debug(`Sweep status retrieved`, {
          reference: sweep.reference,
          status: status.status,
          confirmations: status.confirmations,
        });

        // Update transaction
        await cryptoTransactionRepository.update(sweep.id.toString(), {
          sweepStatus: status.status,
          meta: {
            ...sweep.meta,
            sweepConfirmations: status.confirmations,
            sweepBlockNumber: status.blockNumber,
            sweepLastChecked: new Date().toISOString(),
          },
        });

        if (status.status === "confirmed") {
          confirmedCount++;
          logger.info(`Sweep confirmed on blockchain`, {
            reference: sweep.reference,
            txHash: sweep.tatumSweepTxHash,
            confirmations: status.confirmations,
          });
        } else if (status.status === "failed") {
          failedCount++;
          logger.warn(`Sweep failed on blockchain`, {
            reference: sweep.reference,
            txHash: sweep.tatumSweepTxHash,
          });
        } else {
          pendingCount++;
        }
      } catch (error: any) {
        logger.error(`Status check failed for sweep`, {
          error: error.message,
          sweepId: sweep.id,
          reference: sweep.reference,
        });
      }
    }

    logger.info(` Status update completed`, {
      confirmedCount,
      pendingCount,
      failedCount,
      totalChecked: pendingSweeps.length,
    });
  } catch (error: any) {
    logger.error(`Status update job error`, {
      error: error.message,
      stack: error.stack,
    });
  } finally {
    isStatusUpdateRunning = false;
  }
}

// Daily health check: Monitor Master Wallet balance
// Purpose: Alert if Master Wallet is running low
// Note: Non-blocking, just for monitoring
// Logs balances for each currency
// Can add alerting logic here if needed
// Runs: Daily at 1 AM UTC

// In runHealthCheck, replace the balance checking loop:
async function runHealthCheck(cryptoService: CryptoService): Promise<void> {
  if (isHealthCheckRunning) {
    logger.warn("⚠️ Tatum health check already running, skipping this cycle");
    return;
  }

  isHealthCheckRunning = true;

  try {
    logger.info("🔄 Starting Tatum Master Wallet health check");

    const currencies = ["BITCOIN", "ETHEREUM", "TRON"];
    const minReserve = parseFloat(
      process.env.TATUM_MIN_MASTER_WALLET_RESERVE || "1000",
    );

    const balances: Record<string, number> = {};

    for (const currency of currencies) {
      try {
        logger.debug(`Checking balance for ${currency}`);

        // const networkPath = getNetworkPathForCurrency(currency);

        const network = await ServiceContainer.getNetworkRepository().findOne({
          networkId: currency,
          isActive: true,
        });

        if (!network || !network.platformDepositAddress) {
          logger.warn(
            `Network not found or no master wallet configured for ${currency}`,
            {
              currency,
            },
          );
          continue;
        }

        const networkPath = network.networkPath;
        const masterWalletAddress = network.platformDepositAddress;

        logger.debug(`Checking balance for ${currency}`, {
          currency,
          networkPath,
          masterWallet: masterWalletAddress,
        });

        const balanceStr = await tatumService.getMasterWalletBalance(
          currency,
          networkPath,
          masterWalletAddress,
        );

        const balance = parseFloat(balanceStr || "0");
        balances[currency] = balance;

        logger.info(`Master Wallet balance - ${currency}`, {
          currency,
          balance,
        });

        if (balance < minReserve) {
          logger.warn(`⚠️ Master Wallet balance LOW for ${currency}`, {
            currency,
            balance,
            minReserve,
          });
          // Could add admin alert here if needed
        }
      } catch (err: any) {
        logger.warn(`Failed to check ${currency} balance`, {
          error: err.message,
          currency,
        });
      }
    }

    logger.info(` Health check completed`, {
      balances,
      minReserve,
    });
  } catch (error: any) {
    logger.error(`Health check job error`, {
      error: error.message,
      stack: error.stack,
    });
  } finally {
    isHealthCheckRunning = false;
  }
}

async function runWebhookWorker(worker: TatumWebhookWorker): Promise<void> {
  if (isWebhookWorkerRunning) {
    logger.warn("Tatum webhook worker already running, skipping");
    return;
  }

  isWebhookWorkerRunning = true;

  try {
    await worker.processBatch(10);
  } catch (err: any) {
    logger.error("Tatum webhook worker error", { error: err.message });
  } finally {
    isWebhookWorkerRunning = false;
  }
}

function getNetworkPathForCurrency(currency: string): string {
  const pathMap: Record<string, string> = {
    BTC: "bitcoin",
    ETH: "ethereum",
    USDT: "ethereum", // Default to Ethereum for stablecoins
    USDC: "ethereum",
    MATIC: "polygon",
    BNB: "bsc",
    TRON: "tron",
    SOL: "solana",
    XRP: "xrp",
    ADA: "cardano",
    LTC: "litecoin",
    BCH: "bitcoin-cash",
    DOGE: "dogecoin",
    AVAX: "avalanche",
    ARB: "arbitrum",
    OP: "optimism",
    BASE: "base",
    CELO: "celo",
    ONE: "harmony",
    VET: "vechain",
  };

  return pathMap[currency.toUpperCase()] || "ethereum";
}

export function initializetatumCronJobs(
  cryptoService: CryptoService,
  worker: TatumWebhookWorker,
): TatumCronTask[] {
  logger.info("Initializing Tatum cron jobs");

  const tasks: TatumCronTask[] = [];

  // Daily sweep at 2 AM UTC
  tasks.push(
    cron.schedule("0 2 * * *", async () => {
      try {
        await runDailySweep(cryptoService);
      } catch (error: any) {
        logger.error("Daily sweep cron job error", { error: error.message });
      }
    }),
  );

  // Hourly status check at :00
  tasks.push(
    cron.schedule("0 * * * *", async () => {
      try {
        await runStatusUpdate(cryptoService);
      } catch (error: any) {
        logger.error("Status update cron job error", { error: error.message });
      }
    }),
  );

  // Daily health check at 1 AM UTC
  tasks.push(
    cron.schedule("0 1 * * *", async () => {
      try {
        await runHealthCheck(cryptoService);
      } catch (error: any) {
        logger.error("Health check cron job error", { error: error.message });
      }
    }),
  );

  // Every 30 seconds — webhook processing
  tasks.push(
    cron.schedule("*/30 * * * * *", async () => {
      try {
        await runWebhookWorker(worker);
      } catch (err: any) {
        logger.error("Webhook worker cron error", { error: err.message });
      }
    }),
  );

  logger.info("All Tatum cron jobs initialized", {
    schedule: "Sweep: 2 AM UTC | Status: Every hour | Health: 1 AM UTC",
  });

  return tasks;
}
