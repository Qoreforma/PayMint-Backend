import logger from "@/logger";
import { AppError } from "@/middlewares/shared/errorHandler";
import { IUser } from "@/models/core/User";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { TRANSACTION_TYPES, HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { generateReference, roundAmount } from "@/utils/helpers";
import { TransactionMapper } from "@/utils/mapper/TransactionMapper";
import { Types } from "mongoose";
import { HelperService } from "@/services/client/utility/HelperService";

import { ProviderService } from "../ProviderService";
import { WalletService } from "../wallet/WalletService";
import { CacheManager } from "./shared/CacheManager";
import { TransactionProcessor } from "./shared/TransactionProcessor";
import { TradeBonusProcessorService } from "../utility/TradeBonusProcessorService";
import { PartnerCommissionService } from "@/services/partner/PartnerCommissionService";
import { ProviderDTO } from "@/middlewares/shared/checkServiceAvailability";
import { ProductRepository } from "@/repositories/shared/ProductRepository";
import { stat } from "fs";
import {
  recordTransactionSuccess,
  recordTransactionFailure,
} from "@/services/monitoring/transactionFailureTracker";
import { isImmediateResponseProvider } from "@/config/providers";

// CABLE TV SERVICE
export class CableTvService {
  constructor(
    private transactionRepository: TransactionRepository,
    private walletService: WalletService,
    private providerService: ProviderService,
    private helperService: HelperService,
    private transactionProcessor: TransactionProcessor,
    private cacheManager: CacheManager,
    private bonusProcessor: TradeBonusProcessorService,
    private productRepository: ProductRepository,
    private partnerCommissionService?: PartnerCommissionService,
  ) {}

  async purchase(data: {
    userId: string;
    user: IUser;
    provider: string;
    smartCardNumber: string;
    productId: string;
    type: "renew" | "change";
    serviceProvider: ProviderDTO;
    discountCode?: string;
    useCashback?: boolean;
    isPartnerPurchase?: boolean;
    partnerReference?: string;
  }) {
    const reference = generateReference("CABLE");

    const [product, wallet] = await Promise.all([
      this.productRepository.findById(data.productId, [
        { path: "serviceId", select: "serviceTypeId name code status" },
      ]),
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
          data.serviceProvider._id,
        )) ?? null)
      : await this.cacheManager.getApplicableCashbackRuleCached(service.serviceTypeId);

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
          TRANSACTION_TYPES.CABLE,
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
        "Cashback used for Cable TV subscription",
        {
          type: "cashback_spent",
          provider: service.name,
          idempotencyKey: data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.CABLE}:${data.partnerReference}_bonus`
            : `${reference}_bonus`,
          initiatedBy: new Types.ObjectId(data.userId),
        }
      );
    }

    const debitResult = await this.walletService.debitWallet(
      data.userId,
      mainWalletDebitAmount,
      "Cable TV subscription",
      {
        type: "cable_tv",
        provider: service.name,
        idempotencyKey:
          data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.CABLE}:${data.partnerReference}`
            : reference,
        initiatedBy: new Types.ObjectId(data.userId),
        initiatedByType: "user",
        transactableType: "Product",
        transactableId: product.id || product._id,
        meta: {
          smartCardNumber: data.smartCardNumber,
          productName: product.name,
          serviceCode: service.code,
          serviceName: service.name,
          logo: service.logo || "",
          subscriptionType: data.type,
          remark: `Cable TV Subscription: ₦${chargeCalculation.totalAmount} for ${product.name} (${data.smartCardNumber}) (Ref: ${reference})`,
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
    const providerCode = data.serviceProvider.code;

    if (isImmediateResponseProvider(providerCode)) {
      try {
        const providerResponse = await this.providerService.purchaseCableTv({
          reference,
          provider: data.provider || service.code,
          smartCardNumber: data.smartCardNumber,
          amount: product.amount,
          phone: data.user.phone || "",
          package: product.code,
          subscriptionType: data.type,
          serviceProvider: data.serviceProvider,
          serviceCode: service.code,
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
          transactionType: TRANSACTION_TYPES.CABLE,
          serviceName: service.name,
          meta: {
            smartCardNumber: data.smartCardNumber,
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            subscriptionType: data.type,
          },
          providerReference: providerResponse.providerReference,
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.CABLE);
          this.transactionProcessor
            .initializeTransactionHandling(
              transaction.id,
              providerResponse.providerReference,
              data.serviceProvider.code || providerResponse.providerCode!,
              status,
              data.userId,
            )
            .catch((err) => logger.error("Transaction handling init failed", err));
        }

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.CABLE);

          if (!isPartner && !data.useCashback && rule) {
             const earned = this.helperService.applyRate(roundAmount(product.amount), rule).amountDifference;
             if (earned > 0) {
                 await this.walletService.creditBonus(
                     data.userId,
                     earned,
                     "Cashback earned from Cable TV subscription",
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
              serviceType: TRANSACTION_TYPES.CABLE,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.CABLE}`, err),
            );
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }

        return {
          result: TransactionMapper.toDTO(updatedTransaction),
          providerStatus: providerResponse.status,
          status,
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
          transactionType: TRANSACTION_TYPES.CABLE,
          serviceName: service.name,
          meta: {
            smartCardNumber: data.smartCardNumber,
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            subscriptionType: data.type,
          },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.CABLE);
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
      .purchaseCableTv({
        reference,
        provider: data.provider || service.code,
        smartCardNumber: data.smartCardNumber,
        amount: product.amount,
        phone: data.user.phone || "",
        package: product.code,
        subscriptionType: data.type,
        serviceProvider: data.serviceProvider,
        serviceCode: service.code,
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
          transactionType: TRANSACTION_TYPES.CABLE,
          serviceName: service.name,
          meta: {
            smartCardNumber: data.smartCardNumber,
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            subscriptionType: data.type,
          },
          providerReference: providerResponse.providerReference,
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.CABLE);
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
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.CABLE);

          if (!isPartner && !data.useCashback && rule) {
             const earned = this.helperService.applyRate(roundAmount(product.amount), rule).amountDifference;
             if (earned > 0) {
                 await this.walletService.creditBonus(
                     data.userId,
                     earned,
                     "Cashback earned from Cable TV subscription",
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
              serviceType: TRANSACTION_TYPES.CABLE,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.CABLE}`, err),
            );
          return;
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }
      })
      .catch(async (error) => {
        logger.error(`CableTV provider call failed async [${reference}]:`, error);
        await this.transactionProcessor.handleError({
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.CABLE,
          serviceName: service.name,
          meta: {
            smartCardNumber: data.smartCardNumber,
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            subscriptionType: data.type,
          },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.CABLE);
      });

    return {
      result: TransactionMapper.toDTO(transaction),
      providerStatus: "pending",
      status: "pending",
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

  async verifySmartCard(
    smartCardNumber: string,
    serviceCode: string,
    serviceProvider: ProviderDTO,
  ) {
    return this.providerService.verifySmartCard(
      smartCardNumber,
      serviceCode,
      serviceProvider,
    );
  }

  async getProviders() {
    return this.cacheManager.getServicesByTypeCodeCached(
      TRANSACTION_TYPES.CABLE,
    );
  }

  async getProducts(serviceId: string) {
    return this.cacheManager.getProductsByServiceCached(serviceId);
  }
}
