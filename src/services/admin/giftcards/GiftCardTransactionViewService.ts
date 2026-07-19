import { GiftCardRepository } from "@/repositories/shared/GiftCardRepository";
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
import logger from "@/logger";
import data from "@/routes/client/data";
import { TradeBonusProcessorService } from "../../client/utility/TradeBonusProcessorService";
import { HelperService } from "@/services/client/utility/HelperService";
import ServiceContainer from "../../client/container";
import { GiftCardTransactionRepository } from "@/repositories/client/GiftCardTransactionRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { PartnerWebhookService } from "@/services/partner/PartnerWebhookService";
import { IGiftCardTransaction } from "@/models/giftcard/GiftCardTransaction";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { GiftCard } from "@/models/giftcard/GiftCard";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { resolveDateRange } from "@/utils/dateRange";

const GIFTCARD_SELL_PAYMENT_VIA_PLATFORM =
  process.env.GIFTCARD_SELL_PAYMENT_VIA_PLATFORM !== "false";

export class GiftCardTransactionViewService {
  constructor(
    private giftCardRepository: GiftCardRepository,
    private giftCardTransactionRepository: GiftCardTransactionRepository,
    private walletService: WalletService,
    private transactionRepository: TransactionRepository,
    private notificationService: NotificationService,
    private bonusProcessor: TradeBonusProcessorService,
    private helperService: HelperService,
    private userRepository: UserRepository,
    private partnerWebhookService: PartnerWebhookService,
  ) {}

  CONCURRENCY_LIMIT = 5;

  private readonly TRANSACTION_POPULATIONS = [
    {
      path: "userId",
      select: "firstname lastname email country phone avatar",
    },
    {
      path: "giftCardId",
      select: "name logo currency categoryId countryId sellRate buyRate",
      populate: [
        { path: "categoryId", select: "name icon description" },
        { path: "countryId", select: "name flag currency" },
      ],
    },
    { path: "reviewedBy", select: "firstName lastName" },
  ];

  async listGiftCardTransactions(
    page: number = 1,
    limit: number = 20,
    filters: any = {},
    adminPermissions?: string[],
  ) {
    const query: any = {};

    if (filters.status === "pending") {
      // Surface pending transactions wherever they live — including pending
      // children trapped inside a "multiple" parent group.
      query.status = "pending";
    } else {
      // Show parent transactions, plus any children matching the status filter
      const parentConditions = [
        { parentId: { $exists: false } },
        { parentId: null },
      ];

      if (filters.status) {
        // If specific status requested: show parents with that status OR children with that status
        query.$or = [
          { parentId: { $exists: false }, status: filters.status },
          { parentId: null, status: filters.status },
          { parentId: { $exists: true, $ne: null }, status: filters.status }, // Include children with matching status
        ];
      } else {
        // No status filter: show all parents only
        query.$or = parentConditions;
      }
    }

    if (filters.userId) query.userId = filters.userId;
    if (filters.cardType) query.cardType = filters.cardType;
    if (filters.tradeType) query.tradeType = filters.tradeType;
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
        { providerReference: { $regex: searchTerm, $options: "i" } },
        { comment: { $regex: searchTerm, $options: "i" } },
        { accountNumber: { $regex: searchTerm, $options: "i" } },
        { accountName: { $regex: searchTerm, $options: "i" } },
      ];

