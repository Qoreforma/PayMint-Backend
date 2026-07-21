import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { NotificationRepository } from "@/repositories/client/NotificationRepository";
import { WalletService } from "../client/wallet/WalletService";
import { ClubKonnectService } from "../client/providers/billpayment/ClubkonnectService";
import { ReloadlyService } from "../client/providers/giftcard/ReloadlyService";
import { CoolsubService } from "../client/providers/billpayment/CoolsubService";
import { MySimHostingService } from "../client/providers/billpayment/MySimHostingService";
import { GiftBillsService } from "../client/providers/billpayment/GiftBillsService";
import { BilalsadasubService } from "../client/providers/billpayment/BilalsadasubService";
import { Types } from "mongoose";
import SocketService from "@/services/core/SocketService";
import logger from "@/logger";
import { EmailService } from "../core/EmailService";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import { getTransactionStateValidator } from "../client/utility/TransactionStateValidator";
import { VTPassService } from "../client/providers/billpayment/VtpassService";
import { VtuNgService } from "../client/providers/billpayment/VtuNgService";
import { ITransaction } from "@/models/wallet/Transaction";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { NotificationService } from "../client/notifications/NotificationService";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import Sentry from "@/config/sentry";
import { PartnerWebhookService } from "@/services/partner/PartnerWebhookService";
import { UserRepository } from "@/repositories/client/UserRepository";

export class TransactionPollingService {
  private readonly MAX_POLL_ATTEMPTS = 100;
  private readonly TIMEOUT_MINUTES = 30;
  private validator = getTransactionStateValidator();

  constructor(
    private transactionRepository: TransactionRepository,
    private clubkonnectService: ClubKonnectService,
    private vtpassService: VTPassService,
    private vtuNgService: VtuNgService,
    private reloadlyService: ReloadlyService,
    private coolsubService: CoolsubService,
    private mySimHostingService: MySimHostingService,
    private giftBillsService: GiftBillsService,
    private bilalsadasubService: BilalsadasubService,
    private walletService: WalletService,
    private notificationService: NotificationService,
    private emailService: EmailService,
    private auditLoggingService: AuditLoggingService,
    private partnerWebhookService: PartnerWebhookService,
    private userRepository: UserRepository,
  ) { }

  // PROFIT CALCULATION HELPER
  // Same formula as TransactionProcessor and WebhookService, but this one
  // also handles ClubKonnect's amountcharged field which is only available
  // in the polling query result.
  private calculateProfit(params: {
    chargeInfo: any;
    provider: string;
    queryResult: any;
    transactionAmount: number; //transactionAmount: chargeInfo?.baseAmount ?? transaction.amount,
    // baseAmount = what user paid for the product = what was sent to provider
    // NOT totalAmount which includes serviceCharge
  }): number {
    const { chargeInfo, provider, queryResult, transactionAmount } = params;

    if (!chargeInfo) {
      logger.warn(
        "TransactionPollingService.calculateProfit: no chargeInfo, profit = 0",
      );
      return 0;
    }

    // 1. Service charge — always present
    const serviceCharge: number = chargeInfo.serviceCharge ?? 0;

    // 2. Product margin — only when providerAmount stored at debit time
    //    (Data, Cable TV, Education)
    const productMargin: number =
      chargeInfo.providerAmount != null
        ? Math.max(0, (chargeInfo.baseAmount ?? 0) - chargeInfo.providerAmount)
        : 0;

    // 3. Provider net — depends on provider
    let providerNet = 0;
    const providerLower = (provider ?? "").toLowerCase();

    if (providerLower === "vtpass") {
      // VTPass requery response has the same structure as the purchase response
      const commission: number =
        queryResult?.content?.transactions?.commission ?? 0;
      const convenienceFee: number =
        queryResult?.content?.transactions?.convinience_fee ?? 0;
      providerNet = commission - convenienceFee;
    } else if (providerLower === "clubkonnect") {
      const amountCharged = queryResult?.amountcharged;
      // Only use amountcharged when there is no providerAmount on chargeInfo.
      // - Airtime: no providerAmount → amountcharged is the only margin source
      // - Data/Cable/Education: providerAmount exists → productMargin already
      //   captures the margin, using amountcharged here would double-count it
      if (
        amountCharged != null &&
        amountCharged !== "" &&
        chargeInfo?.providerAmount == null
      ) {
        const ckCharged = parseFloat(amountCharged);
        if (!isNaN(ckCharged) && ckCharged > 0) {
          providerNet =
            (chargeInfo?.baseAmount ?? transactionAmount) - ckCharged;
        }
      }
    }
    // GiftBills and all other providers: providerNet stays 0

    const profit = serviceCharge + productMargin + providerNet;

    logger.info("TransactionPollingService.calculateProfit result", {
      provider,
      serviceCharge,
      productMargin,
      providerNet,
      transactionAmount,
      profit,
    });

    return Math.max(0, profit);
  }

