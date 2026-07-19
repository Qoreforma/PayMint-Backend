import { UserTradeMetricsRepository } from "@/repositories/shared/UserTradeMetricsRepository";
import { TradeBonusRepository } from "@/repositories/admin/TradeBonusRepository";
import { WalletService } from "../wallet/WalletService";
import { CacheService } from "@/services/core/CacheService";
import { Types } from "mongoose";
import logger from "@/logger";
import { UserRepository } from "@/repositories/client/UserRepository";
import { EmailService } from "@/services/core/EmailService";

export class TradeBonusProcessorService {
  constructor(
    private userMetricsRepository: UserTradeMetricsRepository,
    private tradeBonusRepository: TradeBonusRepository,
    private walletService: WalletService,
    private cacheService: CacheService,
    private userRepository: UserRepository,
    private emailService: EmailService,
  ) {}

  // Process trade and check for bonus eligibility
  async processTradeAndBonus(
    userId: string | Types.ObjectId,
    transactionData: {
      transactionId: string;
      amount: number;
      serviceType: string;
    },
  ): Promise<void> {
    try {
      const userIdStr = userId.toString();

      //  Get or create user metrics
      const metrics =
        await this.userMetricsRepository.getOrCreateUserMetrics(userId);
      // Increment trade count
      const updatedMetrics =
        await this.userMetricsRepository.incrementTradeCount(
          userId,
          transactionData.amount,
        );

      if (!updatedMetrics) {
        logger.warn(`Failed to increment trade count for user: ${userIdStr}`);
        return;
      }

      this.sendTransactionLifecycleEmails(
        userId,
        updatedMetrics.totalTradesCount,
      ).catch((err) =>
        logger.error("Lifecycle email dispatch failed:", { userId, err }),
      );

      //  Get eligible bonuses for current total amount traded
      const eligibleBonuses =
        await this.tradeBonusRepository.getBonusesByAmountTraded(
          updatedMetrics.totalAmountTraded,
        );

      if (eligibleBonuses.length === 0) {
        logger.debug(
          `No eligible bonuses for user ${userIdStr} at amount ₦${updatedMetrics.totalAmountTraded}`,
        );
        return;
      }

      // Get most generous bonus (first in sorted list)
      const applicableBonus = eligibleBonuses[0];

      // Check if bonus already applied

      const alreadyApplied =
        await this.userMetricsRepository.checkBonusAppliedForTransaction(
          userId,
          transactionData.transactionId,
        );

      if (alreadyApplied) {
        logger.debug(
          `Bonus ${applicableBonus.name} already applied to user ${userIdStr}`,
        );
        return;
      }

      // Calculate cashback based on bonus type
      const cashbackAmount = this.calculateCashback(
        transactionData.amount,
        applicableBonus.bonusType,
        applicableBonus.value,
        applicableBonus.maxCashbackAmount,
      );

      // Credit wallet with idempotency key
      const idempotencyKey = `trade-bonus:${userIdStr}:${transactionData.transactionId}`;

      await this.walletService.creditWallet(
        userId,
        cashbackAmount,
        `Trade Bonus `,
        {
          idempotencyKey,
          initiatedByType: "system",
          remark: `Trade Bonus - ${applicableBonus.name}`,
          meta: {
            bonusId: applicableBonus.id.toString(),
            bonusName: applicableBonus.name,
            tradeCount: updatedMetrics.totalTradesCount,
            originalTransactionId: transactionData.transactionId,
            logo: "https://ik.imagekit.io/x2ug9v49a/9092455_AjSMtR-9J.png",
          },
        },
      );

      // Mark bonus as applied
      await this.userMetricsRepository.markBonusApplied(
        userId,
        applicableBonus.id,
        cashbackAmount,
        transactionData.transactionId,
      );

      logger.info(
        `Trade bonus applied: User=${userIdStr}, Bonus=${applicableBonus.name}, Cashback=₦${cashbackAmount}, TotalAmountTraded=₦${updatedMetrics.totalAmountTraded}`,
      );
    } catch (error) {
      logger.error("Trade bonus processing error:", { userId, error });
      // Don't throw - this shouldn't interrupt main transaction
    }
  }

  private calculateCashback(
    amount: number,
    bonusType: "flat" | "percentage",
    value: number,
    maxAmount?: number,
  ): number {
    let cashback = 0;

    if (bonusType === "flat") {
      // Flat bonus - just use the value as-is
      cashback = value;
    } else if (bonusType === "percentage") {
      // Percentage bonus - calculate percentage of transaction amount
      cashback = (amount * value) / 100;
    }

    // Apply max cap if specified
    return maxAmount ? Math.min(cashback, maxAmount) : cashback;
  }

  private async sendTransactionLifecycleEmails(
    userId: string | Types.ObjectId,
    totalTradesCount: number,
  ): Promise<void> {
    const user = await this.userRepository.findById(userId.toString());
    if (!user?.email) return;

    if (totalTradesCount === 1) {
      await this.emailService.sendFirstTransactionEmail(
        user.email,
        user.firstname,
      );
    }

    await this.emailService.sendTransactionCelebrationEmail(
      user.email,
      user.firstname,
    );
  }
}
