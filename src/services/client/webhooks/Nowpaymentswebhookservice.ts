import { Types } from "mongoose";
import { CryptoTransactionRepository } from "@/repositories/client/CryptoTransactionRepository";
import { WalletService } from "@/services/client/wallet/WalletService";
import { NotificationService } from "@/services/client/notifications/NotificationService";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  TRANSACTION_TYPES,
  SYSTEM,
} from "@/utils/constants";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import { NowPaymentsWebhookData } from "./Nowpaymentswebhookprocessor";
import { ProviderRateConfigRepository } from "@/repositories/admin/Providerrateconfigrepository";
import { HelperService } from "@/services/client/utility/HelperService";

import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import SocketService from "@/services/core/SocketService";

const PAYMENT_STATUS_MAP: Record<string, string | null> = {
  waiting: null,
  confirming: null,
  confirmed: null,
  sending: null,
  partially_paid: "partially_paid_flag",
  finished: "transferred",
  failed: "failed",
  expired: "failed",
  refunded: "failed",
};

const PAYOUT_STATUS_MAP: Record<string, string | null> = {
  waiting: null,
  processing: null,
  sending: null,
  finished: "transferred",
  failed: "failed",
  rejected: "failed",
};

export class NowPaymentsWebhookService {
  private cryptoTransactionRepository: CryptoTransactionRepository;
  private walletService: WalletService;
  private notificationService: NotificationService;
  private cryptoRepository: CryptoRepository;
  private transactionRepository: TransactionRepository;
  private providerRateConfigRepository: ProviderRateConfigRepository;
  private helperService: HelperService;

  constructor() {
    this.cryptoTransactionRepository =
      ServiceContainer.getCryptoTransactionRepository();
    this.walletService = ServiceContainer.getWalletService();
    this.notificationService = ServiceContainer.getNotificationService();
    this.cryptoRepository = ServiceContainer.getCryptoRepository();
    this.transactionRepository = ServiceContainer.getTransactionRepository();
    this.providerRateConfigRepository =
      ServiceContainer.getProviderRateConfigRepository();
    this.helperService = ServiceContainer.getHelperService();
  }

  async processWebhook(data: NowPaymentsWebhookData): Promise<void> {
    logger.info("NowPayments webhook — processing", {
      eventType: data.eventType,
      nowPaymentsId: data.nowPaymentsId,
      reference: data.reference,
      status: data.status,
    });

    if (data.eventType === "payment") {
      await this.handlePaymentUpdate(data);
    } else {
      await this.handlePayoutUpdate(data);
    }
  }

  //SELL flow: payment received from user

  private async handlePaymentUpdate(
    data: NowPaymentsWebhookData,
  ): Promise<void> {
    const mappedStatus = PAYMENT_STATUS_MAP[data.status];

    // No-op statuses (waiting, confirming, confirmed, sending)
    if (mappedStatus === null) {
      logger.info("NowPayments payment IPN — intermediate status, no action", {
        nowPaymentsId: data.nowPaymentsId,
        status: data.status,
      });
      return;
    }

    // Find transaction by nowPaymentsPaymentId
    let transaction = await this.cryptoTransactionRepository.findOne({
      nowPaymentsPaymentId: data.nowPaymentsId,
      tradeType: "sell",
    });

    // Fallback: try matching by reference (order_id)
    if (!transaction && data.reference) {
      transaction = await this.cryptoTransactionRepository.findOne({
        reference: data.reference,
        tradeType: "sell",
      });
    }

    if (!transaction) {
      logger.error("NowPayments payment IPN — transaction not found", {
        nowPaymentsId: data.nowPaymentsId,
        reference: data.reference,
      });
      return;
    }

    // Also check for "pending_deposit" status
    if (
      [
        "transferred",
        "approved",
        "s.approved",
        "failed",
        "declined",
        "pending_deposit",
      ].includes(transaction.status)
    ) {
      logger.info(
        "NowPayments payment IPN — already in terminal/processing state, checking if needs update",
        {
          reference: transaction.reference,
          currentStatus: transaction.status,
        },
      );

      // Allow transitioning from pending_deposit to other states
      if (transaction.status === "pending_deposit" && mappedStatus !== null) {
        // Continue processing
      } else {
        return;
      }
    }

    // Handle different statuses
    if (mappedStatus === "partially_paid_flag") {
      await this.handlePartialPayment(transaction, data);
      return;
    }

    if (mappedStatus === "transferred") {
      await this.handleSellPaymentFinished(transaction, data);
      return;
    }

    if (mappedStatus === "failed") {
      await this.handlePaymentFailed(transaction, data);
      return;
    }
  }