  // POLL ALL PENDING TRANSACTIONS
  async pollPendingTransactions(): Promise<void> {
    try {
      const now = new Date();
      const timeoutThreshold = new Date(
        now.getTime() - this.TIMEOUT_MINUTES * 60 * 1000,
      );

      const pendingTransactions = await this.transactionRepository.find({
        status: "pending",
        "polling.nextPollAt": { $lte: now },
        "polling.stoppedAt": { $exists: false },
        createdAt: { $gte: timeoutThreshold },
      });

      if (pendingTransactions.length > 0) {
        logger.info(
          `Polling ${pendingTransactions.length} pending transactions from various providers`,
        );
      }

      for (const transaction of pendingTransactions) {
        await this.pollSingleTransaction(transaction);
      }
    } catch (error: any) {
      logger.error("Error in pollPendingTransactions", error);
      Sentry.captureException(error, {
        tags: { operation: "pollPendingTransactions" },
      });
    }
  }

  // POLL A SINGLE TRANSACTION
  private async pollSingleTransaction(transaction: any): Promise<void> {
    const transactionId = transaction._id || transaction.id;
    const polling = transaction.polling || {};

    try {
      logger.info(`Polling transaction ${transaction.reference}`, {
        provider: polling.pollingProvider || "unknown",
        pollCount: polling.pollCount,
        providerOrderId: polling.providerOrderId,
      });

      // Check stop conditions
      if (polling.pollCount >= this.MAX_POLL_ATTEMPTS) {
        await this.stopPolling(
          transactionId,
          transaction,
          "max_attempts",
          "Maximum polling attempts reached",
        );
        return;
      }

      const age = Date.now() - new Date(transaction.createdAt).getTime();
      if (age > this.TIMEOUT_MINUTES * 60 * 1000) {
        await this.stopPolling(
          transactionId,
          transaction,
          "timeout",
          "Polling timeout reached",
        );
        return;
      }

      const provider = polling.pollingProvider || "clubkonnect";
      const queryResult = await this.queryProviderStatus(
        provider,
        polling.providerOrderId,
        transaction,
      );

      if (!queryResult) {
        logger.warn(
          `No query result for ${transaction.reference} (${provider})`,
        );
        await this.scheduleNextPoll(transactionId, polling);
        return;
      }

      logger.info(
        `Query result for ${transaction.reference} (${provider})`,
        queryResult,
      );

      const { statusCode, status } = this.parseProviderStatus(
        provider,
        queryResult,
      );

      if (this.isSuccessStatus(statusCode, status, provider)) {
        await this.handleSuccess(
          transactionId,
          transaction,
          queryResult,
          provider,
        );
      } else if (this.isFailureStatus(statusCode, status, provider)) {
        await this.handleFailure(transactionId, transaction, queryResult);
      } else {
        await this.scheduleNextPoll(transactionId, polling);
      }
    } catch (error: any) {
      logger.error(`Error polling transaction ${transaction.reference}`, error);
      await this.scheduleNextPoll(transactionId, polling);
    }
  }

