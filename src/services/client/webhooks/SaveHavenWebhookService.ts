import { Transaction } from "@/models/wallet/Transaction";
import { Wallet } from "@/models/wallet/Wallet";
import { Deposit } from "@/models/banking/Deposit";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { VirtualAccountRepository } from "@/repositories/client/VirtualAccountRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { DepositRepository } from "@/repositories/client/DepositRepository";
import { WebhookProcessResult } from "@/services/WebhookService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import { generateReference } from "@/utils/helpers";
import mongoose, { Types } from "mongoose";
import { NotificationService } from "../notifications/NotificationService";
import AdminServiceContainer from "@/services/admin/container";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import ServiceContainer from "../container";
import { WebhookDeliveryService } from "./WebhookDeliveryService";
import { WalletService } from "../wallet/WalletService";
import { HelperService } from "@/services/client/utility/HelperService";

export class SaveHavenWebhookService {
  private notificationService: NotificationService;
  private transactionRepository: TransactionRepository;
  private virtualAccountRepository: VirtualAccountRepository;
  private walletRepository: WalletRepository;
  private depositRepository: DepositRepository;
  private auditLoggingService: AuditLoggingService;
  private webhookDeliveryService: WebhookDeliveryService;
  private walletService: WalletService;
  private helperService: HelperService;

  constructor(notificationService: NotificationService) {
    this.notificationService = notificationService;
    this.transactionRepository = new TransactionRepository();
    this.virtualAccountRepository = new VirtualAccountRepository();
    this.walletRepository = new WalletRepository();
    this.depositRepository = new DepositRepository();
    this.auditLoggingService = AdminServiceContainer.getAuditLoggingService();
    this.webhookDeliveryService = ServiceContainer.getWebhookDeliveryService();
    this.walletService = ServiceContainer.getWalletService();
    this.helperService = ServiceContainer.getHelperService();
  }

  async processWebhook(webhookData: WebhookProcessResult): Promise<void> {
    const { providerTransactionId, metadata } = webhookData;

    try {
      logger.info("SaveHaven webhook service: Processing started", {
        providerTransactionId,
        transferType: metadata.transferType,
        status: webhookData.status,
      });

      if (metadata.transferType === "Inwards") {
        const isDuplicate = await this.checkIdempotencyForInwards(
          providerTransactionId,
          webhookData.providerReference,
        );

        if (isDuplicate) {
          logger.info(
            "SaveHaven webhook: Inwards transaction already processed, skipping",
            {
              providerTransactionId,
              providerReference: webhookData.providerReference,
            },
          );
          return;
        }

        await this.handleWalletFunding(webhookData);
      } else if (metadata.transferType === "Outwards") {
        const isDuplicate = await this.checkIdempotencyForOutwards(
          webhookData.reference,
          providerTransactionId,
        );

        if (isDuplicate) {
          logger.info(
            "SaveHaven webhook: Outwards transaction already processed, skipping",
            {
              providerTransactionId,
              reference: webhookData.reference,
            },
          );
          return;
        }

        await this.handleWithdrawal(webhookData);
      } else {
        logger.warn("SaveHaven webhook: Unknown transfer type", {
          transferType: metadata.transferType,
          providerTransactionId,
        });
      }

      logger.info("SaveHaven webhook service: Processing completed", {
        providerTransactionId,
        transferType: metadata.transferType,
      });
    } catch (error) {
      logger.error("SaveHaven webhook service: Processing error", {
        error,
        providerTransactionId,
      });
      throw error;
    }
  }

