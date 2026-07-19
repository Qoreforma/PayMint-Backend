import axios from "axios";
import { WebhookLogRepository } from "@/repositories/partner/WebhookLogRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { Types } from "mongoose";
import logger from "@/logger";
import * as crypto from "crypto";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { isSafeWebhookUrl } from "@/utils/validators";

export class PartnerWebhookService {
  constructor(
    private webhookLogRepository: WebhookLogRepository,
    private userRepository: UserRepository,
  ) {}

  /**
   * Create a webhook log entry and attempt immediate delivery.
   *
   * Supply EITHER:
   *   - transactionId + transactionModel  (new bill-payment records)
   *   - giftCardTransactionId             (legacy giftcard records — kept for
   *                                        backward compat with existing code in
   *                                        GiftCardTransactionViewService)
   *
   * At least one of the two must be provided.
   */
  async createWebhookLog(data: {
    userId: string | Types.ObjectId;
    event: string;
    webhookUrl: string;
    payload: any;
    // New generic fields (bill payments + future products)
    transactionId?: string | Types.ObjectId;
    transactionModel?: "GiftCardTransaction" | "Transaction";
    // Legacy giftcard field — existing callers continue to work unchanged
    giftCardTransactionId?: string | Types.ObjectId;
  }): Promise<any> {
    try {
      const timestamp = Date.now().toString();
      const payloadJson = JSON.stringify(data.payload);

      // Get partner's webhook secret
      const user = await this.userRepository.findById(data.userId.toString());
      if (!user?.partner?.webhookSecret) {
        logger.warn(`Partner ${data.userId} has no webhook secret`);
        return null;
      }

      // Sign payload
      const message = `${timestamp}.${payloadJson}`;
      const signature = crypto
        .createHmac("sha256", user.partner.webhookSecret)
        .update(message)
        .digest("hex");

      // Resolve which transaction reference to store
      const transactionId = data.transactionId
        ? new Types.ObjectId(data.transactionId)
        : data.giftCardTransactionId
          ? new Types.ObjectId(data.giftCardTransactionId)
          : undefined;

      const transactionModel:
        | "GiftCardTransaction"
        | "Transaction"
        | undefined =
        data.transactionModel ??
        (data.giftCardTransactionId ? "GiftCardTransaction" : undefined);

      // Create log
      const log = await this.webhookLogRepository.create({
        userId: new Types.ObjectId(data.userId),
        transactionId,
        transactionModel,
        // Preserve legacy field for existing giftcard records
        ...(data.giftCardTransactionId && {
          giftCardTransactionId: new Types.ObjectId(data.giftCardTransactionId),
        }),
        event: data.event,
        webhookUrl: data.webhookUrl,
        payload: data.payload,
        signature,
        timestamp,
        status: "pending",
        nextRetryAt: new Date(), // Try immediately
      });

      logger.info(`Webhook log created: ${log._id} | Event: ${data.event}`);
      return log;
    } catch (error: any) {
      logger.error("Failed to create webhook log", error);
      return null;
    }
  }

  // Send webhook
  async sendWebhook(logId: string | Types.ObjectId): Promise<boolean> {
    try {
      const log = await this.webhookLogRepository.findById(logId.toString());

      if (!log) {
        logger.warn(`Webhook log not found: ${logId}`);
        return false;
      }

      if (!(await isSafeWebhookUrl(log.webhookUrl))) {
        logger.warn(
          `Blocked webhook send to disallowed address: ${log.webhookUrl}`,
        );
        await this.webhookLogRepository.markAsFailed(
          logId,
          0,
          "Webhook URL resolves to a private/disallowed address",
        );
        return false;
      }

      logger.info(`Sending webhook to ${log.webhookUrl}`);

      const response = await axios.post(log.webhookUrl, log.payload, {
        headers: {
          "X-Webhook-Signature": log.signature,
          "X-Webhook-Timestamp": log.timestamp,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      });

      // Success
      if (response.status >= 200 && response.status < 300) {
        await this.webhookLogRepository.markAsSuccess(logId, response.status);
        logger.info(
          `Webhook sent successfully: ${logId} | Status: ${response.status}`,
        );
        return true;
      }

      // Non-2xx response, retry
      await this.scheduleRetry(logId);
      return false;
    } catch (error: any) {
      logger.error(`Webhook delivery failed: ${logId}`, error.message);
      await this.scheduleRetry(logId, error.response?.status);
      return false;
    }
  }

  // Schedule retry
  private async scheduleRetry(
    logId: string | Types.ObjectId,
    responseStatus?: number,
  ): Promise<void> {
    try {
      const log = await this.webhookLogRepository.findById(logId.toString());

      if (!log) return;

      // Check if max retries reached
      if (log.retryCount >= 3) {
        await this.webhookLogRepository.markAsFailed(
          logId,
          responseStatus || 0,
          "Max retries exceeded",
        );
        SentryHelper.captureBusinessError(
          "PARTNER_WEBHOOK_MAX_RETRIES",
          `Webhook permanently failed after 3 retries: ${logId}`,
          log.userId?.toString(),
          {
            logId: logId.toString(),
            webhookUrl: log.webhookUrl,
            event: log.event,
            responseStatus,
          },
        );
        logger.warn(`Webhook max retries reached: ${logId}`);
        return;
      }

      // Calculate next retry delay
      const delays = [
        5 * 60 * 1000, // 5 min
        15 * 60 * 1000, // 15 min
        1 * 60 * 60 * 1000, // 1 hour
      ];

      const nextRetryAt = new Date(Date.now() + delays[log.retryCount]);

      await this.webhookLogRepository.markForRetry(logId, nextRetryAt);
      logger.info(
        `Webhook retry scheduled: ${logId} | Retry ${log.retryCount + 1}/3 at ${nextRetryAt.toISOString()}`,
      );
    } catch (error: any) {
      logger.error("Failed to schedule webhook retry", error);
    }
  }

  // Get pending retries and send them
  async processPendingWebhooks(): Promise<void> {
    try {
      const pendingWebhooks =
        await this.webhookLogRepository.findPendingRetries();

      logger.info(`Processing ${pendingWebhooks.length} pending webhooks`);

      for (const log of pendingWebhooks) {
        await this.sendWebhook(log._id);
        // Small delay between retries
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error: any) {
      logger.error("Failed to process pending webhooks", error);
    }
  }
}
