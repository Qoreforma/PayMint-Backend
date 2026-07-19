import { ReferralRepository } from "@/repositories/client/ReferralRepository";
import { UserTradeMetricsRepository } from "@/repositories/shared/UserTradeMetricsRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { Types } from "mongoose";
import logger from "@/logger";
import { WalletService } from "../../client/wallet/WalletService";
import { ReferralBonusRepository } from "@/repositories/admin/ReferralBonusRepository";

export class ReferralBonusService {
  constructor(
    private referralBonusRepository: ReferralBonusRepository,
    private referralRepository: ReferralRepository,
    private metricsRepository: UserTradeMetricsRepository,
    private userRepository: UserRepository,
    private walletService: WalletService
  ) {}

  // CRON JOB: Process pending referrals for REGULAR users only
  async processPendingReferrals(): Promise<{
    processed: number;
    newMilestones: number;
  }> {
    try {
      // Get all REGULAR user referrals
      const regularReferrals = await this.referralRepository.find({
        userType: "regular",
      });

      let newMilestoneCount = 0;

      logger.info(
        `[Referral Cron] Processing ${regularReferrals.length} regular user referrals`
      );

      for (const referral of regularReferrals) {
        const metrics = await this.metricsRepository.findOne({
          userId: referral.referredId,
        });

        if (!metrics) continue;

        const referrer = await this.userRepository.findById(
          referral.refereeId.toString()
        );
        if (!referrer) continue;

        // Get ALL applicable bonuses for this amount
        const allApplicableBonuses =
          await this.referralBonusRepository.getAllApplicableBonuses(
            "regular",
            metrics.totalAmountTraded
          );

        if (!allApplicableBonuses.length) continue;

        // Get already earned bonus config IDs
        const earnedBonusIds = new Set(
          referral.bonusMilestones.map((m) => m.bonusConfigId.toString())
        );

        // Find NEW milestones that haven't been earned yet
        const newBonuses = allApplicableBonuses.filter(
          (bonus) => !earnedBonusIds.has(bonus.id.toString())
        );

        if (!newBonuses.length) continue;

        // Add each new milestone
        for (const bonus of newBonuses) {
          let bonusAmount = 0;

          if (bonus.bonusType === "flat") {
            bonusAmount = bonus.value; // Fixed amount
          } else if (bonus.bonusType === "percentage") {
            bonusAmount = (metrics.totalAmountTraded * bonus.value) / 100;
          }

          await this.referralRepository.addMilestone(
            referral.id,
            bonus.id,
            bonusAmount
          );

          newMilestoneCount++;

          logger.info(
            `[Referral Cron] Referral ${referral._id} earned milestone ${bonus.name}: ₦${bonusAmount}`
          );
        }
      }

      return {
        processed: regularReferrals.length,
        newMilestones: newMilestoneCount,
      };
    } catch (error) {
      logger.error(
        "[Referral Cron] Error processing pending referrals:",
        error
      );
      throw error;
    }
  }

  // CRON JOB: Pay earned bonuses (both regular milestones and influencer bonuses)
  async payQualifiedBonuses(): Promise<{
    regularPaid: number;
    influencerPaid: number;
  }> {
    try {
      let regularPaidCount = 0;
      let influencerPaidCount = 0;

      // 1. Pay regular user milestones
      const regularReferrals =
        await this.referralRepository.getRegularReferralsWithUnpaidMilestones();

      logger.info(
        `[Referral Cron] Paying ${regularReferrals.length} regular referrals with unpaid milestones`
      );

      for (const referral of regularReferrals) {
        const unpaidMilestones = referral.bonusMilestones.filter(
          (m) => m.status === "earned"
        );

        for (const milestone of unpaidMilestones) {
          try {
            const idempotencyKey = `referral-milestone:${referral._id}:${milestone.bonusConfigId}`;

            await this.walletService.creditWallet(
              referral.refereeId.toString(),
              milestone.bonusAmount,
              `Referral Bonus`,
              {
                idempotencyKey,
                initiatedByType: "system",
                meta: {
                  referralId: referral.id.toString(),
                  referredId: referral.referredId.toString(),
                  bonusConfigId: milestone.bonusConfigId.toString(),
                  logo: "https://ik.imagekit.io/x2ug9v49a/Screenshot_2026-01-06_134046_8_IN5WBUu.png",
                },
                remark: `Referral Milestone Bonus - User ${referral.referredId}`,
              }
            );

            await this.referralRepository.markMilestoneAsPaid(
              referral.id,
              milestone.bonusConfigId
            );

            regularPaidCount++;

            logger.info(
              `[Referral Cron] Milestone bonus ₦${milestone.bonusAmount} paid to ${referral.refereeId}`
            );
          } catch (error) {
            logger.error(
              `[Referral Cron] Failed to pay milestone for referral ${referral._id}:`,
              error
            );
            continue;
          }
        }
      }

      // 2. Pay influencer bonuses
      const influencerReferrals =
        await this.referralRepository.getInfluencerReferralsWithUnpaidBonuses();

      logger.info(
        `[Referral Cron] Paying ${influencerReferrals.length} influencer bonuses`
      );

      for (const referral of influencerReferrals) {
        if (
          !referral.influencerBonus ||
          referral.influencerBonus.status !== "earned"
        ) {
          continue;
        }

        try {
          const idempotencyKey = `influencer-bonus:${referral._id}`;

          await this.walletService.creditWallet(
            referral.refereeId.toString(),
            referral.influencerBonus.amount,
            `Referral Bonus`,
            {
              idempotencyKey,
              initiatedByType: "system",
              meta: {
                referralId: referral.id.toString(),
                referredId: referral.referredId.toString(),
                logo: "https://ik.imagekit.io/x2ug9v49a/Screenshot_2026-01-06_134046_8_IN5WBUu.png",
              },
              remark: `Influencer Referral Bonus - User ${referral.referredId}`,
            }
          );

          await this.referralRepository.markInfluencerBonusAsPaid(referral.id);

          influencerPaidCount++;

          logger.info(
            `[Referral Cron] Influencer bonus ₦${referral.influencerBonus.amount} paid to ${referral.refereeId}`
          );
        } catch (error) {
          logger.error(
            `[Referral Cron] Failed to pay influencer bonus for referral ${referral._id}:`,
            error
          );
          continue;
        }
      }

      return {
        regularPaid: regularPaidCount,
        influencerPaid: influencerPaidCount,
      };
    } catch (error) {
      logger.error("[Referral Cron] Error paying qualified bonuses:", error);
      throw error;
    }
  }