  // QUERY PROVIDER STATUS
  private async queryProviderStatus(
    provider: string,
    providerOrderId: string,
    transaction: ITransaction,
  ): Promise<any> {
    try {
      const providerLower = provider.toLowerCase();

      switch (providerLower) {
        case "clubkonnect":
          return await this.clubkonnectService.queryTransaction(
            providerOrderId,
            true,
          );

        case "vtpass":
          return await this.vtpassService.queryTransactionStatus(
            providerOrderId,
          );

        case "vtung":
          return await this.vtuNgService.requeryTransaction(providerOrderId);

        case "reloadly":
          if (
            transaction.type === "internationaldata" ||
            transaction.type === "internationalairtime"
          ) {
            return await this.reloadlyService.getAirtimeTransactionStatus(
              providerOrderId,
            );
          } else if (transaction.type === "giftcard") {
            return await this.reloadlyService.getGiftCardTransaction(
              providerOrderId,
            );
          }
          break;

        case "coolsub":
          if (transaction.type === "airtime") {
            return await this.coolsubService.queryAirtimeTransaction(
              providerOrderId,
            );
          } else if (transaction.type === "data") {
            return await this.coolsubService.queryDataTransaction(
              providerOrderId,
            );
          } else if (transaction.type === "cable_tv") {
            return await this.coolsubService.queryCableTvTransaction(
              providerOrderId,
            );
          } else if (transaction.type === "electricity") {
            return await this.coolsubService.queryElectricityTransaction(
              providerOrderId,
            );
          } else if (transaction.type === "education") {
            return await this.coolsubService.queryEducationTransaction(
              providerOrderId,
            );
          }
          break;

        case "mysimhosting":
          throw new AppError(
            "Transaction requery not supported by MySimHosting",
            HTTP_STATUS.NOT_IMPLEMENTED,
            ERROR_CODES.PROVIDER_ERROR,
          );

        case "giftbills":
          return await this.giftBillsService.getTransactionStatus(
            providerOrderId,
          );

        case "bilalsadasub":
          throw new AppError(
            "Transaction requery not supported by Bilalsadasub",
            HTTP_STATUS.NOT_IMPLEMENTED,
            ERROR_CODES.PROVIDER_ERROR,
          );

        default:
          logger.warn(`No query handler for provider: ${provider}`);
          return null;
      }
    } catch (error: any) {
      logger.error(`Failed to query ${provider} status:`, error);
      return null;
    }
  }

  // PARSE PROVIDER STATUS
  private parseProviderStatus(
    provider: string,
    queryResult: any,
  ): { statusCode: number; status: string } {
    const providerLower = provider.toLowerCase();

    switch (providerLower) {
      case "clubkonnect":
        return {
          statusCode: parseInt(queryResult.statuscode || "0"),
          status: queryResult.status || "",
        };

      case "vtpass":
        return {
          statusCode: queryResult.code ? parseInt(queryResult.code) : 0,
          status: queryResult.status || "",
        };

      case "vtung":
        return {
          statusCode: queryResult.code ? parseInt(queryResult.code) : 0,
          status: queryResult.status || "",
        };

      case "reloadly":
        return {
          statusCode: queryResult.status === "SUCCESS" ? 200 : 400,
          status: queryResult.status || "",
        };

      case "coolsub":
        return {
          statusCode: queryResult.status === "success" ? 200 : 400,
          status: queryResult.status || "",
        };

      case "mysimhosting":
        return {
          statusCode: queryResult.code ? parseInt(queryResult.code) : 0,
          status: queryResult.status || "",
        };

      case "mydataplug":
        return {
          statusCode: queryResult.status === "success" ? 200 : 400,
          status: queryResult.status || "",
        };

      case "giftbills":
        return {
          statusCode: queryResult.status === "success" ? 200 : 400,
          status: queryResult.status || "",
        };

      case "bilalsadasub":
        return {
          statusCode: queryResult.status === "success" ? 200 : 400,
          status: queryResult.status || "",
        };

      default:
        return {
          statusCode: 0,
          status: "",
        };
    }
  }

