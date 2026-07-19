import logger from "@/logger";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  TRANSACTION_TYPES,
  SYSTEM,
} from "@/utils/constants";
import { generateReference } from "@/utils/helpers";
import { Types } from "mongoose";
import { NotificationService } from "../../notifications/NotificationService";
import { TradeBonusProcessorService } from "../../utility/TradeBonusProcessorService";
import { WalletService } from "../../wallet/WalletService";
import { CryptoBreakdownService } from "../CryptoBreakdownService";
import { CryptoTransactionRepository } from "@/repositories/client/CryptoTransactionRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { HelperService } from "../../utility/HelperService";
import { BankAccountRepository } from "@/repositories/client/BankAccountRepository";
import { BuyCryptoData, SellCryptoData } from "../CryptoService";
import { CryptoUtilityService } from "../CryptoUtilityService";

export class CryptoManualTradeService {
  constructor(
    private cryptoUtilityService: CryptoUtilityService,
    private walletService: WalletService,
    private notificationService: NotificationService,
    private bonusProcessor: TradeBonusProcessorService,
    private cryptoBreakdownService: CryptoBreakdownService,
    private cryptoTransactionRepository: CryptoTransactionRepository,
    private transactionRepository: TransactionRepository,
    private helperService: HelperService,
    private bankAccountRepository: BankAccountRepository,
  ) {}

