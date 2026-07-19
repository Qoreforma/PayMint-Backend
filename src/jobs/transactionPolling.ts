import cron from "node-cron";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

const pollingService = ServiceContainer.getTransactionPollingService();
const partnerWebhookService = ServiceContainer.getPartnerWebHookService();
const userRepository = ServiceContainer.getUserRepository();

let isTransactionPollingRunning = false;

export function startTransactionPolling() {
  logger.info("Starting transaction polling cron job...");

  const job = cron.schedule("*/30 * * * * *", async () => {
    if (isTransactionPollingRunning) {
      logger.warn(
        "⚠️ Transaction polling already running, skipping this cycle",
      );
      return;
    }

    isTransactionPollingRunning = true;

    try {
      await SentryHelper.wrapCronJob(
        "transaction-polling",
        "*/30 * * * * *",
        async () => {
          await pollingService.pollPendingTransactions();
        },
      );
    } catch (error: any) {
      logger.error("Transaction polling cron job error", error);
    } finally {
      isTransactionPollingRunning = false;
    }
  });

  logger.info("Transaction polling cron job started (runs every 30 seconds)");
  return job;
}

async function handleCodesReady(giftCardTransaction: any): Promise<void> {
  try {
    if (giftCardTransaction.meta?.partnerPurchase) {
      const partnerId = giftCardTransaction.userId.toString();

      const user = await userRepository.findById(partnerId);
      if (!user?.partner?.webhookUrl) {
        logger.info(
          `Partner ${partnerId} has no webhook URL, skipping notification`,
        );
        return;
      }

      const webhookLog = await partnerWebhookService.createWebhookLog({
        userId: partnerId,
        giftCardTransactionId: giftCardTransaction._id,
        event: "giftcard.codes.ready",
        webhookUrl: user.partner.webhookUrl,
        payload: {
          event: "giftcard.codes.ready",
          transactionReference: giftCardTransaction.reference,
          partnerReference: giftCardTransaction.meta.partnerReference,
          status: "success",
          productId: giftCardTransaction.meta.productId,
          quantity: giftCardTransaction.quantity,
          amount: giftCardTransaction.amount,
          codes: giftCardTransaction.meta.codes || [],
          timestamp: Date.now(),
        },
      });

      if (webhookLog) {
        await partnerWebhookService.sendWebhook(webhookLog._id);
      }
    }
  } catch (error: any) {
    logger.error("Failed to handle codes ready for partner", error);
  }
}
