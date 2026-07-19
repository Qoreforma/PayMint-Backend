import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  WALLET_OPERATION_TYPES,
  BILL_PAYMENT_TYPES,
} from "@/utils/constants";
import { TransactionMapper } from "@/utils/mapper/TransactionMapper";
import { CryptoService } from "../crypto/CryptoService";
import { GiftCardService } from "../GiftCardService";
import { CryptoTransactionService } from "../crypto/CryptoTransactionService";
import { normalizeProviderName } from "@/utils/helpers";

export interface TransactionFilters {
  type?: string;
  status?: string;
  provider?: string;
  direction?: string;
  purpose?: string;
  reference?: string;
  startDate?: string;
  endDate?: string;
  startPrice?: number;
  endPrice?: number;
  transactionType?: "wallet" | "bills";
}

export class TransactionService {
  constructor(
    private transactionRepository: TransactionRepository,
    private walletRepository: WalletRepository,
    private cryptoService: CryptoService,
    private giftCardService: GiftCardService,
    private cryptoTransactionService: CryptoTransactionService,
  ) {}

  async getUserTransactions(
    userId: string,
    filters: TransactionFilters = {},
    page: number = 1,
    limit: number = 20,
  ): Promise<any> {
    const wallet = await this.walletRepository.findByUserId(userId);

    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const query: any = { walletId: wallet._id };

    if (filters.type) {
      query.type = filters.type;
    } else {
      query.type = { $ne: "refund" };
    }

    if (filters.transactionType) {
      if (filters.transactionType === "wallet") {
        query.type = { $in: WALLET_OPERATION_TYPES };
      } else if (filters.transactionType === "bills") {
        query.type = { $in: BILL_PAYMENT_TYPES };
      }
    }

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.provider)
      query.provider = normalizeProviderName(filters.provider);

    if (filters.direction) {
      query.direction = filters.direction;
    }

    if (filters.purpose) {
      query.purpose = filters.purpose;
    }