  // SUCCESS / FAILURE STATUS CHECKS
  private isSuccessStatus(
    statusCode: number,
    status: string,
    provider: string,
  ): boolean {
    const providerLower = provider.toLowerCase();

    if (providerLower === "clubkonnect") {
      return statusCode === 200 && status === "ORDER_COMPLETED";
    }

    if (providerLower === "reloadly") {
      return status === "SUCCESSFUL" || statusCode === 200;
    }

    if (
      ["coolsub", "mydataplug", "giftbills", "bilalsadasub"].includes(
        providerLower,
      )
    ) {
      return (
        status === "success" ||
        status === "completed" ||
        statusCode === 200 ||
        statusCode === 0
      );
    }

    if (["vtpass", "vtung", "mysimhosting"].includes(providerLower)) {
      return statusCode === 200 || status === "success";
    }

    return false;
  }

  private isFailureStatus(
    statusCode: number,
    status: string,
    provider: string,
  ): boolean {
    const providerLower = provider.toLowerCase();

    if (providerLower === "clubkonnect") {
      const failureStatuses = [
        "ORDER_ERROR",
        "ORDER_CANCELLED",
        "ORDER_REFUNDED",
        "ORDER_FAILED",
      ];
      if (statusCode === 800) return true;
      if (statusCode >= 400 && statusCode < 600) return true;
      if (failureStatuses.includes(status)) return true;
    }

    if (providerLower === "reloadly") {
      return status === "FAILED" || statusCode >= 400;
    }

    if (statusCode >= 400 && statusCode < 600) {
      return true;
    }

    if (
      ["failed", "error", "cancelled", "refunded"].includes(
        status?.toLowerCase(),
      )
    ) {
      return true;
    }

    return false;
  }

  // HANDLE SUCCESS
  // Calculates profit and persists it alongside the status update.
  // provider is passed through from pollSingleTransaction so we know
  // which formula to apply (VTPass vs ClubKonnect vs others).
  private async handleSuccess(
    transactionId: string,
    transaction: any,
    queryResult: any,
    provider: string,
  ): Promise<void> {
    logger.info(`Transaction ${transaction.reference} completed successfully`, {
      provider,
    });

    // Calculate profit using chargeInfo stored at debit time
    // and any provider-specific fields from the query result
    const chargeInfo = transaction.meta?.chargeInfo;
    const profit = this.calculateProfit({
      chargeInfo,
      provider,
      queryResult,
      transactionAmount: chargeInfo?.baseAmount ?? transaction.amount, // base amount sent to provider
    });

    await this.transactionRepository.update(transactionId, {
      status: "success",
      profit,
      "polling.stoppedAt": new Date(),
      "polling.stopReason": "completed",
      "polling.lastPolledAt": new Date(),
      ...(transaction.type === "electricity" && {
        "meta.token": queryResult.metertoken
          ? queryResult.metertoken.replace(/^TOKEN:\s*/i, "").trim()
          : transaction.meta?.token || "",
        "meta.meterNumber":
          queryResult.meterno || transaction.meta?.meterNumber || "",
        "meta.customerName": transaction.meta?.customerName || "",
        "meta.customerAddress": transaction.meta?.customerAddress || "",
        ...(queryResult.units && { "meta.units": queryResult.units }),
        ...(queryResult.amountcharged && {
          "meta.amountcharged": queryResult.amountcharged,
        }),
      }),
      ...(transaction.type === "data_epin" &&
        queryResult.TXN_EPIN_DATABUNDLE?.length && {
        "meta.epins": queryResult.TXN_EPIN_DATABUNDLE,
      }),
    });

    logger.info("Profit set on polling success", {
      reference: transaction.reference,
      profit,
      provider,
    });

    this.transactionRepository.findById(transactionId)
      .then(updatedTransaction => {
        if (updatedTransaction) {
          SocketService.emitTransactionUpdate(transaction.reference, { status: "success", transaction: updatedTransaction });
        }
      })
      .catch(err => logger.error("Socket emit error", err));

    await this.auditLoggingService.logPollingEvent({
      transactionId: transaction._id.toString(),
      transactionReference: transaction.reference,
      pollCount: transaction.polling?.pollCount || 0,
      status: "success",
      details: {
        provider: transaction.polling?.pollingProvider,
        meterToken: queryResult.metertoken,
        cardDetails: queryResult.carddetails,
        profit,
      },
    });

    await this.notificationService
      .createNotification({
        type: "transaction_success",
        notifiableType: "User",
        notifiableId: new Types.ObjectId(transaction.sourceId),
        data: {
          transactionType: this.getTransactionTypeLabel(transaction.type),
          amount: transaction.amount,
          reference: transaction.reference,
          token: queryResult.metertoken || queryResult.carddetails || undefined,
        },
        sendEmail: false,
        sendSMS: false,
        sendPush: true,
      })
      .catch((err) =>
        logger.error("Failed to create success notification", err),
      );

    // Fire partner webhook if this was a partner transaction
    if (transaction.meta?.isPartnerTransaction) {
      this.firePartnerWebhookOnSuccess(transaction, queryResult).catch((err) =>
        logger.error("Partner webhook failed after polling success", err),
      );
    }
  }

