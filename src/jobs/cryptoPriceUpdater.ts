import cron from "node-cron";
import { CryptoPriceService } from "@/services/sync/CryptoPriceService";
import logger from "@/logger";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

const cryptoPriceService = new CryptoPriceService();

let isCryptoPriceUpdateRunning = false;

export function startCryptoPriceUpdater() {
  const job = cron.schedule("*/3 * * * *", async () => {
    if (isCryptoPriceUpdateRunning) {
      logger.warn(
        "⚠️ Crypto price update already running, skipping this cycle",
      );
      return;
    }

    isCryptoPriceUpdateRunning = true;

    try {
      // await SentryHelper.wrapCronJob(
      //   "crypto-price-updater",
      //   "*/3 * * * *",
      //   async () => {
          logger.info("Running scheduled crypto price update...");
          await cryptoPriceService.updateAllCryptoPrices();
      //   },
      // );
    } catch (error) {
      logger.error("Cron job error - crypto price update:", error);
    } finally {
      isCryptoPriceUpdateRunning = false;
    }
  });

  // Run immediately on startup
  cryptoPriceService.updateAllCryptoPrices().catch((error) => {
    logger.error("Initial crypto price update failed:", error);
  });

  logger.info("Crypto price updater cron job started (runs every 3 minutes)");

  return job;
}
