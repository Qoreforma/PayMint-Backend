import logger from "@/logger";
import { startAlertDispatchCron } from "./alertDispatchCronJobs";
import { startCleanupExpiredVirtualAccountsCron } from "./cleanupExpiredVirtualAccounts";
import { startCryptoPriceUpdater } from "./cryptoPriceUpdater";
import { startDailyProviderReconciliationJob } from "./dailyproviderreconciliation";
import {
  startGiftCardSync,
  startGiftCardRateUpdate,
} from "./giftCardSyncCronJob";
import { startLeaderboardCron } from "./leaderboardCron";
import { startNowPaymentsCustodyMonitor } from "./nowPaymentsCustodyMonitor";
import { startPaymentReconciliationJobs } from "./paymentReconciliation";
import { startReferralBonusCrons } from "./referralBonusCron";
import { startTradeBonusCacheCron } from "./refreshTradeBonusCache";
import { startTransactionPolling } from "./transactionPolling";
import { startWebhookRetryCron } from "./webhookRetryJob";
import { startWebhookTimeoutRefundJob } from "./webhooktimeoutrefund";
import { initializeBreetSyncJobs } from "./breetSyncCronJobs";
import { startUserLifecycleCron } from "./userLifecycleCron";
import { startAlertBatchCron } from "./alertBatchCronJobs";

const environment = process.env.NODE_ENV || "development";
const isProduction = environment === "production";

export function startAllCronJobs(): any[] {
  logger.info(`Starting cron jobs in [${environment}] mode...`);

  const jobs: any[] = [
    startCryptoPriceUpdater(),
    startLeaderboardCron(),
    startTradeBonusCacheCron(),
    startTransactionPolling(),
    startGiftCardSync(),
    startGiftCardRateUpdate(),
    startCleanupExpiredVirtualAccountsCron(),
    // initializeBreetSyncJobs(),
    // startRenderKeepAliveCron(),
  ];

  if (isProduction) {
    jobs.push(
      startAlertDispatchCron(),
      startAlertBatchCron(),
      startUserLifecycleCron(),
      // startNowPaymentsCustodyMonitor(),
      // startDailyProviderReconciliationJob(),
      ...startPaymentReconciliationJobs(),
      ...startReferralBonusCrons(),
      startWebhookRetryCron(),
      // startWebhookTimeoutRefundJob(),
    );

    logger.info("Production-only cron jobs started");
  } else {
    logger.info("Skipping production-only cron jobs in development mode");
  }

  logger.info("All cron jobs initialized");
  return jobs;
}