  private async handleSellPaymentFinished(
    transaction: any,
    data: NowPaymentsWebhookData,
  ): Promise<void> {
    logger.info("NowPayments SELL payment finished — marking transferred", {
      reference: transaction.reference,
      txHash: data.txHash,
      actuallyPaid: data.actuallyPaid,
      payCurrency: data.payCurrency,
    });

    if (!data.actuallyPaid) {
      logger.error("NowPayments SELL payment: actuallyPaid is missing", {
        reference: transaction.reference,
        paymentId: data.nowPaymentsId,
      });
      throw new AppError(
        "Invalid payment data received",
        HTTP_STATUS.BAD_GATEWAY,
      );
    }

    // Get actual crypto received (already fee-deducted by NowPayments)
    const actualCryptoReceived = data.actuallyPaid;
    const depositFee = data.fee?.depositFee || 0;
    const cryptoCode =
      transaction.meta?.cryptoCode || data.payCurrency?.toUpperCase();

    // Get stored metadata for price calculation
    const nowPaymentsPayAmount = transaction.meta?.nowPaymentsPayAmount;
    const priceAmount = transaction.meta?.priceAmountUsd;
    const priceAmountUsd = parseFloat(priceAmount);

    if (!nowPaymentsPayAmount || !priceAmountUsd) {
      logger.error(
        "NowPayments SELL payment — missing metadata for price calculation",
        {
          reference: transaction.reference,
          nowPaymentsPayAmount,
          priceAmountUsd,
        },
      );
      throw new AppError(
        "Missing payment metadata for calculation",
        HTTP_STATUS.BAD_GATEWAY,
      );
    }

    // Calculate implied USD price from requested amount and payAmount
    const impliedUsdPrice = priceAmountUsd / nowPaymentsPayAmount;

    // Calculate USD value of what user actually sent (after NowPayments deposit fee)
    const usdValue = actualCryptoReceived * impliedUsdPrice;

    logger.info("NowPayments SELL — price calculation", {
      reference: transaction.reference,
      priceAmountUsd,
      nowPaymentsPayAmount,
      impliedUsdPrice,
      actualCryptoReceived,
      usdValue,
      depositFee,
    });

    // Get current USD to NGN exchange rate
    let usdToNgnRate: number | null = null;
    let rateSource: string = "unknown";
    //  Try crypto.sellRate first
    try {
      const crypto = await this.cryptoRepository.findById(
        transaction.cryptoId.toString(),
      );

      if (crypto?.sellRate) {
        usdToNgnRate = crypto.sellRate;
        rateSource = "crypto.sellRate";
        logger.info("NowPayments SELL — using crypto rate", {
          reference: transaction.reference,
          cryptoId: transaction.cryptoId,
          rate: usdToNgnRate,
        });
      }
    } catch (cryptoErr: any) {
      logger.warn("NowPayments SELL — failed to fetch crypto for rate", {
        reference: transaction.reference,
        cryptoId: transaction.cryptoId,
        error: cryptoErr.message,
      });
    }
    //  Fallback to provider config
    if (!usdToNgnRate) {
      const rateConfig =
        await this.providerRateConfigRepository?.findByProviderCode(
          "nowpayment",
        );
      if (rateConfig?.sellRate) {
        usdToNgnRate = rateConfig.sellRate;
        rateSource = "providerRateConfig.sellRate";
        logger.info("NowPayments SELL — using provider config rate", {
          reference: transaction.reference,
          rate: usdToNgnRate,
        });
      }
    }

    if (!usdToNgnRate) {
      logger.error("NowPayments SELL — CRITICAL: No exchange rate found", {
        reference: transaction.reference,
        cryptoId: transaction.cryptoId,
        userId: transaction.userId,
      });

      // Mark transaction as pending
      await this.cryptoTransactionRepository.update(transaction.id.toString(), {
        status: "pending",
        errorMessage: "Rate configuration missing - awaiting admin action",
        meta: {
          ...transaction.meta,
          providerResponse: data,
          rateResolutionFailed: true,
          failedAt: new Date().toISOString(),
        },
      });

      // Alert admin CRITICAL
      await this.notificationService
        .createNotification({
          type: "admin_critical_no_rate_config",
          notifiableType: "Admin",
          notifiableId: transaction.userId,
          data: {
            reference: transaction.reference,
            cryptoCode: transaction.meta?.cryptoCode,
            cryptoId: transaction.cryptoId,
            actualCryptoReceived,
            usdValue,
            message: `CRITICAL: Cannot credit wallet. No exchange rate (crypto or provider config). Manual review required.`,
          },
          sendEmail: true,
          sendSMS: true,
          sendPush: true,
        })
        .catch((err) =>
          logger.error("NowPayments: failed to send critical rate alert", err),
        );

      // Stop processing - do NOT credit wallet
      return;
    }

    // Calculate service charge on the USD value converted to NGN
    const chargeCalculation =
      await this.helperService?.calculateAmountWithCharge(
        usdValue * usdToNgnRate,
        TRANSACTION_TYPES.CRYPTO_SALE,
      );

    const serviceFeeNGN = chargeCalculation?.chargeAmount || 0;
    const totalNgnPayout = usdValue * usdToNgnRate - serviceFeeNGN;

    logger.info("NowPayments SELL — payout calculation", {
      reference: transaction.reference,
      usdValue,
      usdToNgnRate,
      ngnBeforeCharge: usdValue * usdToNgnRate,
      serviceFeeNGN,
      totalNgnPayout,
    });

    // Credit user's wallet with calculated NGN amount
    try {
      await this.walletService.creditWallet(
        transaction.userId.toString(),
        totalNgnPayout,
        `Crypto sale`,
        {
          type: TRANSACTION_TYPES.CRYPTO,
          provider: "NowPayments",
          idempotencyKey: `SELL-${transaction.reference}`,
          initiatedByType: "system",
          linkedTransactionId: transaction._id as Types.ObjectId,
          remark: `Crypto sale: ${actualCryptoReceived} ${cryptoCode}`,
          meta: {
            tradeType: "Crypto Sale",
            cryptoCode,
            actualCryptoReceived,
            depositFeeCharged: depositFee,
            depositFeeCurrency: data.payCurrency,
            usdValue,
            exchangeRate: usdToNgnRate,
            serviceCharge: serviceFeeNGN,
            actualPayout: totalNgnPayout,
            cryptoAmount: actualCryptoReceived,
            providerResponse: data,
            nowPaymentsPaymentId: data.nowPaymentsId,
            chargeInfo: {
              baseAmount: transaction.meta?.chargeInfo?.baseAmount || 0,
              serviceCharge: transaction.meta?.chargeInfo?.serviceCharge || 0,
              chargeType: transaction.meta?.chargeInfo?.chargeType || null,
              chargeValue: transaction.meta?.chargeInfo?.chargeValue || null,
              creditedAmount: totalNgnPayout,
            },
          },
        },
      );

      logger.info("SELL: User wallet credited successfully", {
        reference: transaction.reference,
        amount: totalNgnPayout,
        ngnPayout: totalNgnPayout,
      });
    } catch (creditErr: any) {
      logger.error("SELL: Failed to credit user wallet", {
        reference: transaction.reference,
        error: creditErr.message,
      });
      // Mark for manual intervention
      await this.cryptoTransactionRepository.update(transaction.id.toString(), {
        status: "failed",
        errorMessage: "Credit wallet failed - manual intervention required",
      });
      throw creditErr;
    }

    // Update transaction with actual amounts
    await this.cryptoTransactionRepository.update(transaction.id.toString(), {
      status: "transferred",
      cryptoAmount: actualCryptoReceived,
      fiatAmount: totalNgnPayout,
      totalAmount: totalNgnPayout,
      exchangeRate: usdToNgnRate,
      serviceFee: serviceFeeNGN,
      txHash: data.txHash,
      processedAt: new Date(),
      meta: {
        ...transaction.meta,
        providerResponse: data,
        actualCryptoReceived,
        chargeInfo: {
          ...transaction.meta?.chargeInfo,
          baseAmount: usdValue * usdToNgnRate,
          serviceCharge: serviceFeeNGN,
          totalPayout: totalNgnPayout,
        },

        nowPaymentsDepositFee: depositFee,
        nowPaymentsDepositFeeCurrency: data.payCurrency,
        nowPaymentsFeeStructure: data.fee,
        nowPaymentsPaymentId: data.nowPaymentsId,
        actuallyPaid: actualCryptoReceived,
        impliedUsdPrice,
        automatedFlow: true,
        automatedFinishedAt: new Date().toISOString(),
        usdValue,
        finalNgnPayout: totalNgnPayout,
        flowType: "flexible_amount",
      },
    });

    this.cryptoTransactionRepository.findById(transaction.id.toString())
      .then(updatedTransaction => {
        if (updatedTransaction) {
          SocketService.emitTransactionUpdate(transaction.reference, { status: "success", transaction: updatedTransaction });
        }
      })
      .catch(err => logger.error("Socket emit error", err));

    logger.info("NowPayments SELL payment — transaction updated", {
      reference: transaction.reference,
      status: "transferred",
      cryptoAmount: actualCryptoReceived,
      fiatAmount: totalNgnPayout,
      serviceFee: serviceFeeNGN,
    });

    // Notify admin — transaction complete, user already credited
    await this.notificationService
      .createNotification({
        type: "admin_crypto_sell_transferred",
        notifiableType: "Admin",
        notifiableId: transaction.userId,
        data: {
          reference: transaction.reference,
          cryptoCode,
          cryptoAmount: actualCryptoReceived,
          network: transaction.network?.name,
          txHash: data.txHash,
          depositFeeCharged: depositFee,
          depositFeeCurrency: data.payCurrency,
          usdValue,
          ngnPayout: totalNgnPayout,
          serviceFeeApplied: serviceFeeNGN,
          automatedFlow: true,
          flexibleAmount: true,
        },
        sendEmail: true,
        sendSMS: false,
        sendPush: false,
      })
      .catch((err) =>
        logger.error(
          "NowPayments: failed to send admin sell notification",
          err,
        ),
      );

    // Notify user — crypto received and NGN credited
    await this.notificationService
      .createNotification({
        type: "transaction_success",
        notifiableType: "User",
        notifiableId: transaction.userId,
        data: {
          transactionType: "Crypto Sale",
          reference: transaction.reference,
          cryptoCode,
          cryptoAmount: actualCryptoReceived,
          depositFeeCharged: depositFee,
          depositFeeCurrency: data.payCurrency,
          ngnAmount: totalNgnPayout,
          status: "transferred",
          message: `Your ${actualCryptoReceived} ${cryptoCode} has been received. NowPayments charged ${depositFee} ${data.payCurrency} as network fee. ₦${totalNgnPayout.toLocaleString()} credited to your wallet.`,
        },
        sendEmail: true,
        sendSMS: false,
        sendPush: true,
      })
      .catch((err) =>
        logger.error("NowPayments: failed to send user sell notification", err),
      );

    this.helperService
      ?.updateLeaderboardAsync(
        transaction.userId.toString(),
        transaction.id,
        TRANSACTION_TYPES.CRYPTO,
        totalNgnPayout,
        usdValue,
      )
      .catch((err) =>
        logger.error("NowPayments: leaderboard update failed (sell)", err),
      );
  }

