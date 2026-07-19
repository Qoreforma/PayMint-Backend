import logger from "@/logger";
import { CryptoTransactionRepository } from "@/repositories/client/CryptoTransactionRepository";
import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";
import { WalletService } from "../wallet/WalletService";
import { NotificationService } from "../notifications/NotificationService";
import { HelperService } from "../utility/HelperService";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import { AppError } from "@/middlewares/shared/errorHandler";
import { BankAccountRepository } from "@/repositories/client/BankAccountRepository";
import { UserRepository } from "@/repositories/client/UserRepository";

export interface IBreetTradeWebhook {
  id: string;
  event: "trade.pending" | "trade.completed" | "trade.flagged";
  asset: string;
  cryptoAmount: number;
  amountInUSD: number;
  feeAmountInUsd: number;
  rate: number;
  status: "pending" | "completed" | "flagged";
  txHash: string;
  confirmations: number;
  destinationAddress: string;
  destinationDescription: string;
  vaultId?: string;
  blockInfo?: {
    blockHeight: string;
    blockHash: string;
  };
  // Auto-settlement fields (if enabled)
  markupPercent?: number;
  markupAmount?: number;
  amountSettled?: number;
  createdAt: string;
  updatedAt: string;
}

const SETTLEMENT_MODE = (process.env.BREET_SETTLEMENT_MODE || "wallet") as
  | "bank"
  | "wallet";

export class BreetWebhookService {
  constructor(
    private cryptoTransactionRepository: CryptoTransactionRepository,
    private cryptoRepository: CryptoRepository,
    private networkRepository: NetworkRepository,
    private walletService: WalletService,
    private notificationService: NotificationService,
    private helperService: HelperService,
    private userRepository: UserRepository,
    private bankAccountRepository: BankAccountRepository,
  ) {}

  /**
   * Verify webhook secret
   */
  verifySecret(receivedSecret: string): boolean {
    const webhookSecret = process.env.BREET_WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.error("BREET_WEBHOOK_SECRET not configured");
      return false;
    }

