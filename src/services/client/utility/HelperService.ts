import logger from "@/logger";
import { IServiceCharge } from "@/models/billing/fees/ServiceCharge";
import { ServiceChargeRepository } from "@/repositories/admin/ServiceChargeRepository";
import { CACHE_KEYS, CACHE_TTL, STAMP_DUTY } from "@/utils/constants";
import { roundAmount, calculatePercentage, addAmounts } from "@/utils/helpers";
import { CacheService } from "@/services/core/CacheService";
import { LeaderboardService } from "../LeaderboardService";

export class HelperService {
  constructor(
    private cacheService: CacheService,
    private serviceChargeRepository: ServiceChargeRepository,
    private leaderboardService: LeaderboardService,
  ) {}
  async getServiceChargeCached(
    transactionType: string,
  ): Promise<IServiceCharge | null> {
    const cacheKey = CACHE_KEYS.SERVICE_CHARGE_BY_CODE(transactionType);

    // Try cache first
    const cached = await this.cacheService.get<IServiceCharge>(cacheKey);
    if (cached) {
      return cached;
    }

    // Cache miss - fetch from DB
    const serviceCharge =
      await this.serviceChargeRepository.findByCode(transactionType);

    if (serviceCharge) {
      this.cacheService
        .set(cacheKey, serviceCharge, CACHE_TTL.SERVICE_CHARGE)
        .catch((err) => logger.error("Failed to cache service charge:", err));
    }

    return serviceCharge;
  }

  async calculateAmountWithCharge(
    baseAmount: number,
    transactionType: string,
  ): Promise<{
    baseAmount: number;
    chargeAmount: number;
    totalAmount: number;
    serviceCharge: IServiceCharge | null;
  }> {
    const normalizedBase = roundAmount(baseAmount);

    const serviceCharge = await this.getServiceChargeCached(transactionType);

    let chargeAmount = 0;

    if (serviceCharge) {
      if (serviceCharge.type === "percentage") {
        chargeAmount = calculatePercentage(normalizedBase, serviceCharge.value);

        logger.debug(`Calculated percentage charge:`, {
          baseAmount: normalizedBase,
          percentage: serviceCharge.value,
          chargeAmount,
        });
      } else {
        chargeAmount = roundAmount(serviceCharge.value);

        logger.debug(`Applied flat charge:`, {
          baseAmount: normalizedBase,
          flatCharge: serviceCharge.value,
          chargeAmount,
        });
      }
    } else {
      logger.info(`No service charge configured for: ${transactionType}`, {
        baseAmount: normalizedBase,
        transactionType,
      });
    }

    const totalAmount = addAmounts(normalizedBase, chargeAmount);

    return {
      baseAmount: normalizedBase,
      chargeAmount,
      totalAmount,
      serviceCharge,
    };
  }

  async calculateStampDuty(baseAmount: number): Promise<{
    stampDutyAmount: number;
    applied: boolean;
  }> {
    const normalizedBase = roundAmount(baseAmount);

    if (normalizedBase < STAMP_DUTY.WITHDRAWAL_THRESHOLD) {
      return { stampDutyAmount: 0, applied: false };
    }

    const stampDutyCharge = await this.getServiceChargeCached(
      STAMP_DUTY.SERVICE_CHARGE_CODE,
    );

    let stampDutyAmount = STAMP_DUTY.DEFAULT_AMOUNT;

    if (stampDutyCharge) {
      stampDutyAmount =
        stampDutyCharge.type === "percentage"
          ? calculatePercentage(normalizedBase, stampDutyCharge.value)
          : roundAmount(stampDutyCharge.value);
    } else {
      logger.info(
        `No stamp duty ServiceCharge configured (code: ${STAMP_DUTY.SERVICE_CHARGE_CODE}), using default ₦${STAMP_DUTY.DEFAULT_AMOUNT}`,
        { baseAmount: normalizedBase },
      );
    }

    logger.debug(`Calculated stamp duty:`, {
      baseAmount: normalizedBase,
      stampDutyAmount,
    });

    return { stampDutyAmount, applied: true };
  }

  async updateLeaderboardAsync(
    userId: string,
    walletId: string,
    type: string,
    amount: number,
    amountUSD?: number, 
  ): Promise<void> {
    this.leaderboardService
      .updateUserStats(userId, walletId, type, amount, undefined, amountUSD)
      .catch((err) => logger.error("Leaderboard update failed", err));
  }
  applyRate(
    baseAmount: number,
    rule: { type: "flat" | "percentage", value: number } | null,
  ): {
    newAmount: number;
    amountDifference: number;
  } {
    if (!rule) {
      return { newAmount: baseAmount, amountDifference: 0 };
    }

    let amountDifference = 0;

    if (rule.type === "percentage") {
      amountDifference = calculatePercentage(baseAmount, rule.value);
    } else {
      amountDifference = roundAmount(rule.value);
    }

    amountDifference = Math.min(amountDifference, baseAmount);

    const newAmount = baseAmount - amountDifference;

    return { newAmount, amountDifference };
  }
}
