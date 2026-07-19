import { BaseRepository } from "../BaseRepository";
import { Leaderboard, ILeaderboardEntry } from "@/models/core/Leaderboard";
import { FilterQuery } from "mongoose";

// Types (and composite keys) ranked by USD instead of NGN.
// USD is the stable unit of value here — NGN is just an FX snapshot that
// drifts on its own, independent of how much the user actually traded.
const USD_RANKED_TYPES = new Set(["crypto", "giftcard", "crypto|giftcard"]);

const getSortField = (type: string): "totalAmount" | "totalAmountUSD" =>
  USD_RANKED_TYPES.has(type) ? "totalAmountUSD" : "totalAmount";

export class LeaderboardRepository extends BaseRepository<ILeaderboardEntry> {
  constructor() {
    super(Leaderboard);
  }

  async findByTypeAndPeriod(
    type: string,
    period: string,
    periodKey: string,
    limit: number = 50,
  ): Promise<ILeaderboardEntry[]> {
    const sortField = getSortField(type);
    return this.model
      .find({ type, period, periodKey })
      .sort({ [sortField]: -1, transactionCount: -1, lastTransactionAt: 1 })
      .limit(limit)
      .exec();
  }

  async findByTypesAndPeriod(
    types: string[],
    period: string,
    periodKey: string,
    limit: number,
  ) {
    const query: any = {
      period,
      periodKey,
      type: { $in: types },
    };

    // If every queried type is USD-ranked (e.g. a crypto+giftcard live
    // multi-fetch), sort by USD. A mixed bill-payment + crypto query has
    // no single fair unit, so it falls back to NGN.
    const sortField = types.every((t) => USD_RANKED_TYPES.has(t))
      ? "totalAmountUSD"
      : "totalAmount";

    return this.model
      .find(query)
      .sort({ [sortField]: -1, transactionCount: -1, lastTransactionAt: 1 })
      .limit(limit)
      .lean();
  }

  async findUserRank(
    userId: string,
    type: string,
    period: string,
    periodKey: string,
  ): Promise<ILeaderboardEntry | null> {
    return this.model.findOne({ userId, type, period, periodKey }).exec();
  }

  async upsertEntry(
    filter: FilterQuery<ILeaderboardEntry>,
    data: Partial<ILeaderboardEntry>,
  ): Promise<ILeaderboardEntry | null> {
    return this.model
      .findOneAndUpdate(filter, { $set: data }, { upsert: true, new: true })
      .exec();
  }

  async bulkUpsert(entries: Partial<ILeaderboardEntry>[]): Promise<void> {
    const bulkOps = entries.map((entry) => ({
      updateOne: {
        filter: {
          userId: entry.userId,
          type: entry.type,
          period: entry.period,
          periodKey: entry.periodKey,
        },
        update: { $set: entry },
        upsert: true,
      },
    }));

    await this.model.bulkWrite(bulkOps);
  }

  async updateRanks(
    type: string,
    period: string,
    periodKey: string,
  ): Promise<void> {
    const sortField = getSortField(type);

    // Get all entries sorted by the correct ranking unit for this type
    const entries = await this.model
      .find({ type, period, periodKey })
      .sort({ [sortField]: -1, transactionCount: -1, lastTransactionAt: 1 })
      .exec();

    // Update ranks
    const bulkOps = entries.map((entry, index) => ({
      updateOne: {
        filter: { _id: entry._id },
        update: { $set: { rank: index + 1 } },
      },
    }));

    if (bulkOps.length > 0) {
      await this.model.bulkWrite(bulkOps);
    }
  }

  async deleteOldEntries(
    type: string,
    period: string,
    periodKey: string,
  ): Promise<void> {
    await this.model.deleteMany({ type, period, periodKey }).exec();
  }

  async incrementUserStats(
    userId: string,
    walletId: string,
    type: string,
    period: string,
    periodKey: string,
    amount: number,
    amountUSD: number = 0,
    userDetails: any,
  ): Promise<void> {
    const inc: any = { totalAmount: amount, transactionCount: 1 };
    if (amountUSD > 0) {
      inc.totalAmountUSD = amountUSD;
    }

    await this.model
      .findOneAndUpdate(
        { userId, type, period, periodKey },
        {
          $inc: inc,
          $set: {
            walletId,
            userDetails,
            lastTransactionAt: new Date(),
            calculatedAt: new Date(),
          },
        },
        { upsert: true, new: true },
      )
      .exec();
  }

  async deleteStaleEntries(
    type: string,
    period: string,
    currentPeriodKey: string,
  ): Promise<void> {
    await this.model
      .deleteMany({ type, period, periodKey: { $ne: currentPeriodKey } })
      .exec();
  }
}
