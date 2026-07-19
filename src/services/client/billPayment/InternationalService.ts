import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import { Types } from "mongoose";
import { generateReference, roundAmount } from "@/utils/helpers";
import { TransactionMapper } from "@/utils/mapper/TransactionMapper";
import logger from "@/logger";
import { TransactionProcessor } from "./shared/TransactionProcessor";
import { HelperService } from "@/services/client/utility/HelperService";

import { ProviderService } from "../ProviderService";
import { WalletService } from "../wallet/WalletService";
import { TradeBonusProcessorService } from "../utility/TradeBonusProcessorService";
import { ProviderDTO } from "@/middlewares/shared/checkServiceAvailability";
import {
  recordTransactionFailure,
  recordTransactionSuccess,
} from "@/services/monitoring/transactionFailureTracker";
import { CacheManager } from "./shared/CacheManager";

export class InternationalService {
  constructor(
    private cacheManager: CacheManager,
    private walletService: WalletService,
    private providerService: ProviderService,
    private helperService: HelperService,
    private transactionProcessor: TransactionProcessor,
    private bonusProcessor: TradeBonusProcessorService,
    private partnerCommissionService?: any,
  ) {}

  async purchaseAirtime(data: {
    userId: string;
    phone: string;
    amount: number;
    countryCode: string;
    operatorId: string;
    email: string;
    productCode: string;
    provider: ProviderDTO;
    useCashback?: boolean;
    discountCode?: string;
    countryName?: string;
    variationCode?: string;
    flag?: string;
    phoneCode?: string;
    isPartnerPurchase?: boolean;
    partnerReference?: string;
  }) {
    const reference = generateReference("INT_AIRTIME");

    const [wallet, service] = await Promise.all([
      this.walletService.getWallet(data.userId),
      this.cacheManager.getServiceByCodeCached(TRANSACTION_TYPES.INTERNATIONALAIRTIME),
    ]);

    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    const isPartner = !!data.isPartnerPurchase;
    const rule = isPartner
      ? ((await this.partnerCommissionService?.getPartnerDiscountCached(
          service?._id,
          data.provider?._id,
        )) ?? null)
      : await this.cacheManager.getApplicableCashbackRuleCached(service?._id);

    let baseAmountForCharge = roundAmount(data.amount);
    let amountSaved = 0;
    let discountedAmount = baseAmountForCharge;

    if (isPartner && rule) {
      const res = this.helperService.applyRate(baseAmountForCharge, rule);
      discountedAmount = res.newAmount;
      amountSaved = res.amountDifference;
    }

    const chargeCalculation = isPartner
      ? {
          baseAmount: roundAmount(data.amount),
          chargeAmount: 0,
          totalAmount: discountedAmount,
          serviceCharge: null,
        }
      : await this.helperService.calculateAmountWithCharge(
          baseAmountForCharge,
          TRANSACTION_TYPES.INTERNATIONALAIRTIME,
        );

    let bonusApplied = 0;
    let mainWalletDebitAmount = chargeCalculation.totalAmount;

    if (!isPartner && data.useCashback) {
      bonusApplied = Math.min(wallet.bonusBalance, chargeCalculation.totalAmount);
      mainWalletDebitAmount = chargeCalculation.totalAmount - bonusApplied;
    }

    if (wallet.balance < mainWalletDebitAmount) {
      throw new AppError(
        "Insufficient wallet balance",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INSUFFICIENT_BALANCE,
      );
    }

    if (bonusApplied > 0) {
      await this.walletService.debitBonus(
        data.userId,
        bonusApplied,
        "Cashback used for International Airtime purchase",
        {
          type: "cashback_spent",
          provider: data.provider.name,
          idempotencyKey: data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.INTERNATIONALAIRTIME}:${data.partnerReference}_bonus`
            : `${reference}_bonus`,
          initiatedBy: new Types.ObjectId(data.userId),
        }
      );
    }

    const debitResult = await this.walletService.debitWallet(
      data.userId,
      mainWalletDebitAmount,
      "International airtime purchase",
      {
        type: TRANSACTION_TYPES.INTERNATIONALAIRTIME,
        idempotencyKey:
          data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.INTERNATIONALAIRTIME}:${data.partnerReference}`
            : reference,
        initiatedBy: new Types.ObjectId(data.userId),
        initiatedByType: "user",
        remark: `Intl Airtime: ₦${chargeCalculation.totalAmount} for ${data.phone} (${data.countryName || data.countryCode}) (Ref: ${reference})`,
        meta: {
          phone: data.phone,
          network: TRANSACTION_TYPES.INTERNATIONALAIRTIME,
          countryCode: data.countryCode,
          operatorId: data.operatorId,
          email: data.email,
          suppressNotification: true,
          country: {
            code: data.countryCode,
            name: data.countryName || "",
            flag: data.flag || "",
            phoneCode: data.phoneCode || "",
          },
          chargeInfo: {
            baseAmount: roundAmount(data.amount),
            discountedAmount,
            amountSaved,
            serviceCharge: chargeCalculation.chargeAmount,
            totalAmount: chargeCalculation.totalAmount,
            bonusApplied,
          },
          ...(isPartner && rule && {
            discountType: rule.type,
            discountValue: rule.value,
            amountSaved,
          }),
        },
      },
    );

    const transaction = debitResult.transaction;

    try {
      const providerResponse =
        await this.providerService.purchaseInternationalAirtime({
          phone: data.phone,
          amount: data.amount, // raw amount to provider, unchanged
          countryCode: data.countryCode,
          operatorId: data.operatorId,
          reference,
          variationCode: data.variationCode || data.productCode,
          email: data.email,
          provider: data.provider,
        });

      const { status, transaction: updatedTransaction } =
        await this.transactionProcessor.updateTransactionStatus(
          transaction.id,
          providerResponse,
        );

      if (status === "pending" && providerResponse.providerReference) {
        recordTransactionSuccess(
          data.userId,
          TRANSACTION_TYPES.INTERNATIONALAIRTIME,
        );

        setImmediate(() => {
          this.transactionProcessor
            .initializeTransactionHandling(
              transaction.id,
              providerResponse.providerReference!,
              data.provider.code || providerResponse.providerCode!,
              status,
              data.userId,
            )
            .catch((err) =>
              logger.error("Transaction handling init failed", err),
            );
        });
      }

      const context = {
        userId: data.userId,
        walletId: wallet.id,
        transactionId: transaction.id,
        reference,
        amount: data.amount,
        totalAmount: chargeCalculation.totalAmount,
        chargeInfo: chargeCalculation,
        transactionType: TRANSACTION_TYPES.INTERNATIONALAIRTIME,
        meta: {
          phone: data.phone,
          network: TRANSACTION_TYPES.INTERNATIONALAIRTIME,
          countryCode: data.countryCode,
          operatorId: data.operatorId,
          email: data.email,
          country: {
            code: data.countryCode,
            name: data.countryName || "",
            flag: data.flag || "",
            phoneCode: data.phoneCode || "",
          },
        },
        providerReference: providerResponse.providerReference,
      };

      if (status === "success") {
        this.transactionProcessor.handleSuccess(context);
        recordTransactionSuccess(
          data.userId,
          TRANSACTION_TYPES.INTERNATIONALAIRTIME,
        );

        if (!isPartner && !data.useCashback && rule) {
           const earned = this.helperService.applyRate(roundAmount(data.amount), rule).amountDifference;
           if (earned > 0) {
               await this.walletService.creditBonus(
                   data.userId,
                   earned,
                   "Cashback earned from International Airtime purchase",
                   {
                       type: "cashback_earned",
                       provider: data.provider.name,
                       linkedTransactionId: transaction.id,
                       initiatedBy: new Types.ObjectId(data.userId),
                   }
               ).catch(e => logger.error("Failed to credit cashback", e));
           }
        }

        this.bonusProcessor
          .processTradeAndBonus(data.userId, {
            transactionId: transaction.id.toString(),
            amount: data.amount,
            serviceType: TRANSACTION_TYPES.INTERNATIONALAIRTIME,
          })
          .catch((err) =>
            logger.error(
              `Trade bonus processing failed: ${TRANSACTION_TYPES.INTERNATIONALAIRTIME}`,
              err,
            ),
          );
      }

      if (status === "failed") {
        await this.transactionProcessor.handleFailure(context);
      }

      return {
        result: TransactionMapper.toDTO(updatedTransaction),
        providerStatus: providerResponse.status,
        pending: status === "pending",
        chargeInfo: {
          baseAmount: roundAmount(data.amount),
          discountedAmount,
          amountSaved,
          serviceCharge: chargeCalculation.chargeAmount,
          totalAmount: chargeCalculation.totalAmount,
          bonusApplied,
        },
      };
    } catch (error) {
      await this.transactionProcessor.handleError({
        userId: data.userId,
        walletId: wallet.id,
        transactionId: transaction.id,
        reference,
        amount: data.amount,
        totalAmount: chargeCalculation.totalAmount,
        chargeInfo: chargeCalculation,
        transactionType: TRANSACTION_TYPES.INTERNATIONALAIRTIME,
        meta: {
          phone: data.phone,
          network: TRANSACTION_TYPES.INTERNATIONALAIRTIME,
          countryCode: data.countryCode,
          operatorId: data.operatorId,
          email: data.email,
          country: {
            code: data.countryCode,
            name: data.countryName || "",
            flag: data.flag || "",
            phoneCode: data.phoneCode || "",
          },
        },
      });
      recordTransactionFailure(
        data.userId,
        TRANSACTION_TYPES.INTERNATIONALAIRTIME,
      );

      throw error;
    }
  }