  private async handleBuyPayoutFinished(
    transaction: any,
    data: NowPaymentsWebhookData,
  ): Promise<void> {
    logger.info("NowPayments BUY payout finished — marking transferred", {
      reference: transaction.reference,
      txHash: data.txHash,
      address: data.payoutAddress,
    });

    await this.cryptoTransactionRepository.update(transaction.id.toString(), {
      status: "transferred",
      txHash: data.txHash,
      processedAt: new Date(),
      completedAt: new Date(),
      meta: {
        ...transaction.meta,
        nowPaymentsPayoutId: data.nowPaymentsId,
        automatedFlow: true,
        providerResponse: data,
        automatedFinishedAt: new Date().toISOString(),
        payoutVerifiedAt: new Date().toISOString(), // Add this timestamp
      },
    });

    this.cryptoTransactionRepository.findById(transaction.id.toString())
      .then(updatedTransaction => {
        if (updatedTransaction) {
          SocketService.emitTransactionUpdate(transaction.reference, { status: "success", transaction: updatedTransaction });
        }
      })
      .catch(err => logger.error("Socket emit error", err));

    // Notify user
    await this.notificationService
      .createNotification({
        type: "transaction_success",
        notifiableType: "User",
        notifiableId: transaction.userId,
        data: {
          transactionType: "Crypto Purchase",
          reference: transaction.reference,
          cryptoCode: transaction.meta?.cryptoCode,
          cryptoAmount: transaction.cryptoAmount,
          walletAddress: transaction.walletAddress,
          txHash: data.txHash,
          status: "transferred",
          message: "Your crypto has been sent to your wallet!",
        },
        sendEmail: true,
        sendSMS: false,
        sendPush: true,
      })
      .catch((err) =>
        logger.error("NowPayments: failed to send user buy notification", err),
      );

    // Notify admin for record keeping
    await this.notificationService
      .createNotification({
        type: "admin_crypto_buy_completed",
        notifiableType: "Admin",
        notifiableId: transaction.userId,
        data: {
          reference: transaction.reference,
          cryptoCode: transaction.meta?.cryptoCode,
          cryptoAmount: transaction.cryptoAmount,
          walletAddress: transaction.walletAddress,
          txHash: data.txHash,
          automatedFlow: true,
        },
        sendEmail: false,
        sendSMS: false,
        sendPush: false,
      })
      .catch((err) =>
        logger.error("NowPayments: failed to send admin buy notification", err),
      );

    // LEADERBOARD (fire and forget) — webhook is idempotency-guarded
    // upstream (terminal-status check), so this fires exactly once.
    this.helperService
      .updateLeaderboardAsync(
        transaction.userId.toString(),
        transaction.id,
        TRANSACTION_TYPES.CRYPTO,
        transaction.totalAmount,
        transaction.cryptoAmount,
      )
      .catch((err) =>
        logger.error("NowPayments: leaderboard update failed (buy)", err),
      );
  }

