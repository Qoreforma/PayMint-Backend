import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  TRANSACTION_CATEGORIES,
  isBankingOperation,
  TRANSACTION_TYPES,
} from "@/utils/constants";
import { Types } from "mongoose";
import { WalletService } from "@/services/client/wallet/WalletService";
import { DepositManagementService } from "./DepositManagementService";
import { ManualWithdrawalService } from "../finances/Manualwithdrawalservice";
import { resolveDateRange } from "@/utils/dateRange";
import { TransactionPollingService } from "@/services/polling/TransactionPollingService";
import { normalizeProviderName, toDisplayProviderName } from "@/utils/helpers";

export class TransactionManagementService {
  // Define transaction categories

  private readonly SERVICE_TRANSACTION_TYPES =
    TRANSACTION_CATEGORIES.SERVICE_TRANSACTIONS;

  private readonly WALLET_TRANSACTION_TYPES =
    TRANSACTION_CATEGORIES.FINANCIAL_OPERATIONS;

  private readonly TRANSACTION_STATUSES = [
    "pending",
    "processing",
    "success",
    "failed",
    "reversed",
  ];
  constructor(
    private transactionRepository: TransactionRepository,
    private walletRepository: WalletRepository,
    private walletService: WalletService,
    private depositManagementService: DepositManagementService,
    private manualWithdrawalService: ManualWithdrawalService,
    private transactionPollingService: TransactionPollingService,
  ) { }

  async listTransactions(
    page: number = 1,
    limit: number = 20,
    filters: any = {},
  ) {
    const query: any = {};

    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.type) {
      query.type = filters.type;
    }

    if (filters.provider)
      query.provider = normalizeProviderName(filters.provider);

    const dateRange = resolveDateRange(filters);
    if (dateRange) query.createdAt = dateRange;
    if (
      filters.channel &&
      ["ios", "android", "web", "api"].includes(filters.channel)
    ) {
      query.channel = filters.channel;
    }
    if (filters.reference) {
      query.reference = { $regex: filters.reference, $options: "i" };
    }

    if (filters.minAmount || filters.maxAmount) {
      query.amount = {};
      if (filters.minAmount) query.amount.$gte = parseFloat(filters.minAmount);
      if (filters.maxAmount) query.amount.$lte = parseFloat(filters.maxAmount);
    }

    if (filters.userId) {
      query.sourceId = new Types.ObjectId(filters.userId);
    }

    if (filters.search && filters.search.trim()) {
      const searchTerm = filters.search.trim();
      query.$or = [
        { reference: { $regex: searchTerm, $options: "i" } },
        { providerReference: { $regex: searchTerm, $options: "i" } },
        { remark: { $regex: searchTerm, $options: "i" } },
        { purpose: { $regex: searchTerm, $options: "i" } },
        { provider: { $regex: searchTerm, $options: "i" } },
      ];
    }

    const result =
      await this.transactionRepository.findWithPaginationAndPopulate(
        query,
        page,
        limit,
      );

    const normalizedTransactions = result.data.map((transaction: any) => ({
      ...transaction,
      status: this.normalizeStatus(transaction.status),
      provider: toDisplayProviderName(transaction.provider),
    }));


