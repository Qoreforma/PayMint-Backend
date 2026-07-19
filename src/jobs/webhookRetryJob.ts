import cron, { ScheduledTask } from "node-cron";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

let webhookRetryJob: ScheduledTask | null = null;
let isWebhookRetryRunning = false;

const partnerWebhookService = ServiceContainer.getPartnerWebHookService();

export const startWebhookRetryCron = () => {
  if (webhookRetryJob) {
    logger.warn("[Webhook Retry Job] Already running");
    return webhookRetryJob;
  }

  webhookRetryJob = cron.schedule(
    "*/5 * * * *",
    async () => {
      if (isWebhookRetryRunning) {
        logger.warn(
          "[Webhook Retry Job] ⚠️ Already processing, skipping this cycle",
        );
        return;
      }

      isWebhookRetryRunning = true;

      try {
        await SentryHelper.wrapCronJob(
          "webhook-retry",
          "*/5 * * * *",
          async () => {
            logger.info(
              "[Webhook Retry Job] Starting webhook retry processing",
            );
            await partnerWebhookService.processPendingWebhooks();
            logger.info(
              "[Webhook Retry Job] Completed webhook retry processing",
            );
          },
        );
      } catch (error: any) {
        logger.error("[Webhook Retry Job] Error", error);
      } finally {
        isWebhookRetryRunning = false;
      }
    },
    {
      timezone: "Africa/Lagos",
    },
  );

  logger.info("[Webhook Retry Job] Started - runs every 5 minutes");
  return webhookRetryJob;
};