    if (filters.reference) {
      query.reference = { $regex: filters.reference, $options: "i" };
    }

    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) {
        query.createdAt.$gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        // Set to end of day
        const endDate = new Date(filters.endDate);
        endDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDate;
      }
    }

    if (filters.startPrice !== undefined || filters.endPrice !== undefined) {
      query.amount = {};
      if (filters.startPrice !== undefined) {
        query.amount.$gte = filters.startPrice;
      }
      if (filters.endPrice !== undefined) {
        query.amount.$lte = filters.endPrice;
      }
    }

    const result = await this.transactionRepository.findWithFilters(
      query,
      page,
      limit,
    );

    return TransactionMapper.toPaginatedDTO(
      result.data,
      result.total,
      page,
      limit,
    );
  }

  async getTransaction(reference: string, userId: string): Promise<any> {
    const transaction =
      await this.transactionRepository.findByReference(reference);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const wallet = await this.walletRepository.findByUserId(userId);

    if (!wallet || transaction.walletId?.toString() !== wallet.id.toString()) {
      throw new AppError(
        "Unauthorized access to transaction",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    return TransactionMapper.toDTO(transaction);
  }

  async exportTransactions(
    userId: string,
    filters: TransactionFilters = {},
  ): Promise<string> {
    const wallet = await this.walletRepository.findByUserId(userId);

    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const query: any = { walletId: wallet._id };

    if (filters.type) query.type = filters.type;
    if (filters.status) query.status = filters.status;
    if (filters.provider)
      query.provider = normalizeProviderName(filters.provider);
    if (filters.direction) query.direction = filters.direction;
    if (filters.purpose) query.purpose = filters.purpose;

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

    const result = await this.transactionRepository.findWithFilters(
      query,
      1,
      10000,
    );

    const sanitizedData = TransactionMapper.toDTOList(result.data);

    const headers = [
      "Reference",
      "Type",
      "Direction",
      "Description",
      "Amount",
      "Status",
      "Balance Before",
      "Balance After",
      "Date",
    ];

    const rows = sanitizedData.map((t: any) => [
      t.reference,
      t.type || "",
      t.direction || "",
      t.description || "",
      t.amount,
      t.status,
      t.balanceBefore || "",
      t.balanceAfter || "",
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

  async generateReceipt(reference: string, userId: string): Promise<any> {
    const transaction =
      await this.transactionRepository.findByReference(reference);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const wallet = await this.walletRepository.findByUserId(userId);

    if (!wallet || transaction.walletId?.toString() !== wallet.id.toString()) {
      throw new AppError(
        "Unauthorized access to transaction",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // Only generate receipts for successful transactions
    if (transaction.status !== "success") {
      throw new AppError(
        "Receipt can only be generated for successful transactions",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    const sanitized = TransactionMapper.toDTO(transaction);

    return {
      receiptNumber: `RCP-${sanitized.reference}`,
      reference: sanitized.reference,
      amount: sanitized.amount,
      direction: sanitized.direction,
      type: sanitized.type,
      status: sanitized.status,
      description: sanitized.description,
      balanceBefore: sanitized.balanceBefore,
      balanceAfter: sanitized.balanceAfter,
      metadata: sanitized.metadata,
      transactionDate: sanitized.createdAt,
      generatedAt: new Date(),
    };
  }

  // Combined fast method (add to HelperService or new TradingVolumeService)
  async getMonthlyTradingVolume(
    userId: string,
    options: {
      month?: number;
      year?: number;
      tradeType?: "buy" | "sell" | "both";
      serviceType?: "giftcard" | "crypto" | "both";
    } = {},
  ) {
    const serviceType = options.serviceType || "both";
    const targetMonth = options.month || new Date().getMonth() + 1;
    const targetYear = options.year || new Date().getFullYear();

    let giftCardData, cryptoData;

    // Fetch only requested service data
    if (serviceType === "both") {
      [giftCardData, cryptoData] = await Promise.all([
        this.giftCardService.getMonthlyVolume(userId, options),
        this.cryptoTransactionService.getMonthlyVolume(userId, options),
      ]);
    } else if (serviceType === "giftcard") {
      giftCardData = await this.giftCardService.getMonthlyVolume(
        userId,
        options,
      );
      cryptoData = {
        totalVolume: 0,
        buyVolume: 0,
        sellVolume: 0,
        transactionCount: 0,
        previousMonthVolume: 0,
      };
    } else {
      cryptoData = await this.cryptoTransactionService.getMonthlyVolume(
        userId,
        options,
      );
      giftCardData = {
        totalVolume: 0,
        buyVolume: 0,
        sellVolume: 0,
        transactionCount: 0,
        previousMonthVolume: 0,
      };
    }

    const currentTotal = giftCardData.totalVolume + cryptoData.totalVolume;
    const prevTotal =
      giftCardData.previousMonthVolume + cryptoData.previousMonthVolume;

    const percentageChange =
      prevTotal > 0
        ? ((currentTotal - prevTotal) / prevTotal) * 100
        : currentTotal > 0
          ? 100
          : 0;

    return {
      month: targetMonth,
      year: targetYear,
      summary: {
        totalVolume: currentTotal,
        buyVolume: giftCardData.buyVolume + cryptoData.buyVolume,
        sellVolume: giftCardData.sellVolume + cryptoData.sellVolume,
        transactionCount:
          giftCardData.transactionCount + cryptoData.transactionCount,
        previousMonthVolume: prevTotal,
        percentageChange: Number(percentageChange.toFixed(2)),
        changeAmount: currentTotal - prevTotal,
        trend:
          percentageChange > 0
            ? "increase"
            : percentageChange < 0
              ? "decrease"
              : "stable",
      },
      breakdown: {
        giftCard: {
          totalVolume: giftCardData.totalVolume,
          buyVolume: giftCardData.buyVolume,
          sellVolume: giftCardData.sellVolume,
          transactionCount: giftCardData.transactionCount,
        },
        crypto: {
          totalVolume: cryptoData.totalVolume,
          buyVolume: cryptoData.buyVolume,
          sellVolume: cryptoData.sellVolume,
          transactionCount: cryptoData.transactionCount,
        },
      },
    };
  }

  // Combined yearly method
  async getYearlyTradingVolume(
    userId: string,
    options: {
      year?: number;
      tradeType?: "buy" | "sell" | "both";
      serviceType?: "giftcard" | "crypto" | "both";
    } = {},
  ) {
    const serviceType = options.serviceType || "both";
    const targetYear = options.year || new Date().getFullYear();

    let giftCardData, cryptoData;

    if (serviceType === "both") {
      [giftCardData, cryptoData] = await Promise.all([
        this.giftCardService.getYearlyVolumeBreakdown(userId, options),
        this.cryptoTransactionService.getYearlyVolumeBreakdown(userId, options),
      ]);
    } else if (serviceType === "giftcard") {
      giftCardData = await this.giftCardService.getYearlyVolumeBreakdown(
        userId,
        options,
      );
      cryptoData = {
        year: targetYear,
        yearTotal: 0,
        yearBuyTotal: 0,
        yearSellTotal: 0,
        yearTransactionCount: 0,
        monthlyData: Array(12).fill({
          totalVolume: 0,
          buyVolume: 0,
          sellVolume: 0,
          transactionCount: 0,
        }),
      };
    } else {
      cryptoData = await this.cryptoTransactionService.getYearlyVolumeBreakdown(
        userId,
        options,
      );
      giftCardData = {
        year: targetYear,
        yearTotal: 0,
        yearBuyTotal: 0,
        yearSellTotal: 0,
        yearTransactionCount: 0,
        monthlyData: Array(12).fill({
          totalVolume: 0,
          buyVolume: 0,
          sellVolume: 0,
          transactionCount: 0,
        }),
      };
    }

    // Combine monthly data
    const combinedMonthlyData = giftCardData.monthlyData.map((gc, index) => {
      const crypto = cryptoData.monthlyData[index];
      return {
        month: index + 1,
        totalVolume: gc.totalVolume + crypto.totalVolume,
        buyVolume: gc.buyVolume + crypto.buyVolume,
        sellVolume: gc.sellVolume + crypto.sellVolume,
        transactionCount: gc.transactionCount + crypto.transactionCount,
        giftCard: {
          totalVolume: gc.totalVolume,
          buyVolume: gc.buyVolume,
          sellVolume: gc.sellVolume,
          transactionCount: gc.transactionCount,
        },
        crypto: {
          totalVolume: crypto.totalVolume,
          buyVolume: crypto.buyVolume,
          sellVolume: crypto.sellVolume,
          transactionCount: crypto.transactionCount,
        },
      };
    });

    const yearTotal = giftCardData.yearTotal + cryptoData.yearTotal;
    const yearBuyTotal = giftCardData.yearBuyTotal + cryptoData.yearBuyTotal;
    const yearSellTotal = giftCardData.yearSellTotal + cryptoData.yearSellTotal;
    const yearTransactionCount =
      giftCardData.yearTransactionCount + cryptoData.yearTransactionCount;

    // Calculate stats
    const averageMonthlyVolume = yearTotal / 12;
    const highestMonth = combinedMonthlyData.reduce((max, curr) =>
      curr.totalVolume > max.totalVolume ? curr : max,
    );
    const lowestMonth = combinedMonthlyData.reduce((min, curr) =>
      curr.totalVolume < min.totalVolume ? curr : min,
    );

    return {
      year: targetYear,
      summary: {
        yearTotal,
        yearBuyTotal,
        yearSellTotal,
        yearTransactionCount,
        averageMonthlyVolume: Number(averageMonthlyVolume.toFixed(2)),
        highestMonth: {
          month: highestMonth.month,
          volume: highestMonth.totalVolume,
        },
        lowestMonth: {
          month: lowestMonth.month,
          volume: lowestMonth.totalVolume,
        },
      },
      breakdown: {
        giftCard: {
          yearTotal: giftCardData.yearTotal,
          yearBuyTotal: giftCardData.yearBuyTotal,
          yearSellTotal: giftCardData.yearSellTotal,
          yearTransactionCount: giftCardData.yearTransactionCount,
        },
        crypto: {
          yearTotal: cryptoData.yearTotal,
          yearBuyTotal: cryptoData.yearBuyTotal,
          yearSellTotal: cryptoData.yearSellTotal,
          yearTransactionCount: cryptoData.yearTransactionCount,
        },
      },
      monthlyData: combinedMonthlyData,
    };
  }
}