    try {
      const crypto = require("crypto");
      const isValid = crypto.timingSafeEqual(
        Buffer.from(receivedSecret),
        Buffer.from(webhookSecret),
      );
      return isValid;
    } catch (err) {
      logger.error("Webhook secret verification failed", { err });
      return false;
    }
  }

  /**
   * Validate webhook payload structure
   */
  validatePayload(payload: any): boolean {
    if (!payload) {
      logger.error("Breet webhook: payload is empty");
      return false;
    }

    const requiredFields = [
      "id",
      "event",
      "asset",
      "amountInUSD",
      "destinationAddress",
    ];
    const missing = requiredFields.filter((field) => !payload[field]);

    if (missing.length > 0) {
      logger.error("Breet webhook: missing required fields", { missing });
      return false;
    }

    return true;
  }

  /**
   * Process webhook based on event type
   */
  async processWebhook(payload: IBreetTradeWebhook): Promise<void> {
    logger.info(`Processing Breet webhook: ${payload.id}`, {
      event: payload.event,
      asset: payload.asset,
      status: payload.status,
    });

    try {
      // Handle based on event type
      switch (payload.event) {
        case "trade.pending":
          await this.handleTradePending(payload);
          break;

        case "trade.completed":
          await this.handleTradeCompleted(payload);
          break;

        case "trade.flagged":
          await this.handleTradeFlagged(payload);
          break;

        default:
          logger.warn("Breet webhook: unknown event type", {
            event: payload.event,
          });
      }
    } catch (error: any) {
      logger.error("Breet webhook processing error", {
        error: error.message,
        webhookId: payload.id,
      });
      // Don't throw - webhook must return 200 OK
    }
  }

  /**
   * Handle trade.pending webhook
   * Transaction detected on-chain, waiting for confirmations
   */
  private async handleTradePending(payload: IBreetTradeWebhook): Promise<void> {
    logger.info(`Handling trade.pending: ${payload.id}`, {
      asset: payload.asset,
      confirmations: payload.confirmations,
    });

    try {
      // Check if transaction already exists
      const existingTx = await this.cryptoTransactionRepository.findOne({
        breetTradeId: payload.id,
      });

      if (existingTx) {
        // Update confirmations
        await this.cryptoTransactionRepository.update(
          existingTx.id.toString(),
          {
            breetWebhookId: payload.id,
            meta: {
              ...existingTx.meta,
              providerResponse: payload,
              confirmations: payload.confirmations,
              lastWebhookAt: new Date().toISOString(),
            },
          },
        );
        logger.info(`Updated existing pending transaction`, {
          reference: existingTx.reference,
          confirmations: payload.confirmations,
        });
        return;
      }

      // Find user by wallet address (from breetWalletAddresses in User model)
      const user = await this.userRepository.findOne({
        "breetWalletAddresses.walletAddress": payload.destinationAddress,
      });

      if (!user) {
        logger.warn(`Breet webhook: no user found for address`, {
          address: payload.destinationAddress,
          description: payload.destinationDescription,
        });
        return;
      }

      // Find crypto by asset identifier
      // Find network by breet asset identifier (variant lives on network now)
      const network = await this.networkRepository.findOne({
        breetAssetId: payload.asset,
        deletedAt: null,
      });

      if (!network) {
        logger.warn(`Breet webhook: network not found for asset`, {
          asset: payload.asset,
        });
        return;
      }

      // Find crypto via network's linked crypto (code = symbol, providerCode = breet)
      const crypto = await this.cryptoRepository.findOne({
        networks: network._id,
        providerCode: "breet",
        deletedAt: null,
      });

      if (!crypto) {
        logger.warn(`Breet webhook: crypto not found for network`, {
          asset: payload.asset,
          networkId: network._id,
        });
        return;
      }

      // Create pending transaction record
      const reference = `BREET_${payload.id}_${Date.now()}`;

      await this.cryptoTransactionRepository.create({
        userId: user._id,
        cryptoId: crypto._id,
        reference,
        tradeType: "sell",
        status: "pending_deposit",
        walletAddress: payload.destinationAddress,
        cryptoAmount: payload.cryptoAmount,
        fiatAmount: 0, // Will be calculated on completion
        exchangeRate: 0,
        serviceFee: payload.feeAmountInUsd,
        totalAmount: 0,
        txHash: payload.txHash,
        confirmations: payload.confirmations,
        breetTradeId: payload.id,
        breetWebhookId: payload.id,
        balanceBefore: user.virtualAccount?.balance || 0,
        balanceAfter: user.virtualAccount?.balance || 0,
        network: {
          networkId: network.networkId,
          code: network.code,
          name: network.name,
        },
        meta: {
          asset: payload.asset,
          vaultId: payload.vaultId,
          blockInfo: payload.blockInfo,
          providerResponse: payload,
          confirmations: payload.confirmations,
          pendingWebhookAt: new Date().toISOString(),
        },
      });

      logger.info(`Pending transaction created`, {
        reference,
        userId: user._id,
        cryptoAmount: payload.cryptoAmount,
      });
    } catch (error: any) {
      logger.error(`Error handling trade.pending`, {
        error: error.message,
        webhookId: payload.id,
      });
    }
  }

  /**
   * Handle trade.completed webhook
   * Transaction fully confirmed, debit/credit applied
   */
  private async handleTradeCompleted(
    payload: IBreetTradeWebhook,
  ): Promise<void> {
    logger.info(`Handling trade.completed: ${payload.id}`, {
      asset: payload.asset,
      amountInUSD: payload.amountInUSD,
    });

    try {
      // 1. Find user first
      const user = await this.userRepository.findOne({
        "breetWalletAddresses.walletAddress": payload.destinationAddress,
      });

      if (!user) {
        logger.warn(`Breet webhook: user not found`, {
          address: payload.destinationAddress,
        });
        return;
      }

      // 2. Find wallet record
      const walletRecord = user.breetWalletAddresses?.find(
        (w: any) => w.walletAddress === payload.destinationAddress,
      );

      if (!walletRecord) {
        logger.warn(`Breet webhook: wallet record not found`, {
          address: payload.destinationAddress,
        });
        return;
      }

      // 3. Find network then crypto
      const network = await this.networkRepository.findOne({
        breetAssetId: payload.asset,
        deletedAt: null,
      });

      if (!network) {
        logger.warn(`Breet webhook: network not found`, {
          asset: payload.asset,
        });
        return;
      }

      const crypto = await this.cryptoRepository.findOne({
        networks: network._id,
        providerCode: "breet",
        deletedAt: null,
      });

      if (!crypto) {
        logger.warn(`Breet webhook: crypto not found`, {
          asset: payload.asset,
        });
        return;
      }

      // 4. Find existing transaction
      let transaction = await this.cryptoTransactionRepository.findOne({
        breetTradeId: payload.id,
      });

      // 5. Idempotency check
      if (transaction && transaction.status === "approved") {
        logger.info(`Transaction already processed (idempotent)`, {
          reference: transaction.reference,
          webhookId: payload.id,
        });
        return;
      }

      // 6. Calculate amounts
      const fiatAmountNGN = payload.amountInUSD * payload.rate;
      let finalAmount = fiatAmountNGN;
      let markupAmount = payload.markupAmount || 0;
      let markupPercent = payload.markupPercent || 0;
      let autoSettled = false;

      if (SETTLEMENT_MODE === "bank" && walletRecord.autoSettlementEnabled) {
        autoSettled = true;
        finalAmount = payload.amountSettled || fiatAmountNGN;

        logger.info(`Auto-settlement applied (bank mode)`, {
          fiatAmountNGN,
          markupPercent,
          markupAmount,
          finalAmount,
        });
      }

      // 7. Save/update transaction record FIRST before crediting
      if (transaction) {
        await this.cryptoTransactionRepository.update(
          transaction.id.toString(),
          {
            status: "approved",
            cryptoAmount: payload.cryptoAmount,
            fiatAmount: fiatAmountNGN,
            exchangeRate: payload.rate,
            serviceFee: payload.feeAmountInUsd,
            totalAmount: finalAmount,
            txHash: payload.txHash,
            confirmations: payload.confirmations,
            completedAt: new Date(),
            breetWebhookId: payload.id,
            breetAutoSettled: autoSettled,
            breetMarkupPercent: markupPercent,
            breetMarkupAmount: markupAmount,
            breetAmountSettled: finalAmount,
            meta: {
              ...transaction.meta,
              completedAt: new Date().toISOString(),
              fiatAmountNGN,
              exchangeRate: payload.rate,
              blockInfo: payload.blockInfo,
              confirmations: payload.confirmations,
              providerResponse: payload,
            },
          },
        );
      } else {
        // trade.completed fired without a prior trade.pending
        const reference = `BREET_${payload.id}`;
        transaction = await this.cryptoTransactionRepository.create({
          userId: user._id,
          cryptoId: crypto._id,
          reference,
          tradeType: "sell",
          status: "approved",
          walletAddress: payload.destinationAddress,
          cryptoAmount: payload.cryptoAmount,
          fiatAmount: fiatAmountNGN,
          exchangeRate: payload.rate,
          serviceFee: payload.feeAmountInUsd,
          totalAmount: finalAmount,
          txHash: payload.txHash,
          confirmations: payload.confirmations,
          completedAt: new Date(),
          breetTradeId: payload.id,
          breetWebhookId: payload.id,
          breetAutoSettled: autoSettled,
          breetMarkupPercent: markupPercent,
          breetMarkupAmount: markupAmount,
          breetAmountSettled: finalAmount,
          balanceBefore: 0,
          balanceAfter: 0,
          network: {
            networkId: network.networkId,
            code: network.code,
            name: network.name,
          },
          meta: {
            asset: payload.asset,
            vaultId: payload.vaultId,
            providerResponse: payload,
            blockInfo: payload.blockInfo,
            completedAt: new Date().toISOString(),
            missedPending: true,
          },
        });
      }

      // 8. Credit wallet AFTER record is saved (wallet mode only)
      if (SETTLEMENT_MODE === "wallet") {
        const creditResult = await this.walletService.creditWallet(
          user._id.toString(),
          finalAmount,
          "Crypto Sale Credit",
          {
            type: TRANSACTION_TYPES.CRYPTO,
            provider: "breet",
            idempotencyKey: `${transaction.reference}_credit`,
            remark: `Crypto sale: ${payload.cryptoAmount} ${payload.asset}`,
            meta: {
              breetTradeId: payload.id,
              asset: payload.asset,
              cryptoAmount: payload.cryptoAmount,
            },
          },
        );

        logger.info(`User wallet credited`, {
          userId: user._id,
          amount: finalAmount,
          newBalance: creditResult.balanceAfter,
        });

        // LEADERBOARD (fire and forget) — automated sell completion,
        // mirrors the manual admin-approved sell path which already
        // updates this. Scoped to wallet-settlement mode only, since
        // that's the only case where the user's NGN balance actually moved.
        this.helperService
          .updateLeaderboardAsync(
            user._id.toString(),
            transaction.id,
            TRANSACTION_TYPES.CRYPTO,
            finalAmount,
            payload.amountInUSD,
          )
          .catch((err: any) => {
            logger.error(`Leaderboard update failed (Breet sell)`, {
              error: err.message,
              webhookId: payload.id,
            });
          });
      }

      // 9. Notification
      this.notificationService
        .createNotification({
          type: "transaction_complete",
          notifiableType: "User",
          notifiableId: user._id,
          data: {
            reference: transaction.reference,
            transactionType: "Crypto Sale",
            cryptoAmount: payload.cryptoAmount,
            cryptoCode: payload.asset,
            fiatAmount: fiatAmountNGN,
            serviceCharge: payload.feeAmountInUsd,
            totalReceived: finalAmount,
            status: "approved",
            completedAt: new Date().toISOString(),
            settlementMode: SETTLEMENT_MODE,
            autoSettled,
          },
          sendEmail: true,
          sendSMS: false,
          sendPush: true,
        })
        .catch((err) => {
          logger.error(`Failed to send completion notification`, {
            error: err.message,
            webhookId: payload.id,
          });
        });

      logger.info(`Breet trade completed successfully`, {
        webhookId: payload.id,
        userId: user._id,
        cryptoAmount: payload.cryptoAmount,
        fiatAmount: fiatAmountNGN,
        totalReceived: finalAmount,
      });
    } catch (error: any) {
      logger.error(`Error handling trade.completed`, {
        error: error.message,
        webhookId: payload.id,
      });
    }
  }

  /**
   * Handle trade.flagged webhook
   * Deposit below minimum amount, held until resolved
   */
  private async handleTradeFlagged(payload: IBreetTradeWebhook): Promise<void> {
    logger.info(`Handling trade.flagged: ${payload.id}`, {
      asset: payload.asset,
      amountInUSD: payload.amountInUSD,
    });

    try {
      // Find user
      const user = await this.userRepository.findOne({
        "breetWalletAddresses.walletAddress": payload.destinationAddress,
      });

      if (!user) {
        logger.warn(`Breet webhook: user not found for flagged deposit`, {
          address: payload.destinationAddress,
        });
        return;
      }

      // Find crypto
      // Find network by breet asset identifier
      const network = await this.networkRepository.findOne({
        breetAssetId: payload.asset,
        deletedAt: null,
      });

      if (!network) {
        logger.warn(`Breet webhook: network not found for flagged deposit`, {
          asset: payload.asset,
        });
        return;
      }

      // Find crypto via network
      const crypto = await this.cryptoRepository.findOne({
        networks: network._id,
        providerCode: "breet",
        deletedAt: null,
      });

      if (!crypto) {
        logger.warn(`Breet webhook: crypto not found for flagged deposit`, {
          asset: payload.asset,
          networkId: network._id,
        });
        return;
      }

      // Find or create transaction
      let transaction = await this.cryptoTransactionRepository.findOne({
        breetTradeId: payload.id,
      });

      if (transaction) {
        // Update existing
        await this.cryptoTransactionRepository.update(
          transaction.id.toString(),
          {
            status: "flagged",
            breetFlaggedStatus: "pending",
            cryptoAmount: payload.cryptoAmount,
            fiatAmount: payload.amountInUSD,
            exchangeRate: payload.rate,
            serviceFee: payload.feeAmountInUsd,
            meta: {
              ...transaction.meta,
              flaggedAt: new Date().toISOString(),
              flagReason: "below_minimum",
              providerResponse: payload,
              flagFeeUSD: payload.feeAmountInUsd,
            },
          },
        );

        logger.info(`Transaction flagged`, {
          reference: transaction.reference,
          reason: "below_minimum",
        });
      } else {
        // Create new flagged transaction
        const reference = `BREET_FLAGGED_${payload.id}_${Date.now()}`;

        await this.cryptoTransactionRepository.create({
          userId: user._id,
          cryptoId: crypto._id,
          reference,
          tradeType: "sell",
          status: "flagged",
          walletAddress: payload.destinationAddress,
          cryptoAmount: payload.cryptoAmount,
          fiatAmount: payload.amountInUSD,
          exchangeRate: payload.rate,
          serviceFee: payload.feeAmountInUsd,
          totalAmount: 0,
          txHash: payload.txHash,
          confirmations: payload.confirmations,
          breetTradeId: payload.id,
          breetWebhookId: payload.id,
          breetFlaggedStatus: "pending",
          balanceBefore: user.virtualAccount?.balance || 0,
          balanceAfter: user.virtualAccount?.balance || 0,
          network: {
            networkId: network.networkId,
            code: network.code,
            name: network.name,
          },
          meta: {
            asset: payload.asset,
            providerResponse: payload,
            flaggedAt: new Date().toISOString(),
            flagReason: "below_minimum",
            flagFeeUSD: payload.feeAmountInUsd,
          },
        });
      }

      // Send notification
      this.notificationService
        .createNotification({
          type: "deposit_flagged",
          notifiableType: "User",
          notifiableId: user._id,
          data: {
            asset: payload.asset,
            cryptoAmount: payload.cryptoAmount,
            fiatAmount: payload.amountInUSD,
            reason: "Below minimum deposit amount",
            message: `Your deposit of ${payload.cryptoAmount} ${payload.asset} is below the minimum and has been held. Top up to release it.`,
          },
          sendEmail: true,
          sendSMS: false,
          sendPush: true,
        })
        .catch((err) => {
          logger.error(`Failed to send flagged notification`, {
            error: err.message,
            webhookId: payload.id,
          });
        });

      logger.info(`⚠️ Breet trade flagged`, {
        webhookId: payload.id,
        userId: user._id,
        reason: "below_minimum",
      });
    } catch (error: any) {
      logger.error(`Error handling trade.flagged`, {
        error: error.message,
        webhookId: payload.id,
      });
    }
  }
}
