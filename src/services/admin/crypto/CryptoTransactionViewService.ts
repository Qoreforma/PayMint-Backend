import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { NotificationService } from "../../client/notifications/NotificationService";
import { WalletService } from "../../client/wallet/WalletService";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  TRANSACTION_TYPES,
  SYSTEM,
  ADMIN_DEPOSIT_TRANSACTION_TYPES,
} from "@/utils/constants";
import { Types } from "mongoose";
import { TradeBonusProcessorService } from "../../client/utility/TradeBonusProcessorService";
import logger from "@/logger";
import { CryptoTransactionRepository } from "@/repositories/client/CryptoTransactionRepository";
import ServiceContainer from "../../client/container";
import { roundAmount } from "@/utils/helpers";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { HelperService } from "@/services/client/utility/HelperService";
import { resolveDateRange } from "@/utils/dateRange";

const CRYPTO_SELL_PAYMENT_VIA_PLATFORM =
  process.env.CRYPTO_SELL_PAYMENT_VIA_PLATFORM !== "false";
export class CryptoTransactionViewService {
  constructor(
    private cryptoRepository: CryptoRepository,
    private cryptoTransactionRepository: CryptoTransactionRepository,
    private walletService: WalletService,
    private transactionRepository: TransactionRepository,
    private notificationService: NotificationService,
    private bonusProcessor: TradeBonusProcessorService,
    private helperService: HelperService,
  ) {}

  async listCryptoTransactions(
    page: number = 1,
    limit: number = 20,
    filters: any = {},
    adminPermissions?: string[],
  ) {
    const query: any = {};

    if (filters.userId) {
      query.userId = new Types.ObjectId(filters.userId);
    }
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.tradeType) {
      query.tradeType = filters.tradeType;
    }
    if (filters.cryptoId) {
      query.cryptoId = new Types.ObjectId(filters.cryptoId);
    }
    const dateRange = resolveDateRange(filters);
    if (dateRange) query.createdAt = dateRange;

    if (
      filters.channel &&
      ["ios", "android", "web", "api"].includes(filters.channel)
    ) {
      query.channel = filters.channel;
    }
    if (filters.search && filters.search.trim()) {
      const searchTerm = filters.search.trim();
      const searchOrConditions = [
        { reference: { $regex: searchTerm, $options: "i" } },
        { txHash: { $regex: searchTerm, $options: "i" } },
        { walletAddress: { $regex: searchTerm, $options: "i" } },
        { comment: { $regex: searchTerm, $options: "i" } },
        { accountNumber: { $regex: searchTerm, $options: "i" } },
        { nowPaymentsPaymentId: { $regex: searchTerm, $options: "i" } },
        { nowPaymentsPayoutId: { $regex: searchTerm, $options: "i" } },
      ];

      // If permission $or conditions exist, merge them
      if (query.$or && Array.isArray(query.$or)) {
        query.$and = [{ $or: query.$or }, { $or: searchOrConditions }];
        delete query.$or;
      } else {
        query.$or = searchOrConditions;
      }
    }
    // Network-level filtering for non-super admins
    if (adminPermissions && !adminPermissions.includes("*")) {
      // Extract permitted networks per tradeType from permissions array
      // e.g. "crypto_buy.manage.network:ethereum" → { networkId: "ethereum", tradeType: "buy" }
      const networkConditions: any[] = [];

      adminPermissions.forEach((permission) => {
        if (
          permission.startsWith(
            `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY}.network:`,
          )
        ) {
          const networkId = permission.split(
            `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY}.network:`,
          )[1];
          networkConditions.push({
            tradeType: "buy",
            "network.networkId": { $regex: new RegExp(`^${networkId}$`, "i") },
          });
        }
        if (
          permission.startsWith(
            `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL}.network:`,
          )
        ) {
          const networkId = permission.split(
            `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL}.network:`,
          )[1];
          networkConditions.push({
            tradeType: "sell",
            "network.networkId": { $regex: new RegExp(`^${networkId}$`, "i") },
          });
        }
      });

      if (networkConditions.length === 0) {
        // Admin has no network permissions at all — return empty
        return {
          transactions: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        };
      }

      // Merge with existing query using $and so other filters still apply
      query.$or = networkConditions;
    }

