import { Types } from "mongoose";
import { BaseRepository } from "../BaseRepository";
import { Referral, IReferral } from "@/models/wallet/Referral";

export class ReferralRepository extends BaseRepository<IReferral> {
  constructor() {
    super(Referral);
  }

  // Find all referrals by user ID (referee)
  async findByUserId(userId: string | Types.ObjectId): Promise<IReferral[]> {
    return await this.find({ refereeId: new Types.ObjectId(userId) });
  }

  async findUpline(userId: string | Types.ObjectId): Promise<IReferral | null> {
    return await this.findOne({ refereeId: new Types.ObjectId(userId) });
  }

  // Get regular user referrals with unpaid milestones
  async getRegularReferralsWithUnpaidMilestones(): Promise<IReferral[]> {
    return await this.find({
      userType: "regular",
      "bonusMilestones.status": "earned",
    });
  }

  // Get influencer referrals with unpaid bonuses
  async getInfluencerReferralsWithUnpaidBonuses(): Promise<IReferral[]> {
    return await this.find({
      userType: { $in: ["influencer", "micro-influencer"] },
      "influencerBonus.status": "earned",
    });
  }

  // Add milestone to referral
  async addMilestone(
    referralId: Types.ObjectId,
    bonusConfigId: Types.ObjectId,
    bonusAmount: number
  ): Promise<IReferral | null> {
    return await this.model.findByIdAndUpdate(
      referralId,
      {
        $push: {
          bonusMilestones: {
            bonusConfigId,
            bonusAmount,
            earnedAt: new Date(),
            status: "earned",
          },
        },
      },
      { new: true }
    );
  }

  // Mark specific milestone as paid
  async markMilestoneAsPaid(
    referralId: Types.ObjectId,
    bonusConfigId: Types.ObjectId
  ): Promise<IReferral | null> {
    return await this.model.findOneAndUpdate(
      {
        _id: referralId,
        "bonusMilestones.bonusConfigId": bonusConfigId,
        "bonusMilestones.status": "earned",
      },
      {
        $set: {
          "bonusMilestones.$.status": "paid",
          "bonusMilestones.$.paidAt": new Date(),
        },
      },
      { new: true }
    );
  }

  // Mark influencer bonus as paid
  async markInfluencerBonusAsPaid(
    referralId: Types.ObjectId
  ): Promise<IReferral | null> {
    return await this.model.findByIdAndUpdate(
      referralId,
      {
        $set: {
          "influencerBonus.status": "paid",
          "influencerBonus.paidAt": new Date(),
        },
      },
      { new: true }
    );
  }

  // Set influencer bonus
  async setInfluencerBonus(
    referralId: Types.ObjectId,
    amount: number
  ): Promise<IReferral | null> {
    return await this.model.findByIdAndUpdate(
      referralId,
      {
        $set: {
          influencerBonus: {
            amount,
            earnedAt: new Date(),
            status: "earned",
          },
        },
      },
      { new: true }
    );
  }

  // Get referrals by referee ID
  async getReferralsByReferee(refereeId: Types.ObjectId): Promise<IReferral[]> {
    return await this.find({ refereeId });
  }

  // Count referrals by user ID
  async countByUserId(userId: string | Types.ObjectId): Promise<number> {
    return await this.model.countDocuments({
      refereeId: new Types.ObjectId(userId),
    });
  }

  // Get total earnings (paid + unpaid) for a user
  async getTotalEarnings(userId: string | Types.ObjectId): Promise<number> {
    const result = await this.model.aggregate([
      { $match: { refereeId: new Types.ObjectId(userId) } },
      {
        $project: {
          totalMilestones: { $sum: "$bonusMilestones.bonusAmount" },
          influencerAmount: {
            $ifNull: ["$influencerBonus.amount", 0],
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $add: ["$totalMilestones", "$influencerAmount"] } },
        },
      },
    ]);
    return result[0]?.total || 0;
  }

  // Find referrals by referee ID for admin with populated user details
  async findReferralsByRefereeIdForAdmin(
    userId: string | Types.ObjectId
  ): Promise<IReferral[]> {
    return await this.find(
      { refereeId: new Types.ObjectId(userId) },
      undefined,
      [
        {
          path: "referredId",
          select: "firstname lastname email avatar country status createdAt",
        },
      ]
    );
  }

  // Find existing referral or create a new one
  async findOrCreateReferral(
    refereeId: string | Types.ObjectId,
    referredId: string | Types.ObjectId,
    userType: "regular" | "influencer" | "micro-influencer" | "vendor"
  ): Promise<IReferral> {
    const refereeObjectId = new Types.ObjectId(refereeId);
    const referredObjectId = new Types.ObjectId(referredId);

    // Try to find existing referral
    let referral = await this.findOne({
      refereeId: refereeObjectId,
      referredId: referredObjectId,
    });

    // If not found, create new referral
    if (!referral) {
      referral = await this.create({
        refereeId: refereeObjectId,
        referredId: referredObjectId,
        userType,
        bonusMilestones: [],
      } as Partial<IReferral>);
    }

    return referral;
  }

  // Get paid earnings for a user
  async getPaidEarnings(userId: string | Types.ObjectId): Promise<number> {
    const result = await this.model.aggregate([
      { $match: { refereeId: new Types.ObjectId(userId) } },
      {
        $project: {
          paidMilestones: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$bonusMilestones",
                    cond: { $eq: ["$$this.status", "paid"] },
                  },
                },
                in: "$$this.bonusAmount",
              },
            },
          },
          paidInfluencer: {
            $cond: {
              if: { $eq: ["$influencerBonus.status", "paid"] },
              then: { $ifNull: ["$influencerBonus.amount", 0] },
              else: 0,
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $add: ["$paidMilestones", "$paidInfluencer"] } },
        },
      },
    ]);
    return result[0]?.total || 0;
  }

  // Get unpaid earnings for a user
  async getUnpaidEarnings(userId: string | Types.ObjectId): Promise<number> {
    const result = await this.model.aggregate([
      { $match: { refereeId: new Types.ObjectId(userId) } },
      {
        $project: {
          unpaidMilestones: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$bonusMilestones",
                    cond: { $eq: ["$$this.status", "earned"] },
                  },
                },
                in: "$$this.bonusAmount",
              },
            },
          },
          unpaidInfluencer: {
            $cond: {
              if: { $eq: ["$influencerBonus.status", "earned"] },
              then: { $ifNull: ["$influencerBonus.amount", 0] },
              else: 0,
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $add: ["$unpaidMilestones", "$unpaidInfluencer"] } },
        },
      },
    ]);
    return result[0]?.total || 0;
  }
}
