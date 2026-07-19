import { GiftCardRepository } from "@/repositories/shared/GiftCardRepository";
import { GiftCardCategoryRepository } from "@/repositories/shared/GiftCardCategoryRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import { Types } from "mongoose";
import { ProviderService } from "./ProviderService";
import { HelperService } from "@/services/client/utility/HelperService";

import { ReloadlyService } from "./providers/giftcard/ReloadlyService";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

// Service for managing gift card rates
// Handles fetching rates from providers and calculating prices

export class GiftCardRateService {
  constructor(
    private giftCardRepository: GiftCardRepository,
    private giftCardCategoryRepository: GiftCardCategoryRepository,
    private providerService: ProviderService,
    private helperService: HelperService,
    private reloadlyService: ReloadlyService,
  ) {}

  private async getExchangeRate(
    giftCard: any,
    amount: number,
  ): Promise<{ exchangeRate: number; rateSource: string }> {
    return SentryHelper.trackCriticalOperation(
      "giftcard_get_exchange_rate",
      async () => {
        // Try live FX rate
        try {
          const usdCost = await this.getUsdCost(giftCard.currency, amount);
          const usdToNgnRate = await this.getUsdToNgnRate();
          const ngnCost = usdCost * usdToNgnRate;
          const exchangeRate = ngnCost / amount;

          logger.debug(
            `Live FX rate used: ${giftCard.currency} = ${exchangeRate} NGN`,
            {
              usdCost,
              usdToNgnRate,
              exchangeRate,
            },
          );

          return { exchangeRate, rateSource: "live_fx" };
        } catch (fxError: any) {
          logger.warn(`FX endpoint failed, using DB rate: ${fxError.message}`);

          if (giftCard.exchangeRate && giftCard.exchangeRate > 0) {
            logger.debug(`DB rate used: ${giftCard.exchangeRate} NGN`, {
              lastUpdated: giftCard.rateLastUpdated,
            });

            return {
              exchangeRate: giftCard.exchangeRate,
              rateSource: "db_cached",
            };
          }

          SentryHelper.captureBusinessError(
            "GIFTCARD_NO_RATE_AVAILABLE",
            `All rate sources failed for ${giftCard.currency}`,
            undefined,
            { giftCardId: giftCard._id, currency: giftCard.currency, amount },
          );
          // Complete failure — no live FX, no cached DB rate.
          // Do NOT guess with a hardcoded FX number. Fail loud instead.
          throw new AppError(
            `No rate available for ${giftCard.currency}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.NOT_FOUND,
          );
        }
      },
      `${giftCard._id}_${amount}`, // Track by card+amount combo
    );
  }

  private async getUsdCost(
    currencyCode: string,
    amount: number,
  ): Promise<number> {
    try {
      const fxData = await this.reloadlyService.getGiftCardFxRate(
        currencyCode,
        amount,
      );

      // Validate response
      if (
        !fxData.senderAmount ||
        fxData.senderAmount <= 0 ||
        fxData.senderCurrency !== "USD"
      ) {
        throw new Error(
          `Invalid FX response: ${fxData.senderCurrency} ${fxData.senderAmount}`,
        );
      }

      logger.debug(
        `FX: ${amount} ${currencyCode} = ${fxData.senderAmount} USD`,
      );
      return fxData.senderAmount;
    } catch (error: any) {
      logger.error(`FX endpoint call failed for ${currencyCode}:`, {
        error: error.message,
        amount,
      });
      throw error;
    }
  }

  private async getUsdToNgnRate(): Promise<number> {
    try {
      const fxData = await this.reloadlyService.getGiftCardFxRate("NGN", 100);

      // fxData returns:
      // senderAmount: 0.07148 USD (cost of 100 NGN)

      if (!fxData.senderAmount || fxData.senderAmount <= 0) {
        throw new Error(`Invalid FX response: ${fxData.senderAmount}`);
      }

      const rate = 100 / fxData.senderAmount;

      if (!rate || rate <= 0) {
        throw new Error(`Invalid USD→NGN rate: ${rate}`);
      }

      logger.debug(`USD→NGN rate: 1 USD = ${rate} NGN`);
      return rate;
    } catch (error: any) {
      logger.error(`Failed to get USD→NGN rate:`, error.message);
      throw error;
    }
  }

  // Calculate buy price for a gift card
  async calculateBuyPrice(
    giftCardId: string,
    amount: number,
    quantity: number = 1,
  ): Promise<{
    giftCardAmount: number;
    giftCardCurrency: string;
    exchangeRate: number;
    senderFee: number;
    discountAmount: number;
    totalNGN: number;
    perUnitNGN: number;
    totalAmount: number;
    serviceFee: number;
    serviceCharge: any;
  }> {
    try {
      const giftCard = await this.giftCardRepository.findById(giftCardId);

      if (!giftCard || giftCard.type !== "buy" || !giftCard.isActive) {
        throw new AppError(
          "Gift card not found or not available for purchase",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      // Validate denomination
      if (giftCard.denominationType === "FIXED") {
        if (!giftCard.priceList || !giftCard.priceList.includes(amount)) {
          throw new AppError(
            `Invalid amount. Must be one of: ${giftCard.priceList?.join(", ")}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
      } else if (giftCard.denominationType === "RANGE") {
        if (giftCard.buyMinAmount && amount < giftCard.buyMinAmount) {
          throw new AppError(
            `Amount must be at least ${giftCard.buyMinAmount}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
        if (giftCard.buyMaxAmount && amount > giftCard.buyMaxAmount) {
          throw new AppError(
            `Amount cannot exceed ${giftCard.buyMaxAmount}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
      }

      // Try to get live rate from FX endpoint
      // Fall back to DB rate if it fails
      const { exchangeRate, rateSource } = await this.getExchangeRate(
        giftCard,
        amount,
      );

      // Calculate NGN cost (base amount without fees)
      const perUnitNGN = amount * exchangeRate;
      const totalNGN = perUnitNGN * quantity;

      logger.info(`💰 Price calculation [${rateSource}]:`, {
        currency: giftCard.currency,
        amount,
        exchangeRate,
        perUnitNGN,
        totalNGN,
        quantity,
      });

      // Get sender fee from gift card (Reloadly's fee)
      const senderFee = giftCard.senderFee || 0;

      //  Calculate discount (for tracking only)
      let discountAmount = 0;
      if (giftCard.discountPercentage) {
        discountAmount = totalNGN * (giftCard.discountPercentage / 100);
      }

      //  Add platform service charge
      const chargeCalculation =
        await this.helperService.calculateAmountWithCharge(
          totalNGN,
          TRANSACTION_TYPES.GIFTCARD_PURCHASE,
        );
      const serviceFee = chargeCalculation.chargeAmount;

      //  Calculate total amount (what user pays)
      const totalAmount = totalNGN + serviceFee;

      return {
        giftCardAmount: amount,
        giftCardCurrency: giftCard.currency || "USD",
        exchangeRate,
        senderFee,
        discountAmount,
        totalNGN,
        perUnitNGN,
        totalAmount,
        serviceFee,
        serviceCharge: chargeCalculation.serviceCharge,
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error("Calculate buy price failed", error);
      throw new AppError(
        "Failed to calculate price",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
      );
    }
  }

  // Calculate sell payout for a gift card
  async calculateSellPayout(
    giftCardId: string,
    amount: number,
    quantity: number = 1,
  ): Promise<{
    giftCardAmount: number;
    giftCardCurrency: string;
    rate: number;
    totalNGN: number;
    totalAmount: number;
    perUnitNGN: number;
    serviceFee: number;
    serviceCharge: any;
  }> {
    try {
      const giftCard = await this.giftCardRepository.findById(giftCardId);

      if (!giftCard || giftCard.type !== "sell") {
        throw new AppError(
          "Gift card not found or not available for sale",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      if (!giftCard.sellRate) {
        throw new AppError(
          "Sell rate not configured for this gift card",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.CONFIGURATION_ERROR,
        );
      }

      // Validate denomination
      if (giftCard.denominationType === "FIXED") {
        if (!giftCard.priceList || !giftCard.priceList.includes(amount)) {
          throw new AppError(
            `Invalid amount. Must be one of: ${giftCard.priceList?.join(", ")}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
      } else if (giftCard.denominationType === "RANGE") {
        if (giftCard.sellMinAmount && amount < giftCard.sellMinAmount) {
          throw new AppError(
            `Amount must be at least ${giftCard.sellMinAmount}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
        if (giftCard.sellMaxAmount && amount > giftCard.sellMaxAmount) {
          throw new AppError(
            `Amount cannot exceed ${giftCard.sellMaxAmount}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
      }

      const perUnitNGN = amount * giftCard.sellRate;
      const totalNGN = perUnitNGN * quantity;

      const chargeCalculation =
        await this.helperService.calculateAmountWithCharge(
          totalNGN,
          TRANSACTION_TYPES.GIFTCARD_SALE,
        );
      const serviceFee = chargeCalculation.chargeAmount;

      return {
        giftCardAmount: amount,
        giftCardCurrency: giftCard.currency || "USD",
        rate: giftCard.sellRate,
        totalNGN,
        totalAmount: totalNGN - serviceFee,
        perUnitNGN,
        serviceFee,
        serviceCharge: chargeCalculation.serviceCharge,
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error("Calculate sell payout failed", error);
      throw new AppError(
        "Failed to calculate payout",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
      );
    }
  }

  // Get all rates for display (both buy and sell)
  async getAllRates(filters: {
    page: number;
    limit: number;
    categoryId?: string;
    countryId?: string;
    type?: "buy" | "sell";
  }) {
    const filter: any = {
      isActive: true,
      deletedAt: { $exists: false },
    };

    if (filters.categoryId) {
      filter.categoryId = new Types.ObjectId(filters.categoryId);
    }
    if (filters.countryId) {
      filter.countryId = new Types.ObjectId(filters.countryId);
    }
    if (filters.type) {
      filter.type = filters.type;
    }

    const giftCards = await this.giftCardRepository.findWithPagination(
      filter,
      filters.page,
      filters.limit,
      undefined,
      [
        { path: "categoryId", select: "name icon" },
        { path: "countryId", select: "name iso2 flag" },
      ],
    );

    const data = giftCards.data.map((card) => ({
      id: card._id,
      name: card.name,
      logo: card.logo,
      type: card.type,
      category: card.categoryId,
      country: card.countryId,
      currency: card.currency,
      buyRate: card.buyRate,
      sellRate: card.sellRate,
      denominationType: card.denominationType,
      priceList: card.priceList,
      minAmount: card.type === "buy" ? card.buyMinAmount : card.sellMinAmount,
      maxAmount: card.type === "buy" ? card.buyMaxAmount : card.sellMaxAmount,
      rateLastUpdated: card.rateLastUpdated,
      rateSource: card.rateSource,
    }));

    return { data, total: giftCards.total };
  }

  // Manually update sell rate (admin only)

  async updateSellRate(giftCardId: string, newRate: number): Promise<any> {
    return SentryHelper.trackCriticalOperation(
      "giftcard_admin_update_sell_rate",
      async () => {
        try {
          const giftCard = await this.giftCardRepository.findById(giftCardId);

          if (!giftCard || giftCard.type !== "sell") {
            throw new AppError(
              "Gift card not found or not a sell type",
              HTTP_STATUS.NOT_FOUND,
              ERROR_CODES.NOT_FOUND,
            );
          }

          const updated = await this.giftCardRepository.update(giftCardId, {
            sellRate: newRate,
            rateLastUpdated: new Date(),
            rateSource: "manual",
          });

          return updated;
        } catch (error: any) {
          if (error instanceof AppError) throw error;
          logger.error("Failed to update sell rate", error);
          throw new AppError(
            "Failed to update rate",
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            ERROR_CODES.INTERNAL_ERROR,
          );
        }
      },
      `rate_update_${giftCardId}`,
    );
  }
}