  private async firePartnerWebhookOnSuccess(
    transaction: any,
    queryResult: any,
  ): Promise<void> {
    try {
      const partnerId =
        transaction.userId?.toString() ||
        transaction.sourceId?.toString();
      if (!partnerId) return;

      const user = await this.userRepository.findById(partnerId);
      if (!user?.partner?.webhookUrl) return;

      const eventType = `${transaction.type}.purchase.success`;

      const payload: any = {
        event: eventType,
        transactionReference: transaction.reference,
        partnerReference: transaction.meta?.partnerReference ?? null,
        status: "success",
        product: transaction.type,
        amount: transaction.amount,
        timestamp: Date.now(),
      };

      // Attach product-specific delivery data
      if (transaction.type === "electricity" && queryResult.metertoken) {
        payload.token = queryResult.metertoken
          .replace(/^TOKEN:\s*/i, "")
          .trim();
      }
      if (transaction.type === "data_epin" && queryResult.TXN_EPIN_DATABUNDLE) {
        payload.epins = queryResult.TXN_EPIN_DATABUNDLE;
      }

      const log = await this.partnerWebhookService.createWebhookLog({
        userId: partnerId,
        event: eventType,
        webhookUrl: user.partner.webhookUrl,
        payload,
        transactionId: transaction._id,
        transactionModel: "Transaction",
      });

      if (log) {
        await this.partnerWebhookService.sendWebhook(log._id);
      }
    } catch (err: any) {
      logger.error("firePartnerWebhookOnSuccess failed", err);
    }
  }

