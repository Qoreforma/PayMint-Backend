import { GiftCardRepository } from "@/repositories/shared/GiftCardRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { WalletService } from "./wallet/WalletService";
import { NotificationService } from "./notifications/NotificationService";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  TRANSACTION_TYPES,
  CACHE_KEYS,
  CACHE_TTL,
  SYSTEM,
} from "@/utils/constants";
import mongoose, { PipelineStage, Types } from "mongoose";
import { generateReference, roundAmount } from "@/utils/helpers";
import logger from "@/logger";
import { GiftCardRateService } from "./GiftCardRateService";
import { ProviderService } from "./ProviderService";
import { HelperService } from "@/services/client/utility/HelperService";
import { TradeBonusProcessorService } from "./utility/TradeBonusProcessorService";
import { GiftCardCategoryRepository } from "@/repositories/shared/GiftCardCategoryRepository";
import { GiftCardTransactionRepository } from "@/repositories/client/GiftCardTransactionRepository";
import { CacheService } from "../core/CacheService";
import { BankAccountRepository } from "@/repositories/client/BankAccountRepository";

type TradingStatus = "newbie" | "regular" | "pro" | "elite" | "legend";

interface MostCardTraded {
  name: string;
  logo: string;
  type: "buy" | "sell";
}

interface UserTransactionStatsResult {
  totalBuyAmount: number;
  totalSellAmount: number;
  totalBuy: number;
  totalSell: number;
  totalAmount: number;
  totalCardsTraded: number;
  mostCardTraded: MostCardTraded | null;
  tradingStatus: TradingStatus;
}
export class GiftCardService {
  constructor(
    private giftCardRepository: GiftCardRepository,
    private giftCardCategoryRepository: GiftCardCategoryRepository,
    private giftCardTransactionRepository: GiftCardTransactionRepository,
    private transactionRepository: TransactionRepository,
    private walletService: WalletService,
    private notificationService: NotificationService,
    private providerService: ProviderService,
    private rateService: GiftCardRateService,
    private helperService: HelperService,
    private bonusProcessor: TradeBonusProcessorService,
    private cacheService: CacheService,
    private bankAccountRepository: BankAccountRepository,
  ) {}

  // Get active gift card categories
  // Only returns categories from active providers
  async getCategories(
    page: number = 1,
    limit: number = 10,
    type: "both" | "sell" | "buy" = "both",
    countryId?: string,
    search?: string,
  ): Promise<{ data: any[]; total: number }> {
    const cacheKey = countryId
      ? `${CACHE_KEYS.GIFTCARD_CATEGORIES(type)}:country:${countryId}:page:${page}:limit:${limit}:search:${search ?? ""}`
      : `${CACHE_KEYS.GIFTCARD_CATEGORIES(type)}:page:${page}:limit:${limit}:search:${search ?? ""}`;

    const cachedResult = await this.cacheService.get<{
      data: any[];
      total: number;
    }>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    let query: any = {
      isActive: true,
      deletedAt: { $in: [null] },
    };

    if (type === "buy") {
      const activeProvider =
        await this.providerService.getActiveApiProvider("giftcard");

      if (!activeProvider) {
        return { data: [], total: 0 };
      }

      query.providerId = activeProvider._id;
      query.purchaseActivated = true;

      // Reloadly categories are auto-generated brand groups from product sync
      if (activeProvider.code.toLowerCase() === "reloadly") {
        query.isAutoGroup = true;
      }
    } else if (type === "sell") {
      query.$or = [{ transactionType: "sell" }, { transactionType: "both" }];
      query.saleActivated = true;
    } else {
      // "both" — return everything active
    }

    if (search) {
      const escapedSearch = search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.name = { $regex: escapedSearch, $options: "i" };
    }

    if (countryId) {
      const giftCardMatchStage: any = {
        isActive: true,
        $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
        countryId: new mongoose.Types.ObjectId(countryId),
      };

      if (type === "buy") {
        giftCardMatchStage.purchaseActivated = true;
        giftCardMatchStage.type = "buy";
      } else if (type === "sell") {
        giftCardMatchStage.saleActivated = true;
        giftCardMatchStage.type = "sell";
      }

      const validCategoryIds =
        await this.giftCardRepository.findDistinctCategoryIds(
          giftCardMatchStage,
        );

      query._id = { $in: validCategoryIds };
    }

    const result = await this.giftCardCategoryRepository.findWithPagination(
      query,
      page,
      limit,
      { name: 1 }, // alphabetical — more useful than createdAt for brand groups
      [
        { path: "providerId", select: "name logo code" },
        { path: "countries", select: "name iso2 iso3 code flag" },
      ],
    );

    if (countryId) {
      result.data = result.data.map((category) => ({
        ...(category.toObject ? category.toObject() : category),
        countryId,
      }));
    }

    await this.cacheService.set(
      cacheKey,
      result,
      CACHE_TTL.GIFTCARD_CATEGORIES,
    );

    return result;
  }

  // Get category by ID
  async getCategoryById(categoryId: string): Promise<any> {
    const category = await this.giftCardCategoryRepository.findById(
      categoryId,
      [
        { path: "providerId", select: "name logo code" },
        { path: "countries", select: "name iso2 iso3 code flag" },
      ],
    );

    if (!category || category.deletedAt) {
      throw new AppError(
        "Category not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return category;
  }

  // Get gift cards with filters
  async getGiftCards(
    filters: any,
    page: number = 1,
    limit: number = 10,
  ): Promise<{ data: any[]; total: number }> {
    const query: any = {
      isActive: true,
    };

    if (filters.categoryId) {
      query.categoryId = new Types.ObjectId(filters.categoryId);
    }
    if (filters.countryId) {
      query.countryId = new Types.ObjectId(filters.countryId);
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: "i" } },
        { productId: { $regex: filters.search, $options: "i" } },
      ];
    }

    // Only show activated gift cards
    if (filters.type === "buy") {
      query.purchaseActivated = true;
      query.type = "buy";
    } else if (filters.type === "sell") {
      query.saleActivated = true;
      query.type = "sell";
    }

    const result = await this.giftCardRepository.findWithPagination(
      query,
      page,
      limit,
      { createdAt: -1 },
      [
        {
          path: "categoryId",
          select: "name icon providerId",
          populate: { path: "providerId", select: "name code logo" },
        },
        { path: "countryId", select: "name iso2 flag currency" },
      ],
    );

