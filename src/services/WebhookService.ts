import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { NotificationRepository } from "@/repositories/client/NotificationRepository";
import { WalletService } from "./client/wallet/WalletService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { Types } from "mongoose";
import ServiceContainer from "./client/container";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { NotificationService } from "./client/notifications/NotificationService";
import SocketService from "@/services/core/SocketService";

export interface WebhookProcessResult {
  reference: string;
  providerReference: string;
  status: "success" | "pending" | "failed" | "reversed";
  metadata?: any;
  token?: string;
  providerTransactionId?: string;
}

// UNIFIED WEBHOOK SERVICE
// Handles common webhook logic for ALL providers:
// - Transaction lookup
// - Profit calculation and persistence
// - Status updates
// - Wallet refunds
// - User notifications
// - Idempotency checks
export class WebhookService {
  private transactionRepository: TransactionRepository;
  private walletService: WalletService;
  private notificationRepository: NotificationRepository;

  constructor() {
    this.transactionRepository = new TransactionRepository();
    this.walletService = ServiceContainer.getWalletService();
    this.notificationRepository = new NotificationRepository();
  }

  // PROFIT CALCULATION HELPER (mirrors TransactionProcessor.calculateProfit)
  // Called here for webhook-confirmed success where the provider response
  // arrives after the initial purchase call (VTPass delayed confirmations).

  private calculateProfit(params: {
    chargeInfo: any;
    providerName: string; // e.g. "VTPass", "ClubKonnect"
    commission?: number; // from metadata.commission (VTPass)
    convenienceFee?: number; // from metadata.convenienceFee (VTPass)
  }): number {
    const {
      chargeInfo,
      providerName,
      commission = 0,
      convenienceFee = 0,
    } = params;

    if (!chargeInfo) {
      logger.warn("WebhookService.calculateProfit: no chargeInfo, profit = 0");
      return 0;
    }

    // 1. Service charge — always present
    const serviceCharge: number = chargeInfo.serviceCharge ?? 0;

    // 2. Product margin — only when providerAmount was stored at debit time
    const productMargin: number =
      chargeInfo.providerAmount != null
        ? Math.max(0, (chargeInfo.baseAmount ?? 0) - chargeInfo.providerAmount)
        : 0;

    // 3. Provider net — VTPass only for webhooks
    //    (ClubKonnect uses polling, not webhooks)
    let providerNet = 0;
    const provider = (providerName ?? "").toLowerCase();

    if (provider === "vtpass") {
      providerNet = (commission ?? 0) - (convenienceFee ?? 0);
    }

    const profit = serviceCharge + productMargin + providerNet;

    logger.info("WebhookService.calculateProfit result", {
      providerName,
      serviceCharge,
      productMargin,
      providerNet,
      commission,
      convenienceFee,
      profit,
    });

    return Math.max(0, profit);
  }

  // MAIN WEBHOOK PROCESSING METHOD
  // Called by all provider processors after they parse the payload.

  async processWebhook(
    providerName: string,
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    const { reference, providerReference, status, metadata, token } =
      webhookData;

    try {
      logger.info(`${providerName} webhook processing started`, {
        reference,
        providerReference,
        status,
      });

      // 1. Find the transaction
      const transaction = await this.findTransaction(reference);

      // 2. Check idempotency (prevent duplicate processing)
      if (this.isAlreadyProcessed(transaction, status)) {
        logger.info(`${providerName} webhook already processed, skipping`, {
          reference,
          currentStatus: transaction.status,
          webhookStatus: status,
        });
        return;
      }

      // 3. Process based on status
      switch (status) {
        case "success":
          await this.handleSuccessfulTransaction(
            transaction,
            providerReference,
            metadata,
            token,
            providerName,
          );
          break;

        case "reversed":
          await this.handleReversedTransaction(
            transaction,
            providerReference,
            metadata,
            providerName,
          );
          break;

        case "failed":
          await this.handleFailedTransaction(
            transaction,
            providerReference,
            metadata,
            providerName,
          );
          break;

        case "pending":
          await this.handlePendingTransaction(
            transaction,
            providerReference,
            metadata,
            providerName,
          );
          break;

        default:
          logger.warn(`${providerName} unknown status received`, {
            reference,
            status,
          });
      }

      logger.info(`${providerName} webhook processed successfully`, {
        reference,
        status,
      });
    } catch (error) {
      logger.error(`${providerName} webhook processing error`, {
        reference,
        error,
      });
      throw error;
    }
  }