  private async handleWalletFunding(
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    const {
      reference,
      providerTransactionId,
      providerReference,
      status,
      metadata,
    } = webhookData;

    let session: mongoose.ClientSession | null = null;
    let notificationData: any = null;

    try {
      logger.info("SaveHaven: Processing wallet funding", {
        providerTransactionId,
        creditAccountNumber: metadata.creditAccountNumber,
        amount: metadata.amount,
        status,
      });
      const chargeCalculation =
        await this.helperService.calculateAmountWithCharge(
          metadata.amount,
          TRANSACTION_TYPES.DEPOSIT, // Transaction type is DEPOSIT
        );

      const amountToCredit =
        metadata.amount - Number(chargeCalculation.chargeAmount);

      await this.auditLoggingService.logWebhookEvent({
        provider: "saveHaven",
        webhookType: "transfer",
        transactionReference: webhookData.reference,
        status: "received",
        details: {
          amount: metadata.amount,
          creditAccountNumber: metadata.creditAccountNumber,
        },
      });

      const existingTransaction = await Transaction.findOne({
        $or: [
          { providerReference: providerTransactionId },
          { idempotencyKey: providerReference },
        ],
        provider: "saveHaven",
        type: "deposit",
      });

      if (existingTransaction) {
        logger.info("SaveHaven: Deposit already processed", {
          transactionId: existingTransaction._id,
          providerReference,
        });
        // Mark webhook delivery as success — duplicate webhook,

        await this.webhookDeliveryService.recordWebhookReceived({
          transactionReference:
            webhookData.reference || webhookData.providerReference,
          provider: "saveHaven",
          webhookPayload: webhookData,
          providerTransactionId,
        });

        // transaction already processed correctly
        await this.webhookDeliveryService.recordWebhookProcessingSuccess({
          transactionReference:
            webhookData.reference || webhookData.providerReference,
          provider: "saveHaven",
        });

        return;
      }
      await this.webhookDeliveryService.recordWebhookReceived({
        transactionReference:
          webhookData.reference || webhookData.providerReference,
        provider: "saveHaven",
        webhookPayload: webhookData,
        providerTransactionId,
      });

      await this.webhookDeliveryService.recordWebhookProcessingStarted({
        transactionReference:
          webhookData.reference || webhookData.providerReference,
        provider: "saveHaven",
      });

      const virtualAccount = await this.virtualAccountRepository.findOne({
        accountNumber: metadata.creditAccountNumber,
        provider: "saveHaven",
        isActive: true,
      });

      if (!virtualAccount) {
        logger.error("SaveHaven: Virtual account not found", {
          accountNumber: metadata.creditAccountNumber,
          providerTransactionId,
        });
        throw new AppError(
          "Virtual account not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      const userId = virtualAccount.userId;

      logger.info("SaveHaven: Found virtual account", {
        virtualAccountId: virtualAccount._id,
        userId,
        accountNumber: metadata.creditAccountNumber,
      });

      const wallet = await this.walletRepository.findByUserId(userId);
      if (!wallet) {
        throw new AppError(
          "Wallet not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      const balanceBefore = wallet.balance;
      let balanceAfter = balanceBefore;

      if (status === "success") {
        balanceAfter = balanceBefore + amountToCredit;
      } else if (status === "reversed") {
        balanceAfter = balanceBefore;
      }

      session = await mongoose.startSession();
      session.startTransaction();

      const depositReference = generateReference("DEP");
      const deposit = await Deposit.create(
        [
          {
            userId: userId,
            walletId: wallet._id,
            reference: depositReference,
            provider: "saveHaven",
            amount: amountToCredit,
            status:
              status === "success"
                ? "success"
                : status === "reversed"
                  ? "reversed"
                  : "failed",
            meta: {
              providerResponse: metadata,
              chargeInfo: {
                baseAmount: metadata.amount,
                serviceCharge: chargeCalculation.chargeAmount,
                chargeType: chargeCalculation.serviceCharge?.type,
                chargeValue: chargeCalculation.serviceCharge?.value,
                creditedAmount: amountToCredit,
              },
              providerReference: providerReference,
              providerTransactionId: providerTransactionId,
              safeHavenTransactionId: providerTransactionId,
              virtualAccountId: virtualAccount._id,
              fees: metadata.fees,
              vat: metadata.vat,
              stampDuty: metadata.stampDuty,
              grossAmount: metadata.amount,
              netAmount: metadata.netAmount,
              unsolicited: true,
              creditAccountNumber: metadata.creditAccountNumber,
              creditAccountName: metadata.creditAccountName,
              debitAccountNumber: metadata.debitAccountNumber,
              debitAccountName: metadata.debitAccountName,
              responseMessage: metadata.responseMessage,
            },
          },
        ],
        { session },
      );

      logger.info("SaveHaven: Deposit record created", {
        depositId: deposit[0]._id,
        reference: depositReference,
        userId,
      });
      const senderName = metadata.debitAccountName;
      const remarkText =
        senderName && senderName !== "N/A"
          ? `Deposit from ${senderName}`
          : "Wallet funded";
      const transactionReference = generateReference("TXN");
      const transaction = await Transaction.create(
        [
          {
            walletId: wallet._id,
            sourceId: userId,
            userId,
            reference: transactionReference,
            providerReference: providerReference,
            idempotencyKey: providerReference,
            transactableType: "Deposit",
            transactableId: deposit[0]._id,
            amount: amountToCredit,
            direction: "CREDIT",
            type: TRANSACTION_TYPES.DEPOSIT,
            profit:
              chargeCalculation.chargeAmount -
              ((metadata.fees || 0) +
                (metadata.vat || 0) +
                (metadata.stampDuty || 0)),

            provider: "saveHaven",
            status:
              status === "success"
                ? "success"
                : status === "reversed"
                  ? "reversed"
                  : "failed",
            purpose: TRANSACTION_TYPES.DEPOSIT,
            remark: remarkText,
            balanceBefore,
            balanceAfter,
            initiatedBy: userId,
            initiatedByType: "system",
            meta: {
              depositId: deposit[0]._id,
              depositReference: depositReference,
              providerResponse: metadata,
              provider: "saveHaven",
              virtualAccount: {
                accountNumber: metadata.creditAccountNumber,
                accountName: metadata.creditAccountName,
                bankName: virtualAccount.bankName,
              },
              chargeInfo: {
                baseAmount: metadata.amount,
                serviceCharge: chargeCalculation.chargeAmount,
                chargeType: chargeCalculation.serviceCharge?.type,
                chargeValue: chargeCalculation.serviceCharge?.value,
                creditedAmount: amountToCredit,
              },
              fees: metadata.fees,
              vat: metadata.vat,
              stampDuty: metadata.stampDuty,
              grossAmount: metadata.amount,
              netAmount: metadata.netAmount,
              providerTransactionId: providerTransactionId,
              debitAccountNumber: metadata.debitAccountNumber,
              debitAccountName: metadata.debitAccountName,
              responseMessage: metadata.responseMessage,
            },
          },
        ],
        { session },
      );

      logger.info("SaveHaven: Transaction record created", {
        transactionId: transaction[0]._id,
        reference: transactionReference,
        userId,
      });

      if (status === "success") {
        const updatedWallet = await Wallet.findByIdAndUpdate(
          wallet._id,
          { $inc: { balance: amountToCredit } },
          { session, new: true },
        );

        if (!updatedWallet) {
          throw new Error("Failed to update wallet balance");
        }

        logger.info("SaveHaven: Wallet credited", {
          userId: userId.toString(),
          amount: amountToCredit,
          reference: transactionReference,
          newBalance: updatedWallet.balance,
        });

        await this.auditLoggingService.logTransactionEvent({
          userId: userId,
          transactionId: transaction[0]._id.toString(),
          transactionReference: transactionReference,
          action: "status_changed",
          previousStatus: "pending",
          newStatus: status,
          amount: amountToCredit,
          balanceAfter: updatedWallet?.balance,
          reason: "webhook_received",
          provider: "saveHaven",
          initiatedBy: "webhook",
        });

        await this.webhookDeliveryService.recordWebhookProcessingSuccess({
          transactionReference: transactionReference,
          provider: "saveHaven",
        });
      }

      if (status === "success") {
        notificationData = {
          type: "payment_success",
          notifiableType: "User",
          notifiableId: userId,
          sendPush: true,
          sendEmail: false,
          sendSMS: false,
          data: {
            transactionType: "Wallet Funding",
            amount: amountToCredit,
            reference: transactionReference,
            provider: "SafeHaven",
            fees: metadata.fees,
            balance: balanceAfter,
          },
        };
      } else if (status === "reversed") {
        notificationData = {
          type: "payment_reversed",
          notifiableType: "User",
          notifiableId: userId,
          sendPush: true,
          sendEmail: false,
          sendSMS: false,
          data: {
            transactionType: "Wallet Funding",
            amount: metadata.netAmount,
            reference: transactionReference,
            provider: "SafeHaven",
            reason: metadata.responseMessage,
          },
        };
      } else if (status === "failed") {
        notificationData = {
          type: "payment_failed",
          notifiableType: "User",
          notifiableId: userId,
          sendPush: true,
          sendEmail: false,
          sendSMS: false,
          data: {
            transactionType: "Wallet Funding",
            amount: metadata.amount,
            reference: transactionReference,
            provider: "SafeHaven",
            reason: metadata.responseMessage,
          },
        };
      }

      await session.commitTransaction();
      session.endSession();
      session = null;

      if (notificationData) {
        try {
          await this.notificationService.createNotification(notificationData);

          logger.info("SaveHaven: Notification sent", {
            userId: userId.toString(),
            type: notificationData.type,
            reference: transactionReference,
          });
        } catch (notificationError) {
          logger.error("SaveHaven: Notification failed (non-critical)", {
            error: notificationError,
            transactionId: transaction[0]._id,
            providerTransactionId,
          });
        }
      }

      if (status === "success") {
        logger.info("SaveHaven: Wallet funded successfully", {
          userId: userId.toString(),
          amount: amountToCredit,
          reference: transactionReference,
          providerTransactionId,
        });
      }
    } catch (error: any) {
      if (session) {
        try {
          if (session.inTransaction()) {
            await session.abortTransaction();
          }
        } catch (abortError) {
          logger.error("SaveHaven: Error aborting transaction", {
            error: abortError,
            originalError: error,
            providerTransactionId,
          });
        } finally {
          session.endSession();
        }
      }

      await this.webhookDeliveryService.recordWebhookProcessingFailed({
        transactionReference: reference,
        provider: "saveHaven",
        error: error?.message || "Unknown error",
      });

      logger.error("SaveHaven: Wallet funding error", {
        error,
        providerTransactionId,
      });
      throw error;
    }
  }

  private async handleWithdrawal(
    webhookData: WebhookProcessResult,
  ): Promise<void> {
    const {
      reference,
      providerTransactionId,
      providerReference,
      status,
      metadata,
    } = webhookData;

    try {
      logger.info("SaveHaven: Processing withdrawal webhook", {
        reference,
        providerTransactionId,
        amount: metadata.amount,
        status,
      });

      let transaction = await this.transactionRepository.findOne({
        reference: reference,
        type: { $in: ["withdrawal"] },
        provider: "saveHaven",
      });

      if (!transaction) {
        transaction = await this.transactionRepository.findOne({
          providerReference: providerTransactionId,
          type: { $in: ["withdrawal"] },
          provider: "saveHaven",
        });
      }

      if (!transaction) {
        logger.error("SaveHaven: Withdrawal transaction not found", {
          reference,
          providerTransactionId,
        });
        throw new AppError(
          "Withdrawal transaction not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      logger.info("SaveHaven: Found transaction record", {
        transactionId: transaction._id,
        reference,
        userId: transaction.sourceId,
        currentStatus: transaction.status,
      });

      if (transaction.status === "success" || transaction.status === "failed") {
        logger.info("SaveHaven: Withdrawal already processed", {
          transactionId: transaction._id,
          currentStatus: transaction.status,
          webhookStatus: status,
        });
        await this.webhookDeliveryService.recordWebhookReceived({
          transactionReference:
            webhookData.reference || webhookData.providerReference,
          provider: "saveHaven",
          webhookPayload: webhookData,
          providerTransactionId,
        });

        // in a final state — this was a duplicate webhook, not a failure
        await this.webhookDeliveryService.recordWebhookProcessingSuccess({
          transactionReference: reference,
          provider: "saveHaven",
        });
        return;
      }

      const transactionStatus = this.mapPaymentStatusToTransaction(status);

      await this.transactionRepository.update(transaction.id.toString(), {
        status: transactionStatus,
        providerReference: providerTransactionId,
        profit:
          (transaction.meta?.chargeInfo?.serviceCharge || 0) -
          ((metadata.fees || 0) +
            (metadata.vat || 0) +
            (metadata.stampDuty || 0)),
        meta: {
          ...transaction.meta,
          providerTransactionId: providerTransactionId,
          providerResponse: metadata,
          fees: metadata.fees,
          vat: metadata.vat,
          stampDuty: metadata.stampDuty,
          responseMessage: metadata.responseMessage,
          completedAt: new Date(),
        },
      });

      logger.info("SaveHaven: Transaction updated", {
        transactionId: transaction._id,
        status: transactionStatus,
      });

      if (status === "success") {
        await this.webhookDeliveryService.recordWebhookProcessingSuccess({
          transactionReference: reference,
          provider: "saveHaven",
        });
      }

      // Handle refund if failed/reversed
      if (status === "failed" || status === "reversed") {
        try {
          const refundAmount =
            transaction.amount +
            (transaction.meta?.chargeInfo?.serviceCharge || 0);

          await this.walletService.creditWallet(
            transaction.sourceId || transaction.userId,
            refundAmount,
            `Withdrawal refund`,
            {
              type: "refund",
              provider: transaction.provider,
              idempotencyKey: `${reference}_webhook_refund`,
              initiatedByType: "system",
              linkedTransactionId: transaction._id as Types.ObjectId,
              remark: `Withdrawal refund - ${status}`,
              meta: {
                originalReference: reference,
                reason: `withdrawal_${status}`,
                webhookStatus: status,
                responseMessage: metadata.responseMessage,
              },
            },
          );

          logger.info(`SaveHaven: Wallet refunded for ${status} withdrawal`, {
            reference,
            amount: refundAmount,
          });
        } catch (refundError) {
          logger.error(`SaveHaven: Refund failed`, {
            error: refundError,
            reference,
          });
          throw refundError;
        }
      }

      // Send notification
      try {
        const userId = transaction.sourceId;
        const amount = transaction.amount;
        const transactionType =
          transaction.type === "withdrawal" ? "Withdrawal" : "Bank Transfer";

        if (status === "success") {
          await this.notificationService.createNotification({
            type: "withdrawal_completed",
            notifiableType: "User",
            notifiableId: userId!,
            sendPush: true,
            sendEmail: false,
            sendSMS: false,
            data: {
              transactionType,
              amount,
              reference,
              provider: "SafeHaven",
              accountNumber: transaction.meta?.accountNumber,
              bankName: transaction.meta?.bankName,
            },
          });

          logger.info("SafeHaven: Withdrawal completed successfully", {
            reference,
            amount,
            providerTransactionId,
          });
        } else if (status === "failed" || status === "reversed") {
          await this.notificationService.createNotification({
            type:
              status === "reversed"
                ? "withdrawal_reversed"
                : "withdrawal_failed",
            notifiableType: "User",
            notifiableId: userId!,
            data: {
              transactionType,
              amount,
              reference,
              provider: "SafeHaven",
              reason: metadata.responseMessage,
              refunded: true,
            },
          });

          logger.info(`SafeHaven: Withdrawal ${status} and refunded`, {
            reference,
            amount,
            providerTransactionId,
          });
        }
      } catch (notificationError) {
        logger.error("SafeHaven: Notification failed (non-critical)", {
          error: notificationError,
          reference,
        });
      }
    } catch (error: any) {
      logger.error("SafeHaven: Withdrawal processing error", {
        error,
        reference,
        providerTransactionId,
      });

      await this.webhookDeliveryService.recordWebhookProcessingFailed({
        transactionReference: reference,
        provider: "saveHaven",
        error: error?.message || "Unknown error",
      });
      throw error;
    }
  }

  private async checkIdempotencyForInwards(
    providerTransactionId: string | undefined,
    providerReference: string,
  ): Promise<boolean> {
    if (!providerTransactionId && !providerReference) {
      logger.warn("SaveHaven: Cannot check idempotency - missing identifiers");
      return false;
    }

    const orConditions: any[] = [];

    if (providerReference) {
      orConditions.push({ providerReference: providerReference });
      orConditions.push({ idempotencyKey: providerReference });
    }

    if (providerTransactionId) {
      // Match against where handleWalletFunding actually stores it
      orConditions.push({
        "meta.providerTransactionId": providerTransactionId,
      });
    }

    const query: any = {
      provider: "saveHaven",
      type: "deposit",
      $or: orConditions,
    };

    const existingTransaction = await this.transactionRepository.findOne(query);

    if (existingTransaction) {
      logger.info("SaveHaven: Inwards transaction already exists (duplicate)", {
        providerTransactionId,
        providerReference,
        existingTransactionId: existingTransaction._id,
        existingReference: existingTransaction.reference,
        status: existingTransaction.status,
        createdAt: existingTransaction.createdAt,
      });
      return true;
    }

    return false;
  }

  private async checkIdempotencyForOutwards(
    reference: string,
    providerTransactionId: string | undefined,
  ): Promise<boolean> {
    if (!reference && !providerTransactionId) {
      logger.warn("SaveHaven: Cannot check idempotency - missing identifiers");
      return false;
    }

    const query: any = {
      type: { $in: ["withdrawal"] },
      provider: "saveHaven",
    };

    const orConditions: any[] = [];

    if (reference) {
      orConditions.push({ reference: reference });
    }

    if (providerTransactionId) {
      orConditions.push(
        { providerReference: providerTransactionId },
        { "meta.transferId": providerTransactionId },
      );
    }

    if (orConditions.length > 0) {
      query.$or = orConditions;
    }

    const existingTransaction = await this.transactionRepository.findOne(query);

    if (!existingTransaction) {
      logger.warn("SaveHaven: Outwards transaction not found", {
        reference,
        providerTransactionId,
      });
      return false;
    }

    const finalStatuses = ["success", "failed", "reversed"];
    const isInFinalState = finalStatuses.includes(existingTransaction.status);
    const hasWebhookData = existingTransaction.meta?.webhookData !== undefined;

    if (isInFinalState) {
      logger.info(
        "SaveHaven: Outwards transaction in final state (duplicate webhook)",
        {
          providerTransactionId,
          reference,
          transactionId: existingTransaction._id,
          status: existingTransaction.status,
          updatedAt: existingTransaction.updatedAt,
        },
      );
      return true;
    }

    if (hasWebhookData) {
      logger.info(
        "SaveHaven: Outwards transaction already has webhook data (duplicate)",
        {
          providerTransactionId,
          reference,
          transactionId: existingTransaction._id,
          status: existingTransaction.status,
          webhookReceivedAt:
            existingTransaction.meta?.webhookData?.webhookReceivedAt,
        },
      );
      return true;
    }

    logger.info(
      "SaveHaven: Outwards transaction ready for webhook processing",
      {
        providerTransactionId,
        reference,
        transactionId: existingTransaction._id,
        currentStatus: existingTransaction.status,
      },
    );

    return false;
  }

  private mapPaymentStatusToTransaction(
    paymentStatus: string,
  ): "pending" | "processing" | "success" | "failed" | "reversed" {
    const statusMap: Record<string, any> = {
      success: "success",
      failed: "failed",
      reversed: "reversed",
      pending: "processing",
      processing: "processing",
    };

    return statusMap[paymentStatus] || "processing";
  }
}