  // HANDLE FAILURE
  // BUG FIX: was refunding transaction.amount (base amount) instead of
  // the full debited amount. Now uses chargeInfo.totalAmount with fallback.
  private async handleFailure(
    transactionId: string,
    transaction: any,
    queryResult: any,
  ): Promise<void> {
    logger.warn(
      `Transaction ${transaction.reference} failed - Status: ${queryResult.status}`,
      queryResult,
    );

    // FIXED: refund the full debited amount (base + serviceCharge),
    // not just the base amount. chargeInfo.totalAmount is what was
    // actually taken from the user's wallet.
    const refundAmount =
      transaction.meta?.chargeInfo?.totalAmount || transaction.amount;

    await this.walletService.creditWallet(
      transaction.sourceId.toString(),
      refundAmount,
      `${this.getTransactionTypeLabel(transaction.type)} refund`,
      {
        type: "refund",
        provider: transaction.polling?.pollingProvider || "system",
        idempotencyKey: `${transaction.reference}_polling_refund`,
        initiatedByType: "system",
        linkedTransactionId: transaction._id as Types.ObjectId, // ← added
        remark: `Refund: ₦${refundAmount} for failed ${this.getTransactionTypeLabel(transaction.type)} (Ref: ${transaction.reference})`,
        meta: {
          originalReference: transaction.reference,
          reason: "polling_failed",
          suppressNotification: true,
        },
      },
    );

    await this.transactionRepository.update(transactionId, {
      status: "failed",
      profit: 0, // failed = no profit
      "polling.stoppedAt": new Date(),
      "polling.stopReason": "failed",
      "polling.lastPolledAt": new Date(),
      failureReason: queryResult.remark || queryResult.status,
    });

    this.transactionRepository.findById(transactionId)
      .then(updatedTransaction => {
        if (updatedTransaction) {
          SocketService.emitTransactionUpdate(transaction.reference, { status: "failed", transaction: updatedTransaction });
        }
      })
      .catch(err => logger.error("Socket emit error", err));

    await this.auditLoggingService.logPollingEvent({
      transactionId: transaction._id.toString(),
      transactionReference: transaction.reference,
      pollCount: transaction.polling?.pollCount || 0,
      status: "failed",
      details: {
        provider: transaction.polling?.pollingProvider,
        failureReason: queryResult.remark || queryResult.status,
        refunded: true,
        refundedAmount: refundAmount,
      },
    });

    await this.notificationService
      .createNotification({
        type: "transaction_failed",
        notifiableType: "User",
        notifiableId: new Types.ObjectId(transaction.sourceId),
        data: {
          transactionType: this.getTransactionTypeLabel(transaction.type),
          amount: transaction.amount,
          reference: transaction.reference,
          reason: queryResult.remark || "Transaction failed",
        },
        sendEmail: false,
        sendSMS: false,
        sendPush: true,
      })
      .catch((err) =>
        logger.error("Failed to create failure notification", err),
      );
  }

  // SCHEDULE NEXT POLL
  private async scheduleNextPoll(
    transactionId: string,
    polling: any,
  ): Promise<void> {
    const pollCount = (polling.pollCount || 0) + 1;

    let nextPollDelay: number;

    if (pollCount <= 12) {
      nextPollDelay = 10 * 1000; // first ~2 minutes: every 10s
    } else if (pollCount <= 18) {
      nextPollDelay = 30 * 1000; // next ~3 minutes: every 30s
    } else if (pollCount <= 28) {
      nextPollDelay = 60 * 1000; // next ~10 minutes: every 60s
    } else {
      nextPollDelay = 5 * 60 * 1000; // after that: every 5 minutes
    }

    const nextPollAt = new Date(Date.now() + nextPollDelay);

    const transaction = await this.transactionRepository.update(transactionId, {
      "polling.pollCount": pollCount,
      "polling.lastPolledAt": new Date(),
      "polling.nextPollAt": nextPollAt,
    });

    await this.auditLoggingService.logPollingEvent({
      transactionId: transactionId,
      transactionReference: transaction?.reference || "unknown",
      pollCount,
      status: "attempt",
      details: {
        nextPollAt: nextPollAt.toISOString(),
        pollDelayMs: nextPollDelay,
      },
    });

    logger.info(`Scheduled next poll for transaction ${transactionId}`, {
      pollCount,
      nextPollAt,
    });
  }

  // STOP POLLING
  private async stopPolling(
    transactionId: string,
    transaction: any,
    reason: "completed" | "failed" | "timeout" | "max_attempts",
    message: string,
  ): Promise<void> {
    logger.warn(
      `Stopping polling for transaction ${transaction.reference}: ${message}`,
    );

    await this.transactionRepository.update(transactionId, {
      "polling.stoppedAt": new Date(),
      "polling.stopReason": reason,
      "polling.lastPolledAt": new Date(),
    });

    if (reason === "timeout" || reason === "max_attempts") {
      SentryHelper.captureBusinessError(
        "STUCK_TRANSACTION",
        `Transaction stuck: ${transaction.reference} - ${reason}`,
        transaction.sourceId?.toString(),
        {
          reference: transaction.reference,
          provider: transaction.polling?.pollingProvider,
          pollCount: transaction.polling?.pollCount,
          reason,
          type: transaction.type,
          amount: transaction.amount,
        },
      );

      logger.error(
        `Transaction ${transaction.reference} stuck in pending state`,
        {
          reason,
          provider: transaction.polling?.pollingProvider,
          pollCount: transaction.polling?.pollCount,
          age: Date.now() - new Date(transaction.createdAt).getTime(),
        },
      );

      await this.alertAdminForStuckTransaction({
        reference: transaction.reference,
        transactionId,
        reason,
        provider: transaction.polling?.pollingProvider || "unknown",
        pollCount: transaction.polling?.pollCount || 0,
        transactionAge: Date.now() - new Date(transaction.createdAt).getTime(),
        transaction,
      });

      logger.info(
        `Transaction ${transaction.reference} marked for manual review. Potential refund required.`,
        {
          provider: transaction.polling?.pollingProvider,
          type: transaction.type,
          amount: transaction.amount,
          direction: transaction.direction,
        },
      );
    }
  }

