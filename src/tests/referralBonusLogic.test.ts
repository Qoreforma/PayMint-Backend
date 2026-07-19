import mongoose from "mongoose";
import { ReferralBonusRepository } from "@/repositories/admin/ReferralBonusRepository";
import { ReferralRepository } from "@/repositories/client/ReferralRepository";
import { UserTradeMetricsRepository } from "@/repositories/shared/UserTradeMetricsRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { ReferralBonusService } from "@/services/admin/finances/ReferralBonusService";
import { User } from "@/models/core/User";
import { Referral } from "@/models/wallet/Referral";
import { UserTradeMetrics } from "@/models/core/UserTradeMetrics";
import { ReferralBonus } from "@/models/billing/bonuses/ReferralBonus";

describe("Referral Bonus Logic (H1 Bug Fix)", () => {
  let referralBonusService: ReferralBonusService;
  let referralRepository: ReferralRepository;
  let referrerId: mongoose.Types.ObjectId;
  let referredId: mongoose.Types.ObjectId;
  let referralId: mongoose.Types.ObjectId;

  beforeEach(async () => {
    // Setup Repositories and Services
    const referralBonusRepo = new ReferralBonusRepository();
    referralRepository = new ReferralRepository();
    const metricsRepo = new UserTradeMetricsRepository();
    const userRepo = new UserRepository();
    
    // We mock WalletService completely
    const walletService = {} as any;

    referralBonusService = new ReferralBonusService(
      referralBonusRepo,
      referralRepository,
      metricsRepo,
      userRepo,
      walletService
    );

    // Create 2 Configs
    await ReferralBonus.create({
      name: "Tier 1",
      userType: "regular",
      bonusType: "flat",
      value: 10,
      threshold: 1000,
      isActive: true,
      createdBy: new mongoose.Types.ObjectId()
    });

    await ReferralBonus.create({
      name: "Tier 2",
      userType: "regular",
      bonusType: "flat",
      value: 1000,
      threshold: 100000,
      isActive: true,
      createdBy: new mongoose.Types.ObjectId()
    });

    // Create Users
    const referrer = await User.create({
      firstname: "Referrer",
      lastname: "User",
      email: "referrer@example.com",
      password: "HashPassword123",
      userType: "regular"
    });
    referrerId = referrer._id as mongoose.Types.ObjectId;

    const referred = await User.create({
      firstname: "Referred",
      lastname: "User",
      email: "referred@example.com",
      password: "HashPassword123",
      userType: "regular"
    });
    referredId = referred._id as mongoose.Types.ObjectId;

    // Create Referral
    const referral = await Referral.create({
      refereeId: referrerId,
      referredId: referredId,
      userType: "regular",
      bonusMilestones: []
    });
    referralId = referral._id as mongoose.Types.ObjectId;
  });

  const setTradedAmount = async (amount: number) => {
    await UserTradeMetrics.create({
      userId: referredId,
      totalAmountTraded: amount,
      totalTradesCount: 1,
      successfulTradesCount: 1,
      failedTradesCount: 0,
      lastTradeDate: new Date()
    });
  };

  it("should NOT be eligible for any tier if totalAmountTraded = 999", async () => {
    await setTradedAmount(999);
    await referralBonusService.processPendingReferrals();

    const ref = await Referral.findById(referralId);
    expect(ref?.bonusMilestones).toHaveLength(0);
  });

  it("should get ₦10 milestone if totalAmountTraded = 1000", async () => {
    await setTradedAmount(1000);
    await referralBonusService.processPendingReferrals();

    const ref = await Referral.findById(referralId);
    expect(ref?.bonusMilestones).toHaveLength(1);
    expect(ref?.bonusMilestones[0].bonusAmount).toBe(10);
  });

  it("should get BOTH ₦10 and ₦1000 milestones if totalAmountTraded = 100000", async () => {
    await setTradedAmount(100000);
    await referralBonusService.processPendingReferrals();

    const ref = await Referral.findById(referralId);
    expect(ref?.bonusMilestones).toHaveLength(2);
    
    const amounts = ref?.bonusMilestones.map(m => m.bonusAmount).sort((a, b) => a - b);
    expect(amounts).toEqual([10, 1000]);
  });
});
