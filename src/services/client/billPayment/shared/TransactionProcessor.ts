import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { Types } from "mongoose";
import logger from "@/logger";
import { LeaderboardService } from "../../LeaderboardService";
import { NotificationService } from "../../notifications/NotificationService";
import { WalletService } from "../../wallet/WalletService";
import { HelperService } from "@/services/client/utility/HelperService";
import SocketService from "@/services/core/SocketService";

import { getProviderConfig } from "@/config";
import AdminServiceContainer from "@/services/admin/container";

interface TransactionContext {
  userId: string;
  walletId: string;
  transactionId: string;
  reference: string;
  amount: number;
  totalAmount: number;
  chargeInfo: {
    baseAmount: number;
    chargeAmount: number;
    totalAmount: number;
  };
  transactionType: string;
  serviceName?: string;
  phone?: string;
  network?: string;
  serviceCode?: string;
  logo?: string;
  providerReference?: string;
  meta?: any;
}

interface ProcessTransactionResult {
  status: "success" | "pending" | "failed";
  transaction: any;
}

export class TransactionProcessor {
  constructor(
    private transactionRepository: TransactionRepository,
    private walletService: WalletService,
    private notificationService: NotificationService,
    private helperService: HelperService,
  ) {}

  // Update transaction status based on provider response

  async updateTransactionStatus(
    transactionId: string,
    providerResponse: any,
  ): Promise<ProcessTransactionResult> {
    let status: "success" | "pending" | "failed";

    if (providerResponse.success) {
      status = "success";
    } else if (providerResponse.pending) {
      status = "pending";
    } else {
      status = "failed";
    }

    // meta is Mixed — a plain `meta: {...}` on update() replaces the whole object,
    // so fetch what's already there and spread it before adding providerResponse.
    const existing = await this.transactionRepository.findById(transactionId);

    const transaction = await this.transactionRepository.update(transactionId, {
      status,
      provider: providerResponse.providerCode,
      providerReference: providerResponse.providerReference,
      meta: {
        ...existing?.meta,
        providerResponse,
        providerResponseAt: new Date(),
      },
    });

    return { status, transaction };
  }

  // Handle successful transaction - notifications + leaderboard

  async handleSuccess(context: TransactionContext): Promise<void> {
    const auditLoggingService = AdminServiceContainer.getAuditLoggingService();

    // Log to audit trail
    await auditLoggingService
      .logTransactionEvent({
        userId: new Types.ObjectId(context.userId),
        transactionId: context.transactionId,
        transactionReference: context.reference,
        action: "status_changed",
        previousStatus: "pending",
        newStatus: "success",
        amount: context.amount,
        reason: "provider_confirmed",
        provider: context.serviceName || "bill_payment",
        initiatedBy: "system",
      })
      .catch((err: any) => logger.error("Failed to log success event", err));

    // Fire-and-forget success notification
    this.notificationService
      .createNotification({
        type: "transaction_success",
        notifiableType: "User",
        notifiableId: new Types.ObjectId(context.userId),
        data: {
          transactionType: context.transactionType,
          amount: context.chargeInfo.totalAmount,
          reference: context.reference,
        },
        sendEmail: false,
        sendSMS: false,
        sendPush: true,
      })
      .catch((err) => logger.error("Success notification failed", err));

    // Fire-and-forget leaderboard update
    this.helperService.updateLeaderboardAsync(
      context.userId,
      context.walletId,
      context.transactionType,
      context.amount,
    );

    // Emit websocket update
    this.transactionRepository.findById(context.transactionId)
      .then(transaction => {
        SocketService.emitTransactionUpdate(context.reference, { status: "success", transaction });
      })
      .catch(err => logger.error("Socket emit error", err));
  }

  async handleFailure(context: TransactionContext): Promise<void> {
    const auditLoggingService = AdminServiceContainer.getAuditLoggingService();

    // Log to audit trail
    await auditLoggingService
      .logTransactionEvent({
        userId: new Types.ObjectId(context.userId),
        transactionId: context.transactionId,
        transactionReference: context.reference,
        action: "refunded",
        previousStatus: "pending",
        newStatus: "failed",
        amount: context.totalAmount,
        reason: "provider_failed",
        provider: context.serviceName || "bill_payment",
        initiatedBy: "system",
      })
      .catch((err: any) => logger.error("Failed to log failure event", err));

    await Promise.allSettled([
      this.walletService.creditWallet(
        context.userId,
        context.totalAmount,
        `${context.transactionType} refund`,
        {
          type: "refund",
          provider: context.serviceName || "system",
          providerReference: context.providerReference,
          idempotencyKey: `${context.reference}_refund`,
          initiatedByType: "system",
          linkedTransactionId: new Types.ObjectId(context.transactionId),
          remark: `Refund: ₦${context.totalAmount} for failed ${context.serviceName} (Ref: ${context.reference})`,
          meta: {
            originalReference: context.reference,
            reason: "transaction_failed",
            logo: context.logo,
            serviceName: context.serviceName,
            serviceCode: context.serviceCode,
            phone: context.phone,
            suppressNotification: true,
            ...context.meta,
          },
        },
      ),
      this.notificationService.createNotification({
        type: "transaction_failed",
        notifiableType: "User",
        notifiableId: new Types.ObjectId(context.userId),
        data: {
          transactionType: context.transactionType,
          amount: context.totalAmount,
          reference: context.reference,
        },
        sendEmail: false,
        sendSMS: false,
        sendPush: true,
      }),
    ]).catch((err) => logger.error("Failed transaction cleanup error", err));

    // Emit websocket update
    this.transactionRepository.findById(context.transactionId)
      .then(transaction => {
        SocketService.emitTransactionUpdate(context.reference, { status: "failed", transaction });
      })
      .catch(err => logger.error("Socket emit error", err));
  }

