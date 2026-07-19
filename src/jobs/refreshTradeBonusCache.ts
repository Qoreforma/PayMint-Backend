import cron from "node-cron";
import logger from "@/logger";
import AdminServiceContainer from "@/services/admin/container";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

const tradeBonusService = AdminServiceContainer.getTradeBonusService();

let isTradeBonusCacheRefreshRunning = false;

export const startTradeBonusCacheCron = () => {
  const job = cron.schedule("0 */6 * * *", async () => {
    if (isTradeBonusCacheRefreshRunning) {
      logger.warn(
        "⚠️ Trade bonus cache refresh already running, skipping this cycle",
      );
      return;
    }

    isTradeBonusCacheRefreshRunning = true;

    try {
      await SentryHelper.wrapCronJob(
        "trade-bonus-cache-refresh",
        "0 */6 * * *",
        async () => {
          logger.info("Starting scheduled trade bonus cache refresh");
          await tradeBonusService.getBonuses();
          logger.info("Completed scheduled trade bonus cache refresh");
        },
      );
    } catch (error: any) {
      logger.error("Error in trade bonus cache refresh cron:", error);
    } finally {
      isTradeBonusCacheRefreshRunning = false;
    }
  });

  logger.info("Trade bonus cache refresh cron started (every 6 hours)");
  return job;
};
