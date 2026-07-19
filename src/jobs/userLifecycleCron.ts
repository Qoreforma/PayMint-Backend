import cron from "node-cron";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { User } from "@/models/core/User";
import { Transaction } from "@/models/wallet/Transaction";
import { UserTradeMetrics } from "@/models/core/UserTradeMetrics";

const DAY = 24 * 60 * 60 * 1000;
const INACTIVITY_THRESHOLDS_DAYS = [30, 60, 90]; // extend here later if needed

let isRunning = false;

const isProfileComplete = (user: any) =>
  !!user.username &&
  !!user.firstname &&
  !!user.lastname &&
  !!user.email &&
  !!user.phone &&
  !!user.state &&
  !!user.country &&
  !!user.emailVerifiedAt &&
  !!user.phoneVerifiedAt;

async function sendProfileIncompleteReminders() {
  const emailService = ServiceContainer.getEmailService();
  const windowStart = new Date(Date.now() - 2 * DAY);
  const windowEnd = new Date(Date.now() - 1 * DAY);

  const candidates = await User.find({
    createdAt: { $gte: windowStart, $lte: windowEnd },
    "lifecycleEmails.profileIncompleteSentAt": { $exists: false },
  });

  for (const user of candidates) {
    if (isProfileComplete(user)) continue;
    try {
      await emailService.sendProfileIncompleteEmail(user.email, user.firstname);
      await User.updateOne(
        { _id: user._id },
        { $set: { "lifecycleEmails.profileIncompleteSentAt": new Date() } },
      );
    } catch (err) {
      logger.error("Failed to send profile-incomplete email:", { userId: user._id, err });
    }
  }
}

async function sendNoTransactionReminders(days: 3 | 7) {
  const emailService = ServiceContainer.getEmailService();
  const field = days === 3 ? "day3NoTxnSentAt" : "day7NoTxnSentAt";
  const windowStart = new Date(Date.now() - (days + 1) * DAY);
  const windowEnd = new Date(Date.now() - days * DAY);

  const candidates = await User.find({
    createdAt: { $gte: windowStart, $lte: windowEnd },
    [`lifecycleEmails.${field}`]: { $exists: false },
  });
  if (candidates.length === 0) return;

  const candidateIds = candidates.map((u) => u._id);

  // Anyone with a transaction that isn't "failed" counts as having transacted
  const userIdsWithTxn = await Transaction.distinct("userId", {
    userId: { $in: candidateIds },
    status: { $ne: "failed" },
  });
  const hasTxnSet = new Set(userIdsWithTxn.map((id) => id.toString()));

  for (const user of candidates) {
    if (hasTxnSet.has(user._id.toString())) continue;
    try {
      await emailService.sendNoTransactionReminderEmail(user.email, user.firstname, days);
      await User.updateOne(
        { _id: user._id },
        { $set: { [`lifecycleEmails.${field}`]: new Date() } },
      );
    } catch (err) {
      logger.error(`Failed to send day-${days} no-transaction email:`, { userId: user._id, err });
    }
  }
}

async function sendInactivityWinBackEmails() {
  const emailService = ServiceContainer.getEmailService();

  for (const days of INACTIVITY_THRESHOLDS_DAYS) {
    const windowStart = new Date(Date.now() - (days + 1) * DAY);
    const windowEnd = new Date(Date.now() - days * DAY);

    const metrics = await UserTradeMetrics.find({
      lastTradeDate: { $gte: windowStart, $lte: windowEnd },
    }).populate("userId");

    for (const metric of metrics) {
      const user: any = metric.userId;
      if (!user?.email) continue;
      if ((user.lifecycleEmails?.inactivitySent || []).includes(days)) continue;

      try {
        await emailService.sendInactivityWinBackEmail(user.email, user.firstname, days);
        await User.updateOne(
          { _id: user._id },
          { $push: { "lifecycleEmails.inactivitySent": days } },
        );
      } catch (err) {
        logger.error(`Failed to send ${days}-day inactivity email:`, { userId: user._id, err });
      }
    }
  }
}

export const startUserLifecycleCron = () => {
  const job = cron.schedule("0 8 * * *", async () => {
    if (isRunning) {
      logger.warn("⚠️ User lifecycle cron already running, skipping this cycle");
      return;
    }
    isRunning = true;
    try {
      await SentryHelper.wrapCronJob("user-lifecycle-emails", "0 8 * * *", async () => {
        logger.info("Starting user lifecycle email run");
        await sendProfileIncompleteReminders();
        await sendNoTransactionReminders(3);
        await sendNoTransactionReminders(7);
        await sendInactivityWinBackEmails();
        logger.info("Completed user lifecycle email run");
      });
    } catch (error) {
      logger.error("Error in user lifecycle cron job:", error);
    } finally {
      isRunning = false;
    }
  });

  logger.info("User lifecycle cron job started (runs daily at 8am)");
  return job;
};