  async handleError(context: TransactionContext): Promise<void> {
    const auditLoggingService = AdminServiceContainer.getAuditLoggingService();

    // Log to audit trail
    await auditLoggingService
      .logTransactionEvent({
        userId: new Types.ObjectId(context.userId),
        transactionId: context.transactionId,
        transactionReference: context.reference,
        action: "refunded",
        newStatus: "failed",
        amount: context.totalAmount,
        reason: "error",
        provider: context.serviceName || "bill_payment",
        initiatedBy: "system",
      })
      .catch((err: any) => logger.error("Failed to log error event", err));

    await Promise.allSettled([
      this.transactionRepository.updateStatus(context.transactionId, "failed"),
      this.walletService.creditWallet(
        context.userId,
        context.totalAmount,
        `${context.transactionType} refund`,
        {
          type: "refund",
          provider: context.serviceName || "system",
          idempotencyKey: `${context.reference}_error_refund`,
          initiatedByType: "system",
          linkedTransactionId: new Types.ObjectId(context.transactionId),
          remark: `Refund: ₦${context.totalAmount} for failed ${context.serviceName} (Ref: ${context.reference})`,
          meta: {
            originalReference: context.reference,
            reason: "error",
            logo: context.logo,
            serviceName: context.serviceName,
            serviceCode: context.serviceCode,
            phone: context.phone,
            ...context.meta,
          },
        },
      ),
    ]);

    // Emit websocket update
    this.transactionRepository.findById(context.transactionId)
      .then(transaction => {
        SocketService.emitTransactionUpdate(context.reference, { status: "failed", transaction });
      })
      .catch(err => logger.error("Socket emit error", err));
  }

  async initializeTransactionHandling(
    transactionId: string,
    providerReference: string,
    providerCode: string,
    status: string,
    userId?: string,
  ): Promise<void> {
    // Only initialize if status is pending
    if (status !== "pending") {
      return;
    }

    const config = getProviderConfig(providerCode);
    if (!config) {
      logger.warn(
        `Unknown provider in initializeTransactionHandling: ${providerCode}`,
      );
      return;
    }

    logger.info(`Initializing handling for ${providerCode}:`, {
      method: config.preferredMethod,
      transactionId,
      providerReference,
    });

    try {
      switch (config.preferredMethod) {
        case "POLLING":
          // Provider uses polling (ClubKonnect, VTU.ng, etc.)
          await this.initializePolling(
            transactionId,
            providerReference,
            providerCode,
            config.pollingTimeoutMinutes,
          );
          break;

        case "WEBHOOK":
          // Provider uses webhooks (VTPass, SimHostng when preferred)
          logger.info(`${providerCode} uses webhooks, skipping polling`, {
            transactionId,
          });
          // Webhook handling would go here in future
          break;

        case "IMMEDIATE":
          // Provider returns immediate response, shouldn't be pending
          logger.warn(
            `${providerCode} returned pending but is IMMEDIATE response provider`,
            { transactionId, status },
          );
          break;

        default:
          logger.error(`Unknown handling method: ${config.preferredMethod}`);
      }
    } catch (error: any) {
      logger.error(
        `Failed to initialize handling for ${transactionId}`,
        error.message,
      );
    }
  }

  private async initializePolling(
    transactionId: string,
    providerReference: string,
    providerCode: string,
    timeoutMinutes: number,
  ): Promise<void> {
    const config = getProviderConfig(providerCode);
    if (!config) {
      logger.error(
        `Cannot initialize polling - unknown provider: ${providerCode}`,
      );
      return;
    }

    try {
      await this.transactionRepository.update(transactionId, {
        polling: {
          nextPollAt: new Date(
            Date.now() + (config.pollingIntervalMs || 10000),
          ),
          pollCount: 0,
          providerOrderId: providerReference,
          pollingProvider: providerCode,
          pollingTimeoutMinutes: timeoutMinutes,
          startedAt: new Date(),
        },
      });

      logger.info(`Polling initialized for ${providerCode}`, {
        transactionId,
        providerReference,
        interval: config.pollingIntervalMs,
        timeout: timeoutMinutes,
      });
    } catch (error: any) {
      logger.error(
        `Error initializing polling for ${transactionId}`,
        error.message,
      );
      throw error;
    }
  }

  supportsPoll(providerCode: string): boolean {
    const config = getProviderConfig(providerCode);
    return config?.supportedMethods.includes("POLLING") ?? false;
  }

  supportsWebhook(providerCode: string): boolean {
    const config = getProviderConfig(providerCode);
    return config?.supportedMethods.includes("WEBHOOK") ?? false;
  }

  getPreferredMethod(providerCode: string): string {
    const config = getProviderConfig(providerCode);
    return config?.preferredMethod || "UNKNOWN";
  }
}
