import logger from "@/logger";
import { AppError } from "@/middlewares/shared/errorHandler";
import { CryptoTransactionRepository } from "@/repositories/client/CryptoTransactionRepository";
import { WalletService } from "@/services/client/wallet/WalletService";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import { generateReference } from "@/utils/helpers";
import mongoose, { Types } from "mongoose";
import { CryptoBreakdownService } from "../../CryptoBreakdownService";
import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";
import { TatumService } from "@/services/client/providers/crypto/TatumService";
import { UserRepository } from "@/repositories/client/UserRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { NotificationService } from "@/services/client/notifications/NotificationService";
import { TradeBonusProcessorService } from "@/services/client/utility/TradeBonusProcessorService";
import { BuyCryptoAutomatedData, SellCryptoData } from "../../CryptoService";
import { CryptoUtilityService } from "../../CryptoUtilityService";
import { registerKmsTransaction } from "@/routes/client/tatum";
import { CryptoProfitCalculatorService } from "../../CryptoProfitCalculatorService";

export class TatumCryptoTradeService {
  constructor(
    private cryptoUtilityService: CryptoUtilityService,
    private walletService: WalletService,
    private cryptoBreakdownService: CryptoBreakdownService,
    private cryptoRepository: CryptoRepository,
    private networkRepository: NetworkRepository,
    private cryptoTransactionRepository: CryptoTransactionRepository,
    private tatumService: TatumService,
    private userRepository: UserRepository,
    private transactionRepository: TransactionRepository,
    private bonusProcessor: TradeBonusProcessorService,
    private notificationService: NotificationService,
  ) {}


  // TATUM: BUY FLOW

  // Buy crypto with Tatum (automated flow)
  // User provides external wallet address
  // Flow:
  // 1. Validate user, crypto, amount
  // 2. Calculate breakdown with live rates
  // 3. Debit fiat wallet
  // 4. Send crypto from Master Wallet via KMS
  // 5. Create transaction record

