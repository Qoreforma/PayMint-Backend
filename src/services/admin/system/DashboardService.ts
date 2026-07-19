import { UserRepository } from "@/repositories/client/UserRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { GiftCardTransactionRepository } from "@/repositories/client/GiftCardTransactionRepository";
import { CryptoTransactionRepository } from "@/repositories/client/CryptoTransactionRepository";
import { TRANSACTION_CATEGORIES } from "@/utils/constants";
import { resolveDateRange, StatsPeriod } from "@/utils/dateRange";

interface StatusBreakdown {
  count: number;
  amount: number;
}

interface ServiceTransactionType {
  pending: StatusBreakdown;
  failed: StatusBreakdown;
  successful: StatusBreakdown;
  reversed: StatusBreakdown;
  total: StatusBreakdown;
}

interface WalletTransactionType {
  pending: StatusBreakdown;
  failed: StatusBreakdown;
  successful: StatusBreakdown;
  reversed: StatusBreakdown;
  total: StatusBreakdown;
}

interface GiftCardStatusBreakdown {
  count: number;
  amount: number;
  payable_amount: number;
}

interface CryptoStatusBreakdown {
  count: number;
  amount: number;
  payable_amount: number;
}
export class DashboardService {
  private readonly SERVICE_TRANSACTION_TYPES =
    TRANSACTION_CATEGORIES.SERVICE_TRANSACTIONS;
  private readonly WALLET_TRANSACTION_TYPES = [
    ...TRANSACTION_CATEGORIES.WALLET_OPERATIONS,
    ...TRANSACTION_CATEGORIES.BANKING_OPERATIONS,
  ];

  constructor(
    private userRepository: UserRepository,
    private transactionRepository: TransactionRepository,
    private walletRepository: WalletRepository,
    private giftCardTransactionRepository: GiftCardTransactionRepository,
    private cryptoTransactionRepository: CryptoTransactionRepository,
  ) {}

  async getDashboardStats(filters: { startDate?: Date; endDate?: Date, period?: StatsPeriod } = {}) {
    const [
      serviceTransactions,
      walletTransactions,
      cryptoTransactions,
      giftCardTransactions,
      users,
      walletBalance,
    ] = await Promise.all([
      this.getServiceTransactionStats(filters),
      this.getWalletTransactionStats(filters),
      this.getCryptoTransactionStats(filters),
      this.getGiftCardTransactionStats(filters),
      this.getUserStats(),
      this.getWalletBalanceStats(),
    ]);

    return {
      services_transaction: serviceTransactions,
      wallet_transaction: walletTransactions,
      crypto_transaction: cryptoTransactions,
      giftcard_transaction: giftCardTransactions,
      users,
      wallet_balance: walletBalance,
    };
  }