    const result = await this.cryptoTransactionRepository.findWithPagination(
      query,
      page,
      limit,
      { createdAt: -1 },
      [
        {
          path: "userId",
          select: "firstname lastname avatar country email phone",
        },
        { path: "cryptoId", select: "name code symbol icon" },
        {
          path: "reviewedBy",
          select: "firstName lastName email profilePicture",
        },
        {
          path: "declinedBy",
          select: "firstName lastName email profilePicture",
        },
      ],
    );

    return {
      transactions: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async getCryptoTransactionDetails(transactionId: string) {
    const transaction = await this.cryptoTransactionRepository.findById(
      transactionId,
      [
        {
          path: "userId",
          select: "firstname lastname country avatar email phone",
        },
        { path: "cryptoId", select: "name code symbol icon networks" },
        {
          path: "reviewedBy",
          select: "firstName lastName email profilePicture",
        },
        {
          path: "declinedBy",
          select: "firstName lastName email profilePicture",
        },
        { path: "bankId", select: "name code logo" },
      ],
    );

    if (!transaction) {
      throw new AppError(
        "Crypto transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return transaction;
  }

  async getCryptoTransactionStats(
    filters: any = {},
    adminPermissions?: string[],
  ) {
    const query: any = {};

    const dateRange = resolveDateRange(filters);
    if (dateRange) query.createdAt = dateRange;

    if (filters.tradeType) {
      query.tradeType = filters.tradeType;
    }

    // Mirror exactly what listCryptoTransactions does for non-super admins
    if (adminPermissions && !adminPermissions.includes("*")) {
      const networkConditions: any[] = [];

      adminPermissions.forEach((permission) => {
        if (
          permission.startsWith(
            `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY}.network:`,
          )
        ) {
          const networkId = permission.split(
            `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY}.network:`,
          )[1];
          networkConditions.push({
            tradeType: "buy",
            "network.networkId": { $regex: new RegExp(`^${networkId}$`, "i") },
          });
        }
        if (
          permission.startsWith(
            `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL}.network:`,
          )
        ) {
          const networkId = permission.split(
            `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL}.network:`,
          )[1];
          networkConditions.push({
            tradeType: "sell",
            "network.networkId": { $regex: new RegExp(`^${networkId}$`, "i") },
          });
        }
      });

      // Admin has no network permissions — return empty stats
      if (networkConditions.length === 0) {
        return {
          category: "crypto_transactions",
          overview: {
            totalTransactions: 0,
            successfulTransactions: 0,
            pendingTransactions: 0,
            declinedTransactions: 0,
            failedTransactions: 0,
            successRate: "0%",
          },
          amounts: {
            totalCryptoAmount: 0,
            totalFiatAmount: 0,
            totalServiceFee: 0,
          },
          statusBreakdown: [],
          tradeTypeBreakdown: [],
        };
      }

      query.$or = networkConditions;
    }

    const stats = await this.cryptoTransactionRepository.aggregate([
      { $match: query },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalTransactions: { $sum: 1 },
                totalCryptoAmount: { $sum: "$cryptoAmount" },
                totalFiatAmount: {
                  $sum: { $ifNull: ["$reviewAmount", "$totalAmount"] },
                },
                totalServiceFee: { $sum: "$serviceFee" },
                successfulCount: {
                  $sum: {
                    $cond: [
                      {
                        $in: [
                          "$status",
                          ["approved", "s.approved", "transferred", "success"],
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                pendingCount: {
                  $sum: {
                    $cond: [
                      { $in: ["$status", ["pending", "pending_deposit"]] },
                      1,
                      0,
                    ],
                  },
                },
                pending: {
                  $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
                },
                pendingDeposit: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "pending_deposit"] }, 1, 0],
                  },
                },
                declinedCount: {
                  $sum: { $cond: [{ $eq: ["$status", "declined"] }, 1, 0] },
                },
                failedCount: {
                  $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
                },
              },
            },
          ],
          byStatus: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                totalAmount: {
                  $sum: { $ifNull: ["$reviewAmount", "$totalAmount"] },
                },
              },
            },
            { $sort: { count: -1 } },
          ],
          byTradeType: [
            {
              $group: {
                _id: "$tradeType",
                count: { $sum: 1 },
                totalCrypto: { $sum: "$cryptoAmount" },
                totalFiat: {
                  $sum: { $ifNull: ["$reviewAmount", "$totalAmount"] },
                },
              },
            },
          ],
        },
      },
    ]);

    const summary = stats[0].summary[0] || {};
    const successRate =
      summary.totalTransactions > 0
        ? ((summary.successfulCount / summary.totalTransactions) * 100).toFixed(
            2,
          )
        : 0;

    const safeToKobo = (value: any) => {
      if (value === null || value === undefined) return 0;
      return roundAmount(value);
    };

    return {
      category: "crypto_transactions",
      overview: {
        totalTransactions: summary.totalTransactions || 0,
        successfulTransactions: summary.successfulCount || 0,
        pendingTransactions: summary.pendingCount || 0,
        declinedTransactions: summary.declinedCount || 0,
        failedTransactions: summary.failedCount || 0,
        successRate: `${successRate}%`,
      },
      amounts: {
        totalCryptoAmount: safeToKobo(summary.totalCryptoAmount),
        totalFiatAmount: safeToKobo(summary.totalFiatAmount),
        totalServiceFee: safeToKobo(summary.totalServiceFee),
      },
      statusBreakdown: stats[0].byStatus || [],
      tradeTypeBreakdown: stats[0].byTradeType || [],
    };
  }

  async approveTransaction(
    transactionId: string,
    adminId: string,
    reviewNote?: string,
  ) {
    const transaction =
      await this.cryptoTransactionRepository.findById(transactionId);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (transaction.status !== "pending") {
      throw new AppError(
        "Only pending transactions can be approved",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_STATUS,
      );
    }

    if (transaction.tradeType === "sell") {
      return this.approveSellTransaction(
        transaction,
        transactionId,
        adminId,
        reviewNote,
      );
    } else if (transaction.tradeType === "buy") {
      return this.approveBuyTransaction(
        transaction,
        transactionId,
        adminId,
        reviewNote,
      );
    } else {
      throw new AppError(
        "Invalid trade type",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_OPERATION,
      );
    }
  }

  private async approveSellTransaction(
    transaction: any,
    transactionId: string,
    adminId: string,
    reviewNote?: string,
  ) {
    // Prevent double approval
    if (transaction.transactionId) {
      throw new AppError(
        "This transaction has already been approved",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_OPERATION,
      );
    }

    return SentryHelper.trackCriticalOperation(
      "admin_crypto_sell_approve",
      async () => {
        const actualPayout = transaction.totalAmount;
        const paymentMethod = CRYPTO_SELL_PAYMENT_VIA_PLATFORM
          ? "platform"
          : "manual";

        // CONDITIONAL: Platform Payment
        let creditResult: any = null;

        if (CRYPTO_SELL_PAYMENT_VIA_PLATFORM) {
          // Direct platform credit - add money to user wallet
          creditResult = await this.walletService.creditWallet(
            transaction.userId.toString(),
            actualPayout,
            "Crypto Sale",
            {
              type: TRANSACTION_TYPES.DEPOSIT,
              provider: SYSTEM.PROVIDER,
              idempotencyKey: `${transaction.reference}_approval`,
              initiatedBy: new Types.ObjectId(adminId),
              initiatedByType: "admin",
              remark: `Crypto Sale Payout - ${transaction.cryptoAmount} (Ref: ${transaction.reference})`,
              meta: {
                method: ADMIN_DEPOSIT_TRANSACTION_TYPES.CRYPTO_APPROVE,
                tradeType: "Crypto sell",
                cryptoTransactionId: transaction.id,
                originalAmount: transaction.totalAmount,
                actualPayout: actualPayout,
                serviceCharge: transaction.serviceCharge,
                approvedBy: adminId,
                cryptoAmount: transaction.cryptoAmount,
                exchangeRate: transaction.exchangeRate,
                chargeInfo: {
                  baseAmount: transaction.meta?.chargeInfo?.baseAmount || 0,
                  serviceCharge:
                    transaction.meta?.chargeInfo?.serviceCharge || 0,
                  chargeType: transaction.meta?.chargeInfo?.chargeType || null,
                  chargeValue:
                    transaction.meta?.chargeInfo?.chargeValue || null,
                  creditedAmount: actualPayout,
                },
              },
            },
          );
        }
        // If MANUAL payment: creditResult stays null, wallet is NOT credited

        // UPDATE TRANSACTION
        const serviceCharge = transaction.meta?.serviceCharge || 0;
        const profitAmount = Number(serviceCharge);
        const updateData: any = {
          status: "approved",
          reviewNote,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          paymentMethod,
          profit: profitAmount,
        };

        // Only set transactionId if platform payment was made
        if (creditResult) {
          updateData.transactionId = creditResult.transaction.id;
          updateData.balanceAfter = creditResult.balanceAfter;
          updateData.balanceBefore = creditResult.balanceBefore;
        }

        await Promise.all([
          // Update crypto transaction
          this.cryptoTransactionRepository.update(transactionId, updateData),

          // Update linked wallet transaction (only if platform payment)
          creditResult
            ? this.transactionRepository.update(creditResult.transaction.id, {
                transactableType: "CryptoTransaction",
                transactableId: new Types.ObjectId(transactionId),
              })
            : Promise.resolve(),
        ]);

        // NOTIFICATIONS
        Promise.all([
          // USER NOTIFICATION
          this.notificationService.createNotification({
            type: "crypto_sale_approved",
            notifiableType: "User",
            notifiableId: transaction.userId,
            data: {
              transactionType: "Crypto Sale",
              cryptoAmount: transaction.cryptoAmount,
              cryptoCode: transaction.network.code,
              fiatAmount: transaction.fiatAmount,
              totalPayout: actualPayout,
              serviceCharge: transaction.serviceCharge,
              reference: transaction.reference,
              status: "approved",
              paymentMethod, // Let user know if manual or platform
              ...(paymentMethod === "manual" && {
                bankDetails: {
                  accountName: transaction.accountName,
                  accountNumber: transaction.accountNumber,
                  bankCode: transaction.bankCode,
                },
                estimatedPayoutTime: "1-2 hours",
              }),
            },
            sendEmail: true,
            sendSMS: false,
            sendPush: true,
          }),

          // BONUS & LEADERBOARD (fire and forget)
          this.bonusProcessor.processTradeAndBonus(transaction.userId, {
            transactionId: transaction.id.toString(),
            amount: transaction.totalAmount,
            serviceType: TRANSACTION_TYPES.CRYPTO,
          }),

          this.helperService.updateLeaderboardAsync(
            transaction.userId.toString(),
            transaction.id,
            TRANSACTION_TYPES.CRYPTO,
            transaction.totalAmount,
            transaction.cryptoAmount,
          ),
        ]).catch((err) => {
          logger.error(
            "Background tasks failed during crypto transaction approval:",
            err,
          );
        });

        return {
          message: "Transaction approved successfully",
          transaction: await this.cryptoTransactionRepository.findById(
            transactionId,
            [
              { path: "userId", select: "firstname lastname email" },
              { path: "cryptoId", select: "name code symbol icon" },
              {
                path: "reviewedBy",
                select: "firstName lastName email profilePicture",
              },
            ],
          ),
        };
      },
      transaction.reference,
    );
  }

  private async approveBuyTransaction(
    transaction: any,
    transactionId: string,
    adminId: string,
    reviewNote?: string,
  ) {
    return SentryHelper.trackCriticalOperation(
      "admin_crypto_buy_approve",
      async () => {
        // Simply update the transaction status to approved
        await this.cryptoTransactionRepository.update(transactionId, {
          status: "approved",
          reviewNote,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          profit: 0,
        });

        // Send notification to user
        Promise.all([
          this.notificationService.createNotification({
            type: "crypto_buy_approved",
            notifiableType: "User",
            notifiableId: transaction.userId,
            data: {
              transactionType: "Crypto Buy",
              cryptoAmount: transaction.cryptoAmount,
              cryptoCode: transaction.network.code,
              fiatAmount: transaction.fiatAmount,
              reference: transaction.reference,
              status: "approved",
            },
            sendEmail: true,
            sendSMS: false,
            sendPush: true,
          }),
          this.bonusProcessor.processTradeAndBonus(transaction.userId, {
            transactionId: transaction.id.toString(),
            amount: transaction.totalAmount,
            serviceType: TRANSACTION_TYPES.CRYPTO,
          }),

          this.helperService.updateLeaderboardAsync(
            transaction.userId.toString(),
            transaction.id,
            TRANSACTION_TYPES.CRYPTO,
            transaction.totalAmount,
            transaction.cryptoAmount,
          ),
        ]).catch((err) => {
          logger.error(
            "Background tasks failed during crypto transaction approval:",
            err,
          );
        });

        return {
          message: "Transaction approved successfully",
          transaction: await this.cryptoTransactionRepository.findById(
            transactionId,
            [
              { path: "userId", select: "firstname lastname email" },
              { path: "cryptoId", select: "name code symbol icon" },
              {
                path: "reviewedBy",
                select: "firstName lastName email profilePicture",
              },
            ],
          ),
        };
      },
      transactionId,
    );
  }

  async declineTransaction(
    transactionId: string,
    adminId: string,
    declineNote?: string,
    declinePrompt?: string,
    declineProof?: string,
  ) {
    const transaction =
      await this.cryptoTransactionRepository.findById(transactionId);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return SentryHelper.trackCriticalOperation(
      "admin_crypto_decline",
      async () => {
        if (transaction.status !== "pending") {
          throw new AppError(
            "Only pending transactions can be declined",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_STATUS,
          );
        }

        await this.cryptoTransactionRepository.update(transactionId, {
          status: "declined",
          declineNote,
          declinePrompt,
          declineProof,
          declinedBy: adminId,
          declinedAt: new Date(),
        });

        this.notificationService
          .createNotification({
            type: "crypto_sale_declined",
            notifiableType: "User",
            notifiableId: transaction.userId,
            data: {
              transactionType: "Crypto Sale",
              cryptoAmount: transaction.cryptoAmount,
              cryptoCode: transaction.network.code,
              fiatAmount:
                transaction.totalAmount -
                (Number(transaction.meta?.serviceCharge) || 0),
              reference: transaction.reference,
              reason: declineNote,
              status: "declined",
            },
            sendEmail: true,
            sendSMS: false,
            sendPush: true,
          })
          .catch((err) =>
            logger.error("Notification failed for crypto transaction", err),
          );

        return {
          message: "Transaction declined successfully",
          transaction: await this.cryptoTransactionRepository.findById(
            transactionId,
            [
              {
                path: "userId",
                select: "firstname lastname email country email avatar",
              },
              { path: "cryptoId", select: "name code symbol icon" },
              {
                path: "declinedBy",
                select: "firstName lastName email profilePicture",
              },
            ],
          ),
        };
      },
      transaction.reference || transactionId,
    );
  }

  async secondApproveTransaction(
    transactionId: string,
    adminId: string,
    reviewAmount: number,
    reviewRate: number | undefined,
    reviewNote: string,
    reviewProof?: string,
  ) {
    const transaction =
      await this.cryptoTransactionRepository.findById(transactionId);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (transaction.status !== "pending") {
      throw new AppError(
        "Only pending transactions can be secondly approved",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_STATUS,
      );
    }

    if (transaction.tradeType === "sell") {
      return this.secondApproveSellTransaction(
        transaction,
        transactionId,
        adminId,
        reviewAmount,
        reviewRate,
        reviewNote,
        reviewProof,
      );
    } else if (transaction.tradeType === "buy") {
      return this.secondApproveBuyTransaction(
        transaction,
        transactionId,
        adminId,
        reviewAmount,
        reviewRate,
        reviewNote,
        reviewProof,
      );
    } else {
      throw new AppError(
        "Invalid trade type",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_OPERATION,
      );
    }
  }

  private async secondApproveSellTransaction(
    transaction: any,
    transactionId: string,
    adminId: string,
    reviewAmount: number,
    reviewRate: number | undefined,
    reviewNote: string,
    reviewProof?: string,
  ) {
    return SentryHelper.trackCriticalOperation(
      "admin_crypto_sell_second_approve",
      async () => {
        if (reviewAmount <= 0) {
          throw new AppError(
            "Review amount must be greater than zero",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        const serviceCharge = transaction.meta?.serviceCharge || 0;
        const actualPayout = reviewAmount - Number(serviceCharge);
        const paymentMethod = CRYPTO_SELL_PAYMENT_VIA_PLATFORM
          ? "platform"
          : "manual";
        // No admin-entered rate → assume no correction, spread = 0, profit = fee only
        const effectiveReviewRate = reviewRate ?? transaction.exchangeRate;
        const profitAmount =
          Number(serviceCharge) +
          (effectiveReviewRate - transaction.exchangeRate) *
            transaction.cryptoAmount;

        // CONDITIONAL: Platform Payment
        let creditResult: any = null;

        if (CRYPTO_SELL_PAYMENT_VIA_PLATFORM) {
          // Credit wallet with reviewed amount
          creditResult = await this.walletService.creditWallet(
            transaction.userId.toString(),
            actualPayout,
            "Crypto Sale",
            {
              type: TRANSACTION_TYPES.DEPOSIT,
              provider: SYSTEM.PROVIDER,
              idempotencyKey: `${transaction.reference}_second_approval`,
              initiatedBy: new Types.ObjectId(adminId),
              initiatedByType: "admin",
              remark: `Crypto Sale Payout - ${transaction.cryptoAmount}. (Ref: ${transaction.reference})`,
              meta: {
                method: ADMIN_DEPOSIT_TRANSACTION_TYPES.CRYPTO_SECOND_APPROVE,
                tradeType: "Crypto Sell",
                cryptoTransactionId: transaction.id,
                originalAmount: transaction.totalAmount,
                reviewAmount,
                originalRate: transaction.exchangeRate,
                reviewRate,
                approvedBy: adminId,
                cryptoAmount: transaction.cryptoAmount,
                chargeInfo: {
                  baseAmount: transaction.meta?.chargeInfo?.baseAmount || 0,
                  serviceCharge:
                    transaction.meta?.chargeInfo?.serviceCharge || 0,
                  chargeType: transaction.meta?.chargeInfo?.chargeType || null,
                  chargeValue:
                    transaction.meta?.chargeInfo?.chargeValue || null,
                  creditedAmount: actualPayout,
                },
              },
            },
          );
        }
        // If MANUAL payment: creditResult stays null, wallet is NOT credited

        // UPDATE TRANSACTION
        const updateData: any = {
          status: "s.approved",
          reviewProof,
          reviewAmount,
          reviewRate: effectiveReviewRate,
          profit: profitAmount,
          reviewNote,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          paymentMethod,
        };

        // Only set transactionId if platform payment was made
        if (creditResult) {
          updateData.transactionId = creditResult.transaction.id;
        }

        await Promise.all([
          // Update crypto transaction
          this.cryptoTransactionRepository.update(transactionId, updateData),

          // Update linked wallet transaction (only if platform payment)
          creditResult
            ? this.transactionRepository.update(creditResult.transaction.id, {
                balanceBefore: creditResult.balanceBefore,
                balanceAfter: creditResult.balanceAfter,
                transactableType: "CryptoTransaction",
                transactableId: new Types.ObjectId(transactionId),
              })
            : Promise.resolve(),
        ]);

        // NOTIFICATIONS
        Promise.all([
          // BONUS & LEADERBOARD
          this.bonusProcessor
            .processTradeAndBonus(transaction.userId, {
              transactionId: transaction.id.toString(),
              amount: reviewAmount,
              serviceType: TRANSACTION_TYPES.CRYPTO,
            })
            .catch((err) =>
              logger.error(
                `Trade bonus processing failed: ${TRANSACTION_TYPES.CRYPTO}`,
                err,
              ),
            ),

          this.helperService.updateLeaderboardAsync(
            transaction.userId.toString(),
            transaction.id,
            TRANSACTION_TYPES.CRYPTO,
            reviewAmount,
            transaction.cryptoAmount,
          ),

          // USER NOTIFICATION
          this.notificationService.createNotification({
            type: "crypto_sale_second_approved",
            notifiableType: "User",
            notifiableId: transaction.userId,
            data: {
              transactionType: "Crypto Sale",
              cryptoAmount: transaction.cryptoAmount,
              cryptoCode: transaction.network.code,
              originalAmount: transaction.totalAmount,
              approvedAmount: reviewAmount,
              reference: transaction.reference,
              serviceCharge: serviceCharge,
              status: "second approved",
              reason: reviewNote,
              paymentMethod,
              ...(paymentMethod === "manual" && {
                bankDetails: {
                  accountName: transaction.accountName,
                  accountNumber: transaction.accountNumber,
                  bankCode: transaction.bankCode,
                },
                estimatedPayoutTime: "1-2 hours",
              }),
            },
            sendEmail: true,
            sendSMS: false,
            sendPush: true,
          }),
        ]).catch((err) => {
          logger.error("Background tasks failed during second approval:", err);
        });

        return {
          message: "Second approval completed successfully",
          transaction: await this.cryptoTransactionRepository.findById(
            transactionId,
            [
              {
                path: "userId",
                select: "firstname lastname email country email avatar",
              },
              {
                path: "cryptoId",
                select: "name code symbol icon",
              },
              {
                path: "reviewedBy",
                select: "firstName lastName email profilePicture",
              },
            ],
          ),
        };
      },
      transaction.reference || transactionId,
    );
  }

  private async secondApproveBuyTransaction(
    transaction: any,
    transactionId: string,
    adminId: string,
    reviewAmount: number,
    reviewRate: number | undefined,
    reviewNote: string,
    reviewProof?: string,
  ) {
    return SentryHelper.trackCriticalOperation(
      "crypto_buy_second_approve",
      async () => {
        // No admin-entered rate → assume no correction, spread = 0
        const effectiveReviewRate = reviewRate ?? transaction.exchangeRate;
        const profitAmount =
          (effectiveReviewRate - transaction.exchangeRate) *
          transaction.cryptoAmount;

        // Store review details for manual transfer tracking
        await this.cryptoTransactionRepository.update(transactionId, {
          status: "s.approved",
          reviewProof,
          reviewAmount,
          profit: profitAmount,
          reviewRate: effectiveReviewRate,
          reviewNote,
          reviewedBy: adminId,
          reviewedAt: new Date(),
        });

        Promise.all([
          this.bonusProcessor
            .processTradeAndBonus(transaction.userId, {
              transactionId: transaction.id.toString(),
              amount: transaction.totalAmount,
              serviceType: TRANSACTION_TYPES.CRYPTO,
            })
            .catch((err) =>
              logger.error(
                `Trade bonus processing failed: ${TRANSACTION_TYPES.CRYPTO}`,
                err,
              ),
            ),

          this.helperService.updateLeaderboardAsync(
            transaction.userId.toString(),
            transaction.id,
            TRANSACTION_TYPES.CRYPTO,
            transaction.totalAmount,
            transaction.cryptoAmount,
          ),

          // Send notification
          this.notificationService.createNotification({
            type: "crypto_buy_second_approved",
            notifiableType: "User",
            notifiableId: transaction.userId,
            data: {
              transactionType: "Crypto Buy",
              cryptoAmount: transaction.cryptoAmount,
              cryptoCode: transaction.network.code,
              fiatAmount: transaction.fiatAmount,
              reference: transaction.reference,
              status: "second approved",
              reviewNote,
              reviewAmount,
              reviewRate,
            },
            sendEmail: true,
            sendSMS: false,
            sendPush: true,
          }),
        ]).catch((err) => {
          logger.error("Background tasks failed during second approval:", err);
        });

        return {
          message: "Buy transaction second approval completed successfully",
          transaction: await this.cryptoTransactionRepository.findById(
            transactionId,
            [
              {
                path: "userId",
                select: "firstname lastname email country email avatar",
              },
              {
                path: "cryptoId",
                select: "name code symbol icon",
              },
              {
                path: "reviewedBy",
                select: "firstName lastName email profilePicture",
              },
            ],
          ),
        };
      },
      transaction.reference || transactionId,
    );
  }

  async markAsTransferred(
    transactionId: string,
    adminId: string,
    txHash: string,
    reviewNote?: string,
  ) {
    const transaction =
      await this.cryptoTransactionRepository.findById(transactionId);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return SentryHelper.trackCriticalOperation(
      "crypto_mark_transferred",
      async () => {
        if (
          transaction.status !== "approved" &&
          transaction.status !== "pending"
        ) {
          throw new AppError(
            "Only approved or pending transactions can be marked as transferred",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_STATUS,
          );
        }

        if (transaction.tradeType !== "buy") {
          throw new AppError(
            "Only buy transactions can be marked as transferred",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_OPERATION,
          );
        }

        // Update transaction
        await this.cryptoTransactionRepository.update(transactionId, {
          status: "transferred",
          txHash,
          reviewNote,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          processedAt: new Date(),
          completedAt: new Date(),
        });

        // Send notification
        this.notificationService
          .createNotification({
            type: "crypto_purchase_completed",
            notifiableType: "User",
            notifiableId: transaction.userId,
            data: {
              transactionType: "Crypto Purchase",
              cryptoAmount: transaction.cryptoAmount,
              cryptoCode: transaction.network.code,
              fiatAmount: transaction.totalAmount,
              reference: transaction.reference,
              txHash,
              status: "completed",
            },
            sendEmail: true,
            sendSMS: false,
            sendPush: true,
          })
          .catch((err) => {
            logger.error("Failed to send notification:", err);
          });

        this.helperService
          .updateLeaderboardAsync(
            transaction.userId.toString(),
            transaction.id,
            TRANSACTION_TYPES.CRYPTO,
            transaction.totalAmount,
            transaction.cryptoAmount,
          )
          .catch((err) => {
            logger.error("Leaderboard update failed (crypto buy):", err);
          });

        return {
          message: "Transaction marked as transferred successfully",
          transaction: await this.cryptoTransactionRepository.findById(
            transactionId,
            [
              {
                path: "userId",
                select: "firstname lastname email country email avatar",
              },
              {
                path: "cryptoId",
                select: "name code symbol icon",
              },
              {
                path: "reviewedBy",
                select: "firstName lastName email profilePicture",
              },
            ],
          ),
        };
      },
      transaction.reference || transactionId,
    );
  }
}