  // HELPERS
  private getTransactionTypeLabel(type: string): string {
    const labels: { [key: string]: string } = {
      airtime: "Airtime",
      data: "Data",
      cable_tv: "Cable TV",
      electricity: "Electricity",
      betting: "Betting",
      education: "Education",
      internationalairtime: "International Airtime",
      internationaldata: "International Data",
      data_epin: "Data E-PIN",
    };

    return labels[type] || type;
  }

  private async alertAdminForStuckTransaction(data: {
    reference: string;
    transactionId: string;
    reason: "timeout" | "max_attempts";
    provider: string;
    pollCount: number;
    transactionAge: number;
    transaction: any;
  }): Promise<void> {
    const adminEmail =
      process.env.ADMIN_EMAIL ||
      `admin@${process.env.APP_NAME?.toLowerCase()}.com`;

    const ageInMinutes = Math.floor(data.transactionAge / 60000);
    const ageInHours = Math.floor(ageInMinutes / 60);

    const notificationData = {
      reference: data.reference,
      transactionId: data.transactionId,
      provider: data.provider,
      reason: data.reason,
      reasonLabel:
        data.reason === "timeout"
          ? "Transaction polling timeout reached"
          : "Maximum polling attempts exceeded",
      pollCount: data.pollCount,
      transactionAge: {
        minutes: ageInMinutes,
        hours: ageInHours,
        milliseconds: data.transactionAge,
      },
      status: data.transaction.status,
      type: data.transaction.type,
      amount: data.transaction.amount,
      direction: data.transaction.direction,
      createdAt: data.transaction.createdAt,
      severity: "critical",
      action: "MANUAL_REVIEW_AND_REFUND_REQUIRED",
      timestamp: new Date().toISOString(),
    };

    const message = `A transaction has been stuck in pending state and polling has stopped.

Provider: ${data.provider}
Reference: ${data.reference}
Reason: ${notificationData.reasonLabel}
Poll Attempts: ${data.pollCount}
Transaction Age: ${ageInHours}h ${ageInMinutes % 60}m
Amount: ₦${data.transaction.amount.toLocaleString()}
Status: ${data.transaction.status}

Manual review and potential refund required.`;

    try {
      await this.emailService.sendSystemNotificationToAdmin(
        adminEmail,
        `⚠️ CRITICAL: Stuck Transaction - ${data.reference}`,
        notificationData,
        message,
      );

      logger.info(
        `CRITICAL ALERT: Stuck Transaction - ${data.reference}`,
        notificationData,
      );
    } catch (err: any) {
      logger.error(
        `Failed to alert admin for stuck transaction: ${data.reference}`,
        err,
      );
    }
  }