  private async getServiceTransactionStats(filters: any = {}) {
    const query: any = { type: { $in: this.SERVICE_TRANSACTION_TYPES } };

    const dateRange = resolveDateRange(filters);
    if (dateRange) query.createdAt = dateRange;

    const pipeline = [
      { $match: query },
      {
        $facet: {
          airtime: this.createServiceTypePipeline("airtime"),
          betting: this.createServiceTypePipeline("betting"),
          data: this.createServiceTypePipeline("data"),
          education: this.createServiceTypePipeline("education"),
          electricity: this.createServiceTypePipeline("electricity"),
          tv: this.createServiceTypePipeline("cable_tv"),
          internationalAirtime: this.createServiceTypePipeline(
            "internationalairtime",
          ),
          internationalData:
            this.createServiceTypePipeline("internationaldata"),
          all: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                amount: { $sum: "$amount" },
              },
            },
          ],
        },
      },
    ];

    const result = await this.transactionRepository.aggregate(pipeline);
    const data = result[0];

    return {
      airtime: this.formatServiceTypeStats(data.airtime),
      betting: this.formatServiceTypeStats(data.betting),
      data: this.formatServiceTypeStats(data.data),
      education: this.formatServiceTypeStats(data.education),
      electricity: this.formatServiceTypeStats(data.electricity),
      tv: this.formatServiceTypeStats(data.tv),
      "international-airtime": this.formatServiceTypeStats(
        data.internationalAirtime,
      ),
      "international-data": this.formatServiceTypeStats(data.internationalData),
      all: this.formatServiceTypeStats(data.all),
    };
  }

  private createServiceTypePipeline(type: string) {
    return [
      { $match: { type } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          amount: { $sum: "$amount" },
        },
      },
    ];
  }

  private formatServiceTypeStats(statusData: any[]): ServiceTransactionType {
    const statusMap = new Map(statusData.map((s) => [s._id, s]));

    const pending = statusMap.get("pending") || { count: 0, amount: 0 };
    const failed = statusMap.get("failed") || { count: 0, amount: 0 };
    const successful = statusMap.get("success") || { count: 0, amount: 0 };
    const reversed = statusMap.get("reversed") || { count: 0, amount: 0 };

    const totalCount =
      pending.count + failed.count + successful.count + reversed.count;
    const totalAmount =
      pending.amount + failed.amount + successful.amount + reversed.amount;

    return {
      pending: { count: pending.count, amount: pending.amount },
      failed: { count: failed.count, amount: failed.amount },
      successful: { count: successful.count, amount: successful.amount },
      reversed: { count: reversed.count, amount: reversed.amount },
      total: { count: totalCount, amount: totalAmount },
    };
  }

  private async getWalletTransactionStats(filters: any = {}) {
    const query: any = { type: { $in: this.WALLET_TRANSACTION_TYPES } };

    const dateRange = resolveDateRange(filters);
    if (dateRange) query.createdAt = dateRange;

    const pipeline = [
      { $match: query },
      {
        $facet: {
          deposit: this.createWalletTypePipeline(["deposit"]),
          withdrawal: this.createWalletTypePipeline(["withdrawal"]),
          transfer: this.createWalletTypePipeline(["wallet_transfer"]),
          all: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                amount: { $sum: "$amount" },
              },
            },
          ],
        },
      },
    ];

    const result = await this.transactionRepository.aggregate(pipeline);
    const data = result[0];

    return {
      deposit: this.formatServiceTypeStats(data.deposit),
      withdrawal: this.formatServiceTypeStats(data.withdrawal),
      transfer: this.formatServiceTypeStats(data.transfer),
      all: this.formatServiceTypeStats(data.all),
    };
  }

  private createWalletTypePipeline(types: string[]) {
    return [
      { $match: { type: { $in: types } } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          amount: { $sum: "$amount" },
        },
      },
    ];
  }

  private async getCryptoTransactionStats(filters: any = {}) {
    const query: any = {};

    const dateRange = resolveDateRange(filters);
    if (dateRange) query.createdAt = dateRange;

    const stats = await this.cryptoTransactionRepository.aggregate([
      { $match: query },
      {
        $facet: {
          buy: this.createCryptoTypePipeline("buy"),
          sell: this.createCryptoTypePipeline("sell"),
        },
      },
    ]);

    const data = stats[0];

    return {
      buy: this.formatCryptoStats(data.buy),
      sell: this.formatCryptoStats(data.sell),
    };
  }

  private createCryptoTypePipeline(tradeType: string) {
    return [
      { $match: { tradeType } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          amount: { $sum: "$cryptoAmount" },
          payableAmount: { $sum: "$fiatAmount" },
        },
      },
    ];
  }

  private formatCryptoStats(statusData: any[]) {
    const statusMap = new Map(statusData.map((s) => [s._id, s]));

    const pending = statusMap.get("pending") || {
      count: 0,
      amount: 0,
      payableAmount: 0,
    };
    const transferred = statusMap.get("transferred") || {
      count: 0,
      amount: 0,
      payableAmount: 0,
    };
    const declined = statusMap.get("declined") || {
      count: 0,
      amount: 0,
      payableAmount: 0,
    };
    const approved = statusMap.get("approved") || {
      count: 0,
      amount: 0,
      payableAmount: 0,
    };
    const partiallyApproved = statusMap.get("partially_approved") || {
      count: 0,
      amount: 0,
      payableAmount: 0,
    };
    const failed = statusMap.get("failed") || {
      count: 0,
      amount: 0,
      payableAmount: 0,
    };

    const totalCount =
      pending.count +
      transferred.count +
      declined.count +
      approved.count +
      partiallyApproved.count +
      failed.count;
    const totalAmount =
      pending.amount +
      transferred.amount +
      declined.amount +
      approved.amount +
      partiallyApproved.amount +
      failed.amount;
    const totalPayableAmount =
      pending.payableAmount +
      transferred.payableAmount +
      declined.payableAmount +
      approved.payableAmount +
      partiallyApproved.payableAmount +
      failed.payableAmount;

    return {
      pending: {
        count: pending.count,
        amount: pending.amount,
        payable_amount: pending.payableAmount,
      },
      transferred: {
        count: transferred.count,
        amount: transferred.amount,
        payable_amount: transferred.payableAmount,
      },
      declined: {
        count: declined.count,
        amount: declined.amount,
        payable_amount: declined.payableAmount,
      },
      approved: {
        count: approved.count,
        amount: approved.amount,
        payable_amount: approved.payableAmount,
      },
      partially_approved: {
        count: partiallyApproved.count,
        amount: partiallyApproved.amount,
        payable_amount: partiallyApproved.payableAmount,
      },
      failed: {
        count: failed.count,
        amount: failed.amount,
        payable_amount: failed.payableAmount,
      },
      total: {
        count: totalCount,
        amount: totalAmount,
        payable_amount: totalPayableAmount,
      },
    };
  }

  private async getGiftCardTransactionStats(filters: any = {}) {
    const query: any = {};

    const dateRange = resolveDateRange(filters);
    if (dateRange) query.createdAt = dateRange;

    const stats = await this.giftCardTransactionRepository.aggregate([
      { $match: query },
      {
        $facet: {
          buy: this.createGiftCardTypePipeline("buy"),
          sell: this.createGiftCardTypePipeline("sell"),
        },
      },
    ]);

    const data = stats[0];

    return {
      buy: this.formatGiftCardStats(data.buy),
      sell: this.formatGiftCardStats(data.sell),
    };
  }

  private createGiftCardTypePipeline(tradeType: string) {
    return [
      { $match: { tradeType } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          amount: { $sum: "$amount" },
          payableAmount: { $sum: "$payableAmount" },
        },
      },
    ];
  }

  private formatGiftCardStats(statusData: any[]) {
    const statusMap = new Map(statusData.map((s) => [s._id, s]));

    const pending = statusMap.get("pending") || {
      count: 0,
      amount: 0,
      payableAmount: 0,
    };
    const declined = statusMap.get("declined") || {
      count: 0,
      amount: 0,
      payableAmount: 0,
    };
    const approved = statusMap.get("approved") || {
      count: 0,
      amount: 0,
      payableAmount: 0,
    };
    const secondApproval = statusMap.get("s.approved") || {
      count: 0,
      amount: 0,
      payableAmount: 0,
    };
    const multiple = statusMap.get("multiple") || {
      count: 0,
      amount: 0,
      payableAmount: 0,
    };
    const failed = statusMap.get("failed") || {
      count: 0,
      amount: 0,
      payableAmount: 0,
    };
    const archived = statusMap.get("archived") || {
      count: 0,
      amount: 0,
      payableAmount: 0,
    };

    const totalCount =
      pending.count +
      declined.count +
      approved.count +
      secondApproval.count +
      multiple.count +
      failed.count +
      archived.count;
    const totalAmount =
      pending.amount +
      declined.amount +
      approved.amount +
      secondApproval.amount +
      multiple.amount +
      failed.amount +
      archived.amount;
    const totalPayableAmount =
      pending.payableAmount +
      declined.payableAmount +
      approved.payableAmount +
      secondApproval.payableAmount +
      multiple.payableAmount +
      failed.payableAmount +
      archived.payableAmount;

    return {
      pending: {
        count: pending.count,
        amount: pending.amount,
        payable_amount: pending.payableAmount,
      },
      declined: {
        count: declined.count,
        amount: declined.amount,
        payable_amount: declined.payableAmount,
      },
      approved: {
        count: approved.count,
        amount: approved.amount,
        payable_amount: approved.payableAmount,
      },
      second_approval: {
        count: secondApproval.count,
        amount: secondApproval.amount,
        payable_amount: secondApproval.payableAmount,
      },
      multiple: {
        count: multiple.count,
        amount: multiple.amount,
        payable_amount: multiple.payableAmount,
      },
      failed: {
        count: failed.count,
        amount: failed.amount,
        payable_amount: failed.payableAmount,
      },
      archived: {
        count: archived.count,
        amount: archived.amount,
        payable_amount: archived.payableAmount,
      },
      total: {
        count: totalCount,
        amount: totalAmount,
        payable_amount: totalPayableAmount,
      },
    };
  }

  private async getUserStats() {
    const pipeline = [
      {
        $facet: {
          statusBreakdown: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ],
          total: [
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ];

    const result = await this.userRepository.aggregate(pipeline);
    const data = result[0];

    const statusMap = new Map(
      data.statusBreakdown.map((s: any) => [s._id, s.count]),
    );

    return {
      active: statusMap.get("active") || 0,
      inactive: statusMap.get("inactive") || 0,
      restricted: statusMap.get("suspended") || 0,
      deactivated: 0, // Adjust based on your actual status values
      fraudulent: statusMap.get("fraudulent") || 0,
      "shadow-banned": statusMap.get("shadow-banned") || 0,
      total: data.total[0]?.count || 0,
    };
  }

  private async getWalletBalanceStats() {
    const result = await this.walletRepository.aggregate([
      {
        $match: {
          balance: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          totalBalance: { $sum: "$balance" },
          userCount: { $sum: 1 },
        },
      },
    ]);

    if (!result || result.length === 0) {
      return {
        amount: 0,
        users: 0,
      };
    }

    return {
      amount: result[0].totalBalance || 0,
      users: result[0].userCount || 0,
    };
  }

  // Additional helper methods for revenue and charts
  async getRevenueChart(days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await this.transactionRepository.aggregate([
      {
        $match: {
          status: "success",
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          revenue: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return result.map((item) => ({
      date: item._id,
      revenue: item.revenue,
      transactions: item.count,
    }));
  }

  async getTransactionTypeDistribution() {
    const result = await this.transactionRepository.aggregate([
      { $match: { status: "success" } },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
          total: { $sum: "$amount" },
        },
      },
    ]);

    return result.map((item) => ({
      type: item._id,
      count: item.count,
      total: item.total,
    }));
  }

  private async calculateTotalRevenue() {
    const result = await this.transactionRepository.aggregate([
      { $match: { status: "success" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    return result[0]?.total || 0;
  }

  private async calculateTodayRevenue(today: Date) {
    const result = await this.transactionRepository.aggregate([
      { $match: { status: "success", createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    return result[0]?.total || 0;
  }
}
