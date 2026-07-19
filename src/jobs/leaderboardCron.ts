import cron from "node-cron";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

const leaderboardService = ServiceContainer.getLeaderboardService();

let isLeaderboardCalculationRunning = false;

export const startLeaderboardCron = () => {
  const job = cron.schedule("*/15 * * * *", async () => {
    if (isLeaderboardCalculationRunning) {
      logger.warn(
        "⚠️ Leaderboard calculation already running, skipping this cycle",
      );
      return;
    }

    isLeaderboardCalculationRunning = true;

    try {
      await SentryHelper.wrapCronJob(
        "leaderboard-calculation",
        "*/15 * * * *",
        async () => {
          logger.info("Starting scheduled leaderboard calculation");
          await leaderboardService.calculateAllLeaderboards();
          logger.info("Completed scheduled leaderboard calculation");
        },
      );
    } catch (error: any) {
      logger.error("Error in leaderboard cron job:", error);
    } finally {
      isLeaderboardCalculationRunning = false;
    }
  });

  logger.info("Leaderboard cron job started (runs every 15 minutes)");
  return job;
};
