import logger from "@/logger";
import { AppError } from "@/middlewares/shared/errorHandler";
import { NowPaymentsService } from "@/services/client/providers/crypto/Nowpaymentsservice";
import {
  HTTP_STATUS,
  ERROR_CODES,
  TRANSACTION_TYPES,
  SYSTEM,
} from "@/utils/constants";
import {
  generateReference,
  validateAddressOrThrow,
  validateExtraIdOrThrow,
} from "@/utils/helpers";
import { Types } from "mongoose";

import { WalletService } from "@/services/client/wallet/WalletService";
import { CryptoBreakdownService } from "../../CryptoBreakdownService";
import { CryptoTransactionRepository } from "@/repositories/client/CryptoTransactionRepository";
import * as speakeasy from "speakeasy";
import { CryptoUtilityService } from "../../CryptoUtilityService";
import {
  SellCryptoAutomatedData,
  BuyCryptoAutomatedData,
} from "../../CryptoService";

const IS_NOWPAYMENTS_MOCK = process.env.ISNOWPAYMENTMOCK === "true";

export class NowPaymentCryptoTradeService {
  constructor(
    private nowPaymentsService: NowPaymentsService,
    private cryptoUtilityService: CryptoUtilityService,
    private walletService: WalletService,
    private cryptoBreakdownService: CryptoBreakdownService,
    private cryptoTransactionRepository: CryptoTransactionRepository,
  ) {}