    return {
      transactions: normalizedTransactions,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async getTransactionDetails(transactionId: string) {
    const transaction = await this.transactionRepository.findById(
      transactionId,
      [
        {
          path: "userId",
          select: "firstname lastname username country phone avatar email",
        },
      ],
    );

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    return {
      ...(transaction.toObject?.() || transaction),
      provider: toDisplayProviderName(transaction.provider),
      status: this.normalizeStatus(transaction.status),
    };
  }

  async updateTransactionStatus(
    transactionId: string,
    status: string,
    note?: string,
    adminId?: string,
  ) {
    const transaction =
      await this.transactionRepository.findById(transactionId);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    if (transaction.status === "success" || transaction.status === "reversed") {
      throw new AppError(
        "Cannot update completed or reversed transactions",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // Stamp duty transactions are always refunded/reversed as part of their
    // parent withdrawal (parent's chargeInfo.totalDeduction already covers
    // the stamp duty amount). Flipping this one directly would trigger the
    // generic "refund on failed debit" logic below a second time for the
    // same money — act on the parent transaction instead.
    if (transaction.type === TRANSACTION_TYPES.STAMP_DUTY) {
      throw new AppError(
        "This is a stamp duty transaction linked to a withdrawal. Update the parent withdrawal transaction's status instead — this one is reversed automatically as part of it.",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (!this.TRANSACTION_STATUSES.includes(status)) {
      throw new AppError(
        `Invalid status: ${status}`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // Manual deposit requests have their own approval workflow (fee
    // calculation + wallet credit). Route through it instead of doing a
    // raw status flip here — that's the bug: raw flips never credited the wallet.
    if (
      transaction.transactableType === "DepositRequest" &&
      transaction.type === "deposit"
    ) {
      return this.delegateDepositStatusUpdate(
        transaction,
        status,
        note,
        adminId,
      );
    }

    // Withdrawals that already failed at the automated provider and got
    // escalated to manual fallback (PENDING_MANUAL / ManualWithdrawalRequest)
    // have their own approve/reject flow. Delegate to it instead of doing a
    // raw status flip — same reasoning as the deposit case above. Most
    // withdrawal transactions are NOT manually escalated, so this only
    // triggers when a linked ManualWithdrawalRequest actually exists.
    if (
      transaction.type === TRANSACTION_TYPES.WITHDRAWAL &&
      transaction.direction === "DEBIT"
    ) {
      const manualRequest =
        await this.manualWithdrawalService.getRequestByTransactionId(
          transaction._id,
        );
      if (manualRequest && manualRequest.status === "pending") {
        return this.delegateWithdrawalStatusUpdate(
          manualRequest,
          status,
          note,
          adminId,
        );
      }
    }

    const previousStatus = transaction.status;

    transaction.status = status as any;
    if (note) {
      transaction.remark = note;
    }

    await transaction.save();

    // Refund user if marking a debit transaction as failed.
    // Guards added:
    // - previousStatus !== "failed" -> don't double-refund if this is called
    //   twice on an already-failed transaction.
    // - direction === "DEBIT" -> only transactions that actually took money
    //   out of the wallet get refunded.
    if (
      status === "failed" &&
      previousStatus !== "failed" &&
      transaction.direction === "DEBIT" &&
      transaction.walletId
    ) {
      const wallet = await this.walletRepository.findById(
        transaction.walletId.toString(),
      );
      if (wallet) {
        const balanceBefore = wallet.balance;

        // Withdrawals store only the base amount on transaction.amount —
        // the wallet was actually debited base + charge
        // (transaction.meta.chargeInfo.totalDeduction). Refund that full
        // amount, not just transaction.amount, or the user loses the charge.
        const refundAmount =
          transaction.meta?.chargeInfo?.totalDeduction ?? transaction.amount;

        const updatedWallet = await this.walletRepository.incrementBalance(
          wallet.id,
          refundAmount,
        );

        if (!updatedWallet) {
          throw new Error("Failed to update wallet balance");
        }

        await this.transactionRepository.create({
          walletId: wallet.id,
          sourceId: wallet.userId,
          userId: wallet.userId,
          reference: `REFUND-${transaction.reference}`,
          amount: refundAmount,
          direction: "CREDIT",
          type: "refund",
          status: "success",
          purpose: "Refund for failed transaction",
          remark: `Refund for failed transaction ${transaction.reference}`,
          balanceBefore,
          balanceAfter: updatedWallet.balance,
          initiatedByType: "system",
          transactableType: "Transaction",
          transactableId: transaction.id,
          linkedTransactionId: transaction._id,
        });

        // Cascade: if this withdrawal had a separately-recorded stamp duty
        // debit linked to it, mark that one failed too for ledger
        // consistency. No second wallet credit here — refundAmount above
        // already came from chargeInfo.totalDeduction, which includes the
        // stamp duty amount, so the user is only ever refunded once.
        if (transaction.type === TRANSACTION_TYPES.WITHDRAWAL) {
          const linkedStampDutyTxn = await this.transactionRepository.findOne({
            linkedTransactionId: transaction._id,
            type: TRANSACTION_TYPES.STAMP_DUTY,
          });
          if (linkedStampDutyTxn && linkedStampDutyTxn.status !== "failed") {
            linkedStampDutyTxn.status = "failed" as any;
            await linkedStampDutyTxn.save();
          }
        }
      }
    }

    return {
      message: "Transaction status updated successfully",
      transaction: {
        id: transaction._id,
        status: this.normalizeStatus(transaction.status),
        reference: transaction.reference,
      },
    };
  }

  // Routes a deposit-request-linked transaction through the canonical
  // approve/decline flow (DepositManagementService) instead of a raw status
  // flip, so charge calculation and the wallet credit actually happen.
  private async delegateDepositStatusUpdate(
    transaction: any,
    status: string,
    note: string | undefined,
    adminId?: string,
  ) {
    if (!adminId) {
      throw new AppError(
        "Admin ID is required to approve or decline a manual deposit",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const depositRequestId = transaction.transactableId?.toString();

    if (!depositRequestId) {
      throw new AppError(
        "This transaction is missing its linked deposit request and cannot be updated here",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (status === "success") {
      const result = await this.depositManagementService.approveDeposit(
        depositRequestId,
        adminId,
      );
      return { message: result.message, transaction: result.deposit };
    }

    if (status === "failed") {
      // if (!note?.trim()) {
      //   throw new AppError(
      //     "A note is required to decline a manual deposit — it is used as the decline reason",
      //     HTTP_STATUS.BAD_REQUEST,
      //     ERROR_CODES.VALIDATION_ERROR,
      //   );
      // }
      const result = await this.depositManagementService.declineDeposit(
        depositRequestId,
        note?.trim() || "Declined by admin",
        adminId,
      );
      return { message: result.message, transaction: result.deposit };
    }

    throw new AppError(
      `Manual deposits can only be moved to "success" (approve) or "failed" (decline) — received: ${status}`,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
    );
  }

  // SERVICE TRANSACTIONS
  async getServiceTransactionsOverview(filters: any = {}) {
    const query: any = { type: { $in: this.SERVICE_TRANSACTION_TYPES } };

    const dateRange = resolveDateRange(filters);
    if (dateRange) query.createdAt = dateRange;

    const pipeline = [
      { $match: query },
      {
        $facet: {
          statusBreakdown: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
              },
            },
          ],
          typeBreakdown: [
            {
              $group: {
                _id: "$type",
                count: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
                successCount: {
                  $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
                },
                pendingCount: {
                  $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
                },
                failedCount: {
                  $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
                },
                reversedCount: {
                  $sum: { $cond: [{ $eq: ["$status", "reversed"] }, 1, 0] },
                },
                successAmount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "success"] }, "$amount", 0],
                  },
                },
                pendingAmount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0],
                  },
                },
              },
            },
          ],
          providerBreakdown: [
            {
              $match: { provider: { $exists: true, $ne: null } },
            },
            {
              $group: {
                _id: "$provider",
                count: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
                successCount: {
                  $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
                },
                failedCount: {
                  $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
                },
              },
            },
          ],
          totals: [
            {
              $group: {
                _id: null,
                totalTransactions: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
                pending: {
                  $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
                },
                processing: {
                  $sum: { $cond: [{ $eq: ["$status", "processing"] }, 1, 0] },
                },
                success: {
                  $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
                },
                failed: {
                  $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
                },
                reversed: {
                  $sum: { $cond: [{ $eq: ["$status", "reversed"] }, 1, 0] },
                },
                pendingAmount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0],
                  },
                },
                processingAmount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "processing"] }, "$amount", 0],
                  },
                },
                successAmount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "success"] }, "$amount", 0],
                  },
                },
                failedAmount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "failed"] }, "$amount", 0],
                  },
                },
                reversedAmount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "reversed"] }, "$amount", 0],
                  },
                },
              },
            },
          ],
        },
      },
    ];

    const result = await this.transactionRepository.aggregate(pipeline);

    return {
      category: "service_transactions",
      overview: {
        totals: result[0].totals[0] || this.getEmptyOverviewTotals(),
        statusBreakdown: this.normalizeStatusBreakdown(
          result[0].statusBreakdown,
        ),
        typeBreakdown: result[0].typeBreakdown,
        providerBreakdown: result[0].providerBreakdown,
      },
    };
  }

  async listServiceTransactions(
    page: number = 1,
    limit: number = 20,
    filters: any = {},
  ) {
    const query: any = { type: { $in: this.SERVICE_TRANSACTION_TYPES } };

    this.applyFilters(query, filters);

    const result =
      await this.transactionRepository.findWithPaginationAndPopulate(
        query,
        page,
        limit,
      );

    return {
      category: "service_transactions",
      transactions: result.data.map((transaction: any) => ({
        ...transaction,
        provider: toDisplayProviderName(transaction.provider),
      })),
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async getSpecificServiceTransactions(
    serviceType: string,
    page: number = 1,
    limit: number = 20,
    filters: any = {},
  ) {
    if (!this.SERVICE_TRANSACTION_TYPES.includes(serviceType as any)) {
      throw new AppError(
        "Invalid service type",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const query: any = { type: serviceType };
    this.applyFilters(query, filters);

    // Get stats for this service type
    const statsQuery = { ...query };
    delete statsQuery.status;

    const stats = await this.transactionRepository.aggregate([
      { $match: statsQuery },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          successCount: {
            $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
          },
          pendingCount: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
          },
          reversedCount: {
            $sum: { $cond: [{ $eq: ["$status", "reversed"] }, 1, 0] },
          },
          successAmount: {
            $sum: { $cond: [{ $eq: ["$status", "success"] }, "$amount", 0] },
          },
        },
      },
    ]);

    const result =
      await this.transactionRepository.findWithPaginationAndPopulate(
        query,
        page,
        limit,
      );

    return {
      serviceType,
      stats: stats[0] || this.getEmptyStats(),
      transactions: result.data.map((transaction: any) => ({
        ...transaction,
        provider: toDisplayProviderName(transaction.provider),
      })),
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  // WALLET TRANSACTIONS
  async getWalletTransactionsOverview(filters: any = {}) {
    const query: any = { type: { $in: this.WALLET_TRANSACTION_TYPES } };

    const dateRange = resolveDateRange(filters);
    if (dateRange) query.createdAt = dateRange;

    const pipeline = [
      { $match: query },
      {
        $facet: {
          statusBreakdown: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
              },
            },
          ],
          typeBreakdown: [
            {
              $group: {
                _id: "$type",
                count: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
                successCount: {
                  $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
                },
                pendingCount: {
                  $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
                },
                failedCount: {
                  $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
                },
                reversedCount: {
                  $sum: { $cond: [{ $eq: ["$status", "reversed"] }, 1, 0] },
                },
                successAmount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "success"] }, "$amount", 0],
                  },
                },
                pendingAmount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0],
                  },
                },
              },
            },
          ],
          directionBreakdown: [
            {
              $group: {
                _id: "$direction",
                count: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
              },
            },
          ],
          totals: [
            {
              $group: {
                _id: null,
                totalTransactions: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
                totalSuccess: {
                  $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
                },
                totalPending: {
                  $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
                },
                totalFailed: {
                  $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
                },
                totalReversed: {
                  $sum: { $cond: [{ $eq: ["$status", "reversed"] }, 1, 0] },
                },
                successAmount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "success"] }, "$amount", 0],
                  },
                },
                pendingAmount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "pending"] }, "$amount", 0],
                  },
                },
                failedAmount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "failed"] }, "$amount", 0],
                  },
                },
                reversedAmount: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "reversed"] }, "$amount", 0],
                  },
                },
                totalDebit: {
                  $sum: { $cond: [{ $eq: ["$direction", "DEBIT"] }, 1, 0] },
                },
                totalCredit: {
                  $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, 1, 0] },
                },
              },
            },
          ],
        },
      },
    ];

    const result = await this.transactionRepository.aggregate(pipeline);

    return {
      category: "wallet_transactions",
      overview: {
        totals: result[0].totals[0] || this.getEmptyOverviewTotals(),
        statusBreakdown: this.normalizeStatusBreakdown(
          result[0].statusBreakdown,
        ),
        typeBreakdown: result[0].typeBreakdown,
        providerBreakdown: result[0].providerBreakdown,
      },
    };
  }

  async listWalletTransactions(
    page: number = 1,
    limit: number = 20,
    filters: any = {},
  ) {
    const query: any = { type: { $in: this.WALLET_TRANSACTION_TYPES } };

    this.applyFilters(query, filters);

    const result =
      await this.transactionRepository.findWithPaginationAndPopulate(
        query,
        page,
        limit,
      );

    // Normalize status for each transaction
    const normalizedTransactions = result.data.map((transaction: any) => ({
      ...transaction,
      provider: toDisplayProviderName(transaction.provider),
      status: this.normalizeStatus(transaction.status),
    }));

    return {
      category: "wallet_transactions",
      transactions: normalizedTransactions,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  // Helper method
  private normalizeStatus(status: string): string {
    if (status === "pending_manual") {
      return "pending";
    }
    return status;
  }

  async getSpecificWalletTransactions(
    walletType: string,
    page: number = 1,
    limit: number = 20,
    filters: any = {},
  ) {
    const isWalletType = isBankingOperation(walletType);
    if (!isWalletType) {
      throw new AppError(
        "Invalid wallet transaction type",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const query: any = { type: walletType };
    this.applyFilters(query, filters);

    // Get stats for this wallet type
    const statsQuery = { ...query };
    delete statsQuery.status;

    const stats = await this.transactionRepository.aggregate([
      { $match: statsQuery },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          successCount: {
            $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
          },
          pendingCount: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          failedCount: {
            $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
          },
          reversedCount: {
            $sum: { $cond: [{ $eq: ["$status", "reversed"] }, 1, 0] },
          },
          successAmount: {
            $sum: { $cond: [{ $eq: ["$status", "success"] }, "$amount", 0] },
          },
          debitCount: {
            $sum: { $cond: [{ $eq: ["$direction", "DEBIT"] }, 1, 0] },
          },
          creditCount: {
            $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, 1, 0] },
          },
        },
      },
    ]);

    const result =
      await this.transactionRepository.findWithPaginationAndPopulate(
        query,
        page,
        limit,
      );
    const normalizedTransactions = result.data.map((transaction: any) => ({
      ...transaction,
      provider: toDisplayProviderName(transaction.provider),
      status: this.normalizeStatus(transaction.status),
    }));
    return {
      walletType,
      stats: stats[0] || this.getEmptyStats(),
      transactions: normalizedTransactions,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  // UTILITY METHODS
  async getFailedTransactions(page: number = 1, limit: number = 20) {
    const query = { status: "failed" };

    const result =
      await this.transactionRepository.findWithPaginationAndPopulate(
        query,
        page,
        limit,
      );

    const normalizedTransactions = result.data.map((transaction: any) => ({
      ...transaction,
      provider: toDisplayProviderName(transaction.provider),
      status: this.normalizeStatus(transaction.status),
    }));

    return {
      transactions: normalizedTransactions,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async getPendingTransactions(page: number = 1, limit: number = 20) {
    const query = { status: "pending" };

    const result =
      await this.transactionRepository.findWithPaginationAndPopulate(
        query,
        page,
        limit,
      );

    const normalizedTransactions = result.data.map((transaction: any) => ({
      ...transaction,
      provider: toDisplayProviderName(transaction.provider),
      status: this.normalizeStatus(transaction.status),
    }));

    return {
      transactions: normalizedTransactions,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async bulkUpdateTransactions(
    transactionIds: string[],
    status: string,
    note?: string,
    adminId?: string,
  ) {
    const validStatuses = ["pending", "processing", "success", "failed"];
    if (!validStatuses.includes(status)) {
      throw new AppError(
        "Invalid status",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // A raw bulk $set had zero wallet side effects — bulk-"failing" a batch
    // of withdrawals refunded nobody, and bulk-"succeeding" manual deposits
    // credited nobody. Loop through updateTransactionStatus per id instead,
    // so deposit delegation and the refund logic both apply per transaction.
    const results = {
      successful: [] as string[],
      failed: [] as { id: string; error: string }[],
    };

    for (const id of transactionIds) {
      try {
        await this.updateTransactionStatus(id, status, note, adminId);
        results.successful.push(id);
      } catch (error: any) {
        results.failed.push({ id, error: error.message });
      }
    }

    return {
      message: `Processed ${transactionIds.length} transactions: ${results.successful.length} updated, ${results.failed.length} failed`,
      updatedCount: results.successful.length,
      results,
    };
  }

  async exportTransactions(filters: any = {}) {
    const query: any = {};

    if (filters.status) query.status = filters.status;
    if (filters.type) query.type = filters.type;
    if (filters.provider)
      query.provider = normalizeProviderName(filters.provider);
    const dateRange = resolveDateRange(filters);
    if (dateRange) query.createdAt = dateRange;

    const transactions = await this.transactionRepository.findAll(query, {
      limit: 10000,
    });

    const normalizedTransactions = transactions.map((transaction: any) => ({
      ...transaction,
      provider: toDisplayProviderName(transaction.provider),
      status: this.normalizeStatus(transaction.status),
    }));

    return normalizedTransactions;
  }

  async reverseTransaction(
    transactionId: string,
    adminId: string,
    reason: string,
  ) {
    return await this.walletService.reverseTransaction({
      transactionId,
      adminId,
      reason,
    });
  }

  async retryFailedTransaction(transactionId: string) {
    return this.transactionPollingService.manualRequeryTransaction(
      transactionId,
    );
  }

  private async delegateWithdrawalStatusUpdate(
    manualRequest: any,
    status: string,
    note: string | undefined,
    adminId?: string,
  ) {
    if (!adminId) {
      throw new AppError(
        "Admin ID is required to approve or decline a manual withdrawal",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (status === "success") {
      const result = await this.manualWithdrawalService.approveRequest(
        manualRequest._id.toString(),
        adminId,
      );
      return { message: result.message, transaction: result.details };
    }

    if (status === "failed") {
      const result = await this.manualWithdrawalService.rejectRequest(
        manualRequest._id.toString(),
        adminId,
        note?.trim() || "Declined by admin",
      );
      return { message: result.message, transaction: result.details };
    }

    throw new AppError(
      `Manual withdrawals can only be moved to "success" (approve) or "failed" (decline) — received: ${status}`,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
    );
  }

  // Helper methods
  private applyFilters(query: any, filters: any) {
    if (filters.status) {
      query.status = filters.status;
    }

    if (filters.provider)
      query.provider = normalizeProviderName(filters.provider);

    const dateRange = resolveDateRange(filters);
    if (dateRange) query.createdAt = dateRange;

    if (filters.reference) {
      query.reference = { $regex: filters.reference, $options: "i" };
    }

    if (filters.minAmount || filters.maxAmount) {
      query.amount = {};
      if (filters.minAmount) query.amount.$gte = parseFloat(filters.minAmount);
      if (filters.maxAmount) query.amount.$lte = parseFloat(filters.maxAmount);
    }

    if (filters.userId) {
      query.sourceId = new Types.ObjectId(filters.userId);
    }

    if (filters.search && filters.search.trim()) {
      const searchTerm = filters.search.trim();
      query.$or = [
        { reference: { $regex: searchTerm, $options: "i" } },
        { providerReference: { $regex: searchTerm, $options: "i" } },
        { remark: { $regex: searchTerm, $options: "i" } },
        { purpose: { $regex: searchTerm, $options: "i" } },
        { provider: { $regex: searchTerm, $options: "i" } },
      ];
    }
  }

  private getEmptyTotals() {
    return {
      totalTransactions: 0,
      totalAmount: 0,
      totalSuccess: 0,
      totalPending: 0,
      totalFailed: 0,
      totalReversed: 0,
      successAmount: 0,
      pendingAmount: 0,
      failedAmount: 0,
      reversedAmount: 0,
    };
  }

  private normalizeStatusBreakdown(statusBreakdown: any[]) {
    const normalized = this.TRANSACTION_STATUSES.map((status) => {
      const existing = statusBreakdown.find((s) => s._id === status);
      return {
        status,
        count: existing?.count || 0,
        totalAmount: existing?.totalAmount || 0,
      };
    });
    return normalized;
  }

  private getEmptyWalletOverviewTotals() {
    return {
      ...this.getEmptyOverviewTotals(),
      totalDebit: 0,
      totalCredit: 0,
      debitAmount: 0,
      creditAmount: 0,
    };
  }

  private getEmptyOverviewTotals() {
    return {
      totalTransactions: 0,
      totalAmount: 0,
      pending: 0,
      processing: 0,
      success: 0,
      failed: 0,
      reversed: 0,
      pendingAmount: 0,
      processingAmount: 0,
      successAmount: 0,
      failedAmount: 0,
      reversedAmount: 0,
    };
  }

  private getEmptyStats() {
    return {
      totalTransactions: 0,
      totalAmount: 0,
      successCount: 0,
      pendingCount: 0,
      failedCount: 0,
      reversedCount: 0,
      successAmount: 0,
    };
  }
}