  async buyCrypto(data: BuyCryptoData) {
    const reference = generateReference();
    const userObjectId = new Types.ObjectId(data.userId);
    const cryptoObjectId = new Types.ObjectId(data.cryptoId);

    const [crypto, wallet, network] = await Promise.all([
      this.cryptoUtilityService.getCryptoById(data.cryptoId),
      this.walletService.getWallet(data.userId),
      this.cryptoUtilityService.getNetwork(data.cryptoId, data.networkId),
    ]);

    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    if (!crypto.purchaseActivated) {
      throw new AppError(
        "Crypto purchase is currently disabled",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // Amount validations
    if (crypto.buyMinAmount && data.cryptoAmount < crypto.buyMinAmount) {
      throw new AppError(
        `Minimum purchase amount is ${crypto.buyMinAmount} ${crypto.code}`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (crypto.buyMaxAmount && data.cryptoAmount > crypto.buyMaxAmount) {
      throw new AppError(
        `Maximum purchase amount is ${crypto.buyMaxAmount} ${crypto.code}`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // const walletAddress = this.validateWalletAddress(
    //   data.walletAddress,
    //   network,
    // );

    const walletAddress = data.walletAddress.trim();

    const breakdown = await this.cryptoBreakdownService.calculateBreakdown({
      cryptoId: data.cryptoId,
      cryptoAmount: data.cryptoAmount,
      tradeType: "buy",
      networkId: data.networkId,
    });

    const totalDeduction = breakdown.totalAmount;
    const chargeInfo = {
      baseAmount: breakdown.fiatAmount,
      serviceCharge: breakdown.serviceFee,
      chargeType: breakdown.serviceCharge?.type,
      chargeValue: breakdown.serviceCharge?.value,
      totalDeduction: totalDeduction,
    };
    // Balance check
    if (wallet.balance < totalDeduction) {
      throw new AppError(
        breakdown.serviceFee > 0
          ? `Insufficient balance. You need ₦${totalDeduction.toLocaleString()} (₦${breakdown.totalAmount.toLocaleString()} + ₦${breakdown.serviceFee.toLocaleString()} service charge)`
          : "Insufficient wallet balance",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INSUFFICIENT_BALANCE,
      );
    }

    const debitResult = await this.walletService.debitWallet(
      data.userId,
      totalDeduction,
      "Crypto Purchase",
      {
        type: TRANSACTION_TYPES.CRYPTO,
        provider: SYSTEM.PROVIDER,
        idempotencyKey: reference,
        initiatedBy: userObjectId,
        initiatedByType: "user",
        remark: `Crypto purchase: ${breakdown.cryptoAmount} ${crypto.code}`,
        channel: data.channel || "web",
        meta: {
          tradeType: "Crypto Purchase",
          cryptoName: crypto.name,
          cryptoCode: crypto.code,
          network: network.name,
          walletAddress,
          ...(chargeInfo && { chargeInfo }),
        },
      },
    );

    const transaction = debitResult.transaction;

    const cryptoTransaction = await this.cryptoTransactionRepository.create({
      cryptoId: cryptoObjectId,
      userId: userObjectId,
      reference,
      tradeType: "buy",
      network: {
        networkId: network.networkId,
        code: network.code,
        name: network.name,
        confirmationsRequired: network.confirmationsRequired,
        explorerUrl: network.explorerUrl || "",
      },
      walletAddress,
      cryptoAmount: breakdown.cryptoAmount,
      fiatAmount: breakdown.fiatAmount,
      exchangeRate: breakdown.exchangeRate,
      serviceFee: breakdown.serviceFee,
      totalAmount: breakdown.totalAmount,
      status: "pending",
      channel: data.channel || "web",
      transactionId: transaction.id.toString(),
      balanceBefore: debitResult.balanceBefore,
      balanceAfter: debitResult.balanceAfter,
      meta: {
        cryptoName: crypto.name,
        cryptoCode: crypto.code,
        network: network.name,
        walletAddress,
        serviceCharge: breakdown.serviceFee,
        totalDeduction: totalDeduction,
        ...(chargeInfo && { chargeInfo }),
        processedBy: "Admin",
      },
    });

    // Update transaction
    try {
      const updatedTransaction = await this.transactionRepository.update(
        transaction.id.toString(),
        {
          transactableType: "CryptoTransaction",
          transactableId: cryptoTransaction.id,
        },
      );

      if (!updatedTransaction) {
        logger.error(
          "Failed to link crypto transaction to wallet transaction",
          {
            transactionId: transaction.id,
            cryptoTransactionId: cryptoTransaction.id,
            reference,
          },
        );
      } else {
        logger.info(
          `Transaction linked: ${reference} -> CryptoTransaction ${cryptoTransaction.id}`,
        );
      }
    } catch (err) {
      logger.error("Error linking crypto transaction to wallet transaction", {
        transactionId: transaction.id,
        cryptoTransactionId: cryptoTransaction.id,
        reference,
        error: err,
      });
    }

    const notificationMeta: any = {
      reference,
      cryptoCode: crypto.code,
      cryptoAmount: breakdown.cryptoAmount,
      network: network.name,
      walletAddress,
      fiatAmount: breakdown.fiatAmount,
      totalAmount: breakdown.totalAmount,
    };

    if (breakdown.serviceFee > 0) {
      notificationMeta.serviceCharge = breakdown.serviceFee;
      notificationMeta.totalDeducted = totalDeduction;
    }

    this.bonusProcessor
      .processTradeAndBonus(data.userId, {
        transactionId: transaction.id.toString(),
        amount: breakdown.fiatAmount,
        serviceType: TRANSACTION_TYPES.CRYPTO,
      })
      .catch((err) =>
        logger.error(
          `Trade bonus processing failed: ${TRANSACTION_TYPES.CRYPTO}`,
          err,
        ),
      );

    Promise.all([
      this.notificationService
        .createNotification({
          type: "admin_crypto_buy_pending",
          notifiableType: "Admin",
          notifiableId: userObjectId,
          data: notificationMeta,
          sendEmail: true,
          sendSMS: false,
          sendPush: false,
          adminNotificationScope: {
            type: "crypto_network",
            id: network.networkId,
            tradeType: "buy",
          },
        })
        .catch((err) => {
          logger.error("Failed to send admin notification:", err);
        }),
      this.notificationService
        .createNotification({
          type: "transaction_pending",
          notifiableType: "User",
          notifiableId: userObjectId,
          data: {
            transactionType: "Crypto Purchase",
            ...notificationMeta,
            status: "pending",
          },
          sendEmail: true,
          sendSMS: false,
          sendPush: true,
        })
        .catch((err) => {
          logger.error("Failed to send user notification:", err);
        }),
    ]); //  fire-and-forget

    return {
      ...this.cryptoUtilityService.sanitizeCryptoTransaction(cryptoTransaction),
      crypto: {
        name: crypto.name,
        code: crypto.code,
        icon: crypto.icon,
      },
      breakdown: {
        ...breakdown,
        serviceCharge: breakdown.serviceFee,
        totalDeducted: totalDeduction,
      },
    };
  }

  async sellCrypto(data: SellCryptoData) {
    const reference = generateReference();
    const userObjectId = new Types.ObjectId(data.userId);
    const cryptoObjectId = new Types.ObjectId(data.cryptoId);
    const proofValue = data.proof || "";

    const [crypto, wallet, network] = await Promise.all([
      this.cryptoUtilityService.getCryptoById(data.cryptoId),
      // this.bankAccountRepository.findById(data.bankAccountId),
      this.walletService.getWallet(data.userId),
      this.cryptoUtilityService.getNetwork(data.cryptoId, data.networkId),
    ]);

    // if (!bankAccount || bankAccount.userId.toString() !== data.userId) {
    //   throw new AppError(
    //     "Invalid bank account",
    //     HTTP_STATUS.BAD_REQUEST,
    //     ERROR_CODES.VALIDATION_ERROR
    //   );
    // }

    if (!crypto.saleActivated) {
      throw new AppError(
        "Crypto sale is currently disabled",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (!network.platformDepositAddress) {
      throw new AppError(
        `Platform wallet not configured for ${network.name}`,
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.NOT_IMPLEMENTED,
      );
    }

    // Amount validations
    if (crypto.sellMinAmount && data.cryptoAmount < crypto.sellMinAmount) {
      throw new AppError(
        `Minimum sale amount is ${crypto.sellMinAmount} ${crypto.code}`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (crypto.sellMaxAmount && data.cryptoAmount > crypto.sellMaxAmount) {
      throw new AppError(
        `Maximum sale amount is ${crypto.sellMaxAmount} ${crypto.code}`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const breakdown = await this.cryptoBreakdownService.calculateBreakdown({
      cryptoId: data.cryptoId,
      cryptoAmount: data.cryptoAmount,
      tradeType: "sell",
      networkId: data.networkId,
    });

    // const chargeCalculation =
    //   await this.helperService.calculateAmountWithCharge(
    //     breakdown.totalAmount,
    //     TRANSACTION_TYPES.CRYPTO
    //   );

    const totalPayout = breakdown.totalAmount;

    const chargeInfo = {
      baseAmount: breakdown.fiatAmount,
      serviceCharge: breakdown.serviceFee,
      chargeType: breakdown.serviceCharge?.type,
      chargeValue: breakdown.serviceCharge?.value,
      totalPayout: totalPayout,
    };

    let bankAccount: any = null;
    // Fetch and validate bank account (REQUIRED for sell)
    if (data.bankAccountId) {
      bankAccount = await this.bankAccountRepository.findByIdAndPopulate(
        data.bankAccountId,
      );

      if (!bankAccount || bankAccount.userId.toString() !== data.userId) {
        throw new AppError(
          "Invalid or missing bank account",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      if (bankAccount.deletedAt) {
        throw new AppError(
          "Selected bank account has been deleted",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
    }

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
      walletAddress: network.platformDepositAddress,
      cryptoAmount: breakdown.cryptoAmount,
      fiatAmount: breakdown.fiatAmount,
      exchangeRate: breakdown.exchangeRate,
      serviceFee: breakdown.serviceFee,
      channel: data.channel || "web",
      totalAmount: breakdown.totalAmount,
      status: "pending",
      balanceBefore: wallet.balance,
      balanceAfter: wallet.balance,
      comment: data.comment,
      proof: proofValue,
      ...(data.bankAccountId && {
        bankId: bankAccount.bankId,
        bankCode: bankAccount.bankCode,
        accountName: bankAccount.accountName,
        accountNumber: bankAccount.accountNumber,
      }),
      paymentMethod: "pending",
      meta: {
        cryptoName: crypto.name,
        cryptoCode: crypto.code,
        network: network.name,
        walletAddress: network.platformDepositAddress,
        ...(bankAccount && {
          bankDetails: {
            bankId: bankAccount.bankId?.toString(),
            bankCode: bankAccount.bankCode,
            accountName: bankAccount.accountName,
            accountNumber: bankAccount.accountNumber,
          },
        }),
        serviceCharge: breakdown.serviceFee,
        totalPayout: totalPayout,
        ...(chargeInfo && { chargeInfo }),
        processedBy: "Admin",
      },
    });

    // const depositInstructions = `Send exactly ${breakdown.cryptoAmount} ${crypto.code} to ${network.platformDepositAddress} on ${network.name} network`;

    const notificationMeta: any = {
      reference,
      cryptoCode: crypto.code,
      cryptoAmount: breakdown.cryptoAmount,
      network: network.name,
      depositAddress: network.platformDepositAddress,
      fiatAmount: breakdown.fiatAmount,
      totalAmount: breakdown.totalAmount,
      // bankDetails,
      proof: proofValue,
    };

    if (breakdown.serviceFee > 0) {
      notificationMeta.serviceCharge = breakdown.serviceFee;
      notificationMeta.totalPayout = totalPayout;
    }

    Promise.all([
      this.notificationService
        .createNotification({
          type: "admin_crypto_sell_pending",
          notifiableType: "Admin",
          notifiableId: userObjectId,
          data: notificationMeta,
          sendEmail: true,
          sendSMS: false,
          sendPush: false,
          adminNotificationScope: {
            type: "crypto_network",
            id: network.networkId,
            tradeType: "sell",
          },
        })
        .catch((err) => {
          logger.error("Failed to send admin notification:", err);
        }),
      //   this.notificationService
      //     .createNotification({
      //       type: "transaction_pending",
      //       notifiableType: "User",
      //       notifiableId: userObjectId,
      //       data: {
      //         transactionType: "Crypto Sale",
      //         ...notificationMeta,
      //         status: "pending",
      //         instructions: depositInstructions,
      //       },
      //       sendEmail: true,
      //       sendSMS: false,
      //       sendPush: true,
      //     })
      //     .catch((err) => {
      //       logger.error("Failed to send user notification:", err);
      //     }),
    ]); // Don't await

    return {
      ...this.cryptoUtilityService.sanitizeCryptoTransaction(cryptoTransaction),
      crypto: {
        name: crypto.name,
        code: crypto.code,
        icon: crypto.icon,
      },
      breakdown: {
        ...breakdown,
        serviceCharge: breakdown.serviceFee,
        totalPayout: totalPayout,
      },

      // backward compatibility for frontend - can be removed in future
      depositInstructions: {
        address: network.platformDepositAddress,
        network: network.name,
        amount: breakdown.cryptoAmount,
        confirmationsRequired: network.confirmationsRequired,
        explorerUrl: network.explorerUrl,
      },
    };
  }
}