  // Called when referred user completes KYC (for influencers/micro-influencers only)
  async handleKYCCompletion(
    referredId: string | Types.ObjectId
  ): Promise<void> {
    try {
      const referredIdObj = new Types.ObjectId(referredId);
      const referral = await this.referralRepository.findOne({
        referredId: referredIdObj,
      });

      if (!referral) {
        logger.warn(`[KYC Handler] No referral found for user ${referredId}`);
        return;
      }

      // Only influencers/micro-influencers get KYC bonus
      if (referral.userType === "regular") {
        logger.info(
          `[KYC Handler] Regular user referral, no KYC bonus applicable`
        );
        return;
      }

      logger.info(`[KYC Handler] Processing KYC for referral ${referral._id}`);

      const referrer = await this.userRepository.findById(
        referral.refereeId.toString()
      );

      if (!referrer || !referrer.referralEarningRate) {
        logger.warn(`[KYC Handler] Referrer not found or no earning rate set`);
        return;
      }

      // Check if already processed (prevent duplicates)
      if (referral.kycCompletedAt || referral.influencerBonus) {
        logger.warn(
          `[KYC Handler] Referral ${referral._id} already processed for KYC`
        );
        return;
      }

      const bonusAmount = referrer.referralEarningRate;

      // Set the influencer bonus (will be paid by cron job)
      await this.referralRepository.updateOne(
        { _id: referral._id },
        {
          kycCompletedAt: new Date(),
        }
      );

      await this.referralRepository.setInfluencerBonus(
        referral.id,
        bonusAmount
      );

      logger.info(
        `[KYC Handler] Influencer bonus ₦${bonusAmount} marked as earned for ${referral.refereeId}`
      );
    } catch (error) {
      logger.error("[KYC Handler] Error processing KYC completion:", error);
      throw error;
    }
  }

  // Admin: Create bonus config
  async createBonus(data: any, adminId: string): Promise<any> {
    const config = await this.referralBonusRepository.create({
      ...data,
      createdBy: new Types.ObjectId(adminId),
      userType: "regular",
    });

    logger.info(
      `Admin ${adminId} created referral bonus config: ${config._id}`
    );
    return config;
  }

  // Admin: Update bonus config
  async updateBonus(id: string, data: any): Promise<any> {
    const config = await this.referralBonusRepository.update(id, data);
    logger.info(`Referral bonus config ${id} updated`);
    return config;
  }

  // Admin: Get all configs
  async getAllBonus(): Promise<any[]> {
    return await this.referralBonusRepository.find();
  }

  // User: Get referral stats
  async getReferralStats(refereeId: string): Promise<any> {
    const referrals = await this.referralRepository.getReferralsByReferee(
      new Types.ObjectId(refereeId)
    );

    const total = referrals.length;

    // Calculate earnings from milestones and influencer bonuses
    let totalEarned = 0;
    let paidAmount = 0;
    let pendingAmount = 0;

    let qualifiedCount = 0;
    let paidCount = 0;

    for (const referral of referrals) {
      // Regular user milestones
      if (referral.bonusMilestones && referral.bonusMilestones.length > 0) {
        const milestones = referral.bonusMilestones;
        const earnedMilestones = milestones.filter(
          (m) => m.status === "earned"
        );
        const paidMilestones = milestones.filter((m) => m.status === "paid");

        if (paidMilestones.length > 0) paidCount++;
        if (earnedMilestones.length > 0 || paidMilestones.length > 0)
          qualifiedCount++;

        totalEarned += milestones.reduce((sum, m) => sum + m.bonusAmount, 0);
        paidAmount += paidMilestones.reduce((sum, m) => sum + m.bonusAmount, 0);
        pendingAmount += earnedMilestones.reduce(
          (sum, m) => sum + m.bonusAmount,
          0
        );
      }

      // Influencer bonuses
      if (referral.influencerBonus) {
        totalEarned += referral.influencerBonus.amount;
        qualifiedCount++;

        if (referral.influencerBonus.status === "paid") {
          paidAmount += referral.influencerBonus.amount;
          paidCount++;
        } else {
          pendingAmount += referral.influencerBonus.amount;
        }
      }
    }

    const pendingReferrals = total - qualifiedCount;

    return {
      totalReferrals: total,
      qualifiedReferrals: qualifiedCount,
      paidReferrals: paidCount,
      pendingReferrals,
      totalEarned,
      paidAmount,
      pendingAmount,
    };
  }
}
