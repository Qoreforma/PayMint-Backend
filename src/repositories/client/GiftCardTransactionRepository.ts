import { BaseRepository } from "../BaseRepository";
import {
  GiftCardTransaction,
  IGiftCardTransaction,
} from "@/models/giftcard/GiftCardTransaction";
import { ClientSession, FilterQuery, Types } from "mongoose";

export class GiftCardTransactionRepository extends BaseRepository<IGiftCardTransaction> {
  constructor() {
    super(GiftCardTransaction);
  }

  async findByDateRange(
    startDate: Date,
    endDate: Date,
  ): Promise<IGiftCardTransaction[]> {
    return this.model
      .find({
        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },
      })
      .exec();
  }

  async findPendingTransactions(): Promise<IGiftCardTransaction[]> {
    return this.model.find({ status: "pending" }).exec();
  }

  async updateReview(
    transactionId: string,
    reviewData: {
      reviewNote?: string;
      reviewRate?: number;
      reviewAmount?: number;
      reviewProof?: string;
    },
  ): Promise<IGiftCardTransaction | null> {
    return this.model
      .findByIdAndUpdate(transactionId, reviewData, { new: true })
      .exec();
  }

  async getTotalVolume(filters: any = {}): Promise<number> {
    const transactions = await this.model.find(filters).exec();
    return transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
  }

  async getTransactionStats(filters: any = {}): Promise<{
    totalTransactions: number;
    totalVolume: number;
    averageAmount: number;
    byStatus: Record<string, number>;
    byTradeType: Record<string, number>;
  }> {
    const transactions = await this.model.find(filters).exec();

    const totalTransactions = transactions.length;
    const totalVolume = transactions.reduce(
      (sum, t) => sum + (t.amount || 0),
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

    return {
      totalTransactions,
      totalVolume,
      averageAmount,
      byStatus,
      byTradeType,
    };
  }

  async findPendingSellTransactions(page: number = 1, limit: number = 20) {
    return this.findWithPagination(
      {
        tradeType: "sell",
        status: "pending",
        parentId: { $exists: false }, // Exclude children
      },
      page,
      limit,
      { createdAt: -1 },
      [
        { path: "userId", select: "firstName lastName email phone" },
        { path: "giftCardId", select: "name logo currency" },
      ],
    );
  }

  async findAwaitingSecondApproval(page: number = 1, limit: number = 20) {
    return this.findWithPagination(
      {
        tradeType: "sell",
        status: "approved",
        reviewedAmount: { $exists: true },
      },
      page,
      limit,
      { createdAt: -1 },
      [
        { path: "userId", select: "firstName lastName email phone" },
        { path: "giftCardId", select: "name logo currency" },
        { path: "reviewedBy", select: "firstName lastName" },
      ],
    );
  }

  async findByReference(
    reference: string,
  ): Promise<IGiftCardTransaction | null> {
    return this.model
      .findOne({ reference })
      .populate("giftCardId")
      .populate("userId", "firstname lastname email phone")
      .exec();
  }

  async findByReferenceWithoutPopulate(
    reference: string,
  ): Promise<IGiftCardTransaction | null> {
    return this.model
      .findOne({ reference })

      .exec();
  }

  async findByUserId(
    userId: string | Types.ObjectId,
    filters: any = {},
    page: number = 1,
    limit: number = 10,
  ) {
    return this.findWithPagination(
      { userId, ...filters },
      page,
      limit,
      { createdAt: -1 },
      [
        { path: "giftCardId", select: "name logo currency" },
        { path: "parentId", select: "reference groupTag status" },
      ],
    );
  }

  async findByGroupTag(groupTag: string): Promise<IGiftCardTransaction[]> {
    return this.model
      .find({ groupTag })
      .populate("giftCardId", "name logo currency")
      .populate("userId", "firstname lastname email phone")
      .sort({ createdAt: -1 })
      .exec();
  }

  // Find pending sell transactions for a specific user and gift card
  // Used to determine if we need to create/update parent transaction
  async findPendingSellByUserAndGiftCard(
    userId: string,
    giftCardId: string,
  ): Promise<IGiftCardTransaction[]> {
    return this.model
      .find({
        userId: new Types.ObjectId(userId),
        giftCardId: new Types.ObjectId(giftCardId),
        tradeType: "sell",
        status: { $in: ["pending", "multiple"] },
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  // Find all children of a parent transaction
  async findChildrenByParentId(
    parentId: string,
  ): Promise<IGiftCardTransaction[]> {
    return this.model
      .find({ parentId: new Types.ObjectId(parentId) })
      .populate("giftCardId", "name logo currency")
      .sort({ createdAt: -1 })
      .exec();
  }

  async updateStatus(
    transactionId: string,
    status:
      | "pending"
      | "processing"
      | "success"
      | "failed"
      | "approved"
      | "declined"
      | "multiple"
      | "s.approved",
    reviewData?: any,
  ): Promise<IGiftCardTransaction | null> {
    return this.model
      .findByIdAndUpdate(
        transactionId,
        { status, ...reviewData },
        { new: true },
      )
      .exec();
  }

  async countPendingSellByUserAndGiftCard(
    userId: string,
    giftCardId: string,
  ): Promise<number> {
    return this.model.countDocuments({
      userId: new Types.ObjectId(userId),
      giftCardId: new Types.ObjectId(giftCardId),
      tradeType: "sell",
      status: { $in: ["pending", "multiple"] },
    });
  }

  async findByGiftCardId(
    giftCardId: string | Types.ObjectId,
    page: number = 1,
    limit: number = 10,
  ) {
    return this.findWithPagination({ giftCardId }, page, limit);
  }

  async findByStatus(status: string, page: number = 1, limit: number = 10) {
    return this.findWithPagination({ status }, page, limit);
  }

  async findByTradeType(
    tradeType: "buy" | "sell",
    page: number = 1,
    limit: number = 10,
  ) {
    return this.findWithPagination({ tradeType }, page, limit);
  }

  async findChildTransactions(parentId: string | Types.ObjectId) {
    return this.model.find({ parentId }).sort({ createdAt: -1 }).lean().exec();
  }

  async findWithFilters(
    query: any,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: any[]; total: number }> {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.model
        .find(query)
        .populate("giftCardId", "name category country")
        .populate("userId", "firstName lastName email")
        .populate("bankAccountId", "bankName accountName accountNumber")
        .populate("reviewedBy", "firstName lastName")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);

    return {
      data,
      total,
    };
  }

  async findWithPaginationPendingFirst(
    filter: FilterQuery<IGiftCardTransaction>,
    page: number = 1,
    limit: number = 10,
    populate?: Array<{ path: string; select?: string; populate?: any }>,
    session?: ClientSession,
  ): Promise<{ data: IGiftCardTransaction[]; total: number }> {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.model
        .aggregate([
          { $match: filter },
          {
            $addFields: {
              _sortPriority: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
            },
          },
          { $sort: { _sortPriority: -1, createdAt: -1 } },
          { $skip: skip },
          { $limit: limit },
        ])
        .session(session ?? null),
      this.model.countDocuments(filter).session(session ?? null),
    ]);

    const hydrated = data.map((doc) => this.model.hydrate(doc));

    if (populate && populate.length > 0) {
      await this.model.populate(hydrated, populate as any);
    }

    return { data: hydrated, total };
  }
}