  //BUY flow: payout sent to user

  private async handlePayoutUpdate(
    data: NowPaymentsWebhookData,
  ): Promise<void> {
    const mappedStatus = PAYOUT_STATUS_MAP[data.status];

    if (mappedStatus === null) {
      logger.info("NowPayments payout IPN — intermediate status, no action", {
        nowPaymentsId: data.nowPaymentsId,
        status: data.status,
      });
      return;
    }

    // Find transaction by nowPaymentsPayoutId stored at buy-initiation time
    const transaction = await this.cryptoTransactionRepository.findOne({
      nowPaymentsPayoutId: data.nowPaymentsId,
      tradeType: "buy",
    });

    if (!transaction) {
      logger.error("NowPayments payout IPN — transaction not found", {
        nowPaymentsId: data.nowPaymentsId,
      });
      return;
    }

    // Idempotency guard
    if (
      ["transferred", "approved", "s.approved", "failed", "declined"].includes(
        transaction.status,
      )
    ) {
      logger.info(
        "NowPayments payout IPN — already in terminal state, skipping",
        {
          reference: transaction.reference,
          currentStatus: transaction.status,
        },
      );
      return;
    }

    if (mappedStatus === "transferred") {
      await this.handleBuyPayoutFinished(transaction, data);
    } else if (mappedStatus === "failed") {
      await this.handlePayoutFailed(transaction, data);
    }
  }

