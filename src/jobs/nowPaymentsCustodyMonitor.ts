import cron from "node-cron";
import axios from "axios";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

const BASE_URL =
  process.env.NOWPAYMENTS_SANDBOX === "true"
    ? "https://api-sandbox.nowpayments.io/v1"
    : "https://api.nowpayments.io/v1";

const ALERT_THRESHOLD = parseFloat(
  process.env.NOWPAYMENTS_CUSTODY_ALERT_THRESHOLD || "100",
);

let isCustodyCheckRunning = false;

async function checkCustodyBalance(): Promise<void> {
  if (isCustodyCheckRunning) {
    logger.warn(
      "⚠️ Custody balance check already running, skipping this cycle",
    );
    return;
  }

  isCustodyCheckRunning = true;

  try {
    const response = await axios.get(`${BASE_URL}/merchant/coins`, {
      headers: {
        "x-api-key": process.env.NOWPAYMENTS_API_KEY!,
        "Content-Type": "application/json",
      },
      timeout: 15_000,
    });

    const balances: Array<{ currency: string; amount: number }> =
      response.data?.currencies || [];

    const lowBalances = balances.filter((b) => b.amount < ALERT_THRESHOLD);

    if (lowBalances.length > 0) {
      logger.warn("NowPayments custody balance LOW", {
        lowBalances,
        threshold: ALERT_THRESHOLD,
      });

      const notificationService = ServiceContainer.getNotificationService();
      await notificationService
        .createNotification({
          type: "admin_custody_balance_low",
          notifiableType: "Admin",
          notifiableId: null as any,
          data: {
            lowBalances,
            threshold: ALERT_THRESHOLD,
            message: `NowPayments custody balance is critically low. BUY flow may fail.`,
            checkedAt: new Date().toISOString(),
          },
          sendEmail: true,
          sendSMS: false,
          sendPush: false,
        })
        .catch((err) =>
          logger.error(
            "Custody monitor: failed to send alert notification",
            err,
          ),
        );
    } else {
      logger.info("NowPayments custody balance OK", {
        balances: balances.map((b) => `${b.currency}: ${b.amount}`),
        threshold: ALERT_THRESHOLD,
      });
    }
  } catch (err: any) {
    logger.error("NowPayments custody balance check failed", {
      error: err.message,
    });
  } finally {
    isCustodyCheckRunning = false;
  }
}

export function startNowPaymentsCustodyMonitor() {
  const job = cron.schedule("*/30 * * * *", async () => {
    logger.info("Running NowPayments custody balance check...");
    try {
      await SentryHelper.wrapCronJob(
        "nowpayments-custody-monitor",
        "*/30 * * * *",
        async () => {
          await checkCustodyBalance();
        },
      );
    } catch (error: any) {
      logger.error("Custody monitor cron job error", error);
    }
  });

  // Run immediately on startup (lock is handled inside checkCustodyBalance)
  checkCustodyBalance().catch((err) =>
    logger.error("Initial custody balance check failed", err),
  );

  logger.info("NowPayments custody monitor started (runs every 30 minutes)");

  return job;
}
