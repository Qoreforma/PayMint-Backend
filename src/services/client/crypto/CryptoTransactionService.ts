import { AppError } from "@/middlewares/shared/errorHandler";
import { ICryptoTransaction } from "@/models/crypto/CryptoTransaction";
import { CryptoTransactionRepository } from "@/repositories/client/CryptoTransactionRepository";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Types, PipelineStage } from "mongoose";
import { NotificationService } from "../notifications/NotificationService";

export class CryptoTransactionService {
  constructor(
    private cryptoTransactionRepository: CryptoTransactionRepository,
        private notificationService: NotificationService,
    
  ) {}

  async getCryptoTransactions(
    userId: string,
    filters: any = {},
    page: number = 1,
    limit: number = 10,
  ) {
    const query: any = { userId: new Types.ObjectId(userId) };

    if (filters.tradeType) {
      query.tradeType = filters.tradeType;
    }

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.cryptoId) {
      query.cryptoId = new Types.ObjectId(filters.cryptoId);
    }

    if (filters.reference) {
      query.reference = filters.reference;
    }

    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) {
        query.createdAt.$gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        query.createdAt.$lte = new Date(filters.endDate);
      }
    }

    if (filters.search) {
      query.$or = [
        { reference: { $regex: filters.search, $options: "i" } },
        { "crypto.name": { $regex: filters.search, $options: "i" } },
        { "crypto.code": { $regex: filters.search, $options: "i" } },
        { "network.name": { $regex: filters.search, $options: "i" } },
        { "network.code": { $regex: filters.search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const pipeline: PipelineStage[] = [
      { $match: query },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: "cryptos",
                localField: "cryptoId",
                foreignField: "_id",
                as: "cryptoDetails",
              },
            },
            {
              $addFields: {
                crypto: {
                  $let: {
                    vars: {
                      cryptoDoc: { $arrayElemAt: ["$cryptoDetails", 0] },
                    },
                    in: {
                      name: "$$cryptoDoc.name",
                      code: "$$cryptoDoc.code",
                      icon: "$$cryptoDoc.icon",
                    },
                  },
                },
              },
            },
            {
              $project: {
                cryptoDetails: 0,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const [results] = await this.cryptoTransactionRepository.aggregate<{
      data: Array<
        ICryptoTransaction & {
          crypto: { name: string; code: string; icon: string };
        }
      >;
      totalCount: Array<{ count: number }>;
    }>(pipeline);

    const total = results.totalCount[0]?.count || 0;

    return {
      data: results.data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserTransactionsStats(
    userId: string,
    filters?: {
      startDate?: Date;
      endDate?: Date;
      cryptoId?: string;
    },
  ): Promise<{
    totalBuyAmount: number;
    totalSellAmount: number;
    totalBuy: number;
    totalSell: number;
  }> {
    const matchStage: any = {
      userId: new Types.ObjectId(userId),
    };

    if (filters?.startDate && filters?.endDate) {
      matchStage.createdAt = {
        $gte: filters.startDate,
        $lte: filters.endDate,
      };
    }
    if (filters?.cryptoId) {
    }

    const stats = await this.cryptoTransactionRepository.aggregate([
      { $match: matchStage },
      {
        $facet: {
          buyStats: [
            { $match: { tradeType: "buy" } },
            {
              $group: {
                _id: null,
                totalBuy: { $sum: 1 },
                totalBuyAmount: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ["$status", "s.approved"] },
                          { $ifNull: ["$reviewAmount", false] },
                        ],
                      },
                      "$reviewAmount",
                      "$fiatAmount",
                    ],
                  },
                },
              },
            },
          ],

          sellStats: [
            { $match: { tradeType: "sell" } },
            {
              $group: {
                _id: null,
                totalSell: { $sum: 1 },
                totalSellAmount: {
                  $sum: {
                    $cond: [
                      {
                        $in: [
                          "$status",
                          ["approved", "transferred", "s.approved"],
                        ],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $eq: ["$status", "s.approved"] },
                              { $ifNull: ["$reviewAmount", false] },
                            ],
                          },
                          "$reviewAmount",
                          "$fiatAmount",
                        ],
                      },
                      0,
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      {
        $project: {
          totalBuyAmount: {
            $ifNull: [{ $arrayElemAt: ["$buyStats.totalBuyAmount", 0] }, 0],
          },
          totalBuy: {
            $ifNull: [{ $arrayElemAt: ["$buyStats.totalBuy", 0] }, 0],
          },
          totalSellAmount: {
            $ifNull: [{ $arrayElemAt: ["$sellStats.totalSellAmount", 0] }, 0],
          },
          totalSell: {
            $ifNull: [{ $arrayElemAt: ["$sellStats.totalSell", 0] }, 0],
          },
        },
      },
    ]);

    return (
      stats[0] || {
        totalBuyAmount: 0,
        totalSellAmount: 0,
        totalBuy: 0,
        totalSell: 0,
      }
    );
  }

  async getCryptoTransactionById(transactionId: string, userId?: string) {
    const pipeline: PipelineStage[] = [
      { $match: { _id: new Types.ObjectId(transactionId) } },
      {
        $lookup: {
          from: "cryptos",
          localField: "cryptoId",
          foreignField: "_id",
          as: "cryptoDetails",
        },
      },
      {
        $addFields: {
          crypto: {
            $let: {
              vars: { cryptoDoc: { $arrayElemAt: ["$cryptoDetails", 0] } },
              in: {
                name: "$$cryptoDoc.name",
                code: "$$cryptoDoc.code",
                icon: "$$cryptoDoc.icon",
              },
            },
          },
        },
      },
      {
        $project: {
          cryptoDetails: 0,
        },
      },
    ];

    const transaction = await this.cryptoTransactionRepository.aggregateOne<
      ICryptoTransaction & {
        crypto: { name: string; code: string; icon: string };
      }
    >(pipeline);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    if (userId && transaction.userId.toString() !== userId) {
      throw new AppError(
        "Unauthorized access",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    return transaction;
  }

  async getCryptoTransactionByReference(reference: string, userId?: string) {
    const pipeline: PipelineStage[] = [
      { $match: { reference } },
      {
        $lookup: {
          from: "cryptos",
          localField: "cryptoId",
          foreignField: "_id",
          as: "cryptoDetails",
        },
      },
      {
        $addFields: {
          crypto: {
            $let: {
              vars: { cryptoDoc: { $arrayElemAt: ["$cryptoDetails", 0] } },
              in: {
                name: "$$cryptoDoc.name",
                code: "$$cryptoDoc.code",
                icon: "$$cryptoDoc.icon",
              },
            },
          },
        },
      },
      {
        $project: {
          cryptoDetails: 0,
        },
      },
    ];

    const transaction = await this.cryptoTransactionRepository.aggregateOne<
      ICryptoTransaction & {
        crypto: { name: string; code: string; icon: string };
      }
    >(pipeline);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    if (userId && transaction.userId.toString() !== userId) {
      throw new AppError(
        "Unauthorized access",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    return transaction;
  }

  async getMonthlyVolume(
    userId: string,
    options: {
      month?: number;
      year?: number;
      tradeType?: "buy" | "sell" | "both";
    } = {},
  ) {
    const currentDate = new Date();
    const targetMonth = options.month || currentDate.getMonth() + 1;
    const targetYear = options.year || currentDate.getFullYear();
    const tradeType = options.tradeType || "both";

    const startOfMonth = new Date(targetYear, targetMonth - 1, 1);
    const endOfMonth = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);

    const startOfPrevMonth = new Date(targetYear, targetMonth - 2, 1);
    const endOfPrevMonth = new Date(
      targetYear,
      targetMonth - 1,
      0,
      23,
      59,
      59,
      999,
    );

    const userObjectId = new Types.ObjectId(userId);

    const baseMatch: any = {
      userId: userObjectId,
      status: { $in: ["approved", "s.approved", "transferred"] },
    };

    if (tradeType !== "both") {
      baseMatch.tradeType = tradeType;
    }

    const currentMonthPipeline = [
      {
        $match: {
          ...baseMatch,
          createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          totalVolume: {
            $sum: {
              $cond: [
                { $eq: ["$status", "s.approved"] },
                { $ifNull: ["$reviewAmount", "$fiatAmount"] },
                "$fiatAmount",
              ],
            },
          },
          buyVolume: {
            $sum: {
              $cond: [
                { $eq: ["$tradeType", "buy"] },
                {
                  $cond: [
                    { $eq: ["$status", "s.approved"] },
                    { $ifNull: ["$reviewAmount", "$fiatAmount"] },
                    "$fiatAmount",
                  ],
                },
                0,
              ],
            },
          },
          sellVolume: {
            $sum: {
              $cond: [
                { $eq: ["$tradeType", "sell"] },
                {
                  $cond: [
                    { $eq: ["$status", "s.approved"] },
                    { $ifNull: ["$reviewAmount", "$fiatAmount"] },
                    "$fiatAmount",
                  ],
                },
                0,
              ],
            },
          },
          transactionCount: { $sum: 1 },
        },
      },
    ];

    const prevMonthPipeline = [
      {
        $match: {
          ...baseMatch,
          createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth },
        },
      },
      {
        $group: {
          _id: null,
          totalVolume: {
            $sum: {
              $cond: [
                { $eq: ["$status", "s.approved"] },
                { $ifNull: ["$reviewAmount", "$fiatAmount"] },
                "$fiatAmount",
              ],
            },
          },
        },
      },
    ];

    const [current, previous] = await Promise.all([
      this.cryptoTransactionRepository.aggregate(currentMonthPipeline),
      this.cryptoTransactionRepository.aggregate(prevMonthPipeline),
    ]);

    const currentData = current[0] || {
      totalVolume: 0,
      buyVolume: 0,
      sellVolume: 0,
      transactionCount: 0,
    };

    const previousVolume = previous[0]?.totalVolume || 0;

    return {
      totalVolume: currentData.totalVolume,
      buyVolume: currentData.buyVolume,
      sellVolume: currentData.sellVolume,
      transactionCount: currentData.transactionCount,
      previousMonthVolume: previousVolume,
    };
  }

  async getYearlyVolumeBreakdown(
    userId: string,
    options: {
      year?: number;
      tradeType?: "buy" | "sell" | "both";
    } = {},
  ) {
    const targetYear = options.year || new Date().getFullYear();
    const tradeType = options.tradeType || "both";

    const startOfYear = new Date(targetYear, 0, 1);
    const endOfYear = new Date(targetYear, 11, 31, 23, 59, 59, 999);

    const userObjectId = new Types.ObjectId(userId);

    const baseMatch: any = {
      userId: userObjectId,
      status: { $in: ["approved", "s.approved", "transferred"] },
      createdAt: { $gte: startOfYear, $lte: endOfYear },
    };

    if (tradeType !== "both") {
      baseMatch.tradeType = tradeType;
    }

    const pipeline = [
      { $match: baseMatch },
      {
        $group: {
          _id: { $month: "$createdAt" },
          totalVolume: {
            $sum: {
              $cond: [
                { $eq: ["$status", "s.approved"] },
                { $ifNull: ["$reviewAmount", "$fiatAmount"] },
                "$fiatAmount",
              ],
            },
          },
          buyVolume: {
            $sum: {
              $cond: [
                { $eq: ["$tradeType", "buy"] },
                {
                  $cond: [
                    { $eq: ["$status", "s.approved"] },
                    { $ifNull: ["$reviewAmount", "$fiatAmount"] },
                    "$fiatAmount",
                  ],
                },
                0,
              ],
            },
          },
          sellVolume: {
            $sum: {
              $cond: [
                { $eq: ["$tradeType", "sell"] },
                {
                  $cond: [
                    { $eq: ["$status", "s.approved"] },
                    { $ifNull: ["$reviewAmount", "$fiatAmount"] },
                    "$fiatAmount",
                  ],
                },
                0,
              ],
            },
          },
          transactionCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ] as PipelineStage[];

    const results = await this.cryptoTransactionRepository.aggregate(pipeline);

    const monthlyData = Array.from({ length: 12 }, (_, i) => {
      const monthData = results.find((r) => r._id === i + 1);
      return {
        month: i + 1,
        totalVolume: monthData?.totalVolume || 0,
        buyVolume: monthData?.buyVolume || 0,
        sellVolume: monthData?.sellVolume || 0,
        transactionCount: monthData?.transactionCount || 0,
      };
    });

    const yearTotal = monthlyData.reduce((sum, m) => sum + m.totalVolume, 0);
    const yearBuyTotal = monthlyData.reduce((sum, m) => sum + m.buyVolume, 0);
    const yearSellTotal = monthlyData.reduce((sum, m) => sum + m.sellVolume, 0);
    const yearTransactionCount = monthlyData.reduce(
      (sum, m) => sum + m.transactionCount,
      0,
    );

    return {
      year: targetYear,
      yearTotal,
      yearBuyTotal,
      yearSellTotal,
      yearTransactionCount,
      monthlyData,
    };
  }

  async exportCryptoTransactions(
    userId: string,
    filters: any = {},
  ): Promise<string> {
    const query: any = { userId: new Types.ObjectId(userId) };

    if (filters.tradeType) query.tradeType = filters.tradeType;
    if (filters.status) query.status = filters.status;
    if (filters.cryptoId) query.cryptoId = new Types.ObjectId(filters.cryptoId);
    if (filters.networkCode) query["network.code"] = filters.networkCode;

    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) {
        query.createdAt.$gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDate;
      }
    }

    const result = await this.cryptoTransactionRepository.findWithPagination(
      query,
      1,
      10000,
      { createdAt: -1 },
    );

    const headers = [
      "Reference",
      "Trade Type",
      "Crypto",
      "Network",
      "Crypto Amount",
      "Fiat Amount",
      "Exchange Rate",
      "Service Fee",
      "Total Amount",
      "Status",
      "Wallet Address",
      "TX Hash",
      "Confirmations",
      "Bank Account",
      "Review Note",
      "Date",
    ];

    const rows = result.data.map((t: any) => [
      t.reference,
      t.tradeType,
      t.cryptoId?.name || t.cryptoId || "",
      t.network?.name || "",
      t.cryptoAmount,
      t.fiatAmount,
      t.exchangeRate,
      t.serviceFee || 0,
      t.totalAmount,
      t.status,
      t.walletAddress,
      t.txHash || "",
      t.confirmations || 0,
      t.accountNumber || "",
      t.reviewNote || "",
      new Date(t.createdAt).toISOString(),
    ]);

    const escapeCsvValue = (value: any): string => {
      const strValue = String(value);
      if (
        strValue.includes(",") ||
        strValue.includes('"') ||
        strValue.includes("\n")
      ) {
        return `"${strValue.replace(/"/g, '""')}"`;
      }
      return strValue;
    };

    const csv = [
      headers.join(","),
      ...rows.map((row: any[]) => row.map(escapeCsvValue).join(",")),
    ].join("\n");

    return csv;
  }

  async generateCryptoReceipt(reference: string, userId: string): Promise<any> {
    const transaction = await this.getCryptoTransactionByReference(
      reference,
      userId,
    );

    if (!["success", "approved"].includes(transaction.status)) {
      throw new AppError(
        "Receipt can only be generated for successful or approved transactions",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    return {
      receiptNumber: `CRYPTO-RCP-${transaction.reference}`,
      reference: transaction.reference,
      tradeType: transaction.tradeType,
      crypto: transaction.cryptoId,
      network: transaction.network,
      walletAddress: transaction.walletAddress,
      cryptoAmount: transaction.cryptoAmount,
      fiatAmount: transaction.fiatAmount,
      exchangeRate: transaction.exchangeRate,
      serviceFee: transaction.serviceFee,
      totalAmount: transaction.totalAmount,
      status: transaction.status,
      txHash: transaction.txHash,
      confirmations: transaction.confirmations,
      blockNumber: transaction.blockNumber,
      bankDetails: transaction.accountNumber
        ? {
            accountName: transaction.accountName,
            accountNumber: transaction.accountNumber,
            bankCode: transaction.bankCode,
          }
        : null,
      reviewNote: transaction.reviewNote,
      transactionDate: transaction.createdAt,
      completedDate: transaction.completedAt,
      generatedAt: new Date(),
    };
  }

  async uploadTransactionProof(
    reference: string,
    userId: string,
    proof: string,
  ): Promise<any> {
    const transaction = await this.getCryptoTransactionByReference(
      reference,
      userId,
    );

    if (transaction.tradeType !== "sell") {
      throw new AppError(
        "Proof can only be uploaded for sell transactions",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (!["pending", "processing"].includes(transaction.status)) {
      throw new AppError(
        "Cannot upload proof for completed transactions",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const updated = await this.cryptoTransactionRepository.update(
      transaction.id.toString(),
      { proof },
    );

    await this.notificationService.createNotification({
      type: "admin_crypto_proof_uploaded",
      notifiableType: "Admin",
      notifiableId: transaction.userId,
      data: {
        reference: transaction.reference,
        cryptoAmount: transaction.cryptoAmount,
        cryptoCode: transaction.cryptoId,
        proof,
      },
      sendEmail: true,
      sendSMS: false,
      sendPush: false,
    });

    return updated;
  }
}