  //Partial payment: user sent less than required
  private async handlePartialPayment(
    transaction: any,
    data: NowPaymentsWebhookData,
  ): Promise<void> {
    logger.warn("NowPayments SELL — partial payment detected", {
      reference: transaction.reference,
      paymentId: data.nowPaymentsId,
      actuallyPaid: data.actuallyPaid,
      payCurrency: data.payCurrency,
    });
    if (!data.actuallyPaid) {
      logger.error("NowPayments SELL payment: actuallyPaid is missing", {
        reference: transaction.reference,
        paymentId: data.nowPaymentsId,
      });
      throw new AppError(
        "Invalid payment data received",
        HTTP_STATUS.BAD_GATEWAY,
      );
    }
    const actualCryptoReceived = data.actuallyPaid;
    const nowPaymentsPayAmount = transaction.meta?.nowPaymentsPayAmount;
    const priceAmount = transaction.meta?.priceAmountUsd;
    const priceAmountUsd = parseFloat(priceAmount);
    const totalFeeNGN = transaction.meta?.chargeInfo?.serviceCharge;
    const feePerUsd = totalFeeNGN / priceAmountUsd;
    const cryptoCode =
      transaction.meta?.cryptoCode || data.payCurrency?.toUpperCase();

    if (!nowPaymentsPayAmount || !priceAmountUsd) {
      logger.error(
        "NowPayments SELL partial — missing metadata for calculation",
        {
          reference: transaction.reference,
          nowPaymentsPayAmount,
          priceAmountUsd,
        },
      );
      throw new AppError("Missing payment metadata", HTTP_STATUS.BAD_GATEWAY);
    }

    // Calculate implied USD price
    const impliedUsdPrice = priceAmountUsd / nowPaymentsPayAmount;
    const actualUsdValue = actualCryptoReceived * impliedUsdPrice;

    // Get exchange rate
    let usdToNgnRate: number | null = null;
    let rateSource: string = "unknown";

    // Get previous payments if any
    const previousPayments = transaction.meta?.cumulativePayments || [];
    const hasPreviousPayment = previousPayments.length > 0;

    try {
      const crypto = await this.cryptoRepository.findById(
        transaction.cryptoId.toString(),
      );
      //  Try crypto.sellRate first
      if (crypto?.sellRate) {
        usdToNgnRate = crypto.sellRate;
        rateSource = "crypto.sellRate";
        logger.info("NowPayments SELL (partial) — using crypto rate", {
          reference: transaction.reference,
          rate: usdToNgnRate,
        });
      }
    } catch (cryptoErr: any) {
      logger.warn(
        "NowPayments SELL (partial) — failed to fetch crypto for rate",
        {
          reference: transaction.reference,
          error: cryptoErr.message,
        },
      );
    }

    // Fallback to provider config
    if (!usdToNgnRate) {
      const rateConfig =
        await this.providerRateConfigRepository?.findByProviderCode(
          "nowpayment",
        );
      if (rateConfig?.sellRate) {
        usdToNgnRate = rateConfig.sellRate;
        rateSource = "providerRateConfig.sellRate";
        logger.info("NowPayments SELL (partial) — using provider config rate", {
          reference: transaction.reference,
          rate: usdToNgnRate,
        });
      }
    }

    // CRITICAL ERROR - No rate found
    if (!usdToNgnRate) {
      logger.error(
        "NowPayments SELL (partial) — CRITICAL: No exchange rate found",
        {
          reference: transaction.reference,
          userId: transaction.userId,
        },
      );

      // Mark transaction as pending
      await this.cryptoTransactionRepository.update(transaction.id.toString(), {
        status: "pending",
        errorMessage: "Rate configuration missing - awaiting admin action",
        meta: {
          ...transaction.meta,
          providerResponse: data,
          rateResolutionFailed: true,
          failedAt: new Date().toISOString(),
        },
      });

      // Alert admin CRITICAL
      await this.notificationService
        .createNotification({
          type: "admin_critical_no_rate_config",
          notifiableType: "Admin",
          notifiableId: transaction.userId,
          data: {
            reference: transaction.reference,
            cryptoCode,
            paymentNumber: previousPayments.length + 1,
            actualCryptoReceived,
            message: `CRITICAL: Partial payment received but cannot credit wallet. No exchange rate. Manual review required.`,
          },
          sendEmail: true,
          sendSMS: true,
          sendPush: true,
        })
        .catch((err) =>
          logger.error(
            "NowPayments: failed to send critical rate alert (partial)",
            err,
          ),
        );

      // Stop processing
      return;
    }

    // Calculate cumulative totals
    const cumulativeCrypto =
      previousPayments.reduce(
        (sum: number, p: any) => sum + p.cryptoAmount,
        0,
      ) + actualCryptoReceived;
    const cumulativeUsd =
      previousPayments.reduce((sum: number, p: any) => sum + p.usdValue, 0) +
      actualUsdValue;

    // Determine if this completes the payment
    const isComplete = cumulativeUsd >= priceAmountUsd;

    // Only charge service fee if payment is complete
    let thisPaymentNgnBeforeFee = actualUsdValue * usdToNgnRate;

    const feeForThisPayment = actualUsdValue * feePerUsd;
    const thisPaymentNgn = actualUsdValue * usdToNgnRate - feeForThisPayment;
    const cumulativeNgn =
      previousPayments.reduce((sum: number, p: any) => sum + p.ngnPayout, 0) +
      thisPaymentNgn;

    // Get deposit fee from NowPayments response
    const depositFee = data.fee?.depositFee || 0;

    // Credit THIS partial payment to user wallet
    await this.walletService.creditWallet(
      transaction.userId.toString(),
      thisPaymentNgn,
      `Crypto sale (partial)`,
      {
        type: TRANSACTION_TYPES.CRYPTO,
        provider: "NowPayments",
        idempotencyKey: `SELL-${transaction.reference}-${data.nowPaymentsId}`,
        initiatedByType: "system",
        linkedTransactionId: transaction._id as Types.ObjectId,
        remark: `Partial payment #${previousPayments.length + 1}: ${actualCryptoReceived} ${cryptoCode}`,
        meta: {
          tradeType: "Crypto Sale",
          cryptoCode,
          paymentNumber: previousPayments.length + 1,
          isPartialPayment: true,
          providerResponse: data,
          isComplete,
        },
      },
    );

    logger.info("SELL: User wallet credited for partial payment", {
      reference: transaction.reference,
      paymentNumber: previousPayments.length + 1,
      amount: thisPaymentNgn,
      cumulativeNgn,
    });

    // Update transaction with cumulative data
    await this.cryptoTransactionRepository.update(transaction.id.toString(), {
      status: "transferred",
      cryptoAmount: cumulativeCrypto,
      fiatAmount: cumulativeNgn,
      totalAmount: cumulativeNgn,
      exchangeRate: usdToNgnRate,
      serviceFee: feeForThisPayment,
      txHash: data.txHash,
      processedAt: new Date(),
      meta: {
        ...transaction.meta,
        isPartialPayment: true,
        paymentCount: hasPreviousPayment ? previousPayments.length + 1 : 1,
        cumulativePayments: [
          ...previousPayments,
          {
            paymentIndex: previousPayments.length + 1,
            cryptoAmount: actualCryptoReceived,
            usdValue: actualUsdValue,
            ngnPayoutBeforeFee: thisPaymentNgnBeforeFee,
            feeDeducted: feeForThisPayment,
            ngnPayout: thisPaymentNgn,
            receivedAt: new Date().toISOString(),
            nowPaymentsWebhookId: data.nowPaymentsId,
            txHash: data.txHash || null,
            depositFee,
            depositFeeCurrency: data.payCurrency,
          },
        ],
        cumulativeCrypto,
        cumulativeUsd,
        cumulativeNgn,
        expectedUsd: priceAmountUsd,
        shortfall: Math.max(0, priceAmountUsd - cumulativeUsd),
        shortfallNgn:
          Math.max(0, priceAmountUsd - cumulativeUsd) * usdToNgnRate,
        allPaymentsReceived: isComplete,
        totalDepositFeeCharged:
          previousPayments.reduce(
            (sum: number, p: any) => sum + (p.depositFee || 0),
            0,
          ) + depositFee,
        totalDepositFeeChargeCurrency: data.payCurrency,
        nowPaymentsPaymentId: data.nowPaymentsId,
        actuallyPaid: cumulativeCrypto,
        automatedFlow: true,
        automatedPartialUpdatedAt: new Date().toISOString(),
        flowType: "flexible_amount",
        serviceFeeApplied: isComplete,
      },
    });

    this.cryptoTransactionRepository.findById(transaction.id.toString())
      .then(updatedTransaction => {
        if (updatedTransaction) {
          SocketService.emitTransactionUpdate(transaction.reference, { status: "success", transaction: updatedTransaction });
        }
      })
      .catch(err => logger.error("Socket emit error", err));

    logger.info("NowPayments SELL partial payment — transaction updated", {
      reference: transaction.reference,
      paymentNumber: previousPayments.length + 1,
      thisPaymentUsd: actualUsdValue,
      cumulativeUsd,
      expectedUsd: priceAmountUsd,
      isComplete,
      totalNgnPayout: cumulativeNgn,
    });

    // Notify user about THIS payment
    await this.notificationService
      .createNotification({
        type: hasPreviousPayment
          ? "transaction_partial_update"
          : "transaction_partial_success",
        notifiableType: "User",
        notifiableId: transaction.userId,
        data: {
          transactionType: "Crypto Sale",
          reference: transaction.reference,
          paymentNumber: previousPayments.length + 1,
          thisPaymentCrypto: actualCryptoReceived,
          thisPaymentUsd: actualUsdValue,
          thisPaymentNgn: thisPaymentNgn,
          depositFeeCharged: depositFee,
          depositFeeCurrency: data.payCurrency,
          cumulativeCrypto,
          cumulativeUsd,
          cumulativeNgn,
          expectedUsd: priceAmountUsd,
          shortfall: Math.max(0, priceAmountUsd - cumulativeUsd),
          isComplete,
          message: hasPreviousPayment
            ? isComplete
              ? `Additional payment received (#${previousPayments.length + 1}): ${actualCryptoReceived} ${cryptoCode}. Total completed: ${cumulativeCrypto} ${cryptoCode}. ₦${cumulativeNgn.toLocaleString()} credited (including service charge).`
              : `Additional payment received (#${previousPayments.length + 1}): ${actualCryptoReceived} ${cryptoCode}. Total received: ${cumulativeCrypto} ${cryptoCode}. ₦${cumulativeNgn.toLocaleString()} credited. Send remaining $${(priceAmountUsd - cumulativeUsd).toFixed(2)}.`
            : isComplete
              ? `Partial payment received: ${actualCryptoReceived} ${cryptoCode} (expected $${priceAmountUsd}). ₦${cumulativeNgn.toLocaleString()} credited to wallet.`
              : `Partial payment received: ${actualCryptoReceived} ${cryptoCode}. ₦${thisPaymentNgn.toLocaleString()} credited. Send remaining $${(priceAmountUsd - actualUsdValue).toFixed(2)}.`,
        },
        sendEmail: true,
        sendSMS: hasPreviousPayment, // SMS on follow-ups
        sendPush: true,
      })
      .catch((err) =>
        logger.error(
          "NowPayments: failed to send user partial payment notification",
          err,
        ),
      );

    // Admin notification
    await this.notificationService
      .createNotification({
        type: "admin_crypto_sell_partial",
        notifiableType: "Admin",
        notifiableId: transaction.userId,
        data: {
          reference: transaction.reference,
          cryptoCode,
          paymentNumber: previousPayments.length + 1,
          thisPaymentUsd: actualUsdValue,
          thisPaymentCrypto: actualCryptoReceived,
          depositFeeCharged: depositFee,
          cumulativeUsd,
          cumulativeCrypto,
          expectedUsd: priceAmountUsd,
          shortfall: Math.max(0, priceAmountUsd - cumulativeUsd),
          allReceived: isComplete,
          message: isComplete
            ? `Partial payment #${previousPayments.length + 1} completed the transaction`
            : `Partial payment #${previousPayments.length + 1} — shortfall: $${(priceAmountUsd - cumulativeUsd).toFixed(2)}`,
        },
        sendEmail: false,
        sendSMS: false,
        sendPush: false,
      })
      .catch((err) =>
        logger.error(
          "NowPayments: partial payment admin notification failed",
          err,
        ),
      );
  }

