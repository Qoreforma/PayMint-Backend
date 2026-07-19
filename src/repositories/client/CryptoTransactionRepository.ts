import { BaseRepository } from "../BaseRepository";
import {
  CryptoTransaction,
  ICryptoTransaction,
} from "@/models/crypto/CryptoTransaction";
import { Types, PipelineStage } from "mongoose";

export class CryptoTransactionRepository extends BaseRepository<ICryptoTransaction> {
  constructor() {
    super(CryptoTransaction);
  }

  async findByTransactionId(
    transactionId: string,
  ): Promise<ICryptoTransaction | null> {
    return this.model.findOne({ transactionId }).exec();
  }

  async findByStatus(
    status: ICryptoTransaction["status"],
  ): Promise<ICryptoTransaction[]> {
    return this.model.find({ status }).exec();
  }

  async findByTradeType(
    tradeType: "buy" | "sell",
  ): Promise<ICryptoTransaction[]> {
    return this.model.find({ tradeType }).exec();
  }

  async findByCryptoId(
    cryptoId: string | Types.ObjectId,
  ): Promise<ICryptoTransaction[]> {
    return this.model.find({ cryptoId }).exec();
  }

  async findByDateRange(
    startDate: Date,
    endDate: Date,
  ): Promise<ICryptoTransaction[]> {
    return this.model
      .find({
        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },
      })
      .exec();
  }

  async findApprovedTransactions(): Promise<ICryptoTransaction[]> {
    return this.model.find({ status: "approved" }).exec();
  }

  async updateStatus(
    transactionId: string,
    status: ICryptoTransaction["status"],
  ): Promise<ICryptoTransaction | null> {
    return this.model
      .findByIdAndUpdate(transactionId, { status }, { new: true })
      .exec();
  }

  async updateReview(
    transactionId: string,
    reviewData: {
      reviewNote?: string;
      reviewRate?: number;
      reviewAmount?: number;
      reviewProof?: string;
    },
  ): Promise<ICryptoTransaction | null> {
    return this.model
      .findByIdAndUpdate(transactionId, reviewData, { new: true })
      .exec();
  }

  async findWithFilters(filters: {
    userId?: string | Types.ObjectId;
    status?: ICryptoTransaction["status"];
    tradeType?: "buy" | "sell";
    startDate?: Date;
    endDate?: Date;
    cryptoId?: string | Types.ObjectId;
  }): Promise<ICryptoTransaction[]> {
    const query: any = {};

    if (filters.userId) query.userId = filters.userId;
    if (filters.status) query.status = filters.status;
    if (filters.tradeType) query.tradeType = filters.tradeType;
    if (filters.cryptoId) query.cryptoId = filters.cryptoId;

    if (filters.startDate && filters.endDate) {
      query.createdAt = {
        $gte: filters.startDate,
        $lte: filters.endDate,
      };
    }

    return this.model.find(query).exec();
  }

  async getTotalVolume(filters: any = {}): Promise<number> {
    const transactions = await this.model.find(filters).exec();
    return transactions.reduce((sum, t) => sum + (t.cryptoAmount || 0), 0);
  }

  async getTransactionStats(filters: any = {}): Promise<{
    totalTransactions: number;
    totalVolume: number;
    averageAmount: number;
    byStatus: Record<string, number>;
    byTradeType: Record<string, number>;
    byCryptocurrency: Record<string, number>;
  }> {
    const transactions = await this.model.find(filters).exec();

    const totalTransactions = transactions.length;
    const totalVolume = transactions.reduce(
      (sum, t) => sum + (t.cryptoAmount || 0),
      0,
    );
    const averageAmount =
      totalTransactions > 0 ? totalVolume / totalTransactions : 0;

    const byStatus = transactions.reduce(
      (acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const byTradeType = transactions.reduce(
      (acc, t) => {
        acc[t.tradeType] = (acc[t.tradeType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const byCryptocurrency = transactions.reduce(
      (acc, t) => {
        const cryptoId = t.cryptoId.toString();
        acc[cryptoId] = (acc[cryptoId] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      totalTransactions,
      totalVolume,
      averageAmount,
      byStatus,
      byTradeType,
      byCryptocurrency,
    };
  }

  // Add aggregate method for advanced queries
  async aggregate<T = any>(pipeline: PipelineStage[]): Promise<T[]> {
    return this.model.aggregate<T>(pipeline).exec();
  }

  // Get crypto transaction volume by cryptocurrency
  async getVolumeByMeta(metaField: string): Promise<
    Array<{
      cryptocurrency: string;
      volume: number;
      count: number;
    }>
  > {
    const result = await this.aggregate([
      { $match: { status: "success" } },
      {
        $group: {
          _id: `$${metaField}`,
          volume: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { volume: -1 } },
    ]);

    return result.map((item) => ({
      cryptocurrency: item._id || "Unknown",
      volume: item.volume,
      count: item.count,
    }));
  }
  async findByReference(reference: string): Promise<ICryptoTransaction | null> {
    return this.model.findOne({ reference }).exec();
  }

  async findByUserId(
    userId: string,
    filters: any = {},
    page: number = 1,
    limit: number = 10,
  ) {
    const query: any = { userId: new Types.ObjectId(userId), ...filters };
    return this.findWithPagination(query, page, limit, { createdAt: -1 }, [
      { path: "cryptoId", select: "name code symbol icon" },
      { path: "reviewedBy", select: "firstName lastName email" },
    ]);
  }

  async findByTxHash(txHash: string): Promise<ICryptoTransaction | null> {
    return this.model.findOne({ txHash }).exec();
  }

  async updateTransactionStatus(
    transactionId: string,
    status: string,
    additionalData?: any,
  ): Promise<ICryptoTransaction | null> {
    return this.model
      .findByIdAndUpdate(
        transactionId,
        { status, ...additionalData },
        { new: true },
      )
      .exec();
  }

  async findPendingTransactions(
    tradeType?: "buy" | "sell",
  ): Promise<ICryptoTransaction[]> {
    const query: any = { status: "pending" };
    if (tradeType) {
      query.tradeType = tradeType;
    }
    return this.model
      .find(query)
      .populate("userId", "firstName lastName email")
      .populate("cryptoId", "name code symbol")
      .sort({ createdAt: 1 })
      .exec();
  }

  async countByStatus(status: string): Promise<number> {
    return this.model.countDocuments({ status }).exec();
  }

  async getTotalVolumeByType(
    tradeType: "buy" | "sell",
    startDate?: Date,
    endDate?: Date,
  ): Promise<number> {
    const match: any = {
      tradeType,
      status: { $in: ["approved", "transferred"] },
    };
    if (startDate && endDate) {
      match.createdAt = { $gte: startDate, $lte: endDate };
    }

    const result = await this.model.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: "$fiatAmount" } } },
    ]);

    return result[0]?.total || 0;
  }

  // Find one with filters
  // Find one with filters
  async findOne(
    filters: any,
    select?: string,
    populate?: Array<{ path: string; select?: string; populate?: any }>,
    session?: import("mongoose").ClientSession,
  ): Promise<ICryptoTransaction | null> {
    return this.model
      .findOne(filters)
      .session(session ?? null)
      .exec();
  }

  async claimForProcessing(
    filters: any,
    webhookTxId: string,
    session?: import("mongoose").ClientSession,
  ): Promise<ICryptoTransaction | null> {
    const STALE_THRESHOLD_MS = 10 * 60 * 1000;
    const staleTime = new Date(Date.now() - STALE_THRESHOLD_MS);
    const { status: _ignored, ...baseFilters } = filters;

    return this.model
      .findOneAndUpdate(
        {
          ...baseFilters,
          tatumWebhookId: { $exists: false },
          $or: [
            { status: "pending_deposit" },
            { status: "processing", claimedAt: { $lt: staleTime } },
          ],
        },
        {
          $set: {
            status: "processing",
            claimedAt: new Date(),
            tatumWebhookId: `${webhookTxId}:${baseFilters.tatumDepositAddress}`,
          },
        },
        {
          new: false,
          session,
          // Deterministic tie-breaker: with a reused deposit address, more
          // than one pending_deposit/stale-processing record can exist at
          // once. Without a sort, which one gets claimed is whatever Mongo
          // happens to return first — effectively random. Oldest-first
          // (FIFO) makes the outcome predictable and explainable, even
          // though it doesn't guarantee the "correct" record is picked
          // (a BTC address has no memo field to disambiguate by).
          sort: { createdAt: 1 },
        },
      )
      .exec();
  }
}