  async purchaseData(data: {
    userId: string;
    phone: string;
    productCode: string;
    operatorId: string;
    countryCode: string;
    countryName: string;
    amount: number;
    email: string;
    provider: ProviderDTO;
    useCashback?: boolean;
    discountCode?: string;
    flag?: string;
    phoneCode?: string;
    isPartnerPurchase?: boolean;
    partnerReference?: string;
  }) {
    const reference = generateReference("INT_DATA");

    const [wallet, service] = await Promise.all([
      this.walletService.getWallet(data.userId),
      this.cacheManager.getServiceByCodeCached(TRANSACTION_TYPES.INTERNATIONALDATA),
    ]);

    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    const isPartner = !!data.isPartnerPurchase;
    const rule = isPartner
      ? ((await this.partnerCommissionService?.getPartnerDiscountCached(
          service?._id,
          data.provider?._id,
        )) ?? null)
      : await this.cacheManager.getApplicableCashbackRuleCached(service?._id);

    let baseAmountForCharge = roundAmount(data.amount);
    let amountSaved = 0;
    let discountedAmount = baseAmountForCharge;

    if (isPartner && rule) {
      const res = this.helperService.applyRate(baseAmountForCharge, rule);
      discountedAmount = res.newAmount;
      amountSaved = res.amountDifference;
    }

    const chargeCalculation = isPartner
      ? {
          baseAmount: roundAmount(data.amount),
          chargeAmount: 0,
          totalAmount: discountedAmount,
          serviceCharge: null,
        }
      : await this.helperService.calculateAmountWithCharge(
          baseAmountForCharge,
          TRANSACTION_TYPES.INTERNATIONALDATA,
        );

    let bonusApplied = 0;
    let mainWalletDebitAmount = chargeCalculation.totalAmount;

    if (!isPartner && data.useCashback) {
      bonusApplied = Math.min(wallet.bonusBalance, chargeCalculation.totalAmount);
      mainWalletDebitAmount = chargeCalculation.totalAmount - bonusApplied;
    }

    if (wallet.balance < mainWalletDebitAmount) {
      throw new AppError(
        "Insufficient wallet balance",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INSUFFICIENT_BALANCE,
      );
    }

    if (bonusApplied > 0) {
      await this.walletService.debitBonus(
        data.userId,
        bonusApplied,
        "Cashback used for International Data purchase",
        {
          type: "cashback_spent",
          provider: data.provider.name,
          idempotencyKey: data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.INTERNATIONALDATA}:${data.partnerReference}_bonus`
            : `${reference}_bonus`,
          initiatedBy: new Types.ObjectId(data.userId),
        }
      );
    }

    const debitResult = await this.walletService.debitWallet(
      data.userId,
      mainWalletDebitAmount,
      "International data purchase",
      {
        type: TRANSACTION_TYPES.INTERNATIONALDATA,
        idempotencyKey:
          data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.INTERNATIONALDATA}:${data.partnerReference}`
            : reference,
        initiatedBy: new Types.ObjectId(data.userId),
        initiatedByType: "user",
        meta: {
          phone: data.phone,
          productCode: data.productCode,
          operatorId: data.operatorId,
          countryCode: data.countryCode,
          remark: `Intl Data: ₦${chargeCalculation.totalAmount} for ${data.phone} (${data.countryName || data.countryCode}) (Ref: ${reference})`,
          network: TRANSACTION_TYPES.INTERNATIONALDATA,
          suppressNotification: true,
          country: {
            code: data.countryCode,
            name: data.countryName || "",
            flag: data.flag || "",
            phoneCode: data.phoneCode || "",
          },
          chargeInfo: {
            baseAmount: roundAmount(data.amount),
            discountedAmount,
            amountSaved,
            serviceCharge: chargeCalculation.chargeAmount,
            totalAmount: chargeCalculation.totalAmount,
            bonusApplied,
          },
          ...(isPartner && rule && {
            discountType: rule.type,
            discountValue: rule.value,
            amountSaved,
          }),
        },
      },
    );

    const transaction = debitResult.transaction;

    try {
      const providerResponse =
        await this.providerService.purchaseInternationalData({
          phone: data.phone,
          variationCode: data.productCode,
          operatorId: data.operatorId,
          countryCode: data.countryCode,
          amount: data.amount, // raw amount to provider, unchanged
          reference,
          email: data.email,
          provider: data.provider,
        });

      const { status, transaction: updatedTransaction } =
        await this.transactionProcessor.updateTransactionStatus(
          transaction.id,
          providerResponse,
        );

      if (status === "pending" && providerResponse.providerReference) {
        recordTransactionSuccess(
          data.userId,
          TRANSACTION_TYPES.INTERNATIONALDATA,
        );

        setImmediate(() => {
          this.transactionProcessor
            .initializeTransactionHandling(
              transaction.id,
              providerResponse.providerReference!,
              data.provider.code || providerResponse.providerCode!,
              status,
              data.userId,
            )
            .catch((err) =>
              logger.error("Transaction handling init failed", err),
            );
        });
      }

      const context = {
        userId: data.userId,
        walletId: wallet.id,
        transactionId: transaction.id,
        reference,
        amount: data.amount,
        totalAmount: chargeCalculation.totalAmount,
        chargeInfo: chargeCalculation,
        transactionType: TRANSACTION_TYPES.INTERNATIONALDATA,
        meta: {
          phone: data.phone,
          productCode: data.productCode,
          operatorId: data.operatorId,
          countryCode: data.countryCode,
          network: TRANSACTION_TYPES.INTERNATIONALDATA,
          country: {
            code: data.countryCode,
            name: data.countryName || "",
            flag: data.flag || "",
            phoneCode: data.phoneCode || "",
          },
        },
        providerReference: providerResponse.providerReference,
      };

      if (status === "success") {
        await this.transactionProcessor.handleSuccess(context);
        recordTransactionSuccess(
          data.userId,
          TRANSACTION_TYPES.INTERNATIONALDATA,
        );

        if (!isPartner && !data.useCashback && rule) {
           const earned = this.helperService.applyRate(roundAmount(data.amount), rule).amountDifference;
           if (earned > 0) {
               await this.walletService.creditBonus(
                   data.userId,
                   earned,
                   "Cashback earned from International Data purchase",
                   {
                       type: "cashback_earned",
                       provider: data.provider.name,
                       linkedTransactionId: transaction.id,
                       initiatedBy: new Types.ObjectId(data.userId),
                   }
               ).catch(e => logger.error("Failed to credit cashback", e));
           }
        }

        this.bonusProcessor
          .processTradeAndBonus(data.userId, {
            transactionId: transaction.id.toString(),
            amount: data.amount,
            serviceType: TRANSACTION_TYPES.INTERNATIONALDATA,
          })
          .catch((err) =>
            logger.error(
              `Trade bonus processing failed: ${TRANSACTION_TYPES.INTERNATIONALDATA}`,
              err,
            ),
          );
      }

      if (status === "failed") {
        await this.transactionProcessor.handleFailure(context);
      }

      return {
        result: TransactionMapper.toDTO(updatedTransaction),
        providerStatus: providerResponse.status,
        pending: status === "pending",
        chargeInfo: {
          baseAmount: roundAmount(data.amount),
          discountedAmount,
          amountSaved,
          serviceCharge: chargeCalculation.chargeAmount,
          totalAmount: chargeCalculation.totalAmount,
          bonusApplied,
        },
      };
    } catch (error) {
      await this.transactionProcessor.handleError({
        userId: data.userId,
        walletId: wallet.id,
        transactionId: transaction.id,
        reference,
        amount: data.amount,
        totalAmount: chargeCalculation.totalAmount,
        chargeInfo: chargeCalculation,
        meta: {
          phone: data.phone,
          productCode: data.productCode,
          operatorId: data.operatorId,
          countryCode: data.countryCode,
          network: TRANSACTION_TYPES.INTERNATIONALDATA,
          country: {
            code: data.countryCode,
            name: data.countryName || "",
            flag: data.flag || "",
            phoneCode: data.phoneCode || "",
          },
        },
        transactionType: "International Data",
      });
      recordTransactionFailure(
        data.userId,
        TRANSACTION_TYPES.INTERNATIONALDATA,
      );

      throw error;
    }
  }

  // Query methods
  async getAirtimeCountries() {
    return this.providerService.getInternationalAirtimeCountries();
  }

  async getAirtimeProviders(countryCode: string) {
    return this.providerService.getInternationalAirtimeProviders(countryCode);
  }

  async getAirtimeProducts(providerId: string, productTypeId: number) {
    return this.providerService.getInternationalAirtimeVariations(
      providerId,
      productTypeId,
    );
  }

  async getDataCountries() {
    return this.providerService.getInternationalDataCountries();
  }

  async getDataProviders(countryCode: string) {
    return this.providerService.getInternationalDataProviders(countryCode);
  }

  async getDataProducts(operator: string) {
    return this.providerService.getInternationalDataProducts(operator);
  }
}