  //Payment failed / expired

  private async handlePaymentFailed(
    transaction: any,
    data: NowPaymentsWebhookData,
  ): Promise<void> {
    logger.warn("NowPayments payment failed/expired", {
      reference: transaction.reference,
      nowPaymentsId: data.nowPaymentsId,
      status: data.status,
    });

    await this.cryptoTransactionRepository.update(transaction.id.toString(), {
      status: "failed",
      errorMessage: `NowPayments payment ${data.status}`,
      meta: {
        ...transaction.meta,
        providerResponse: data,
        nowPaymentsStatus: data.status,
        failedAt: new Date().toISOString(),
      },
    });

    this.cryptoTransactionRepository.findById(transaction.id.toString())
      .then(updatedTransaction => {
        if (updatedTransaction) {
          SocketService.emitTransactionUpdate(transaction.reference, { status: "failed", transaction: updatedTransaction });
        }
      })
      .catch(err => logger.error("Socket emit error", err));

    await this.notificationService
      .createNotification({
        type: "transaction_failed",
        notifiableType: "User",
        notifiableId: transaction.userId,
        data: {
          transactionType: "Crypto Sale",
          reference: transaction.reference,
          reason: `Payment ${data.status}`,
          message: "Your crypto sale could not be completed. Please try again.",
        },
        sendEmail: true,
        sendSMS: false,
        sendPush: true,
      })
      .catch((err) =>
        logger.error("NowPayments: failed payment notification failed", err),
      );
  }