  async sellCryptoWithNowPayments(data: SellCryptoAutomatedData): Promise<any> {
    const reference = generateReference();
    const userObjectId = new Types.ObjectId(data.userId);
    const cryptoObjectId = new Types.ObjectId(data.cryptoId);

    const wallet = await this.walletService.getWallet(data.userId);
    if (!wallet) {
      throw new AppError("Wallet not found", HTTP_STATUS.NOT_FOUND);
    }

    // Get crypto and validate it's enabled for sale
    const crypto = await this.cryptoUtilityService.getCryptoById(data.cryptoId);
    const network = await this.cryptoUtilityService.getNetwork(
      data.cryptoId,
      data.networkId,
    );

    if (!crypto) {
      throw new AppError("Crypto not found", HTTP_STATUS.NOT_FOUND);
    }

    if (!crypto.saleActivated) {
      throw new AppError(
        `${crypto.code} sales are currently disabled`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (!crypto.providerCode) {
      throw new AppError(
        "NP Provider code not found",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // FLEXIBLE: Use provided amount OR fallback to minimum
    const priceAmount = data.usdAmount || crypto.sellMinAmount || 10;

    // Optional: Validate if amount was provided
    if (data.usdAmount) {
      if (crypto.sellMinAmount && data.usdAmount < crypto.sellMinAmount) {
        throw new AppError(
          `Minimum sell amount is $${crypto.sellMinAmount}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      if (crypto.sellMaxAmount && data.usdAmount > crypto.sellMaxAmount) {
        throw new AppError(
          `Maximum sell amount is $${crypto.sellMaxAmount}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
    }

    const npCurrency = crypto.providerCode.toLowerCase();
    const ipnUrl = `${process.env.BASE_URL}/api/v1/webhooks/nowpayments`;

    try {
      const breakdown =
        await this.cryptoBreakdownService.calculateBreakdownAutomated({
          cryptoId: data.cryptoId,
          usdAmount: priceAmount,
          tradeType: "sell",
          networkId: data.networkId,
        });

      if (!breakdown) {
        throw new AppError("Breakdown not found", HTTP_STATUS.NOT_FOUND);
      }
      const chargeInfo = {
        baseAmount: breakdown.fiatAmount,
        serviceCharge: breakdown.serviceFee,
        chargeType: breakdown.serviceCharge?.type,
        chargeValue: breakdown.serviceCharge?.value,
        totalPayout: breakdown.totalAmount,
      };
      // Create payment with flexible amount
      const nowPaymentsPayment = await this.nowPaymentsService.createPayment({
        priceAmount, // Use provided amount or minimum
        priceCurrency: "usd",
        payCurrency: npCurrency,
        orderId: reference,
        ipnCallbackUrl: ipnUrl,
      });

      // Create transaction in pending state
      const cryptoTransaction = await this.cryptoTransactionRepository.create({
        cryptoId: cryptoObjectId,
        userId: userObjectId,
        reference,
        tradeType: "sell",
        network: {
          networkId: network.networkId,
          code: network.code,
          name: network.name,
          confirmationsRequired: network.confirmationsRequired,
          explorerUrl: network.explorerUrl || "",
        },
        walletAddress: nowPaymentsPayment.payAddress,
        cryptoAmount: priceAmount, // Will be filled when crypto arrives
        fiatAmount: breakdown.fiatAmount,
        exchangeRate: breakdown.exchangeRate,
        serviceFee: breakdown.serviceFee,
        totalAmount: breakdown.totalAmount,
        status: "pending_deposit",
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance,
        comment: data.comment,
        proof: "",
        isAutomated: true,
        channel: data.channel || "web",
        meta: {
          cryptoName: crypto.name,
          cryptoCode: crypto.code,
          network: network.name,
          automatedFlow: true,
          chargeInfo,
          processedBy: "nowpayments",
          flowType: "flexible_amount",
          requestedAmount: data.usdAmount,
          walletAddress: nowPaymentsPayment.payAddress,
          minimumAmount: crypto.sellMinAmount,
          nowPaymentsPayAmount: nowPaymentsPayment.payAmount,
          priceAmountUsd: priceAmount,
          nowPaymentsPaymentId: nowPaymentsPayment.paymentId,
          initiatedAt: new Date().toISOString(),
          expiresAt: nowPaymentsPayment.expirationEstimate,
        },
      });

      return {
        ...this.cryptoUtilityService.sanitizeCryptoTransaction(
          cryptoTransaction,
        ),
        depositInstructions: {
          address: nowPaymentsPayment.payAddress,
          network: network.name,
          networkCode: network.code,
          crypto: {
            code: crypto.code,
            name: crypto.name,
            icon: crypto.icon,
          },
          minAmount: crypto.sellMinAmount,
          maxAmount: crypto.sellMaxAmount,
          estimatedRate: crypto.currentPriceUSD,
          instructions: `Send ${crypto.code} to this address. Minimum: ${crypto.sellMinAmount} USD equivalent${crypto.sellMaxAmount ? ` | Maximum: ${crypto.sellMaxAmount}` : ""}. You can send any amount.`,
          expiresAt: nowPaymentsPayment.expirationEstimate,
        },
        status: "pending_deposit",
        message: data.usdAmount
          ? `Send at least $${data.usdAmount} worth of ${crypto.code}. You can send more and we'll calculate your payout based on what you send.`
          : `Send any amount of ${crypto.code} (minimum $${crypto.sellMinAmount} equivalent). We'll calculate your payout based on what you send.`,
      };
    } catch (err: any) {
      logger.error("Failed to initiate sell transaction", {
        reference,
        requestedAmount: data.usdAmount,
        fallbackAmount: crypto.sellMinAmount,
        error: err.message,
      });

      throw new AppError(
        `Failed to create sell transaction: ${err.message}`,
        HTTP_STATUS.BAD_GATEWAY,
      );
    }
  }

  // BUY CRYPTO AUTOMATED
  async buyCryptoWithNowPayments(data: BuyCryptoAutomatedData): Promise<any> {
    const reference = generateReference();
    const userObjectId = new Types.ObjectId(data.userId);
    const cryptoObjectId = new Types.ObjectId(data.cryptoId);

    const wallet = await this.walletService.getWallet(data.userId);
    if (!wallet) throw new AppError("Wallet not found", HTTP_STATUS.NOT_FOUND);

    // Get crypto and network with validation fields
    const crypto = await this.cryptoUtilityService.getCryptoById(data.cryptoId);
    const network = await this.cryptoUtilityService.getNetwork(
      data.cryptoId,
      data.networkId,
    );

    if (!crypto) {
      throw new AppError("Crypto not found", HTTP_STATUS.NOT_FOUND);
    }

    // Validate wallet address format
    validateAddressOrThrow(data.walletAddress, crypto);

    // Validate extra_id if required
    if (data.extraId) {
      validateExtraIdOrThrow(data.extraId, crypto);
    }

    // Validate minimum amount
    if (crypto.buyMinAmount && data.usdAmount < crypto.buyMinAmount) {
      throw new AppError(
        `Minimum buy amount is $${crypto.buyMinAmount}`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    //  Validate maximum amount
    if (crypto.buyMaxAmount && data.usdAmount > crypto.buyMaxAmount) {
      throw new AppError(
        `Maximum buy amount is $${crypto.buyMaxAmount}`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // Calculate breakdown
    const breakdown =
      await this.cryptoBreakdownService.calculateBreakdownAutomated({
        cryptoId: data.cryptoId,
        usdAmount: data.usdAmount,
        tradeType: "buy",
        networkId: data.networkId,
      });

    if (!breakdown) {
      throw new AppError(
        "Failed to calculate crypto breakdown",
        HTTP_STATUS.BAD_GATEWAY,
      );
    }
    const { crypto: breakdownCrypto, network: breakdownNetwork } = breakdown;
    const totalDeduction = breakdown.totalAmount;

    if (wallet.balance < totalDeduction) {
      throw new AppError(
        `Insufficient balance. Need ₦${totalDeduction.toLocaleString()}`,
        HTTP_STATUS.BAD_REQUEST,
      );
    }
    const chargeInfo = {
      baseAmount: breakdown.fiatAmount,
      serviceCharge: breakdown.serviceFee,
      chargeType: breakdown.serviceCharge?.type,
      chargeValue: breakdown.serviceCharge?.value,
      totalDeduction: breakdown.totalAmount,
    };
    // Debit wallet
    const debitResult = await this.walletService.debitWallet(
      data.userId,
      totalDeduction,
      `Crypto purchase`,
      {
        type: TRANSACTION_TYPES.CRYPTO,
        idempotencyKey: reference,
        provider: "nowpayments",
        initiatedBy: userObjectId,
        initiatedByType: "user",
        remark: `Crypto purchase: ${data.usdAmount} USD for ${breakdownCrypto.code}`,
        channel: data.channel || "web",
        meta: {
          tradeType: "Crypto Purchase",
          cryptoName: crypto.name,
          cryptoCode: crypto.code,
          network: network.name,
          walletAddress: data.walletAddress,
          ...(chargeInfo && { chargeInfo }),
        },
      },
    );

    const debitTransaction = debitResult.transaction;
    const npCurrency = breakdownCrypto.code.toLowerCase();
    const ipnUrl = `${process.env.BASE_URL}/api/v1/webhooks/nowpayments`;

    try {
      // Send both fiat_amount and let NP convert to crypto
      let nowPaymentsPayout = await this.nowPaymentsService.createPayout({
        ipnCallbackUrl: ipnUrl,
        withdrawals: [
          {
            address: data.walletAddress,
            currency: npCurrency,
            fiat_amount: data.usdAmount, // Just USD amount
            fiat_currency: "usd",
            ipn_callback_url: ipnUrl,
            ...(data.extraId && { extra_id: data.extraId }), // Include extra_id if provided
          },
        ],
      });

      if (!IS_NOWPAYMENTS_MOCK) {
        try {
          // TOTP generation with base32 encoding
          const otp = speakeasy.totp({
            secret: process.env.NOWPAYMENTS_TOTP_SECRET!,
            encoding: "base32",
            time: Math.floor(Date.now() / 1000),
          });

          await this.nowPaymentsService.verifyPayout(nowPaymentsPayout.id, otp);

          logger.info("NowPayments payout verified successfully", {
            reference,
            payoutId: nowPaymentsPayout.id,
          });
        } catch (verifyErr: any) {
          logger.error("NowPayments 2FA verification failed", {
            reference,
            error: verifyErr.message,
          });

          throw new Error(`2FA verification failed: ${verifyErr.message}`);
        }
      }
      // Get official crypto amount sent from response
      const officialCryptoSent = nowPaymentsPayout.withdrawals[0].amount;

      // Create transaction only after successful verification
      const cryptoTransaction = await this.cryptoTransactionRepository.create({
        cryptoId: cryptoObjectId,
        userId: userObjectId,
        reference,
        tradeType: "buy",
        network: {
          networkId: breakdownNetwork.networkId,
          code: breakdownNetwork.code,
          name: breakdownNetwork.name,
          confirmationsRequired: 0,
          explorerUrl:  "",
        },
        walletAddress: data.walletAddress,
        cryptoAmount: officialCryptoSent,
        fiatAmount: breakdown.fiatAmount,
        exchangeRate: breakdown.exchangeRate,
        serviceFee: breakdown.serviceFee,
        totalAmount: breakdown.totalAmount,
        status: "pending",
        channel: data.channel || "web",
        transactionId: debitTransaction.id.toString(),
        balanceBefore: debitResult.balanceBefore,
        balanceAfter: debitResult.balanceAfter,
        nowPaymentsPayoutId: nowPaymentsPayout.id,
        isAutomated: true,
        meta: {
          cryptoName: breakdownCrypto.name,
          cryptoCode: breakdownCrypto.code,
          network: breakdownNetwork.name,
          walletAddress: data.walletAddress,
          ...(data.extraId && { extraId: data.extraId }), // Store extra_id in meta
          serviceCharge: breakdown.serviceFee,
          totalDeduction,
          chargeInfo,
          nowPaymentsPayoutId: nowPaymentsPayout.id,
          automatedFlow: true,
          actualCryptoAmount: officialCryptoSent,
          usdAmount: data.usdAmount, // Clear naming: usdAmount not cryptoAmount
          cryptoAmount: data.usdAmount, // for convenience
          processedBy: "NowPayments",
          verifiedAt: new Date().toISOString(),
        },
      });

      return {
        ...this.cryptoUtilityService.sanitizeCryptoTransaction(
          cryptoTransaction,
        ),
        crypto: {
          name: breakdownCrypto.name,
          code: breakdownCrypto.code,
          icon: breakdownCrypto.icon,
        },
        breakdown: {
          cryptoAmount: officialCryptoSent,
          fiatAmount: breakdown.fiatAmount,
          exchangeRate: breakdown.exchangeRate,
          serviceCharge: breakdown.serviceFee,
          totalDeducted: totalDeduction,
        },
        purchaseDetails: {
          cryptoAmount: officialCryptoSent,
          usdAmount: data.usdAmount, // Clear naming
          pricePerUnit: data.usdAmount / officialCryptoSent,
        },
      };
    } catch (payoutErr: any) {
      logger.error("NowPayments payout creation/verification failed", {
        reference,
        error: payoutErr.message,
      });

      // Refund user since payout failed or couldn't be verified
      await this.walletService.creditWallet(
        data.userId,
        totalDeduction,
        `Refund`,
        {
          type: TRANSACTION_TYPES.REFUND,
          provider: SYSTEM.PROVIDER,
          idempotencyKey: `${reference}_refund`,
          initiatedBy: userObjectId,
          initiatedByType: "system",
          channel: data.channel || "web",
          linkedTransactionId: debitTransaction._id as Types.ObjectId,
          remark: `Crypto Refund: ₦${totalDeduction} for failed payout (Ref: ${reference})`,
          meta: {
            reason: "nowpayments_payout_failed",
            originalReference: reference,
            error: payoutErr.message,
          },
        },
      );

      throw new AppError(
        `Purchase failed: ${payoutErr.message}`,
        HTTP_STATUS.BAD_GATEWAY,
      );
    }
  }

  async getNowPaymentsPaymentStatus(this: any, paymentId: string) {
    const status = await this.nowPaymentsService.getPaymentStatus(paymentId);
    return {
      paymentId: status.paymentId,
      paymentStatus: status.paymentStatus,
      payAmount: status.payAmount,
      actuallyPaid: status.actuallyPaid,
      payCurrency: status.payCurrency,
      txHash: status.txHash,
      updatedAt: status.updatedAt,
    };
  }

  async getCryptoTransactionByNowPaymentsId(
    this: any,
    nowPaymentsPaymentId: string,
    userId?: string,
  ) {
    const transaction = await this.cryptoTransactionRepository.findOne({
      nowPaymentsPaymentId,
    });

    if (!transaction) return null;

    if (userId && transaction.userId.toString() !== userId) {
      return null;
    }

    return transaction;
  }
}
