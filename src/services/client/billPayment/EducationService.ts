import { TransactionRepository } from "@/repositories/client/TransactionRepository";

import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import { Types } from "mongoose";
import { generateReference, roundAmount } from "@/utils/helpers";
import { TransactionMapper } from "@/utils/mapper/TransactionMapper";
import { IUser } from "@/models/core/User";
import logger from "@/logger";
import { TransactionProcessor } from "./shared/TransactionProcessor";
import { CacheManager } from "./shared/CacheManager";
import { HelperService } from "@/services/client/utility/HelperService";

import { ProviderService } from "../ProviderService";
import { WalletService } from "../wallet/WalletService";
import { TradeBonusProcessorService } from "../utility/TradeBonusProcessorService";
import { PartnerCommissionService } from "@/services/partner/PartnerCommissionService";
import { ProviderDTO } from "@/middlewares/shared/checkServiceAvailability";
import {
  recordTransactionSuccess,
  recordTransactionFailure,
} from "@/services/monitoring/transactionFailureTracker";
import { isImmediateResponseProvider } from "@/config/providers";

export class EducationService {
  constructor(
    private transactionRepository: TransactionRepository,
    private walletService: WalletService,
    private providerService: ProviderService,
    private helperService: HelperService,
    private transactionProcessor: TransactionProcessor,
    private cacheManager: CacheManager,
    private bonusProcessor: TradeBonusProcessorService,
    private partnerCommissionService?: PartnerCommissionService,
  ) {}

  async purchase(data: {
    userId: string;
    user: IUser;
    productId: string;
    profileId: string;
    provider: ProviderDTO;
    discountCode?: string;
    useCashback?: boolean;
    isPartnerPurchase?: boolean;
    partnerReference?: string;
  }) {
    const reference = generateReference("EPIN");

    const [product, wallet] = await Promise.all([
      this.cacheManager.getProductWithServiceCached(data.productId),
      this.walletService.getWallet(data.userId),
    ]);

    if (!product || !product.isActive) {
      throw new AppError(
        "Product not found or inactive",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    const service = product.serviceId as any;

    if (!service || !service.isActive) {
      throw new AppError(
        "Service is currently unavailable",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.SERVICE_UNAVAILABLE,
      );
    }

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
          service._id,
          data.provider._id,
        )) ?? null)
      : await this.cacheManager.getApplicableCashbackRuleCached(service._id);

    let baseAmountForCharge = roundAmount(product.amount);
    let amountSaved = 0;
    let discountedAmount = baseAmountForCharge;

    if (isPartner && rule) {
      const res = this.helperService.applyRate(baseAmountForCharge, rule);
      discountedAmount = res.newAmount;
      amountSaved = res.amountDifference;
    }