  // FIND TRANSACTION

  private async findTransaction(reference: string): Promise<any> {
    const transaction =
      await this.transactionRepository.findByReference(reference);

    if (!transaction) {
      logger.error("Transaction not found for webhook", { reference });
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    return transaction;
  }

  // IDEMPOTENCY CHECK

  private isAlreadyProcessed(transaction: any, newStatus: string): boolean {
    const finalStatuses = ["success", "reversed"];
    if (finalStatuses.includes(transaction.status)) {
      return true;
    }
    if (transaction.status === newStatus) {
      return true;
    }
    return false;
  }

  // HANDLE SUCCESSFUL TRANSACTION
  // Calculates profit and persists it alongside the status update.
  // metadata comes from VTPassService.extractMetadata() which already
  // captures commission and convenienceFee from the webhook payload.

  private async handleSuccessfulTransaction(
    transaction: any,
    providerReference: string,
    metadata: any,
    token: string | undefined,
    providerName: string,
  ): Promise<void> {
    logger.info("Processing successful transaction via webhook", {
      reference: transaction.reference,
      providerReference,
      providerName,
    });

    // Calculate profit using chargeInfo stored at debit time
    // and commission/convenienceFee from the webhook metadata
    const chargeInfo = transaction.meta?.chargeInfo;
    const profit = this.calculateProfit({
      chargeInfo,
      providerName,
      commission: metadata?.commission,
      convenienceFee: metadata?.convenienceFee,
    });

    // Update transaction — profit set alongside status in a single write
    await this.transactionRepository.update(transaction.id, {
      status: "success",
      providerReference,
      profit, // <-- persisted here
      meta: {
        ...transaction.meta,
        webhookData: {
          ...metadata,
          processedAt: new Date(),
          provider: providerName,
        },
        token, // store token if available (electricity, e-pins)
      },
    });

    logger.info("Profit set on webhook success", {
      reference: transaction.reference,
      profit,
      providerName,
    });

    this.transactionRepository.findById(transaction.id)
      .then(updatedTransaction => {
        if (updatedTransaction) {
          SocketService.emitTransactionUpdate(transaction.reference, { status: "success", transaction: updatedTransaction });
        }
      })
      .catch(err => logger.error("Socket emit error", err));

    await this.sendNotification(transaction.sourceId, "transaction_success", {
      transactionType: this.getTransactionTypeLabel(transaction.type),
      amount: transaction.amount,
      reference: transaction.reference,
      token: token || null,
      ...metadata,
    });

    logger.info("Transaction marked as successful via webhook", {
      reference: transaction.reference,
      providerReference,
    });
  }

  // HANDLE REVERSED TRANSACTION

  private async handleReversedTransaction(
    transaction: any,
    providerReference: string,
    metadata: any,
    providerName: string,
  ): Promise<void> {
    logger.info("Processing reversed transaction", {
      reference: transaction.reference,
      providerReference,
      amount: transaction.amount,
    });

    await this.transactionRepository.update(transaction.id, {
      status: "reversed",
      providerReference,
      profit: 0, // reversed = no profit
      meta: {
        ...transaction.meta,
        webhookData: {
          ...metadata,
          reversedAt: new Date(),
          provider: providerName,
        },
      },
    });

    this.transactionRepository.findById(transaction.id)
      .then(updatedTransaction => {
        if (updatedTransaction) {
          SocketService.emitTransactionUpdate(transaction.reference, { status: "reversed", transaction: updatedTransaction });
        }
      })
      .catch(err => logger.error("Socket emit error", err));

    // Refund the full debited amount (totalAmount, not just base amount)
    const refundAmount =
      transaction.meta?.chargeInfo?.totalAmount || transaction.amount;

    await this.refundWallet(
      transaction.sourceId.toString(),
      refundAmount,
      "REFUND",
      `Transaction reversed - ${transaction.reference}`,
      transaction.reference,
    );

    await this.sendNotification(transaction.sourceId, "transaction_reversed", {
      transactionType: this.getTransactionTypeLabel(transaction.type),
      amount: transaction.amount,
      reference: transaction.reference,
      reason: metadata?.reason || "Transaction reversed by provider",
    });

    logger.info("Transaction reversed and refunded", {
      reference: transaction.reference,
      providerReference,
      refundedAmount: refundAmount,
    });
  }

  // HANDLE FAILED TRANSACTION

  private async handleFailedTransaction(
    transaction: any,
    providerReference: string,
    metadata: any,
    providerName: string,
  ): Promise<void> {
    logger.info("Processing failed transaction", {
      reference: transaction.reference,
      providerReference,
    });

    await this.transactionRepository.update(transaction.id, {
      status: "failed",
      providerReference,
      profit: 0, // failed = no profit
      meta: {
        ...transaction.meta,
        webhookData: {
          ...metadata,
          failedAt: new Date(),
          provider: providerName,
        },
      },
    });

    this.transactionRepository.findById(transaction.id)
      .then(updatedTransaction => {
        if (updatedTransaction) {
          SocketService.emitTransactionUpdate(transaction.reference, { status: "failed", transaction: updatedTransaction });
        }
      })
      .catch(err => logger.error("Socket emit error", err));

    // Only refund if was previously pending (not already failed/reversed)
    if (transaction.status === "pending") {
      // Refund the full debited amount
      const refundAmount =
        transaction.meta?.chargeInfo?.totalAmount || transaction.amount;

      await this.refundWallet(
        transaction.sourceId.toString(),
        refundAmount,
        "REFUND",
        `Transaction failed - ${transaction.reference}`,
        transaction.reference,
      );

      logger.info("Failed transaction refunded", {
        reference: transaction.reference,
        refundedAmount: refundAmount,
      });
    }

    await this.sendNotification(transaction.sourceId, "transaction_failed", {
      transactionType: this.getTransactionTypeLabel(transaction.type),
      amount: transaction.amount,
      reference: transaction.reference,
      reason: metadata?.reason || "Transaction failed",
    });

    logger.info("Transaction marked as failed", {
      reference: transaction.reference,
      providerReference,
    });
  }

  // HANDLE PENDING TRANSACTION

  private async handlePendingTransaction(
    transaction: any,
    providerReference: string,
    metadata: any,
    providerName: string,
  ): Promise<void> {
    logger.info("Transaction still pending", {
      reference: transaction.reference,
      providerReference,
    });

    await this.transactionRepository.update(transaction.id, {
      status: "pending",
      providerReference,
      meta: {
        ...transaction.meta,
        webhookData: {
          ...metadata,
          updatedAt: new Date(),
          provider: providerName,
        },
      },
    });
  }

  // REFUND WALLET
  private async refundWallet(
    userId: string,
    amount: number,
    purpose: string,
    remark: string,
    reference: string,
  ): Promise<void> {
    try {
      await this.walletService.creditWallet(userId, amount, purpose, {
        remark,
      });
      logger.info("Wallet refunded successfully", {
        userId,
        amount,
        reference,
      });
    } catch (error) {
      logger.error("Wallet refund failed", {
        userId,
        amount,
        reference,
        error,
      });
      SentryHelper.captureBusinessError(
        "WEBHOOK_REFUND_FAILED",
        `Wallet refund failed during webhook processing for ${reference}`,
        userId,
        { amount, reference },
      );
      // TODO: add this to a retry queue
    }
  }

  // SEND NOTIFICATION
  private async sendNotification(
    userId: Types.ObjectId,
    type: string,
    data: any,
  ): Promise<void> {
    try {
      await this.notificationRepository.create({
        type,
        notifiableType: "User",
        notifiableId: userId,
        data,
      });
      logger.info("Notification sent", { userId, type });
    } catch (error) {
      logger.error("Notification send failed", {
        userId,
        type,
        error,
      });
      // Don't throw — notifications should never block webhook processing
    }
  }

  // HELPERS
  private getTransactionTypeLabel(type: string): string {
    const typeMap: { [key: string]: string } = {
      airtime: "Airtime Purchase",
      data: "Data Bundle",
      cable_tv: "Cable TV Subscription",
      electricity: "Electricity Payment",
      education: "Education Purchase",
      betting: "Betting Funding",
      internationalairtime: "International Airtime",
      internationaldata: "International Data",
    };

    return typeMap[type] || type.replace(/_/g, " ").toUpperCase();
  }
}