      // If query already has $or (from permissions), merge them
      if (query.$or && Array.isArray(query.$or)) {
        query.$and = [{ $or: query.$or }, { $or: searchOrConditions }];
        delete query.$or;
      } else {
        query.$or = searchOrConditions;
      }
    }

    // Network-level filtering for non-super admins
    if (adminPermissions && !adminPermissions.includes("*")) {
      const hasBuyPermission = adminPermissions.includes(
        ADMIN_PERMISSIONS.GIFTCARD.MANAGE_BUY,
      );

      // Extract permitted category IDs from sell permissions
      const permittedCategoryIds = adminPermissions
        .filter((p) =>
          p.startsWith(`${ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL}.category:`),
        )
        .map(
          (p) =>
            p.split(`${ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL}.category:`)[1],
        );

      if (!hasBuyPermission && permittedCategoryIds.length === 0) {
        // Admin has no relevant permissions — return empty
        return {
          transactions: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        };
      }

      // We need to join with GiftCard to filter by categoryId
      // Build $or conditions based on what admin can access
      const orConditions: any[] = [];

      if (hasBuyPermission) {
        orConditions.push({ tradeType: "buy" });
      }

      if (permittedCategoryIds.length > 0) {
        // Get giftCard IDs that belong to permitted categories
        const permittedGiftCards = await GiftCard.find({
          categoryId: { $in: permittedCategoryIds },
          deletedAt: null,
        }).select("_id");

        const permittedGiftCardIds = permittedGiftCards.map((g) => g._id);

        orConditions.push({
          tradeType: "sell",
          giftCardId: { $in: permittedGiftCardIds },
        });
      }

      query.$or = orConditions;
    }

    // Always sort pending first, then by creation date
    // Use numeric status priority: pending=1, others=0, then sort by createdAt descending
    const sortOrder = { createdAt: -1 };

    const result = await this.giftCardTransactionRepository.findWithPaginationPendingFirst(
      query,
      page,
      limit,
      [
        {
          path: "userId",
          select: "firstname lastname email country phone avatar",
        },
        {
          path: "giftCardId",
          select: "name logo currency categoryId countryId sellRate buyRate",
          populate: [
            { path: "categoryId", select: "name icon description" },
            { path: "countryId", select: "name flag currency" },
          ],
        },
        { path: "reviewedBy", select: "firstName lastName" },
        { path: "declinedBy", select: "firstName lastName" },
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

  async getGiftCardTransactionDetails(transactionId: string) {
    const transaction = await this.giftCardTransactionRepository.findById(
      transactionId,
      [
        {
          path: "userId",
          select: "firstname lastname email country phone avatar",
        },
        {
          path: "giftCardId",
          select: "name logo currency categoryId countryId sellRate buyRate",
          populate: [
            {
              path: "categoryId",
              select: "name icon description",
            },
            {
              path: "countryId",
              select: "name flag currency",
            },
          ],
        },
        { path: "reviewedBy", select: "firstName lastName" },
        { path: "declinedBy", select: "firstName lastName" },
      ],
    );
    if (!transaction) {
      throw new Error("Gift card transaction not found");
    }
    return transaction;
  }

  async getGiftCardTransactionStats(
    filters: any = {},
    adminPermissions?: string[],
  ) {
    const query: any = {};

    const dateRange = resolveDateRange(filters);
    if (dateRange) query.createdAt = dateRange;

    if (filters.tradeType) {
      query.tradeType = filters.tradeType;
    }

    // Mirror exactly what listGiftCardTransactions does for non-super admins
    if (adminPermissions && !adminPermissions.includes("*")) {
      const hasBuyPermission = adminPermissions.includes(
        ADMIN_PERMISSIONS.GIFTCARD.MANAGE_BUY,
      );

      const permittedCategoryIds = adminPermissions
        .filter((p) =>
          p.startsWith(`${ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL}.category:`),
        )
        .map(
          (p) =>
            p.split(`${ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL}.category:`)[1],
        );

      // Admin has no relevant permissions — return empty stats
      if (!hasBuyPermission && permittedCategoryIds.length === 0) {
        return {
          category: "giftcard_transactions",
          overview: {
            totals: {},
            statusBreakdown: [],
            tradeTypeBreakdown: [],
            cardTypeBreakdown: [],
          },
        };
      }

      const orConditions: any[] = [];

      if (hasBuyPermission) {
        orConditions.push({ tradeType: "buy" });
      }

      if (permittedCategoryIds.length > 0) {
        const permittedGiftCards = await GiftCard.find({
          categoryId: { $in: permittedCategoryIds },
          deletedAt: null,
        }).select("_id");

        const permittedGiftCardIds = permittedGiftCards.map((g) => g._id);

        orConditions.push({
          tradeType: "sell",
          giftCardId: { $in: permittedGiftCardIds },
        });
      }

      query.$or = orConditions;
    }

    const stats = await this.giftCardTransactionRepository.aggregate([
      { $match: query },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                totalTransactions: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
                totalPayableAmount: {
                  $sum: { $ifNull: ["$reviewedAmount", "$payableAmount"] },
                },
                totalServiceCharge: { $sum: "$serviceCharge" },
                totalBuy: {
                  $sum: { $cond: [{ $eq: ["$tradeType", "buy"] }, 1, 0] },
                },
                totalSell: {
                  $sum: { $cond: [{ $eq: ["$tradeType", "sell"] }, 1, 0] },
                },
                totalPending: {
                  $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
                },
                totalApproved: {
                  $sum: {
                    $cond: [
                      { $in: ["$status", ["approved", "s.approved"]] },
                      1,
                      0,
                    ],
                  },
                },
                totalDeclined: {
                  $sum: { $cond: [{ $eq: ["$status", "declined"] }, 1, 0] },
                },
                totalSuccess: {
                  $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] },
                },
                totalFailed: {
                  $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
                },
                totalMultiple: {
                  $sum: { $cond: [{ $eq: ["$status", "multiple"] }, 1, 0] },
                },
                totalSecondApproved: {
                  $sum: { $cond: [{ $eq: ["$status", "s.approved"] }, 1, 0] },
                },
                totalArchived: {
                  $sum: { $cond: [{ $eq: ["$status", "archived"] }, 1, 0] },
                },
              },
            },
          ],
          statusBreakdown: [
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
                totalPayableAmount: {
                  $sum: { $ifNull: ["$reviewedAmount", "$payableAmount"] },
                },
              },
            },
            {
              $project: {
                _id: 0,
                status: "$_id",
                count: 1,
                totalAmount: 1,
                totalPayableAmount: 1,
              },
            },
          ],
          tradeTypeBreakdown: [
            {
              $group: {
                _id: "$tradeType",
                count: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
                totalPayableAmount: {
                  $sum: { $ifNull: ["$reviewedAmount", "$payableAmount"] },
                },
                pendingCount: {
                  $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
                },
                approvedCount: {
                  $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] },
                },
                declinedCount: {
                  $sum: { $cond: [{ $eq: ["$status", "declined"] }, 1, 0] },
                },
              },
            },
            {
              $project: {
                _id: 0,
                tradeType: "$_id",
                count: 1,
                totalAmount: 1,
                totalPayableAmount: 1,
                pendingCount: 1,
                approvedCount: 1,
                declinedCount: 1,
              },
            },
          ],
          cardTypeBreakdown: [
            {
              $group: {
                _id: { $ifNull: ["$cardType", "unknown"] },
                count: { $sum: 1 },
                totalAmount: { $sum: "$amount" },
                pendingCount: {
                  $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
                },
              },
            },
            { $match: { count: { $gt: 0 } } },
            {
              $project: {
                _id: 0,
                cardType: "$_id",
                count: 1,
                totalAmount: 1,
                pendingCount: 1,
              },
            },
          ],
        },
      },
    ]);

    const result = stats[0];

    return {
      category: "giftcard_transactions",
      overview: {
        totals: result.totals[0] || {},
        statusBreakdown: result.statusBreakdown || [],
        tradeTypeBreakdown: result.tradeTypeBreakdown || [],
        cardTypeBreakdown: result.cardTypeBreakdown || [],
      },
    };
  }

  async approveTransaction(
    transactionId: string,
    adminId: string,
    reviewNote?: string,
  ) {
    const transaction =
      await this.giftCardTransactionRepository.findById(transactionId);
    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return SentryHelper.trackCriticalOperation(
      "admin_giftcard_approve",
      async () => {
        if (transaction.status !== "pending") {
          throw new AppError(
            "Only pending transactions can be approved",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_STATUS,
          );
        }

        if (transaction.tradeType !== "sell") {
          throw new AppError(
            "Only sell transactions require admin approval",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_OPERATION,
          );
        }

        // Prevent double approval
        if (transaction.transactionId) {
          throw new AppError(
            "This transaction has already been approved",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_OPERATION,
          );
        }

        const serviceCharge = transaction.serviceCharge || 0;
        const netPayout = transaction.payableAmount - serviceCharge;
        const paymentMethod = GIFTCARD_SELL_PAYMENT_VIA_PLATFORM
          ? "platform"
          : "manual";

        // CONDITIONAL: Platform Payment
        let creditResult: any = null;

        if (GIFTCARD_SELL_PAYMENT_VIA_PLATFORM) {
          // Direct platform credit - add money to user wallet
          creditResult = await this.walletService.creditWallet(
            transaction.userId.toString(),
            netPayout,
            "Gift card",
            {
              type: TRANSACTION_TYPES.DEPOSIT,
              provider: SYSTEM.PROVIDER,
              idempotencyKey: `${transaction.reference}_approval`,
              initiatedBy: new Types.ObjectId(adminId),
              initiatedByType: "admin",
              remark: `Gift Card Payout of ₦${netPayout}. (${transaction.reference})`,
              meta: {
                method: ADMIN_DEPOSIT_TRANSACTION_TYPES.GIFTCARD_APPROVE,
                tradeType: "giftcard sell",
                giftCardTransactionId: transaction.id,
                originalAmount: transaction.payableAmount,
                netPayout: netPayout,
                serviceCharge: serviceCharge,
                approvedBy: adminId,
                chargeInfo: {
                  baseAmount: transaction.meta?.chargeInfo?.baseAmount || 0,
                  serviceCharge:
                    transaction.meta?.chargeInfo?.serviceCharge || 0,
                  chargeType: transaction.meta?.chargeInfo?.chargeType || null,
                  chargeValue:
                    transaction.meta?.chargeInfo?.chargeValue || null,
                  creditedAmount: netPayout,
                },
              },
            },
          );
        }
        // If MANUAL payment: creditResult stays null, wallet is NOT credited

        // UPDATE TRANSACTION
        const profitAmount = Number(serviceCharge);
        const updateData: any = {
          status: "approved",
          reviewNote,
          reviewedBy: new Types.ObjectId(adminId),
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
          // Update gift card transaction
          this.giftCardTransactionRepository.update(transactionId, updateData),

          // Update linked wallet transaction (only if platform payment)
          creditResult
            ? this.transactionRepository.update(creditResult.transaction.id, {
                transactableType: "GiftCardTransaction",
                transactableId: new Types.ObjectId(transactionId),
              })
            : Promise.resolve(),
        ]);

        // NOTIFICATIONS
        Promise.all([
          // BONUS & LEADERBOARD (fire and forget)
          this.bonusProcessor
            .processTradeAndBonus(transaction.userId, {
              transactionId: transaction.id.toString(),
              amount: netPayout,
              serviceType: TRANSACTION_TYPES.GIFTCARD,
            })
            .catch((err) =>
              logger.error(
                `Trade bonus processing failed: ${TRANSACTION_TYPES.GIFTCARD}`,
                err,
              ),
            ),

          this.helperService
            .updateLeaderboardAsync(
              transaction.userId.toString(),
              transaction.id,
              TRANSACTION_TYPES.GIFTCARD,
              netPayout,
              transaction.amount,
            )
            .catch((err) =>
              logger.error(
                `Leaderboard update failed ${TRANSACTION_TYPES.GIFTCARD}`,
                err,
              ),
            ),

          this.handlePartnerWebhook(
            transaction,
            "giftcard.sale.approved",
            "approved",
          ).catch((err) => logger.error("Partner webhook failed", err)),

          this.handleCommissionPayment(transaction).catch((err) =>
            logger.error("Commission payment failed", err),
          ),

          // USER NOTIFICATION
          this.notificationService
            .createNotification({
              type: "giftcard_sale_approved",
              notifiableType: "User",
              notifiableId: transaction.userId,
              data: {
                transactionType: "Gift Card Sale",
                originalAmount: transaction.payableAmount,
                serviceCharge: serviceCharge,
                netPayout: netPayout,
                reference: transaction.reference,
                status: "approved",
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
            })
            .catch((err) => logger.info(`Failed to send notification `, err)),
        ]).catch((err) => {
          logger.error(
            "Background tasks failed during giftcard transaction approval:",
            err,
          );
        });

        return {
          transaction: await this.giftCardTransactionRepository.findById(
            transactionId,
            this.TRANSACTION_POPULATIONS,
          ),
        };
      },
      transaction.reference || transactionId,
    );
  }

  async declineTransaction(
    transactionId: string,
    adminId: string,
    declineNote: string,
    declineProof?: string,
    declinePrompt?: string,
  ) {
    const transaction =
      await this.giftCardTransactionRepository.findById(transactionId);
    return SentryHelper.trackCriticalOperation(
      "admin_giftcard_decline",
      async () => {
        if (!transaction) {
          throw new AppError(
            "Transaction not found",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.NOT_FOUND,
          );
        }

        if (
          transaction.status !== "pending" &&
          transaction.status !== "approved"
        ) {
          throw new AppError(
            "Only pending or approved transactions can be declined",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_STATUS,
          );
        }

        // Decline transaction
        await this.giftCardTransactionRepository.update(transactionId, {
          status: "declined",
          declineNote,
          declineProof,
          declinePrompt,
          declinedBy: new Types.ObjectId(adminId),
          declinedAt: new Date(),
        });

        Promise.all([
          this.handlePartnerWebhook(
            transaction,
            "giftcard.sale.declined",
            "declined",
          ).catch((err) => logger.error("Partner webhook failed", err)),

          this.notificationService
            .createNotification({
              type: "giftcard_sale_declined",
              notifiableType: "User",
              notifiableId: transaction.userId,
              data: {
                transactionType: "Gift Card Sale",
                amount: transaction.payableAmount,
                reference: transaction.reference,
                reason: declineNote,
                status: "declined",
              },
              sendEmail: true,
              sendSMS: false,
              sendPush: true,
            })
            .catch((err) => {
              logger.error("Giftcard Decline notification failed:", err);
            }),
        ]).catch((err) => {
          logger.error("Background tasks failed during decline:", err);
        });
        return {
          transaction: await this.giftCardTransactionRepository.findById(
            transactionId,
            [
              {
                path: "userId",
                select: "firstname lastname email country phone avatar",
              },
              {
                path: "giftCardId",
                select:
                  "name logo currency categoryId countryId sellRate buyRate",
                populate: [
                  {
                    path: "categoryId",
                    select: "name icon description",
                  },
                  {
                    path: "countryId",
                    select: "name flag currency",
                  },
                ],
              },
              { path: "reviewedBy", select: "firstName lastName" },
              { path: "declinedBy", select: "firstName lastName" },
            ],
          ),
        };
      },
      transaction?.reference || transactionId,
    );
  }

  async secondApproveTransaction(
    transactionId: string,
    adminId: string,
    reviewedAmount: number,
    reviewNote: string,
    reviewProof?: string,
  ) {
    const transaction =
      await this.giftCardTransactionRepository.findById(transactionId);
    return SentryHelper.trackCriticalOperation(
      "admin_giftcard_second_approve",
      async () => {
        if (!transaction) {
          throw new AppError(
            "Transaction not found",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.NOT_FOUND,
          );
        }

        if (transaction.status !== "pending") {
          throw new AppError(
            "Only pending transactions can be second approved",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_STATUS,
          );
        }

        if (transaction.tradeType !== "sell") {
          throw new AppError(
            "Only sell transactions require admin approval",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_OPERATION,
          );
        }

        const serviceCharge = transaction.serviceCharge || 0;
        const netPayout = reviewedAmount - serviceCharge;
        const paymentMethod = GIFTCARD_SELL_PAYMENT_VIA_PLATFORM
          ? "platform"
          : "manual";
        // Spread = what we originally promised vs what admin actually approved.
        // No adjustment → payableAmount === reviewedAmount → spread is 0, profit = fee only.
        const profitAmount =
          Number(serviceCharge) + (transaction.payableAmount - reviewedAmount);

        // CONDITIONAL: Platform Payment
        let creditResult: any = null;

        if (GIFTCARD_SELL_PAYMENT_VIA_PLATFORM) {
          // Credit wallet with reviewedAmount
          creditResult = await this.walletService.creditWallet(
            transaction.userId.toString(),
            netPayout,
            "Giftcard ",
            {
              type: TRANSACTION_TYPES.DEPOSIT,
              provider: SYSTEM.PROVIDER,
              idempotencyKey: `${transaction.reference}_second_approval`,
              initiatedBy: new Types.ObjectId(adminId),
              initiatedByType: "admin",
              remark: `Giftcard Payout: ₦${netPayout} (Ref: ${transaction.reference})`,
              meta: {
                method: ADMIN_DEPOSIT_TRANSACTION_TYPES.GIFTCARD_SECOND_APPROVE,
                tradeType: "giftcard sell",
                giftCardTransactionId: transaction.id,
                originalAmount: transaction.payableAmount,
                reviewedAmount: reviewedAmount,
                firstApprovedBy: transaction.reviewedBy?.toString(),
                secondApprovedBy: adminId,
                serviceCharge: serviceCharge,
                netPayout: netPayout,
                chargeInfo: {
                  baseAmount: transaction.meta?.chargeInfo?.baseAmount || 0,
                  serviceCharge:
                    transaction.meta?.chargeInfo?.serviceCharge || 0,
                  chargeType: transaction.meta?.chargeInfo?.chargeType || null,
                  chargeValue:
                    transaction.meta?.chargeInfo?.chargeValue || null,
                  creditedAmount: netPayout,
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
          reviewedAmount,
          reviewNote,
          profit: profitAmount,
          reviewedBy: new Types.ObjectId(adminId),
          reviewedAt: new Date(),
          paymentMethod,
        };

        // Only set transactionId if platform payment was made
        if (creditResult) {
          updateData.transactionId = creditResult.transaction.id;
          updateData.balanceBefore = creditResult.balanceBefore;
          updateData.balanceAfter = creditResult.balanceAfter;
        }

        await Promise.all([
          // Update gift card transaction
          this.giftCardTransactionRepository.update(transactionId, updateData),

          // Update transaction record (only if platform payment)
          creditResult
            ? this.transactionRepository.update(creditResult.transaction.id, {
                transactableType: "GiftCardTransaction",
                transactableId: new Types.ObjectId(transactionId),
              })
            : Promise.resolve(),
        ]);

        // NOTIFICATIONS
        Promise.all([
          // Send notification
          this.notificationService
            .createNotification({
              type: "giftcard_sale_completed",
              notifiableType: "User",
              notifiableId: transaction.userId,
              data: {
                transactionType: "Gift Card Sale",
                amount: reviewedAmount,
                reference: transaction.reference,
                status: "completed",
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
            })
            .catch((err) => {
              logger.info("Notification failed", err);
            }),

          this.handlePartnerWebhook(
            transaction,
            "giftcard.sale.second.approved",
            "approved",
          ).catch((err) => logger.error("Partner webhook failed", err)),

          this.handleCommissionPayment(transaction).catch((err) =>
            logger.error("Commission payment failed", err),
          ),

          this.bonusProcessor
            .processTradeAndBonus(transaction.userId, {
              transactionId: transaction.id.toString(),
              amount: netPayout,
              serviceType: TRANSACTION_TYPES.GIFTCARD,
            })
            .catch((err) =>
              logger.error(
                `Trade bonus processing failed: ${TRANSACTION_TYPES.GIFTCARD}`,
                err,
              ),
            ),

          this.helperService
            .updateLeaderboardAsync(
              transaction.userId.toString(),
              transaction.id,
              TRANSACTION_TYPES.GIFTCARD,
              netPayout,
              transaction.amount,
            )
            .catch((err) =>
              logger.error(
                `Leaderboard update failed ${TRANSACTION_TYPES.GIFTCARD}`,
                err,
              ),
            ),
        ]).catch((err) => {
          logger.error("Background tasks failed during second approval:", err);
        });

        return {
          transaction: await this.giftCardTransactionRepository.findById(
            transactionId,
            [
              {
                path: "userId",
                select: "firstname lastname email country phone avatar",
              },
              {
                path: "giftCardId",
                select:
                  "name logo currency categoryId countryId sellRate buyRate",
                populate: [
                  {
                    path: "categoryId",
                    select: "name icon description",
                  },
                  {
                    path: "countryId",
                    select: "name flag currency",
                  },
                ],
              },
              { path: "reviewedBy", select: "firstName lastName" },
              { path: "declinedBy", select: "firstName lastName" },
            ],
          ),
        };
      },
      transaction?.reference || transactionId,
    );
  }

  async archiveTransaction(transactionId: string) {
    const transaction =
      await this.giftCardTransactionRepository.findById(transactionId);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (
      transaction.status !== "approved" &&
      transaction.status !== "declined"
    ) {
      throw new AppError(
        "Only approved or declined transactions can be archived",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_STATUS,
      );
    }

    // Archive transaction
    await this.giftCardTransactionRepository.update(transactionId, {
      status: "archived",
    });

    return {
      transaction: await this.giftCardTransactionRepository.findById(
        transactionId,
        [
          {
            path: "userId",
            select: "firstname lastname email country phone avatar",
          },
          {
            path: "giftCardId",
            select: "name logo currency categoryId countryId sellRate buyRate",
            populate: [
              {
                path: "categoryId",
                select: "name icon description",
              },
              {
                path: "countryId",
                select: "name flag currency",
              },
            ],
          },
          { path: "reviewedBy", select: "firstName lastName" },
          { path: "declinedBy", select: "firstName lastName" },
        ],
      ),
    };
  }

  async getTransactionsByParentId(parentId: string) {
    const transactions = await this.giftCardTransactionRepository.find(
      {
        parentId: new Types.ObjectId(parentId),
      },
      undefined,
      [
        {
          path: "userId",
          select: "firstname lastname email country phone avatar",
        },
        {
          path: "giftCardId",
          select: "name logo currency categoryId",
          populate: {
            path: "categoryId",
            select: "name icon description",
          },
        },
        { path: "reviewedBy", select: "firstName lastName" },
        { path: "declinedBy", select: "firstName lastName" },
      ],
    );

    return transactions;
  }

  async approveAllByParentId(
    parentId: string,
    adminId: string,
    reviewNote?: string,
  ) {
    const parent = await this.giftCardTransactionRepository.findById(parentId);

    if (!parent) {
      throw new AppError(
        "Parent transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return SentryHelper.trackCriticalOperation(
      "admin_giftcard_bulk_approve",
      async () => {
        const childTransactions = await this.giftCardTransactionRepository.find(
          {
            parentId: new Types.ObjectId(parentId),
          },
        );

        if (childTransactions.length === 0) {
          throw new AppError(
            "No child transactions found",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.NOT_FOUND,
          );
        }

        // Only process pending transactions
        const pendingChildren = childTransactions.filter(
          (t) => t.status === "pending",
        );

        if (pendingChildren.length === 0) {
          throw new AppError(
            "No pending child transactions to approve",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_STATUS,
          );
        }

        const invalidTradeTypes = pendingChildren.filter(
          (t) => t.tradeType !== "sell",
        );
        if (invalidTradeTypes.length > 0) {
          throw new AppError(
            "Only sell transactions require admin approval",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_OPERATION,
          );
        }

        const paymentMethod = GIFTCARD_SELL_PAYMENT_VIA_PLATFORM
          ? "platform"
          : "manual";

        const approvedTransactions: Array<{
          childId: any;
          reference: string;
          netPayout: number;
          transactionId?: string;
        }> = [];
        const failedTransactions: Array<{
          childId: any;
          reference: string;
          reason: string;
        }> = [];

        let totalNetPayout = 0;
        let totalUSDAmount = 0;
        const userId = pendingChildren[0].userId.toString();

        // Process each child transaction individually
        for (const child of pendingChildren) {
          try {
            const serviceCharge = child.serviceCharge || 0;
            const netPayout = child.payableAmount! - serviceCharge;

            // ==================== CONDITIONAL: Platform Payment ====================
            let creditResult: any = null;

            if (GIFTCARD_SELL_PAYMENT_VIA_PLATFORM) {
              // Create individual wallet credit transaction for this child
              creditResult = await this.walletService.creditWallet(
                userId,
                netPayout,
                `Giftcard`,
                {
                  type: TRANSACTION_TYPES.DEPOSIT,
                  provider: SYSTEM.PROVIDER,
                  idempotencyKey: `${child.reference}_approval`,
                  initiatedBy: new Types.ObjectId(adminId),
                  initiatedByType: "admin",
                  remark: `Giftcard Payout: ₦${netPayout} - Ref ${child.reference}`,
                  meta: {
                    method: ADMIN_DEPOSIT_TRANSACTION_TYPES.GIFTCARD_APPROVE,
                    tradeType: "giftcard sell",
                    bulkApproval: true,
                    parentId: parentId,
                    giftCardTransactionId: child.id,
                    originalAmount: child.payableAmount,
                    netPayout: netPayout,
                    serviceCharge: serviceCharge,
                    approvedBy: adminId,
                    chargeInfo: {
                      baseAmount: child.meta?.chargeInfo?.baseAmount || 0,
                      serviceCharge: child.meta?.chargeInfo?.serviceCharge || 0,
                      chargeType: child.meta?.chargeInfo?.chargeType || null,
                      chargeValue: child.meta?.chargeInfo?.chargeValue || null,
                      creditedAmount: netPayout,
                    },
                  },
                },
              );
            }
            // If MANUAL payment: creditResult stays null, wallet is NOT credited

            const updateData: any = {
              status: "approved",
              reviewNote,
              reviewedBy: new Types.ObjectId(adminId),
              reviewedAt: new Date(),
              paymentMethod,
            };

            // Only set transactionId if platform payment was made
            if (creditResult) {
              updateData.transactionId = creditResult.transaction.id;
              updateData.balanceAfter = creditResult.balanceAfter;
              updateData.balanceBefore = creditResult.balanceBefore;
            }

            // Update child transaction with its own transaction ID
            await Promise.all([
              this.giftCardTransactionRepository.update(
                child.id.toString(),
                updateData,
              ),
              creditResult
                ? this.transactionRepository.update(
                    creditResult.transaction.id,
                    {
                      transactableType: "GiftCardTransaction",
                      transactableId: new Types.ObjectId(child.id),
                    },
                  )
                : Promise.resolve(),
            ]);

            totalNetPayout += netPayout;
            totalUSDAmount += child.amount;

            approvedTransactions.push({
              childId: child.id,
              reference: child.reference,
              netPayout: netPayout,
              transactionId: creditResult?.transaction.id,
            });

            // Send individual notification
            this.notificationService
              .createNotification({
                type: "giftcard_sale_approved",
                notifiableType: "User",
                notifiableId: child.userId,
                data: {
                  transactionType: "Gift Card Sale",
                  originalAmount: child.payableAmount,
                  serviceCharge: serviceCharge,
                  netPayout: netPayout,
                  reference: child.reference,
                  status: "approved",
                  paymentMethod,
                  ...(paymentMethod === "manual" && {
                    bankDetails: {
                      accountName: child.accountName,
                      accountNumber: child.accountNumber,
                      bankCode: child.bankCode,
                    },
                    estimatedPayoutTime: "1-2 hours",
                  }),
                },
                sendEmail: true,
                sendSMS: false,
                sendPush: true,
              })
              .catch((err: any) => {
                logger.error(
                  `Failed to send approval notification: ${child.reference}`,
                  {
                    error: err.message,
                    userId: userId,
                  },
                );
              });
          } catch (error: any) {
            logger.error(
              `Failed to approve child transaction: ${child.reference}`,
              {
                error: error.message,
                childId: child.id,
              },
            );
            failedTransactions.push({
              childId: child.id,
              reference: child.reference,
              reason: error.message,
            });
          }
        }

        // Background tasks (fire-and-forget)
        Promise.all([
          this.handlePartnerWebhook(
            parent,
            "giftcard.sale.approved",
            "approved",
          ).catch((err) => logger.error("Partner webhook failed", err)),

          this.handleCommissionPayment(parent).catch((err) =>
            logger.error("Commission payment failed", err),
          ),

          this.bonusProcessor
            .processTradeAndBonus(parent.userId, {
              transactionId: parent.id.toString(),
              amount: totalNetPayout,
              serviceType: TRANSACTION_TYPES.GIFTCARD,
            })
            .catch((err) =>
              logger.error(
                `Trade bonus processing failed: ${TRANSACTION_TYPES.GIFTCARD}`,
                err,
              ),
            ),

          this.helperService
            .updateLeaderboardAsync(
              userId,
              parent.id,
              TRANSACTION_TYPES.GIFTCARD,
              totalNetPayout,
              totalUSDAmount,
            )
            .catch((err) =>
              logger.error(
                `Leaderboard update failed ${TRANSACTION_TYPES.GIFTCARD}`,
                err,
              ),
            ),
        ]).catch((err) => {
          logger.error("Background tasks failed during bulk approval:", err);
        });

        return {
          approvedCount: approvedTransactions.length,
          failedCount: failedTransactions.length,
          totalPayout: totalNetPayout,
          paymentMethod,
          approved: approvedTransactions,
          failed: failedTransactions,
        };
      },
      parentId,
    );
  }

  async declineAllByParentId(
    parentId: string,
    adminId: string,
    declineNote: string,
    declineProof?: string,
    declinePrompt?: string,
  ) {
    const parent = await this.giftCardTransactionRepository.findById(parentId);

    if (!parent) {
      throw new AppError(
        "Parent transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return SentryHelper.trackCriticalOperation(
      "admin_giftcard_bulk_decline",
      async () => {
        if (parent.status !== "multiple") {
          throw new AppError(
            "Parent transaction must have status 'multiple'",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_STATUS,
          );
        }

        const childTransactions = await this.giftCardTransactionRepository.find(
          {
            parentId: new Types.ObjectId(parentId),
          },
        );

        if (childTransactions.length === 0) {
          throw new AppError(
            "No child transactions found",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.NOT_FOUND,
          );
        }

        // Only process pending transactions
        const pendingChildren = childTransactions.filter(
          (t) => t.status === "pending",
        );

        if (pendingChildren.length === 0) {
          throw new AppError(
            "No pending child transactions to decline",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_STATUS,
          );
        }

        const declinedTransactions: Array<{
          childId: any;
          reference: string;
        }> = [];
        const failedTransactions: Array<{
          childId: any;
          reference: string;
          reason: string;
        }> = [];

        const userId = pendingChildren[0].userId.toString();

        // Process all pending child transactions sequentially
        for (const child of pendingChildren) {
          try {
            await this.giftCardTransactionRepository.update(
              child.id.toString(),
              {
                status: "declined",
                declineNote,
                declineProof,
                declinePrompt,
                declinedBy: new Types.ObjectId(adminId),
                declinedAt: new Date(),
              },
            );

            declinedTransactions.push({
              childId: child.id,
              reference: child.reference,
            });

            this.handlePartnerWebhook(
              child,
              "giftcard.sale.declined",
              "declined",
            ).catch((err) => logger.error("Partner webhook failed", err));

            this.notificationService
              .createNotification({
                type: "giftcard_sale_declined",
                notifiableType: "User",
                notifiableId: child.userId,
                data: {
                  transactionType: "Gift Card Sale",
                  amount: child.payableAmount,
                  reference: child.reference,
                  reason: declineNote,
                  status: "declined",
                },
                sendEmail: true,
                sendSMS: false,
                sendPush: true,
              })
              .catch((err: any) => {
                logger.error(
                  `Failed to send decline notification: ${child.reference}`,
                  {
                    error: err.message,
                    userId: userId,
                  },
                );
              });
          } catch (error: any) {
            failedTransactions.push({
              childId: child.id,
              reference: child.reference,
              reason: error.message,
            });
          }
        }

        return {
          declinedCount: declinedTransactions.length,
          failedCount: failedTransactions.length,
          declined: declinedTransactions,
          failed: failedTransactions,
        };
      },
      parentId,
    );
  }

  async secondApproveAllByParentId(
    parentId: string,
    adminId: string,
    reviewedAmount: number,
    reviewNote: string,
    reviewProof?: string,
  ) {
    const parentTransaction =
      await this.giftCardTransactionRepository.findById(parentId);

    if (!parentTransaction) {
      throw new AppError(
        "Parent transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return SentryHelper.trackCriticalOperation(
      "admin_giftcard_bulk_second_approve",
      async () => {
        const childTransactions = await this.giftCardTransactionRepository.find(
          {
            parentId: new Types.ObjectId(parentId),
          },
        );

        if (childTransactions.length === 0) {
          throw new AppError(
            "No child transactions found",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.NOT_FOUND,
          );
        }

        // Only process pending transactions
        const pendingChildren = childTransactions.filter(
          (t) => t.status === "pending",
        );

        if (pendingChildren.length === 0) {
          throw new AppError(
            "No pending child transactions to second approve",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_STATUS,
          );
        }

        const invalidTradeTypes = pendingChildren.filter(
          (t) => t.tradeType !== "sell",
        );
        if (invalidTradeTypes.length > 0) {
          throw new AppError(
            "Only sell transactions require admin approval",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.INVALID_OPERATION,
          );
        }

        const paymentMethod = GIFTCARD_SELL_PAYMENT_VIA_PLATFORM
          ? "platform"
          : "manual";

        const perCardReviewedAmount = reviewedAmount / pendingChildren.length;

        const approvedTransactions: Array<{
          childId: any;
          reference: string;
          reviewedAmount: number;
          netPayout: number;
          transactionId?: string;
        }> = [];
        const failedTransactions: Array<{
          childId: any;
          reference: string;
          reason: string;
        }> = [];

        let totalNetPayout = 0;
        let totalUSDAmount = 0;
        const userId = pendingChildren[0].userId.toString();

        // Process each child transaction individually
        for (const child of pendingChildren) {
          try {
            const serviceCharge = child.serviceCharge || 0;
            const netPayout = perCardReviewedAmount - serviceCharge;
            const profitAmount =
              Number(serviceCharge) +
              (child.payableAmount - perCardReviewedAmount);

            // ==================== CONDITIONAL: Platform Payment ====================
            let creditResult: any = null;

            if (GIFTCARD_SELL_PAYMENT_VIA_PLATFORM) {
              // Create individual wallet credit transaction for this child
              creditResult = await this.walletService.creditWallet(
                userId,
                netPayout,
                `Giftcard`,
                {
                  type: TRANSACTION_TYPES.DEPOSIT,
                  provider: SYSTEM.PROVIDER,
                  idempotencyKey: `${child.reference}_second_approval`,
                  initiatedBy: new Types.ObjectId(adminId),
                  initiatedByType: "admin",
                  remark: `Giftcard Payout: ₦${netPayout} - (Ref: ${child.reference})`,
                  meta: {
                    method:
                      ADMIN_DEPOSIT_TRANSACTION_TYPES.GIFTCARD_SECOND_APPROVE,
                    tradeType: "giftcard sell",
                    bulkApproval: true,
                    parentId: parentId,
                    giftCardTransactionId: child.id,
                    originalAmount: child.payableAmount,
                    reviewedAmount: perCardReviewedAmount,
                    netPayout: netPayout,
                    serviceCharge: serviceCharge,
                    firstApprovedBy: child.reviewedBy?.toString(),
                    secondApprovedBy: adminId,
                    chargeInfo: {
                      baseAmount: child.meta?.chargeInfo?.baseAmount || 0,
                      serviceCharge: child.meta?.chargeInfo?.serviceCharge || 0,
                      chargeType: child.meta?.chargeInfo?.chargeType || null,
                      chargeValue: child.meta?.chargeInfo?.chargeValue || null,
                      creditedAmount: netPayout,
                    },
                  },
                },
              );
            }
            // If MANUAL payment: creditResult stays null, wallet is NOT credited

            // ==================== UPDATE TRANSACTION ====================
            const updateData: any = {
              status: "s.approved",
              reviewProof,
              reviewedAmount: perCardReviewedAmount,
              reviewNote,
              reviewedBy: new Types.ObjectId(adminId),
              reviewedAt: new Date(),
              paymentMethod,
              profit: profitAmount,
            };

            // Only set transactionId if platform payment was made
            if (creditResult) {
              updateData.transactionId = creditResult.transaction.id;
              updateData.balanceBefore = creditResult.balanceBefore;
              updateData.balanceAfter = creditResult.balanceAfter;
            }

            // Update child transaction with its own transaction ID
            await Promise.all([
              this.giftCardTransactionRepository.update(
                child.id.toString(),
                updateData,
              ),
              creditResult
                ? this.transactionRepository.update(
                    creditResult.transaction.id,
                    {
                      transactableType: "GiftCardTransaction",
                      transactableId: new Types.ObjectId(child.id),
                    },
                  )
                : Promise.resolve(),
            ]);

            totalNetPayout += netPayout;
            totalUSDAmount += child.amount;
            approvedTransactions.push({
              childId: child.id,
              reference: child.reference,
              reviewedAmount: perCardReviewedAmount,
              netPayout: netPayout,
              transactionId: creditResult?.transaction.id,
            });

            // Send individual notification
            this.notificationService
              .createNotification({
                type: "giftcard_sale_completed",
                notifiableType: "User",
                notifiableId: child.userId,
                data: {
                  transactionType: "Gift Card Sale",
                  amount: perCardReviewedAmount,
                  reference: child.reference,
                  status: "completed",
                  paymentMethod,
                  ...(paymentMethod === "manual" && {
                    bankDetails: {
                      accountName: child.accountName,
                      accountNumber: child.accountNumber,
                      bankCode: child.bankCode,
                    },
                    estimatedPayoutTime: "1-2 hours",
                  }),
                },
                sendEmail: true,
                sendSMS: false,
                sendPush: true,
              })
              .catch((err: any) => {
                logger.error(
                  `Failed to send completion notification: ${child.reference}`,
                  {
                    error: err.message,
                    userId: userId,
                  },
                );
              });
          } catch (error: any) {
            logger.error(
              `Failed to second approve child transaction: ${child.reference}`,
              {
                error: error.message,
                childId: child.id,
              },
            );
            failedTransactions.push({
              childId: child.id,
              reference: child.reference,
              reason: error.message,
            });
          }
        }

        // Background tasks (fire-and-forget)
        Promise.all([
          this.handlePartnerWebhook(
            parentTransaction,
            "giftcard.sale.second.approved",
            "approved",
          ).catch((err) => logger.error("Partner webhook failed", err)),

          this.handleCommissionPayment(parentTransaction).catch((err) =>
            logger.error("Commission payment failed", err),
          ),

          this.bonusProcessor
            .processTradeAndBonus(parentTransaction.userId, {
              transactionId: parentTransaction.id.toString(),
              amount: totalNetPayout,
              serviceType: TRANSACTION_TYPES.GIFTCARD,
            })
            .catch((err) =>
              logger.error(
                `Trade bonus processing failed: ${TRANSACTION_TYPES.GIFTCARD}`,
                err,
              ),
            ),

          this.helperService
            .updateLeaderboardAsync(
              userId,
              parentTransaction.id,
              TRANSACTION_TYPES.GIFTCARD,
              totalNetPayout,
              totalUSDAmount,
            )
            .catch((err) =>
              logger.error(
                `Leaderboard update failed ${TRANSACTION_TYPES.GIFTCARD}`,
                err,
              ),
            ),
        ]).catch((err) => {
          logger.error("Background tasks failed during second approval:", err);
        });

        return {
          approvedCount: approvedTransactions.length,
          failedCount: failedTransactions.length,
          totalReviewedAmount: reviewedAmount,
          perCardAmount: perCardReviewedAmount,
          totalNetPayout: totalNetPayout,
          paymentMethod,
          approved: approvedTransactions,
          failed: failedTransactions,
        };
      },
      parentId,
    );
  }
  private async processConcurrent<T>(
    items: T[],
    processor: (item: T) => Promise<void>,
  ): Promise<void> {
    const chunks = [];
    for (let i = 0; i < items.length; i += this.CONCURRENCY_LIMIT) {
      chunks.push(items.slice(i, i + this.CONCURRENCY_LIMIT));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map(processor));
    }
  }

  private async handlePartnerWebhook(
    transaction: IGiftCardTransaction,
    event: string,
    status: string,
  ): Promise<void> {
    // Only process if it's a partner transaction
    if (
      !transaction.meta?.isPartnerTransaction &&
      !transaction.meta?.partnerReference
    ) {
      return;
    }

    try {
      const partner = await this.userRepository.findById(
        transaction.userId.toString(),
      );

      if (partner?.partner?.webhookUrl) {
        const log = await this.partnerWebhookService.createWebhookLog({
          userId: transaction.userId,
          giftCardTransactionId: transaction._id,
          event: event,
          webhookUrl: partner.partner.webhookUrl,
          payload: {
            event: event,
            transactionReference: transaction.reference,
            partnerReference: transaction.meta?.partnerReference,
            status: status,
            quantity: transaction.quantity,
            amount: transaction.amount,
            payableAmount: transaction.payableAmount,
            timestamp: Date.now(),
          },
        });

        this.partnerWebhookService
          .sendWebhook(log._id)
          .catch((err) =>
            logger.error(
              `Failed to send gift-card webhook for transaction ${transaction.reference}`,
              err,
            ),
          );
      } else {
        // No webhook URL found - notify admin
        await this.notificationService.createNotification({
          type: "admin_notification",
          notifiableType: "Admin",
          notifiableId: new Types.ObjectId("984747466366372993747583"),
          title: "Partner Webhook Missing",
          message: `No webhook URL found for partner transaction ${transaction.reference}`,
          data: {
            transactionReference: transaction.reference,
            partnerReference: transaction.meta?.partnerReference,
            status: status,
            quantity: transaction.quantity,
            amount: transaction.amount,
            payableAmount: transaction.payableAmount,
          },
          sendEmail: true,
          sendPush: false,
          sendSMS: false,
        });
      }
    } catch (err) {
      logger.error("Partner webhook handling failed", {
        transactionId: transaction.id,
        event: event,
        error: err,
      });
    }
  }

  private async handleCommissionPayment(
    transaction: IGiftCardTransaction,
  ): Promise<void> {
    // Only process if it's a partner transaction
    if (
      !transaction.meta?.isPartnerTransaction ||
      !transaction.meta?.partnerReference
    ) {
      return;
    }

    // Only pay commission for successful transactions
    if (
      transaction.status !== "approved" &&
      transaction.status !== "s.approved"
    ) {
      return;
    }

    try {
      const giftcard = await this.giftCardRepository.findById(
        transaction.giftCardId.toString(),
      );

      if (giftcard?.commisionValue && giftcard?.commissionType) {
        let commissionAmount = 0;
        if (giftcard.commissionType === "percentage") {
          if (transaction.reviewedAmount) {
            commissionAmount =
              (giftcard.commisionValue / 100) * transaction.reviewedAmount;
          } else {
            commissionAmount =
              (giftcard.commisionValue / 100) * transaction.payableAmount!;
          }
        } else if (giftcard.commissionType === "flat") {
          commissionAmount = giftcard.commisionValue;
        }

        await this.walletService.creditWallet(
          transaction.userId.toString(),
          commissionAmount,
          "Commission",
          {
            type: TRANSACTION_TYPES.DEPOSIT,
            provider: SYSTEM.PROVIDER,
            idempotencyKey: `${transaction.reference}_commission_payment`,
            remark: "Commission for partner gift card sale",
            meta: {
              giftCardTransactionId: transaction.id,
              partnerTransactionReference: transaction.meta?.partnerReference,
            },
          },
        );
      } else {
        logger.error("Giftcard commission details missing", {
          transactionId: transaction.id,
          giftcardId: transaction.giftCardId,
          giftcardName: giftcard?.name,
        });
      }
    } catch (err) {
      logger.error("Commission payment failed", {
        transactionId: transaction.id,
        error: err,
      });
    }
  }
}