  // MANUAL REQUERY — admin-triggered, on-demand check for transactions the
  // automatic poller already gave up on (timeout / max attempts).
  // Read-only against the provider — never resends the purchase, only asks
  // "what actually happened to this order" and updates our record from the answer.
  async manualRequeryTransaction(transactionId: string): Promise<{
    outcome: "success" | "failed" | "still_pending" | "escalated";
    message: string;
  }> {
    const transaction =
      await this.transactionRepository.findById(transactionId);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    if (transaction.status !== "pending") {
      throw new AppError(
        "Only pending transactions can be requeried",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const polling: any = transaction.polling || {};

    if (!polling.stoppedAt) {
      throw new AppError(
        "This transaction is still being polled automatically — no need to requery manually",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // Cooldown — block accidental double-clicks hitting the provider twice in a row
    if (
      polling.lastPolledAt &&
      Date.now() - new Date(polling.lastPolledAt).getTime() < 60 * 1000
    ) {
      throw new AppError(
        "Please wait a minute before requerying this transaction again",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const provider = polling.pollingProvider || "clubkonnect";
    const queryResult = await this.queryProviderStatus(
      provider,
      polling.providerOrderId,
      transaction,
    );

    await this.transactionRepository.update(transactionId, {
      $set: { "polling.lastPolledAt": new Date() },
    });

    if (!queryResult) {
      return this.handleInconclusiveManualRequery(
        transactionId,
        transaction,
        polling,
      );
    }

    const { statusCode, status } = this.parseProviderStatus(
      provider,
      queryResult,
    );

    if (this.isSuccessStatus(statusCode, status, provider)) {
      await this.handleSuccess(
        transactionId,
        transaction,
        queryResult,
        provider,
      );
      return {
        outcome: "success",
        message:
          "Provider confirms this transaction succeeded — it has been completed and credited.",
      };
    }

    if (this.isFailureStatus(statusCode, status, provider)) {
      await this.handleFailure(transactionId, transaction, queryResult);
      return {
        outcome: "failed",
        message:
          "Provider confirms this transaction failed — it has been marked failed and refunded.",
      };
    }

    return this.handleInconclusiveManualRequery(
      transactionId,
      transaction,
      polling,
    );
  }

  // First stale check after the original timeout → give it one more bounded
  // automatic polling window. Second stale check → stop looping, flag a human, email admin.
  private async handleInconclusiveManualRequery(
    transactionId: string,
    transaction: any,
    polling: any,
  ): Promise<{ outcome: "still_pending" | "escalated"; message: string }> {
    const manualRequeryCount = polling.manualRequeryCount || 0;

    if (manualRequeryCount >= 1) {
      await this.transactionRepository.update(transactionId, {
        $set: {
          "polling.manualRequeryCount": manualRequeryCount + 1,
          "polling.escalatedAt": new Date(),
        },
      });

      await this.notifyAdminsOfStuckTransaction(transaction);

      return {
        outcome: "escalated",
        message:
          "Provider still hasn't given a clear answer after a second check. This has been flagged for manual review and the admin team has been notified.",
      };
    }

    await this.transactionRepository.update(transactionId, {
      $set: {
        "polling.nextPollAt": new Date(),
        "polling.pollCount": 0,
        "polling.manualRequeryCount": manualRequeryCount + 1,
      },
      $unset: {
        "polling.stoppedAt": "",
        "polling.stopReason": "",
      },
    });

    return {
      outcome: "still_pending",
      message:
        "Provider hasn't confirmed a final status yet. This has been re-queued for one more automatic polling window.",
    };
  }

  private async notifyAdminsOfStuckTransaction(
    transaction: any,
  ): Promise<void> {
    try {
      await this.emailService.sendSystemNotificationToAdmin(
        process.env.SUPER_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "",
        `Stuck Transaction Needs Review - ${transaction.reference}`,
        {
          severity: "warning",
          transactionReference: transaction.reference,
          transactionId: transaction._id?.toString(),
          type: transaction.type,
          amount: transaction.amount,
          userId: transaction.userId?.toString(),
          provider: transaction.polling?.pollingProvider,
          providerOrderId: transaction.polling?.providerOrderId,
        },
        "This transaction has now failed to resolve twice — once via automatic polling, once via a manual requery. The provider still hasn't given a clear success/failure answer. It needs a human to check the provider dashboard directly rather than more automated retries.",
      );
    } catch (error) {
      logger.error(
        `Failed to send stuck-transaction admin notification for ${transaction.reference}`,
        error,
      );
    }
  }
}