  //Payout failed

  private async handlePayoutFailed(
    transaction: any,
    data: NowPaymentsWebhookData,
  ): Promise<void> {
    logger.error("NowPayments payout failed — refunding user wallet", {
      reference: transaction.reference,
      nowPaymentsId: data.nowPaymentsId,
      status: data.status,
      error: data.errorMessage,
    });

    // Refund user's fiat wallet since the crypto was never sent
    try {
      await this.walletService.creditWallet(
        transaction.userId.toString(),
        transaction.totalAmount,
        `Crypto purchase`,
        {
          type: TRANSACTION_TYPES.CRYPTO,
          provider: SYSTEM.PROVIDER,
          idempotencyKey: `REFUND-${transaction.reference}`,
          initiatedBy: transaction.userId,
          initiatedByType: "system",
          remark: `Refund: failed crypto purchase ${transaction.reference}`,
          meta: {
            reason: "nowpayments_payout_failed",
            providerResponse: data,
            originalRef: transaction.reference,
            nowPaymentsId: data.nowPaymentsId,
            nowPaymentsErr: data.errorMessage,
          },
        },
      );

      await this.cryptoTransactionRepository.update(transaction.id.toString(), {
        status: "failed",
        errorMessage: `Payout ${data.status}: ${data.errorMessage || ""}`,
        meta: {
          ...transaction.meta,
          providerResponse: data,
          nowPaymentsStatus: data.status,
          nowPaymentsError: data.errorMessage,
          refundedAt: new Date().toISOString(),
          automatedRefund: true,
        },
      });

      this.cryptoTransactionRepository.findById(transaction.id.toString())
        .then(updatedTransaction => {
          if (updatedTransaction) {
            SocketService.emitTransactionUpdate(transaction.reference, { status: "failed", transaction: updatedTransaction });
          }
        })
        .catch(err => logger.error("Socket emit error", err));

      // Notify user of refund
      await this.notificationService
        .createNotification({
          type: "transaction_refunded",
          notifiableType: "User",
          notifiableId: transaction.userId,
          data: {
            transactionType: "Crypto Purchase",
            reference: transaction.reference,
            amount: transaction.totalAmount,
            message:
              "Your crypto purchase failed. Your funds have been refunded to your wallet.",
          },
          sendEmail: true,
          sendSMS: false,
          sendPush: true,
        })
        .catch((err) =>
          logger.error("NowPayments: payout failed notification failed", err),
        );
    } catch (refundErr) {
      logger.error("NowPayments: CRITICAL — payout failed AND refund failed", {
        reference: transaction.reference,
        userId: transaction.userId.toString(),
        amount: transaction.totalAmount,
        error: refundErr,
      });
      // Mark for manual admin attention
      await this.cryptoTransactionRepository.update(transaction.id.toString(), {
        status: "failed",
        errorMessage: `Payout failed + refund failed. MANUAL ACTION REQUIRED.`,
      });
    }

    // Always alert admin when a payout fails
    await this.notificationService
      .createNotification({
        type: "admin_crypto_payout_failed",
        notifiableType: "Admin",
        notifiableId: transaction.userId,
        data: {
          reference: transaction.reference,
          cryptoCode: transaction.meta?.cryptoCode,
          amount: transaction.cryptoAmount,
          walletAddress: transaction.walletAddress,
          nowPaymentsId: data.nowPaymentsId,
          error: data.errorMessage,
          status: data.status,
        },
        sendEmail: true,
        sendSMS: false,
        sendPush: false,
      })
      .catch((err) =>
        logger.error(
          "NowPayments: admin payout failed notification failed",
          err,
        ),
      );
  }
}
