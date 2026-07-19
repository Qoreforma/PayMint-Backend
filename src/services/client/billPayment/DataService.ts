import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import { Types } from "mongoose";
import { generateReference, roundAmount } from "@/utils/helpers";
import { TransactionMapper } from "@/utils/mapper/TransactionMapper";
import logger from "@/logger";
import { TransactionProcessor } from "./shared/TransactionProcessor";
import { CacheManager } from "./shared/CacheManager";
import { HelperService } from "@/services/client/utility/HelperService";

import { ProviderService } from "../ProviderService";
import { WalletService } from "../wallet/WalletService";
import { TradeBonusProcessorService } from "../utility/TradeBonusProcessorService";
import { PartnerCommissionService } from "@/services/partner/PartnerCommissionService";
import { ProviderDTO } from "@/middlewares/shared/checkServiceAvailability";
import { ProductRepository } from "@/repositories/shared/ProductRepository";

import {
  recordTransactionSuccess,
  recordTransactionFailure,
} from "@/services/monitoring/transactionFailureTracker";
import { ProviderRepository } from "@/repositories/shared/ProviderRepository";
import { isImmediateResponseProvider } from "@/config/providers";

export class DataService {
  constructor(
    private providerRepository: ProviderRepository,
    private walletService: WalletService,
    private providerService: ProviderService,
    private helperService: HelperService,
    private transactionProcessor: TransactionProcessor,
    private cacheManager: CacheManager,
    private bonusProcessor: TradeBonusProcessorService,
    private productRepository: ProductRepository,
    private transactionRepository: TransactionRepository,
    private partnerCommissionService?: PartnerCommissionService,
  ) {}

  async purchase(data: {
    userId: string;
    phone: string;
    productId: string;
    discountCode?: string;
    useCashback?: boolean;
    isPartnerPurchase?: boolean;
    partnerReference?: string;
  }) {
    const reference = generateReference("DATA");

    // replace with
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

    const provider = await this.providerRepository.findById(
      product.providerId.toString(),
    );
    if (!provider || !provider.isActive) {
      throw new AppError(
        "Service provider is currently inactive",
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
          product.providerId as Types.ObjectId,
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
          TRANSACTION_TYPES.DATA,
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
        "Cashback used for Data purchase",
        {
          type: "cashback_spent",
          provider: service.name,
          idempotencyKey: data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.DATA}:${data.partnerReference}_bonus`
            : `${reference}_bonus`,
          initiatedBy: new Types.ObjectId(data.userId),
        }
      );
    }

    const debitResult = await this.walletService.debitWallet(
      data.userId,
      mainWalletDebitAmount,
      "Data purchase",
      {
        type: TRANSACTION_TYPES.DATA,
        provider: service.name,
        idempotencyKey:
          data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.DATA}:${data.partnerReference}`
            : reference,
        initiatedBy: new Types.ObjectId(data.userId),
        initiatedByType: "user",
        transactableType: "Product",
        transactableId: product.id || product._id,
        remark: `Data Purchase: ₦${chargeCalculation.totalAmount} for ${product.name} (${data.phone}) (Ref: ${reference})`,
        meta: {
          phone: data.phone,
          productName: product.name,
          serviceCode: service.code,
          serviceName: service.name,
          logo: service.logo || "",
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
    const providerCode = provider.code;

    if (isImmediateResponseProvider(providerCode)) {
      try {
        const providerResponse = await this.providerService.purchaseData({
          phone: data.phone,
          amount: product.amount,
          plan: product.name,
          serviceCode: service.code,
          productCode: product.code,
          reference,
          provider,
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
          transactionType: TRANSACTION_TYPES.DATA,
          serviceName: service.name,
          serviceCode: service.code,
          phone: data.phone,
          logo: service.logo || "",
          providerReference: providerResponse.providerReference,
          productName: product.name,
          meta: {
            productName: product.name,
          },
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.DATA);
          setImmediate(() => {
            this.transactionProcessor
              .initializeTransactionHandling(
                transaction.id,
                providerResponse.providerReference!,
                provider.code,
                status,
                data.userId,
              )
              .catch((err) =>
                logger.error("Transaction handling init failed", err),
              );
          });
        }

        if (status === "success") {
          setImmediate(async () => {
            this.transactionProcessor.handleSuccess(context);
            recordTransactionSuccess(data.userId, TRANSACTION_TYPES.DATA);

            if (!isPartner && !data.useCashback && rule) {
               const earned = this.helperService.applyRate(roundAmount(product.amount), rule).amountDifference;
               if (earned > 0) {
                   await this.walletService.creditBonus(
                       data.userId,
                       earned,
                       "Cashback earned from Data purchase",
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
                serviceType: TRANSACTION_TYPES.DATA,
              })
              .catch((err) =>
                logger.error(
                  `Trade bonus processing failed: ${TRANSACTION_TYPES.DATA}`,
                  err,
                ),
              );
          });
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }

        return {
          result: TransactionMapper.toDTO(updatedTransaction),
          providerStatus: providerResponse.status,
          pending: false,
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
          transactionType: TRANSACTION_TYPES.DATA,
          serviceName: service.name,
          serviceCode: service.code,
          phone: data.phone,
          logo: service.logo || "",
          meta: {
            productName: product.name,
          },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.DATA);
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
      .purchaseData({
        phone: data.phone,
        amount: product.amount,
        plan: product.name,
        serviceCode: service.code,
        productCode: product.code,
        reference,
        provider,
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
          transactionType: TRANSACTION_TYPES.DATA,
          serviceName: service.name,
          serviceCode: service.code,
          phone: data.phone,
          logo: service.logo || "",
          providerReference: providerResponse.providerReference,
          productName: product.name,
          meta: {
            productName: product.name,
          },
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.DATA);
          this.transactionProcessor
            .initializeTransactionHandling(
              transaction.id,
              providerResponse.providerReference!,
              provider.code,
              status,
              data.userId,
            )
            .catch((err) => logger.error("Transaction handling init failed", err));
          return;
        }

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.DATA);
          if (!isPartner && !data.useCashback && rule) {
             const earned = this.helperService.applyRate(roundAmount(product.amount), rule).amountDifference;
             if (earned > 0) {
                 await this.walletService.creditBonus(
                     data.userId,
                     earned,
                     "Cashback earned from Data purchase",
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
              serviceType: TRANSACTION_TYPES.DATA,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.DATA}`, err),
            );
          return;
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }
      })
      .catch(async (error) => {
        logger.error(`Data provider call failed async [${reference}]:`, error);
        await this.transactionProcessor.handleError({
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.DATA,
          serviceName: service.name,
          serviceCode: service.code,
          phone: data.phone,
          logo: service.logo || "",
          meta: {
            productName: product.name,
          },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.DATA);
      });

    return {
      result: TransactionMapper.toDTO(transaction),
      providerStatus: "pending",
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

  async getProviders() {
    return this.cacheManager.getServicesByTypeCodeCached(
      TRANSACTION_TYPES.DATA,
    );
  }

  async getDataTypesByServiceCode(serviceCode: string): Promise<string[]> {
    return this.cacheManager.getDataTypesByServiceCodeCached(serviceCode);
  }

  async getProducts(serviceId: string, dataType?: string) {
    return this.cacheManager.getDataProductsCached(serviceId, dataType);
  }

  async getAllData() {
    return this.providerService.getProductsByServiceTypeCode(
      TRANSACTION_TYPES.DATA,
    );
  }
}