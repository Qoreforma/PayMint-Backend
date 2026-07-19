import { BaseRepository } from "../BaseRepository";
import {
  IUserTradeMetrics,
  UserTradeMetrics,
} from "@/models/core/UserTradeMetrics";
import { Types } from "mongoose";

export class UserTradeMetricsRepository extends BaseRepository<IUserTradeMetrics> {
  constructor() {
    super(UserTradeMetrics);
  }

  async getOrCreateUserMetrics(
    userId: string | Types.ObjectId
  ): Promise<IUserTradeMetrics> {
    const userIdObj = new Types.ObjectId(userId);

    let metrics = await this.findOne({ userId: userIdObj });

    if (!metrics) {
      metrics = await this.create({
        userId: userIdObj,
        totalTradesCount: 0,
        totalAmountTraded: 0,
        bonusesApplied: [],
      });
    }

    return metrics;
  }

  async incrementTradeCount(
    userId: string | Types.ObjectId,
    amount: number
  ): Promise<IUserTradeMetrics | null> {
    const userIdObj = new Types.ObjectId(userId);

    return await this.updateOne(
      { userId: userIdObj },
      {
        $inc: {
          totalAmountTraded: amount, // PRIMARY: increment by amount
          totalTradesCount: 1, // SECONDARY: increment trade count
        },
        lastTradeDate: new Date(),
      }
    );
  }

  async markBonusApplied(
    userId: string | Types.ObjectId,
    bonusId: string | Types.ObjectId,
    cashbackAmount: number,
    transactionId: string | Types.ObjectId
  ): Promise<IUserTradeMetrics | null> {
    return await this.updateOne(
      { userId: new Types.ObjectId(userId) },
      {
        $push: {
          bonusesApplied: {
            bonusId: new Types.ObjectId(bonusId),
            appliedAt: new Date(),
            cashbackAmount,
            transactionId: new Types.ObjectId(transactionId),
          },
        },
      }
    );
  }

  async checkBonusAlreadyApplied(
    userId: string | Types.ObjectId,
    bonusId: string | Types.ObjectId
  ): Promise<boolean> {
    const metrics = await this.findOne({ userId: new Types.ObjectId(userId) });

    if (!metrics) return false;

    return metrics.bonusesApplied.some(
      (b) => b.bonusId.toString() === new Types.ObjectId(bonusId).toString()
    );
  }

  async checkBonusAppliedForTransaction(
    userId: string | Types.ObjectId,
    transactionId: string | Types.ObjectId
  ): Promise<Boolean> {
    const metrics = await this.findOne({ userId: new Types.ObjectId(userId) });

    if (!metrics) return false;

    return metrics.bonusesApplied.some(
      (b) =>
        b.transactionId.toString() ===
        new Types.ObjectId(transactionId).toString()
    );
  }
}