  async buyCryptoWithTatum(data: BuyCryptoAutomatedData): Promise<any> {
    const reference = generateReference();
    const userObjectId = new Types.ObjectId(data.userId);
    const cryptoObjectId = new Types.ObjectId(data.cryptoId);

    logger.info(`Initiating Tatum buy crypto: ${reference}`, {
      userId: data.userId,
      cryptoId: data.cryptoId,
      amount: data.usdAmount,
    });

    // Start MongoDB session for atomicity
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 1: Validate - Check if already processed (idempotency)
      const existingTransaction =
        await this.cryptoTransactionRepository.findOne({
          reference,
        });

      if (existingTransaction) {
        logger.warn(`Transaction already processed`, { reference });
        await session.abortTransaction();
        throw new AppError(
          `Transaction ${reference} already initiated. Please check your transaction history.`,
          HTTP_STATUS.CONFLICT,
        );
      }

      // 2: Get and validate user, crypto, network
      const [user, crypto, network] = await Promise.all([
        this.walletService.getWallet(data.userId),
        this.cryptoRepository.findById(data.cryptoId),
        this.networkRepository.findById(data.networkId),
      ]);

      if (!user) {
        throw new AppError(
          "User not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      if (!crypto || !network) {
        throw new AppError(
          "Crypto or network not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      // 3: Validate purchase enabled
      if (!crypto.purchaseActivated) {
        throw new AppError(
          "Crypto purchase is currently disabled",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // 4: Validate wallet address
      if (
        !this.cryptoUtilityService.validateAddress(data.walletAddress, network)
      ) {
        throw new AppError(
          `Invalid wallet address format for ${network.name}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // 5: Validate min/max amounts
      if (crypto.buyMinAmount && data.usdAmount < crypto.buyMinAmount) {
        throw new AppError(
          `Minimum buy amount is $${crypto.buyMinAmount}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      if (crypto.buyMaxAmount && data.usdAmount > crypto.buyMaxAmount) {
        throw new AppError(
          `Maximum buy amount is $${crypto.buyMaxAmount}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
      // 6: Calculate breakdown with live rates
      const breakdown =
        await this.cryptoBreakdownService.calculateBreakdownWithTatum({
          cryptoId: data.cryptoId,
          usdAmount: data.usdAmount,
          tradeType: "buy",
          networkId: data.networkId,
        });

      const totalDeduction = breakdown.totalAmount;

      logger.info(`Buy breakdown calculated`, {
        reference,
        usdAmount: data.usdAmount,
        cryptoAmount: breakdown.cryptoAmount,
        serviceFee: breakdown.serviceFee,
        totalDeduction,
      });

      // 7: Check balance
      if (user.balance < totalDeduction) {
        throw new AppError(
          `Insufficient balance. You need ₦${totalDeduction.toLocaleString()}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.INSUFFICIENT_BALANCE,
        );
      }

      // 8: Get Master Wallet Address (from network config, not env)
      const masterWalletAddress = network.platformDepositAddress;

      if (!masterWalletAddress) {
        throw new AppError(
          `Master wallet address not configured for ${network.name}`,
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          ERROR_CODES.NOT_FOUND,
        );
      }

      // 9: Get KMS signature ID (using CORRECTED method)
      const kmsSignatureId = this.tatumService.getKmsSignatureIdForChain(
        network.chainType,
      );

      logger.info(`KMS signature retrieved`, {
        reference,
        chainType: network.chainType,
        signatureId: kmsSignatureId.substring(0, 8) + "***",
      });

      // 10: DEBIT WALLET (atomic via WalletService)
      logger.info(`Debiting user wallet`, { reference, totalDeduction });

      const debitResult = await this.walletService.debitWallet(
        data.userId,
        totalDeduction,
        "Crypto Purchase",
        {
          type: TRANSACTION_TYPES.CRYPTO,
          provider: "tatum",
          idempotencyKey: reference, // Already atomic in WalletService
          initiatedBy: userObjectId,
          initiatedByType: "user",
          remark: `Crypto purchase: ${data.usdAmount} USD for ${crypto.code}`,
          channel: data.channel || "web",
          meta: {
            tradeType: "Crypto Purchase",
            cryptoName: crypto.name,
            cryptoCode: crypto.code,
            network: network.name,
            walletAddress: data.walletAddress,
            chargeInfo: {
              baseAmount: breakdown.fiatAmount,
              serviceCharge: breakdown.serviceFee,
              chargeType: breakdown.serviceCharge?.type,
              chargeValue: breakdown.serviceCharge?.value,
            },
          },
        },
      );

      logger.info(`Wallet debited successfully`, {
        reference,
        balanceBefore: debitResult.balanceBefore,
        balanceAfter: debitResult.balanceAfter,
      });

      // 11: SEND CRYPTO FROM MASTER WALLET
      logger.info(`Sending crypto from Master Wallet`, {
        reference,
        amount: breakdown.cryptoAmount,
        currency: crypto.code,
        to: data.walletAddress,
        chainType: network.chainType,
        networkPath: network.networkPath,
      });

      let txHash: string;
      let tatumPendingId: string | undefined;

      try {
        const masterBalance = await this.tatumService.getMasterWalletBalance(
          crypto.code,
          network.networkPath,
          masterWalletAddress,
        );

        logger.info(`Master wallet balance retrieved`, {
          reference,
          balance: masterBalance,
          currency: crypto.code,
        });

        const sendResult = await this.tatumService.sendCryptoFromMasterWallet({
          fromAddress: masterWalletAddress,
          to: data.walletAddress,
          amount: breakdown.cryptoAmount.toString(),
          currency: crypto.code,
          signatureId: kmsSignatureId,
          chainType: network.chainType,
          networkPath: network.networkPath,
          masterWalletBalance: masterBalance,
        });

        txHash = sendResult.txHash;

        tatumPendingId = sendResult.tatumPendingId;

        if (tatumPendingId) {
          await registerKmsTransaction(tatumPendingId);
          logger.info(`KMS tx registered for approval`, {
            reference,
            tatumPendingId,
          });
        }
        logger.info(`Crypto sent successfully`, {
          reference,
          txHash,
          cryptoAmount: breakdown.cryptoAmount,
        });
      } catch (sendError: any) {
        //  SEND FAILED - ABORT TRANSACTION (rollback debit)
        logger.error(
          `Send crypto failed, aborting transaction to rollback debit`,
          sendError,
        );

        await session.abortTransaction();

        // WalletService owns its own session, so the debit is already committed.
        // We must explicitly credit back the full deduction amount.
        try {
          await this.walletService.creditWallet(
            data.userId,
            totalDeduction,
            "Crypto Purchase Reversal",
            {
              type: TRANSACTION_TYPES.REFUND,
              provider: "tatum",
              channel: data.channel || "web",
              idempotencyKey: `${reference}_reversal`, // prevents double-reversal
              remark: `Auto-reversal: send failed for ${reference}`,
              meta: {
                reversalOf: reference,
                reason: sendError.message,
              },
            },
          );
          logger.info(`Debit reversed successfully`, {
            reference,
            totalDeduction,
          });
        } catch (reversalError: any) {
          // Reversal failed — user is out of funds with no crypto received
          // Flag for immediate manual intervention
          logger.error(
            `CRITICAL: Auto-reversal failed — user ${data.userId} debited ₦${totalDeduction} but received no crypto. Reference: ${reference}`,
            { reversalError: reversalError.message },
          );
        }
        throw new AppError(
          `Failed to send cryptocurrency. Please contact support with reference: ${reference}`,
          HTTP_STATUS.BAD_GATEWAY,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

      // 12: CREATE CRYPTO TRANSACTION RECORD (atomically in session)
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
        walletAddress: data.walletAddress,
        cryptoAmount: breakdown.cryptoAmount,
        fiatAmount: breakdown.fiatAmount,
        channel: data.channel || "web",
        exchangeRate: breakdown.exchangeRate,
        profit: CryptoProfitCalculatorService.calculateProvisional(
          breakdown.serviceFee,
        ).profit,
        serviceFee: breakdown.serviceFee,
        totalAmount: breakdown.totalAmount,
        status: "pending",
        transactionId: debitResult.transaction.id.toString(),
        balanceBefore: debitResult.balanceBefore,
        balanceAfter: debitResult.balanceAfter,
        tatumSweepTxHash: txHash,
        tatumPendingId,
        meta: {
          cryptoName: crypto.name,
          cryptoCode: crypto.code,
          network: network.name,
          walletAddress: data.walletAddress,
          automatedFlow: true,
          processedBy: "Tatum",
          serviceCharge: breakdown.serviceFee,
          totalDeduction,
          chargeInfo: {
            baseAmount: breakdown.fiatAmount,
            serviceCharge: breakdown.serviceFee,
            chargeType: breakdown.serviceCharge?.type,
            chargeValue: breakdown.serviceCharge?.value,
            totalDeduction: totalDeduction,
          },
          profitBreakdown: {
            serviceFeeNGN: breakdown.serviceFee,
            gasCostNGN: 0,
            gasCostSource: "none",
            note: "buy-side gas cost not tracked — profit is fee-only",
          },
        },
      });

      logger.info(`Crypto transaction created`, {
        reference,
        transactionId: cryptoTransaction.id,
      });

      // 13: Link to wallet transaction
      try {
        await this.transactionRepository.update(
          debitResult.transaction.id.toString(),
          {
            transactableType: "CryptoTransaction",
            transactableId: cryptoTransaction.id,
          },
        );
      } catch (err: any) {
        logger.error(`Failed to link transactions`, err);
        // Non-critical, don't fail
      }

      //  Commit transaction
      await session.commitTransaction();

      logger.info(`Transaction committed successfully`, { reference });

      // 14: Send notifications (fire-and-forget, now safe)
      Promise.all([
        this.notificationService
          .createNotification({
            type: "transaction_pending",
            notifiableType: "User",
            notifiableId: userObjectId,
            data: {
              transactionType: "Crypto Purchase",
              reference,
              cryptoCode: crypto.code,
              cryptoAmount: breakdown.cryptoAmount,
              fiatAmount: breakdown.fiatAmount,
              totalAmount: breakdown.totalAmount,
              status: "pending",
            },
            sendEmail: true,
            sendSMS: false,
            sendPush: true,
          })
          .catch((err) => logger.error(`Notification failed`, err)),

        this.bonusProcessor
          .processTradeAndBonus(data.userId, {
            transactionId: debitResult.transaction.id.toString(),
            amount: breakdown.fiatAmount,
            serviceType: TRANSACTION_TYPES.CRYPTO,
          })
          .catch((err) => logger.error(`Bonus processing failed`, err)),
      ]);

      return {
        id: cryptoTransaction.id,
        reference,
        tradeType: "buy",
        status: cryptoTransaction.status,
        crypto: {
          name: crypto.name,
          code: crypto.code,
          icon: crypto.icon,
        },
        breakdown: {
          cryptoAmount: breakdown.cryptoAmount,
          fiatAmount: breakdown.fiatAmount,
          exchangeRate: breakdown.exchangeRate,
          serviceCharge: breakdown.serviceFee,
          totalDeducted: breakdown.totalAmount,
        },
        createdAt: cryptoTransaction.createdAt,
      };
    } catch (error: any) {
      logger.error(`Tatum buy crypto failed: ${reference}`, error);

      try {
        await session.abortTransaction();
      } catch (abortErr: any) {
        logger.error(`Failed to abort transaction`, abortErr);
      }

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        "Crypto purchase failed. Please try again later.",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } finally {
      await session.endSession();
    }
  }

  // TATUM: SELL FLOW

  // Sell crypto with Tatum (webhook-driven flow)
  // User sends crypto to permanent deposit address
  // Flow:
  // 1. Validate crypto, amount
  // 2. Get or create permanent deposit address
  // 3. Create Virtual Account if needed
  // 4. Create transaction in "pending_deposit" state
  // 5. Return deposit instructions to user
  // Note: Webhook credits user when deposit confirmed
  async sellCryptoWithTatum(data: SellCryptoData): Promise<any> {
    const reference = generateReference();
    const userObjectId = new Types.ObjectId(data.userId);
    const cryptoObjectId = new Types.ObjectId(data.cryptoId);

    logger.info(`Initiating Tatum sell crypto: ${reference}`, {
      userId: data.userId,
      cryptoId: data.cryptoId,
      cryptoAmount: data.cryptoAmount,
    });

    try {
      const [crypto, user, network] = await Promise.all([
        this.cryptoRepository.findById(data.cryptoId),
        this.walletService.getWallet(data.userId),
        this.networkRepository.findById(data.networkId),
      ]);

      if (!crypto || !user || !network) {
        throw new AppError(
          "Crypto, user, or network not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      // Validate sale enabled
      if (!crypto.saleActivated) {
        throw new AppError(
          "Crypto sale is currently disabled",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Validate amounts
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

      logger.info(`Sell crypto amounts validated`, {
        reference,
        amount: data.cryptoAmount,
        min: crypto.sellMinAmount,
        max: crypto.sellMaxAmount,
      });

      // Get or create permanent deposit address
      const { address: depositAddress, accountId } =
        await this.cryptoBreakdownService.createUserDepositAddress(data.userId, data.networkId);

      logger.info(`Deposit address ready`, {
        reference,
        depositAddress,
        accountId,
      });

      const breakdown =
        await this.cryptoBreakdownService.calculateBreakdownWithTatum({
          cryptoId: data.cryptoId,
          usdAmount: data.cryptoAmount,
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

      // Create crypto transaction in pending_deposit state
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
        channel: data.channel || "web",
        walletAddress: depositAddress,
        cryptoAmount: data.cryptoAmount,
        fiatAmount: breakdown.fiatAmount, // estimate — webhook overwrites with final value
        exchangeRate: breakdown.exchangeRate, // estimate — webhook overwrites with final value
        serviceFee: breakdown.serviceFee, // estimate — webhook overwrites with final value
        totalAmount: breakdown.totalAmount, // estimate — webhook overwrites with final value
        amountsFinalized: false,
        status: "pending_deposit",
        balanceBefore: user.balance,
        balanceAfter: user.balance,
        comment: data.comment,
        proof: data.proof || "",
        tatumDepositAddress: depositAddress,
        tatumAccountId: accountId,
        meta: {
          cryptoName: crypto.name,
          cryptoCode: crypto.code,
          network: network.name,
          automatedFlow: true,
          processedBy: "Tatum",
          chargeInfo,
          depositInstructions: `Send exactly ${data.cryptoAmount} ${crypto.code} to this address on ${network.name} network`,
          transactionInitiatedAt: new Date().toISOString(),
        },
      });

      logger.info(`Sell transaction created (pending deposit)`, {
        reference,
        transactionId: cryptoTransaction.id,
        depositAddress,
      });

      return {
        id: cryptoTransaction.id,
        reference,
        tradeType: "sell",
        status: "pending_deposit",
        crypto: {
          name: crypto.name,
          code: crypto.code,
          icon: crypto.icon,
        },
        depositInstructions: {
          address: depositAddress,
          network: network.name,
          amount: data.cryptoAmount,
          confirmationsRequired: network.confirmationsRequired,
          explorerUrl: network.explorerUrl,
          message: `Send ${data.cryptoAmount} ${crypto.code} to this address. Your funds will be credited after we receive and confirm the transaction.`,
        },
        createdAt: cryptoTransaction.createdAt,
      };
    } catch (error: any) {
      logger.error(`Tatum sell crypto failed: ${reference}`, error);

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        "Crypto sale failed. Please try again later.",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }
}