    const chargeCalculation = isPartner
      ? {
          baseAmount: roundAmount(product.amount),
          chargeAmount: 0,
          totalAmount: discountedAmount,
          serviceCharge: null,
        }
      : await this.helperService.calculateAmountWithCharge(
          baseAmountForCharge,
          TRANSACTION_TYPES.EDUCATION,
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
        "Cashback used for E-Pin purchase",
        {
          type: "cashback_spent",
          provider: service.name,
          idempotencyKey: data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.EDUCATION}:${data.partnerReference}_bonus`
            : `${reference}_bonus`,
          initiatedBy: new Types.ObjectId(data.userId),
        }
      );
    }

    const debitResult = await this.walletService.debitWallet(
      data.userId,
      mainWalletDebitAmount,
      "E-Pin purchase",
      {
        type: TRANSACTION_TYPES.EDUCATION,
        provider: service.name,
        idempotencyKey:
          data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.EDUCATION}:${data.partnerReference}`
            : reference,
        initiatedBy: new Types.ObjectId(data.userId),
        initiatedByType: "user",
        transactableType: "Product",
        transactableId: product.id || product._id,
        meta: {
          productName: product.name,
          serviceCode: service.code,
          serviceName: service.name,
          logo: service.logo || "",
          profileId: data.profileId,
          phone: data.user.phone,
          remark: `E-Pin Purchase: ₦${chargeCalculation.totalAmount} for ${product.name} (Ref: ${reference})`,
          suppressNotification: true,
          chargeInfo: {
            baseAmount: roundAmount(product.amount),
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
    const providerCode = data.provider.code;

    if (isImmediateResponseProvider(providerCode)) {
      try {
        const providerResponse = await this.providerService.purchaseEducation({
          profileId: data.profileId,
          variationCode: product.code,
          phone: data.user.phone!,
          amount: product.amount,
          reference,
          serviceCode: service.code,
          provider: data.provider,
        });

        const { status, transaction: updatedTransaction } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResponse,
          );

        const context = {
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.EDUCATION,
          serviceName: service.name,
          meta: {
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            profileId: data.profileId,
            phone: data.user.phone,
          },
          providerReference: providerResponse.providerReference,
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.EDUCATION);
          this.transactionProcessor
            .initializeTransactionHandling(
              transaction.id,
              providerResponse.providerReference,
              data.provider.code || providerResponse.providerCode!,
              status,
              data.userId,
            )
            .catch((err) => logger.error("Transaction handling init failed", err));
        }

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.EDUCATION);

          if (!isPartner && !data.useCashback && rule) {
             const earned = this.helperService.applyRate(roundAmount(product.amount), rule).amountDifference;
             if (earned > 0) {
                 await this.walletService.creditBonus(
                     data.userId,
                     earned,
                     "Cashback earned from E-Pin purchase",
                     {
                         type: "cashback_earned",
                         provider: service.name,
                         linkedTransactionId: transaction.id,
                         initiatedBy: new Types.ObjectId(data.userId),
                     }
                 ).catch(e => logger.error("Failed to credit cashback", e));
             }
          }

          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: product.amount,
              serviceType: TRANSACTION_TYPES.EDUCATION,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.EDUCATION}`, err),
            );
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }

        return {
          result: TransactionMapper.toDTO(updatedTransaction),
          status,
          providerStatus: providerResponse.status,
          pin: providerResponse.token,
          pending: status === "pending",
          chargeInfo: {
            baseAmount: roundAmount(product.amount),
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
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.EDUCATION,
          serviceName: service.name,
          meta: {
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            profileId: data.profileId,
            phone: data.user.phone,
          },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.EDUCATION);
        throw error;
      }
    }

    // ASYNC path
    await this.transactionRepository.update(transaction.id, {
      "polling.nextPollAt": new Date(Date.now() + 30000),
      "polling.pollCount": 0,
      "polling.pollingProvider": providerCode,
      "polling.startedAt": new Date(),
    });

    this.providerService
      .purchaseEducation({
        profileId: data.profileId,
        variationCode: product.code,
        phone: data.user.phone!,
        amount: product.amount,
        reference,
        serviceCode: service.code,
        provider: data.provider,
      })
      .then(async (providerResponse) => {
        const { status } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResponse,
          );

        const context = {
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.EDUCATION,
          serviceName: service.name,
          meta: {
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            profileId: data.profileId,
            phone: data.user.phone,
          },
          providerReference: providerResponse.providerReference,
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.EDUCATION);
          this.transactionProcessor
            .initializeTransactionHandling(
              transaction.id,
              providerResponse.providerReference,
              providerCode || providerResponse.providerCode!,
              status,
              data.userId,
            )
            .catch((err) => logger.error("Transaction handling init failed", err));
          return;
        }

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.EDUCATION);

          if (!isPartner && !data.useCashback && rule) {
             const earned = this.helperService.applyRate(roundAmount(product.amount), rule).amountDifference;
             if (earned > 0) {
                 await this.walletService.creditBonus(
                     data.userId,
                     earned,
                     "Cashback earned from E-Pin purchase",
                     {
                         type: "cashback_earned",
                         provider: service.name,
                         linkedTransactionId: transaction.id,
                         initiatedBy: new Types.ObjectId(data.userId),
                     }
                 ).catch(e => logger.error("Failed to credit cashback", e));
             }
          }

          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: product.amount,
              serviceType: TRANSACTION_TYPES.EDUCATION,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.EDUCATION}`, err),
            );
          return;
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }
      })
      .catch(async (error) => {
        logger.error(`Education provider call failed async [${reference}]:`, error);
        await this.transactionProcessor.handleError({
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.EDUCATION,
          serviceName: service.name,
          meta: {
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            profileId: data.profileId,
            phone: data.user.phone,
          },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.EDUCATION);
      });

    return {
      result: TransactionMapper.toDTO(transaction),
      status: "pending",
      providerStatus: "pending",
      pin: undefined,
      pending: true,
      chargeInfo: {
        baseAmount: roundAmount(product.amount),
        discountedAmount,
        amountSaved,
        serviceCharge: chargeCalculation.chargeAmount,
        totalAmount: chargeCalculation.totalAmount,
        bonusApplied,
      },
    };
  }

  async verifyProfile(data: { number: string; type: string }) {
    return this.providerService.verifyJambProfile(data.number, data.type);
  }

  async getServices() {
    return this.cacheManager.getServicesByTypeCodeCached(
      TRANSACTION_TYPES.EDUCATION,
    );
  }

  async getProducts(serviceId: string) {
    return this.cacheManager.getProductsByServiceCached(serviceId);
  }
}