    return {
      data: result.data,
      total: result.total,
    };
  }

  // Get gift card by ID
  async getGiftCardById(giftCardId: string): Promise<any> {
    const giftCard = await this.giftCardRepository.findById(giftCardId, [
      {
        path: "categoryId",
        select: "name icon providerId transactionType",
        populate: { path: "providerId", select: "name code logo" },
      },
      { path: "countryId", select: "name iso2 iso3 flag currency" },
    ]);

    if (!giftCard) {
      throw new AppError(
        "Gift card not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return giftCard;
  }

  // Get available denominations for a gift card
  async getAvailableDenominations(giftCardId: string): Promise<any> {
    const giftCard = await this.giftCardRepository.findById(giftCardId);

    if (!giftCard) {
      throw new AppError(
        "Gift card not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (giftCard.denominationType === "FIXED") {
      return {
        type: "FIXED",
        denominations: giftCard.priceList || [],
        denominationsNgn: giftCard.ngnPriceList || [],
        currency: giftCard.currency,
      };
    } else if (giftCard.denominationType === "RANGE") {
      const minAmount =
        giftCard.type === "buy"
          ? giftCard.buyMinAmount
          : giftCard.sellMinAmount;
      const maxAmount =
        giftCard.type === "buy"
          ? giftCard.buyMaxAmount
          : giftCard.sellMaxAmount;

      return {
        type: "RANGE",
        minAmount,
        maxAmount,
        minAmountNgn: giftCard.minAmountNgn,
        maxAmountNgn: giftCard.maxAmountNgn,
        currency: giftCard.currency,
      };
    }

    return {
      type: "UNKNOWN",
      message: "Denomination type not configured",
    };
  }

  // Get gift cards by type (buy or sell)
  async getGiftCardsByType(
    type: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: any[]; total: number }> {
    if (type !== "buy" && type !== "sell") {
      throw new AppError(
        "Invalid type. Must be 'buy' or 'sell'",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    return await this.getGiftCards({ type }, page, limit);
  }

  // Get gift card rates
  async getGiftCardRates(filters: {
    page: number;
    limit: number;
    type?: "buy" | "sell";
    categoryId?: string;
    countryId?: string;
  }): Promise<any> {
    return await this.rateService.getAllRates(filters);
  }

  // Calculate breakdown for buy/sell
  async calculateBreakdown(data: {
    giftCardId: string;
    amount: number;
    quantity: number;
  }): Promise<any> {
    const giftCard = await this.giftCardRepository.findById(data.giftCardId);

    if (!giftCard) {
      throw new AppError(
        "Gift card not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (giftCard.type === "buy") {
      return await this.rateService.calculateBuyPrice(
        data.giftCardId,
        data.amount,
        data.quantity,
      );
    } else {
      return await this.rateService.calculateSellPayout(
        data.giftCardId,
        data.amount,
        data.quantity,
      );
    }
  }

  async buyGiftCard(data: {
    giftCardId: string;
    amount: number;
    quantity: number | string;
    userId: string;
    user: any;
    serviceProvider?: any;
    channel?: "ios" | "android" | "web" | "api";
    isPartnerPurchase?: boolean;
    partnerReference?: string;
  }): Promise<any> {
    try {
      const quantity = Number(data.quantity);
      if (isNaN(quantity) || quantity < 1 || !Number.isInteger(quantity)) {
        throw new AppError(
          "Quantity must be a valid integer >= 1",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // GUARD: Cap quantity to prevent abuse
      if (quantity > 100) {
        throw new AppError(
          "Maximum 100 cards per purchase",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
      // Parallel fetch giftCard and wallet
      const [giftCard, wallet] = await Promise.all([
        this.giftCardRepository.findById(data.giftCardId, [
          {
            path: "categoryId",
            populate: "providerId transactionType icon name",
          },
        ]),
        this.walletService.getWallet(data.userId),
      ]);

      if (!giftCard || giftCard.type !== "buy") {
        throw new AppError(
          "Gift card not available for purchase",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      if (!giftCard.purchaseActivated) {
        throw new AppError(
          "Gift card purchases are currently disabled",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }

      const categoryProvider = giftCard.categoryId as any;
      const provider = data.serviceProvider || categoryProvider?.providerId;

      if (!provider) {
        throw new AppError(
          "Provider not configured for this gift card",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

      // Calculate price breakdown
      const breakdown = await this.rateService.calculateBuyPrice(
        data.giftCardId,
        data.amount,
        quantity,
      );

      const totalDeduction = breakdown.totalNGN + breakdown.serviceFee;

      const walletBalanceBefore = wallet.balance || 0;

      // Check if user has sufficient balance
      if (walletBalanceBefore < totalDeduction) {
        throw new AppError(
          breakdown.serviceFee > 0
            ? `Insufficient balance. You need ₦${totalDeduction.toLocaleString()} (₦${breakdown.totalNGN.toLocaleString()} + ₦${breakdown.serviceFee.toLocaleString()} service charge)`
            : "Insufficient balance",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.INSUFFICIENT_BALANCE,
        );
      }

      // Generate references
      const parentReference = generateReference("GC");
      const groupTag = quantity > 1 ? `GRP-${parentReference}` : undefined;
      const debitIdempotencyKey =
        data.isPartnerPurchase && data.partnerReference
          ? `partner:${data.userId}:GIFTCARD:${data.partnerReference}`
          : parentReference;

      const chargeInfo = {
        baseAmount: roundAmount(breakdown.totalNGN),
        serviceCharge: roundAmount(breakdown.serviceFee),
        chargeType: breakdown.serviceCharge?.type,
        chargeValue: breakdown.serviceCharge?.value,
        totalDeduction: totalDeduction,
      };

      // Debit user wallet ONCE for total amount (card price + service charge)
      const debitResult = await this.walletService.debitWallet(
        data.userId,
        totalDeduction,
        "Giftcard purchase",
        {
          type: "giftcard",
          provider: "system",
          channel: data.channel || "web",
          idempotencyKey: debitIdempotencyKey,
          initiatedBy: new Types.ObjectId(data.userId),
          initiatedByType: "user",
          remark: `Giftcard Purchase: ₦${totalDeduction} (Ref: ${parentReference})`,
          meta: {
            tradeType: "Giftcard Purchase",
            chargeInfo,
          },
        },
      );

      const giftCardCategory = giftCard.categoryId as any;

      let parentTransaction: any;
      const childTransactions: any[] = [];

      // Build base meta with charge info
      const baseMeta: any = {
        giftCardName: giftCard.name,
        giftCardCurrency: breakdown.giftCardCurrency,
        processedBy: "Reloadly",
        giftCardCategory: {
          name: giftCardCategory?.name || "",
          icon: giftCardCategory?.icon || "",
          transactionType: giftCardCategory?.transactionType || "buy",
        },
      };

      baseMeta.chargeInfo = chargeInfo;

      if (Number(data.quantity) === 1) {
        parentTransaction = await this.giftCardTransactionRepository.create({
          userId: new Types.ObjectId(data.userId),
          giftCardId: new Types.ObjectId(data.giftCardId),
          reference: parentReference,
          tradeType: "buy",
          direction: "DEBIT",
          amount: data.amount,
          quantity: 1,
          rate: breakdown.exchangeRate,
          serviceCharge: breakdown.serviceFee,
          payableAmount: breakdown.totalNGN,
          totalDeduction: totalDeduction,
          balanceBefore: walletBalanceBefore,
          balanceAfter: debitResult.balanceAfter,
          status: "pending",
          channel: data.channel || "web",
          transactionId: debitResult.transaction.id,
          idempotencyKey: parentReference,
          initiatedBy: new Types.ObjectId(data.userId),
          initiatedByType: "user",
          meta: baseMeta,
        });
      }
      // Multiple cards purchase (quantity > 1)
      else {
        parentTransaction = await this.giftCardTransactionRepository.create({
          userId: new Types.ObjectId(data.userId),
          giftCardId: new Types.ObjectId(data.giftCardId),
          reference: parentReference,
          tradeType: "buy",
          direction: "DEBIT",
          amount: data.amount * quantity,
          quantity,
          rate: breakdown.exchangeRate,
          serviceCharge: breakdown.serviceFee,
          payableAmount: breakdown.totalNGN,
          totalDeduction: totalDeduction,
          balanceBefore: walletBalanceBefore,
          balanceAfter: debitResult.balanceAfter,
          status: "multiple",
          channel: data.channel || "web",
          groupTag,
          transactionId: debitResult.transaction.id,
          idempotencyKey: parentReference,
          initiatedBy: new Types.ObjectId(data.userId),
          initiatedByType: "user",
          meta: {
            ...baseMeta,
            isParent: true,
          },
        });

        // Create child transactions (one per card)
        const pricePerCard = breakdown.totalNGN / quantity;

     for (let i = 1; i <= quantity; i++) {
          const childReference = `${parentReference}-${i}`;

          try {
            // GUARD: Validate parentId exists before creating child
            if (!parentTransaction?._id) {
              throw new AppError(
                'Parent transaction ID not set',
                HTTP_STATUS.INTERNAL_SERVER_ERROR,
                ERROR_CODES.INTERNAL_ERROR,
              );
            }

            const childTransaction =
              await this.giftCardTransactionRepository.create({
                userId: new Types.ObjectId(data.userId),
                giftCardId: new Types.ObjectId(data.giftCardId),
                parentId: parentTransaction._id,
                reference: childReference,
                tradeType: "buy",
                direction: "DEBIT",
                amount: data.amount,
                quantity: 1,
                rate: breakdown.exchangeRate,
                serviceCharge: 0,
                payableAmount: pricePerCard,
                balanceBefore: walletBalanceBefore,
                balanceAfter: debitResult.balanceAfter,
                status: "pending",
                channel: data.channel || "web",
                groupTag,
                idempotencyKey: childReference,
                initiatedBy: new Types.ObjectId(data.userId),
                initiatedByType: "user",
                meta: {
                  giftCardName: giftCard.name,
                  giftCardCurrency: breakdown.giftCardCurrency,
                  providerCardIndex: i,
                  isChild: true,
                  processedBy: "Reloadly",
                  giftCardCategory: {
                    name: giftCardCategory?.name || "",
                    icon: giftCardCategory?.icon || "",
                    transactionType: giftCardCategory?.transactionType || "buy",
                  },
                  chargeInfo: {
                    baseAmount: roundAmount(pricePerCard),
                    totalAmount: roundAmount(pricePerCard),
                    serviceCharge: 0,
                    chargeType: breakdown.serviceCharge?.type,
                    chargeValue: breakdown.serviceCharge?.value,
                  },
                },
              });

            // GUARD: Verify parentId was saved correctly
            if (!childTransaction?.parentId) {
              throw new AppError(
                `Child transaction created but parentId not set for child ${i}`,
                HTTP_STATUS.INTERNAL_SERVER_ERROR,
                ERROR_CODES.INTERNAL_ERROR,
              );
            }

            childTransactions.push(childTransaction);
          } catch (error: any) {
            // GUARD: Don't silently fail - bubble up so transaction can be rolled back
            throw new AppError(
              `Failed to create child transaction ${i}/${quantity}: ${error.message}`,
              HTTP_STATUS.INTERNAL_SERVER_ERROR,
              ERROR_CODES.INTERNAL_ERROR,
            );
          }
        }
      }

      // Update main transaction record
      await this.transactionRepository.update(
        debitResult.transaction.id.toString(),
        {
          transactableType: "GiftCardTransaction",
          transactableId: parentTransaction._id,
        },
      );

      try {
        let providerResponse;

        if (provider.code.toLowerCase() === "reloadly") {
          const reloadlyProductId = giftCard.productId.includes("_")
            ? parseInt(giftCard.productId.split("_")[1])
            : parseInt(giftCard.productId);

          providerResponse = await this.providerService.orderGiftCard({
            productId: reloadlyProductId,
            quantity,
            unitPrice: data.amount,
            customIdentifier: parentReference,
            senderName: `${data.user.firstName} ${data.user.lastName}`,
            recipientEmail: data.user.email,
            userId: data.userId,
            provider,
          });
        } else {
          throw new AppError(
            `Unsupported provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
        }

        // Determine final status
        const finalStatus = providerResponse.success
          ? "success"
          : providerResponse.pending
            ? "pending"
            : "failed";

        if (finalStatus === "success") {
          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: parentTransaction.id.toString(),
              amount: breakdown.totalNGN,
              serviceType: TRANSACTION_TYPES.GIFTCARD,
            })
            .catch((err) =>
              logger.error(
                `Trade bonus processing failed: ${TRANSACTION_TYPES.GIFTCARD}`,
                err,
              ),
            );

          this.helperService
            .updateLeaderboardAsync(
              data.userId,
              wallet.id,
              TRANSACTION_TYPES.GIFTCARD,
              breakdown.totalNGN,
              data.amount * quantity,
            )
            .catch((err) =>
              logger.error(
                `Leaderboard update failed ${TRANSACTION_TYPES.GIFTCARD}`,
                err,
              ),
            );
        }

        // Update parent transaction
        await this.giftCardTransactionRepository.update(
          parentTransaction.id.toString(),
          {
            status: quantity === 1 ? finalStatus : "multiple",
            providerReference: providerResponse.providerReference,
            meta: {
              ...parentTransaction.meta,
              providerResponse: providerResponse.data,
            },
          },
        );
        let updatedChildren;
        // Update all child transactions if quantity > 1
        if (quantity > 1) {
          const updatePromises = childTransactions.map((child) =>
            this.giftCardTransactionRepository.update(child.id.toString(), {
              status: finalStatus,
              providerReference: providerResponse.providerReference,
              meta: {
                ...child.meta,
                providerResponse: providerResponse.data,
              },
            }),
          );
          updatedChildren = await Promise.all(updatePromises);
        }

        // Build notification data
        const notificationData: any = {
          transactionType: "Gift Card Purchase",
          amount: breakdown.totalNGN,
          quantity: quantity,
          reference: parentReference,
          status: finalStatus,
          giftCardName: giftCard.name,
        };

        notificationData.serviceCharge = breakdown.serviceFee;
        notificationData.totalDeducted = totalDeduction;

        // Fire-and-forget notification
        this.notificationService
          .createNotification({
            type: "giftcard_purchase_initiated",
            notifiableType: "User",
            notifiableId: new Types.ObjectId(data.userId),
            data: notificationData,
            sendEmail: true,
            sendPush: true,
          })
          .catch((err: any) => {
            logger.error(
              `Failed to send gift card purchase notification: ${parentReference}`,
              {
                error: err.message,
                userId: data.userId,
              },
            );
          });

        logger.info(
          `Gift card purchase ${finalStatus}: ${parentReference} | Amount: ${
            breakdown.totalNGN
          }${
            breakdown.serviceFee > 0 ? ` | Charge: ${breakdown.serviceFee}` : ""
          } | Quantity: ${quantity} | User: ${data.userId}`,
        );

        return {
          transaction: await this.giftCardTransactionRepository.findById(
            parentTransaction.id.toString(),
          ),
          children: quantity > 1 ? updatedChildren : undefined,
          providerResponse,
          breakdown: {
            cardAmount: breakdown.totalNGN,
            serviceCharge: breakdown.serviceFee,
            totalDeducted: totalDeduction,
          },
        };
      } catch (providerError: any) {
        // Provider failed - update all transactions and refund FULL amount
        const failedStatus = "failed";

        await this.giftCardTransactionRepository.update(
          parentTransaction.id.toString(),
          {
            status: quantity === 1 ? failedStatus : "multiple",
            reviewNote: `Provider error: ${providerError.message}`,
            meta: {
              ...parentTransaction.meta,
            },
          },
        );

        // Update children if exist
        if (quantity > 1) {
          const updatePromises = childTransactions.map((child) =>
            this.giftCardTransactionRepository.update(child.id.toString(), {
              status: failedStatus,
              reviewNote: `Provider error: ${providerError.message}`,
            }),
          );
          await Promise.all(updatePromises);
        }

        // Refund FULL amount (card price + service charge)
        await this.walletService.creditWallet(
          data.userId,
          totalDeduction,
          "Giftcard purchase",
          {
            type: "refund",
            provider: "system",
            idempotencyKey: `${parentReference}_refund`,
            initiatedBy: new Types.ObjectId(data.userId),
            initiatedByType: "system",
            linkedTransactionId: debitResult.transaction._id as Types.ObjectId,
            transactableType: "GiftCardTransaction",
            transactableId: parentTransaction._id,
            meta: {
              ...parentTransaction.meta,
            },
          },
        );

        // Fire-and-forget refund notification
        const refundNotificationData: any = {
          amount: breakdown.totalNGN,
          reference: parentReference,
          reason: providerError.message,
        };

        refundNotificationData.serviceCharge = breakdown.serviceFee;
        refundNotificationData.totalRefunded = totalDeduction;

        this.notificationService
          .createNotification({
            type: "giftcard_purchase_failed",
            notifiableType: "User",
            notifiableId: new Types.ObjectId(data.userId),
            data: refundNotificationData,
            sendEmail: true,
            sendPush: true,
          })
          .catch((err: any) => {
            logger.error(
              `Failed to send gift card refund notification: ${parentReference}`,
              {
                error: err.message,
                userId: data.userId,
              },
            );
          });

        logger.error(`Gift card purchase failed: ${parentReference}`, {
          error: providerError.message,
          userId: data.userId,
          amount: breakdown.totalNGN,
          refunded: totalDeduction,
        });

        throw providerError;
      }
    } catch (error: any) {
      logger.error("Gift card purchase failed", {
        error: error.message,
        userId: data.userId,
        giftCardId: data.giftCardId,
        amount: data.amount,
        quantity: data.quantity,
      });
      throw error;
    }
  }

  // Sell gift card (manual review)
  async sellGiftCard(data: {
    userId: string;
    giftCardId: string;
    amount: number;
    quantity: number;
    cardType: "physical" | "e-code";
    cards: string[];
    comment?: string;
    bankAccountId?: string;
    channel?: "ios" | "android" | "web" | "api";
  }): Promise<any> {
    try {
      const [giftCard, wallet] = await Promise.all([
        this.giftCardRepository.findById(data.giftCardId, {
          path: "categoryId",
          select: "name icon providerId transactionType",
        }),
        this.walletService.getWallet(data.userId),
      ]);

      if (!giftCard || giftCard.type !== "sell") {
        throw new AppError(
          "Gift card not available for sale",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      if (!giftCard.saleActivated) {
        throw new AppError(
          "Gift card sales are currently disabled",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.SERVICE_UNAVAILABLE,
        );
      }

      let bankAccount: any = null;

      if (data.bankAccountId) {
        bankAccount = await this.bankAccountRepository.findByIdAndPopulate(
          data.bankAccountId,
        );

        if (!bankAccount || bankAccount.userId.toString() !== data.userId) {
          throw new AppError(
            "Invalid or missing bank account",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        if (bankAccount.deletedAt) {
          throw new AppError(
            "Selected bank account has been deleted",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
      }
      const giftCardCategory = giftCard.categoryId as any;

      const breakdown = await this.rateService.calculateSellPayout(
        data.giftCardId,
        data.amount,
        data.quantity,
      );

      const walletBalanceBefore = wallet.balance || 0;

      // Generate references
      const parentReference = generateReference("GCS");
      const groupTag = data.quantity > 1 ? `GRP-${parentReference}` : undefined;

      // Build base meta with charge info
      const baseMeta: any = {
        giftCardName: giftCard.name,
        giftCardCurrency: breakdown.giftCardCurrency,
        tradeType: "sell",
        processedBy: "Admin",
        giftCardCategory: {
          name: giftCardCategory?.name || "",
          icon: giftCardCategory?.icon || "",
          transactionType: giftCardCategory?.transactionType || "buy",
        },
      };

      baseMeta.chargeInfo = {
        baseAmount: roundAmount(breakdown.totalNGN),
        totalAmount: roundAmount(breakdown.totalAmount),
        serviceCharge: breakdown.serviceFee,
        chargeType: breakdown.serviceCharge?.type,
        chargeValue: breakdown.serviceCharge?.value,
      };

      let parentTransaction: any;
      const childTransactions: any[] = [];

      if (Number(data.quantity) === 1) {
        parentTransaction = await this.giftCardTransactionRepository.create({
          userId: new Types.ObjectId(data.userId),
          giftCardId: new Types.ObjectId(data.giftCardId),
          reference: parentReference,
          tradeType: "sell",
          direction: "CREDIT",
          amount: data.amount,
          quantity: 1,
          rate: breakdown.rate,
          serviceCharge: breakdown.serviceFee,
          payableAmount: breakdown.totalNGN,
          balanceBefore: walletBalanceBefore,
          balanceAfter: walletBalanceBefore,
          status: "pending",
          cardType: data.cardType,
          cards: data.cards,
          comment: data.comment,
          channel: data.channel || "web",
          ...(data.bankAccountId && {
            bankAccountId: new Types.ObjectId(data.bankAccountId),
            bankId: bankAccount?.bankId,
            bankCode: bankAccount?.bankCode,
            accountName: bankAccount?.accountName,
            accountNumber: bankAccount?.accountNumber,
          }),
          idempotencyKey: parentReference,
          initiatedBy: new Types.ObjectId(data.userId),
          initiatedByType: "user",
          meta: {
            ...baseMeta,
            ...(bankAccount && {
              bankDetails: {
                bankId: bankAccount.bankId?.toString(),
                bankCode: bankAccount.bankCode,
                accountName: bankAccount.accountName,
                accountNumber: bankAccount.accountNumber,
              },
            }),
          },
        });
        parentTransaction = await parentTransaction.populate([
          {
            path: "giftCardId",
            select: "name logo currency type countryId categoryId",
            populate: [
              { path: "countryId", select: "name code flag" },
              { path: "categoryId", select: "name icon" },
            ],
          },
          { path: "bankAccountId", select: "bankName accountNumber" },
        ]);
      } else {
        // Create parent transaction
        parentTransaction = await this.giftCardTransactionRepository.create({
          userId: new Types.ObjectId(data.userId),
          giftCardId: new Types.ObjectId(data.giftCardId),
          reference: parentReference,
          tradeType: "sell",
          direction: "CREDIT",
          amount: data.amount * data.quantity,
          quantity: data.quantity,
          rate: breakdown.rate,
          serviceCharge: breakdown.serviceFee,
          payableAmount: breakdown.totalNGN,
          balanceBefore: walletBalanceBefore,
          balanceAfter: walletBalanceBefore,
          status: "multiple",
          channel: data.channel || "web",
          groupTag,
          cardType: data.cardType,
          cards: data.cards,
          comment: data.comment,
          ...(data.bankAccountId && {
            bankAccountId: new Types.ObjectId(data.bankAccountId),
            bankId: bankAccount?.bankId,
            bankCode: bankAccount?.bankCode,
            accountName: bankAccount?.accountName,
            accountNumber: bankAccount?.accountNumber,
          }),
          idempotencyKey: parentReference,
          initiatedBy: new Types.ObjectId(data.userId),
          initiatedByType: "user",
          meta: {
            ...baseMeta,
            isParent: true,
            ...(bankAccount && {
              bankDetails: {
                bankId: bankAccount.bankId?.toString(),
                bankCode: bankAccount.bankCode,
                accountName: bankAccount.accountName,
                accountNumber: bankAccount.accountNumber,
              },
            }),
          },
        });

        parentTransaction = await parentTransaction.populate([
          {
            path: "giftCardId",
            select: "name logo currency type countryId categoryId",
            populate: [
              { path: "countryId", select: "name code flag" },
              { path: "categoryId", select: "name icon" },
            ],
          },
          { path: "bankAccountId", select: "bankName accountNumber" },
        ]);

        // Create child transactions
        const payoutPerCard = breakdown.totalNGN / data.quantity;
        const chargePerCard = breakdown.serviceFee / data.quantity;
        const cardChunks = this.chunkCardsForChildren(
          data.cards,
          data.quantity,
        );

        const childPromises = [];
        for (let i = 1; i <= data.quantity; i++) {
          const childReference = `${parentReference}-${i}`;

          childPromises.push(
            this.giftCardTransactionRepository.create({
              userId: new Types.ObjectId(data.userId),
              giftCardId: new Types.ObjectId(data.giftCardId),
              parentId: parentTransaction._id,
              reference: childReference,
              tradeType: "sell",
              direction: "CREDIT",
              amount: data.amount,
              quantity: 1,
              rate: breakdown.rate,
              serviceCharge: chargePerCard,
              payableAmount: payoutPerCard,
              balanceBefore: walletBalanceBefore,
              balanceAfter: walletBalanceBefore,
              status: "pending",
              groupTag,
              cardType: data.cardType,
              cards: cardChunks[i - 1],
              comment: data.comment,
              channel: data.channel || "web",
              ...(data.bankAccountId && {
                bankAccountId: new Types.ObjectId(data.bankAccountId),
                bankId: bankAccount?.bankId,
                bankCode: bankAccount?.bankCode,
                accountName: bankAccount?.accountName,
                accountNumber: bankAccount?.accountNumber,
              }),
              idempotencyKey: childReference,
              initiatedBy: new Types.ObjectId(data.userId),
              initiatedByType: "user",
              meta: {
                giftCardName: giftCard.name,
                giftCardCurrency: breakdown.giftCardCurrency,
                cardIndex: i,
                isChild: true,
                processedBy: "Admin",
                giftCardCategory: {
                  name: giftCardCategory?.name || "",
                  icon: giftCardCategory?.icon || "",
                  transactionType: giftCardCategory?.transactionType || "buy",
                },
                chargeInfo: {
                  baseAmount: roundAmount(payoutPerCard),
                  totalAmount: roundAmount(payoutPerCard),
                  serviceCharge: chargePerCard,
                  chargeType: breakdown.serviceCharge?.type,
                  chargeValue: breakdown.serviceCharge?.value,
                },
                ...(bankAccount && {
                  bankDetails: {
                    bankId: bankAccount.bankId?.toString(),
                    bankCode: bankAccount.bankCode,
                    accountName: bankAccount.accountName,
                    accountNumber: bankAccount.accountNumber,
                  },
                }),
              },
            }),
          );
        }

        const resolvedChildren = await Promise.all(childPromises);
        childTransactions.push(...resolvedChildren);
      }

      this.notificationService
        .createNotification({
          type: "giftcard_sale_pending_review",
          notifiableType: "Admin",
          notifiableId: new Types.ObjectId(data.userId),
          data: {
            transactionType: "Gift Card Sale",
            userId: data.userId,
            amount: breakdown.totalNGN,
            serviceCharge: breakdown.serviceFee,
            quantity: data.quantity,
            reference: parentReference,
            giftCardName: giftCard.name,
            cardType: data.cardType,
          },
          sendEmail: true,
          sendSMS: false,
          sendPush: false,
          adminNotificationScope: {
            type: "giftcard_category",
            id: (
              (giftCard.categoryId as any)?._id ?? giftCard.categoryId
            )?.toString(),
            tradeType: "sell",
          },
        })
        .catch((err) => {
          logger.error("Failed to send admin notification:", err);
        });

      this.notificationService
        .createNotification({
          type: "giftcard_sale_submitted",
          notifiableType: "User",
          notifiableId: new Types.ObjectId(data.userId),
          data: {
            transactionType: "Gift Card Sale",
            amount: breakdown.totalNGN,
            serviceCharge: breakdown.serviceFee,
            quantity: data.quantity,
            reference: parentReference,
            giftCardName: giftCard.name,
            status: "pending",
          },
          sendEmail: true,
          sendPush: true,
        })
        .catch((err: any) => {
          logger.error(
            `Failed to send gift card sale user notification: ${parentReference}`,
            {
              error: err.message,
              userId: data.userId,
            },
          );
        });

      logger.info(
        `Gift card sale submitted: ${parentReference} | Amount: ${
          breakdown.totalNGN
        }${
          breakdown.serviceFee > 0 ? ` | Charge: ${breakdown.serviceFee}` : ""
        } | Quantity: ${data.quantity} | User: ${data.userId}`,
      );

      return {
        transaction: parentTransaction,
        children: data.quantity > 1 ? childTransactions : undefined,
        breakdown: {
          totalAmount: breakdown.totalNGN,
          serviceCharge: breakdown.serviceFee,
        },
      };
    } catch (error: any) {
      logger.error("Gift card sale submission failed", {
        error: error.message,
        userId: data.userId,
        giftCardId: data.giftCardId,
        amount: data.amount,
        quantity: data.quantity,
      });
      throw error;
    }
  }

  // Get redeem code (for successful buy transactions)
  async getRedeemCode(transactionId: string, userId: string): Promise<any> {
    const transaction =
      await this.giftCardTransactionRepository.findById(transactionId);

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (transaction.userId.toString() !== userId) {
      throw new AppError("Unauthorized", HTTP_STATUS.FORBIDDEN);
    }

    if (transaction.tradeType !== "buy") {
      throw new AppError(
        "Redeem codes only available for purchases",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_OPERATION,
      );
    }

    if (transaction.status !== "success") {
      throw new AppError(
        "Transaction not successful",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INVALID_STATUS,
      );
    }

    if (!transaction.providerReference) {
      throw new AppError(
        "No provider reference found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Fetch redeem code from provider
    const redeemCode = await this.providerService.getGiftCardRedeemCode(
      transaction.providerReference,
    );

    return redeemCode;
  }

  // Get user transactions with comprehensive filters

  async getUserTransactions(
    userId: string,
    filters: any,
    page: number = 1,
    limit: number = 10,
  ): Promise<{ data: any[]; total: number }> {
    const query: any = {
      userId: new Types.ObjectId(userId),
      $or: [
        { groupTag: { $exists: false } }, // single transactions
        { parentId: { $ne: null } }, // child transactions
      ], // Only show child transactions
    };

    // Apply filters
    if (filters.tradeType) {
      query.tradeType = filters.tradeType;
    }
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.cardType) {
      query.cardType = filters.cardType;
    }
    if (filters.giftCardId) {
      query.giftCardId = new Types.ObjectId(filters.giftCardId);
    }
    if (filters.reference) {
      query.reference = filters.reference;
    }
    if (filters.groupTag) {
      query.groupTag = filters.groupTag;
    }
    if (filters.startDate && filters.endDate) {
      query.createdAt = {
        $gte: new Date(filters.startDate),
        $lte: new Date(filters.endDate),
      };
    }

    if (filters.search) {
      query.$or = [
        { reference: { $regex: filters.search, $options: "i" } },
        { "giftCardId.name": { $regex: filters.search, $options: "i" } },
      ];
    }

    const result = await this.giftCardTransactionRepository.findWithPagination(
      query,
      page,
      limit,
      { createdAt: -1 },
      [
        {
          path: "giftCardId",
          select: "name logo currency type countryId categoryId ",
          populate: [
            { path: "countryId", select: "name code flag" },
            { path: "categoryId", select: "name icon" },
          ],
        },
        { path: "bankAccountId", select: "bankName accountNumber" },
      ],
    );

    return {
      data: result.data,
      total: result.total,
    };
  }

  // Separate endpoint for stats
  async getUserTransactionsStats(
    userId: string,
    filters?: {
      startDate?: Date;
      endDate?: Date;
      giftCardId?: string;
    },
  ): Promise<UserTransactionStatsResult> {
    const matchStage: any = {
      userId: new Types.ObjectId(userId),
      parentId: { $exists: false },
      deletedAt: { $exists: false },
    };

    if (filters?.startDate && filters?.endDate) {
      matchStage.createdAt = {
        $gte: filters.startDate,
        $lte: filters.endDate,
      };
    }
    if (filters?.giftCardId) {
      matchStage.giftCardId = new Types.ObjectId(filters.giftCardId);
    }

    const stats = await this.giftCardTransactionRepository.aggregate([
      { $match: matchStage },
      {
        $facet: {
          // BUY transactions
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
                          { $ifNull: ["$reviewedAmount", false] },
                        ],
                      },
                      "$reviewedAmount",
                      "$payableAmount",
                    ],
                  },
                },
              },
            },
          ],

          // SELL transactions
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
                        $in: ["$status", ["success", "approved", "s.approved"]],
                      },
                      {
                        $cond: [
                          {
                            $and: [
                              { $eq: ["$status", "s.approved"] },
                              { $ifNull: ["$reviewedAmount", false] },
                            ],
                          },
                          "$reviewedAmount",
                          "$payableAmount",
                        ],
                      },
                      0,
                    ],
                  },
                },
              },
            },
          ],

          // Most traded card — group by giftCardId, pick the top, then lookup card details
          mostTradedCard: [
            { $match: { giftCardId: { $exists: true } } },
            {
              $group: {
                _id: "$giftCardId",
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 1 },
            {
              $lookup: {
                from: "giftcards",
                localField: "_id",
                foreignField: "_id",
                as: "card",
              },
            },
            {
              $unwind: {
                path: "$card",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $project: {
                _id: 0,
                name: "$card.name",
                logo: "$card.logo",
                type: "$card.type",
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
          mostCardTraded: {
            $ifNull: [{ $arrayElemAt: ["$mostTradedCard", 0] }, null],
          },
        },
      },
    ]);

    const raw = stats[0] ?? {
      totalBuyAmount: 0,
      totalSellAmount: 0,
      totalBuy: 0,
      totalSell: 0,
      mostCardTraded: null,
    };

    const totalAmount = raw.totalBuyAmount + raw.totalSellAmount;
    const totalCardsTraded = raw.totalBuy + raw.totalSell;

    return {
      totalBuyAmount: raw.totalBuyAmount,
      totalSellAmount: raw.totalSellAmount,
      totalBuy: raw.totalBuy,
      totalSell: raw.totalSell,
      totalAmount,
      totalCardsTraded,
      mostCardTraded: raw.mostCardTraded,
      tradingStatus: this.mapTradingStatus(totalAmount),
    };
  }

  // Get single transaction
  async getTransaction(reference: string, userId: string): Promise<any> {
    const transaction = await this.giftCardTransactionRepository.findOne(
      { reference, userId: new Types.ObjectId(userId) },
      undefined,
      [
        {
          path: "giftCardId",
          select: "name logo currency type countryId",
          populate: { path: "countryId", select: "name code flag" },
        },
        { path: "bankAccountId", select: "bankName accountNumber accountName" },
        { path: "transactionId" },
      ],
    );

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return transaction;
  }

  // Get transaction with children (for multiple status)
  async getTransactionWithChildren(
    reference: string,
    userId: string,
  ): Promise<any> {
    const parentTransaction = await this.giftCardTransactionRepository.findOne(
      { reference, userId: new Types.ObjectId(userId) },
      undefined,
      [
        { path: "giftCardId", select: "name logo currency type" },
        { path: "bankAccountId", select: "bankName accountNumber accountName" },
        { path: "transactionId" },
      ],
    );

    if (!parentTransaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Check if this transaction has children
    if (parentTransaction.groupTag) {
      const children = await this.giftCardTransactionRepository.find(
        {
          parentId: parentTransaction._id,
          groupTag: parentTransaction.groupTag,
        },
        undefined,
        [
          { path: "giftCardId", select: "name logo currency type" },
          {
            path: "bankAccountId",
            select: "bankName accountNumber accountName",
          },
          { path: "reviewedBy", select: "firstName lastName" },
        ],
      );

      return {
        ...parentTransaction.toObject(),
        children,
        childCount: children.length,
      };
    }

    // Single transaction, no children
    return parentTransaction;
  }

  // Get grouped transactions
  async getGroupedTransactions(
    groupTag: string,
    userId: string,
  ): Promise<any[]> {
    const transactions = await this.giftCardTransactionRepository.find(
      {
        groupTag,
        userId: new Types.ObjectId(userId),
      },
      undefined,
      [
        { path: "giftCardId", select: "name logo currency type" },
        { path: "parentId" },
      ],
    );

    return transactions;
  }

  // Export transactions to CSV
  async exportTransactions(userId: string, filters: any): Promise<string> {
    // Build query
    const query: any = {
      userId: new Types.ObjectId(userId),
    };

    if (filters.tradeType) query.tradeType = filters.tradeType;
    if (filters.status) query.status = filters.status;
    if (filters.startDate && filters.endDate) {
      query.createdAt = {
        $gte: new Date(filters.startDate),
        $lte: new Date(filters.endDate),
      };
    }

    const transactions = await this.giftCardTransactionRepository.find(
      query,
      undefined,
      [{ path: "giftCardId", select: "name" }],
    );

    // Build CSV
    const headers = [
      "Reference",
      "Trade Type",
      "Gift Card",
      "Amount",
      "Quantity",
      "Rate",
      "Payable Amount",
      "Status",
      "Date",
    ].join(",");

    const rows = transactions.map((t: any) => {
      return [
        t.reference,
        t.tradeType,
        t.giftCardId?.name || "N/A",
        t.amount,
        t.quantity,
        t.rate || 0,
        t.payableAmount || 0,
        t.status,
        new Date(t.createdAt).toISOString(),
      ].join(",");
    });

    return [headers, ...rows].join("\n");
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
      status: { $in: ["success", "approved", "s.approved"] },
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
                { $ifNull: ["$reviewedAmount", "$amount"] },
                "$amount",
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
                    { $ifNull: ["$reviewedAmount", "$amount"] },
                    "$amount",
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
                    { $ifNull: ["$reviewedAmount", "$amount"] },
                    "$amount",
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

    const results =
      await this.giftCardTransactionRepository.aggregate(pipeline);

    // Create full 12-month array with zeros for missing months
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

  async getMonthlyVolume(
    userId: string,
    options: {
      month?: number; // 1-12
      year?: number;
      tradeType?: "buy" | "sell" | "both";
    } = {},
  ) {
    const currentDate = new Date();
    const targetMonth = options.month || currentDate.getMonth() + 1;
    const targetYear = options.year || currentDate.getFullYear();
    const tradeType = options.tradeType || "both";

    // Calculate date ranges
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

    // Base match conditions
    const baseMatch: any = {
      userId: userObjectId,
      status: { $in: ["success", "approved", "s.approved"] },
    };

    // Add tradeType filter if not "both"
    if (tradeType !== "both") {
      baseMatch.tradeType = tradeType;
    }

    // Current month pipeline
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
                { $ifNull: ["$reviewedAmount", "$amount"] },
                "$amount",
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
                    { $ifNull: ["$reviewedAmount", "$amount"] },
                    "$amount",
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
                    { $ifNull: ["$reviewedAmount", "$amount"] },
                    "$amount",
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

    // Previous month pipeline (only total needed for comparison)
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
                { $ifNull: ["$reviewedAmount", "$amount"] },
                "$amount",
              ],
            },
          },
        },
      },
    ];

    const [current, previous] = await Promise.all([
      this.giftCardTransactionRepository.aggregate(currentMonthPipeline),
      this.giftCardTransactionRepository.aggregate(prevMonthPipeline),
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

  async getCategoryCountries(
    categoryId: string,
    type: "buy" | "sell" = "buy",
  ): Promise<any[]> {
    const cacheKey = `giftcard:category:${categoryId}:countries:${type}`;

    const cached = await this.cacheService.get<any[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const category = await this.giftCardCategoryRepository.findById(categoryId);
    if (!category || category.deletedAt) {
      throw new AppError(
        "Category not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const matchStage: any = {
      categoryId: new mongoose.Types.ObjectId(categoryId),
      isActive: true,
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    };

    if (type === "buy") {
      matchStage.purchaseActivated = true;
      matchStage.type = "buy";
    } else {
      matchStage.saleActivated = true;
      matchStage.type = "sell";
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: "$countryId",
          productCount: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "countries",
          localField: "_id",
          foreignField: "_id",
          as: "country",
        },
      },
      { $unwind: "$country" },
      {
        $project: {
          _id: "$country._id",
          name: "$country.name",
          iso2: "$country.iso2",
          iso3: "$country.iso3",
          flag: "$country.flag",
          currency: "$country.currency",
          productCount: 1,
        },
      },
      { $sort: { name: 1 } },
    ] as mongoose.PipelineStage[];

    const countries = await this.giftCardRepository.aggregate(pipeline);

    await this.cacheService.set(
      cacheKey,
      countries,
      CACHE_TTL.GIFTCARD_CATEGORIES,
    );

    return countries;
  }

  async getCountriesWithGiftCards(type?: "buy" | "sell"): Promise<any[]> {
    // Generate cache key based on type
    const cacheKey = type
      ? `${CACHE_KEYS.GIFTCARD_COUNTRIES(type)}`
      : `${CACHE_KEYS.GIFTCARD_COUNTRIES("all")}`;

    // Try to get from cache
    const cachedResult = await this.cacheService.get<any[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const matchStage: any = {
      isActive: true,
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    };

    if (type === "buy") {
      matchStage.purchaseActivated = true;
      matchStage.type = "buy";
    } else if (type === "sell") {
      matchStage.saleActivated = true;
      matchStage.type = "sell";
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: "$countryId",
          giftCardCount: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "countries",
          localField: "_id",
          foreignField: "_id",
          as: "country",
        },
      },
      { $unwind: "$country" },
      {
        $project: {
          _id: "$country._id",
          id: "$country.id",
          name: "$country.name",
          iso2: "$country.iso2",
          iso3: "$country.iso3",
          flag: "$country.flag",
          currency: "$country.currency",
          currency_name: "$country.currency_name",
          currency_symbol: "$country.currency_symbol",
          giftCardCount: 1,
        },
      },
      { $sort: { name: 1 } },
    ] as PipelineStage[];

    const countries = await this.giftCardRepository.aggregate(pipeline);

    await this.cacheService.set(
      cacheKey,
      countries,
      CACHE_TTL.GIFTCARD_COUNTRIES,
    );

    return countries;
  }

  // Get hottest gift cards — curated by admin via the isHottest flag
  async getHottestGiftCards(
    limit: number = 10,
    tradeType: "buy" | "sell" | "both" = "both",
    countryId?: string,
  ): Promise<any[]> {
    const cacheKey = countryId
      ? `giftcard:hottest:${tradeType}:country:${countryId}:limit:${limit}`
      : `giftcard:hottest:${tradeType}:limit:${limit}`;

    const cachedResult = await this.cacheService.get<any[]>(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    const filters: any = {
      isActive: true,
      saleActivated: true,
    };

    if (tradeType !== "both") {
      filters.type = tradeType;
    }

    if (countryId) {
      filters.countryId = new Types.ObjectId(countryId);
    }

    const hottestGiftCards = await this.giftCardRepository.findHottest(filters);
    const result = hottestGiftCards.slice(0, limit);

    await this.cacheService.set(cacheKey, result, CACHE_TTL.FIVE_MINUTES);

    return result;
  }

  // Generate receipt
  async generateReceipt(reference: string, userId: string): Promise<any> {
    const transaction = await this.getTransaction(reference, userId);

    return {
      reference: transaction.reference,
      type: transaction.tradeType,
      giftCard: transaction.giftCardId,
      amount: transaction.amount,
      quantity: transaction.quantity,
      rate: transaction.rate,
      payableAmount: transaction.payableAmount,
      status: transaction.status,
      date: transaction.createdAt,
      bankAccount: transaction.bankAccountId,
    };
  }
  async invalidateCountriesCache(): Promise<void> {
    await this.cacheService.deletePattern(`giftcard:countries:*`);
  }
  async invalidateCategoriesCache(
    type?: "buy" | "sell" | "both",
  ): Promise<void> {
    if (type) {
      await this.cacheService.deletePattern(
        `${CACHE_KEYS.GIFTCARD_CATEGORIES(type)}:*`,
      );
    } else {
      // Invalidate all category cache keys
      await this.cacheService.deletePattern(`giftcard:categories:*`);
    }
  }

  // Splits uploaded images evenly across the cards being sold, front-loading
  // any remainder. 4 images/2 qty -> [2,2]. 5 images/2 qty -> [3,2].
  // 1 image/2 qty -> [1,0]. 3 images/5 qty -> [1,1,1,0,0].
  private chunkCardsForChildren(cards: string[], quantity: number): string[][] {
    const base = Math.floor(cards.length / quantity);
    const remainder = cards.length % quantity;
    const chunks: string[][] = [];
    let cursor = 0;

    for (let i = 0; i < quantity; i++) {
      const size = base + (i < remainder ? 1 : 0);
      chunks.push(cards.slice(cursor, cursor + size));
      cursor += size;
    }

    return chunks;
  }

  private mapTradingStatus(totalAmount: number): TradingStatus {
    if (totalAmount < 1_000) return "newbie";
    if (totalAmount < 100_000) return "regular";
    if (totalAmount < 1_000_000) return "pro";
    if (totalAmount < 10_000_000) return "elite";
    return "legend";
  }
}
