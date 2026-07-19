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
import { ProviderDTO } from "@/middlewares/shared/checkServiceAvailability";
import { ProductRepository } from "@/repositories/shared/ProductRepository";
import {
  recordTransactionSuccess,
  recordTransactionFailure,
} from "@/services/monitoring/transactionFailureTracker";

export class DataEpinService {
  constructor(
    private transactionRepository: TransactionRepository,
    private walletService: WalletService,
    private providerService: ProviderService,
    private helperService: HelperService,
    private transactionProcessor: TransactionProcessor,
    private cacheManager: CacheManager,
    private productRepository: ProductRepository,
  ) {}

  async purchase(data: {
    userId: string;
    productId: string;
    quantity: number;
    provider: ProviderDTO;
    useCashback?: boolean;
    isPartnerPurchase?: boolean;
    partnerReference?: string;
  }) {
    const reference = generateReference("DEPIN");

    const [product, wallet] = await Promise.all([
      this.productRepository.findById(data.productId, [
        { path: "serviceId", select: "serviceTypeId name code status logo" },
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

    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    const service = product.serviceId as any;

    const isPartner = !!data.isPartnerPurchase;
    const rule = isPartner
      ? null // Or add partnerCommissionService if needed
      : await this.cacheManager.getApplicableCashbackRuleCached(service._id);

    let baseAmountForCharge = roundAmount(product.amount * data.quantity);
    let amountSaved = 0;
    let discountedAmount = baseAmountForCharge;

    if (isPartner && rule) {
      const res = this.helperService.applyRate(baseAmountForCharge, rule);
      discountedAmount = res.newAmount;
      amountSaved = res.amountDifference;
    }

    const chargeCalculation = isPartner
      ? {
          baseAmount: baseAmountForCharge,
          chargeAmount: 0,
          totalAmount: discountedAmount,
          serviceCharge: null,
        }
      : await this.helperService.calculateAmountWithCharge(
          baseAmountForCharge,
          TRANSACTION_TYPES.DATA_EPIN,
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
        "Cashback used for Data E-PIN purchase",
        {
          type: "cashback_spent",
          provider: service.name,
          idempotencyKey: data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.DATA_EPIN}:${data.partnerReference}_bonus`
            : `${reference}_bonus`,
          initiatedBy: new Types.ObjectId(data.userId),
        }
      );
    }

    const debitResult = await this.walletService.debitWallet(
      data.userId,
      mainWalletDebitAmount,
      "Data E-PIN purchase",
      {
        type: TRANSACTION_TYPES.DATA_EPIN,
        provider: service.name,
        idempotencyKey: reference,
        initiatedBy: new Types.ObjectId(data.userId),
        initiatedByType: "user",
        suppressNotification: true,
        meta: {
          productId: data.productId,
          productName: product.name,
          productCode: product.code,
          quantity: data.quantity,
          serviceCode: service.code,
          serviceName: service.name,
          logo: service.logo || "",
          remark: `Data E-PIN: ${data.quantity}x ${product.name} (Ref: ${reference})`,
          chargeInfo: {
            baseAmount: baseAmountForCharge,
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
      const providerResponse = await this.providerService.purchaseDataEPIN({
        network: service.code,
        dataPlan: product.code,
        quantity: data.quantity,
        reference,
      });

      const context = {
        userId: data.userId,
        walletId: wallet.id,
        transactionId: transaction.id,
        reference,
        amount: baseAmountForCharge,
        totalAmount: chargeCalculation.totalAmount,
        chargeInfo: chargeCalculation,
        transactionType: TRANSACTION_TYPES.DATA_EPIN,
        serviceName: service.name,
        serviceCode: service.code,
        logo: service.logo || "",
        providerReference: providerResponse.providerReference,
        meta: { productName: product.name },
      };

      // Synchronous path — provider returned PINs immediately
      if (providerResponse.success && providerResponse.pins?.length) {
        const updatedTransaction = await this.transactionRepository.update(
          transaction.id,
          {
            status: "success",
            provider: providerResponse.providerCode ?? data.provider.code,
            providerReference: providerResponse.providerReference,
            meta: {
              ...transaction.meta,
              epins: providerResponse.pins,
            },
          },
        );

        recordTransactionSuccess(data.userId, TRANSACTION_TYPES.DATA_EPIN);

        if (!isPartner && !data.useCashback && rule) {
           const earned = this.helperService.applyRate(baseAmountForCharge, rule).amountDifference;
           if (earned > 0) {
               await this.walletService.creditBonus(
                   data.userId,
                   earned,
                   "Cashback earned from Data E-PIN purchase",
                   {
                       type: "cashback_earned",
                       provider: service.name,
                       linkedTransactionId: transaction.id,
                       initiatedBy: new Types.ObjectId(data.userId),
                   }
               ).catch(e => logger.error("Failed to credit cashback", e));
           }
        }

        this.transactionProcessor
          .handleSuccess(context)
          .catch((err) =>
            logger.error("Data E-PIN success handler failed", err),
          );

        return {
          result: TransactionMapper.toDTO(updatedTransaction),
          pins: providerResponse.pins,
          pending: false,
          chargeInfo: {
            baseAmount: baseAmountForCharge,
            discountedAmount,
            amountSaved,
            serviceCharge: chargeCalculation.chargeAmount,
            totalAmount: chargeCalculation.totalAmount,
            bonusApplied,
          },
        };
      }

      // Async/pending path — ORDER_RECEIVED, PINs come via webhook/polling
      if (providerResponse.pending && providerResponse.providerReference) {
        const { transaction: updatedTransaction } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResponse,
          );

        recordTransactionSuccess(data.userId, TRANSACTION_TYPES.DATA_EPIN);

        if (!isPartner && !data.useCashback && rule) {
           const earned = this.helperService.applyRate(baseAmountForCharge, rule).amountDifference;
           if (earned > 0) {
               await this.walletService.creditBonus(
                   data.userId,
                   earned,
                   "Cashback earned from Data E-PIN purchase",
                   {
                       type: "cashback_earned",
                       provider: service.name,
                       linkedTransactionId: transaction.id,
                       initiatedBy: new Types.ObjectId(data.userId),
                   }
               ).catch(e => logger.error("Failed to credit cashback", e));
           }
        }

        this.transactionProcessor
          .initializeTransactionHandling(
            transaction.id,
            providerResponse.providerReference,
            data.provider.code ?? providerResponse.providerCode!,
            "pending",
            data.userId,
          )
          .catch((err) => logger.error("Data E-PIN polling init failed", err));

        return {
          result: TransactionMapper.toDTO(updatedTransaction),
          pins: [],
          pending: true,
          chargeInfo: {
            baseAmount: baseAmountForCharge,
            discountedAmount,
            amountSaved,
            serviceCharge: chargeCalculation.chargeAmount,
            totalAmount: chargeCalculation.totalAmount,
            bonusApplied,
          },
        };
      }

      // Neither success nor pending — treat as failure
      throw new AppError(
        "Provider returned an unexpected response",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error) {
      await this.transactionProcessor.handleError({
        userId: data.userId,
        walletId: wallet.id,
        transactionId: transaction.id,
        reference,
        amount: baseAmountForCharge,
        totalAmount: chargeCalculation.totalAmount,
        chargeInfo: chargeCalculation,
        transactionType: TRANSACTION_TYPES.DATA_EPIN,
        serviceName: service.name,
        serviceCode: service.code,
        logo: service.logo || "",
        meta: { productName: product.name },
      });

      recordTransactionFailure(data.userId, TRANSACTION_TYPES.DATA_EPIN);
      throw error;
    }
  }

  async getByReference(reference: string, userId: string) {
    const transaction = await this.transactionRepository.findOne({
      reference,
      userId: new Types.ObjectId(userId),
      type: TRANSACTION_TYPES.DATA_EPIN,
    });

    if (!transaction) {
      throw new AppError(
        "Data E-PIN transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return {
      result: TransactionMapper.toDTO(transaction),
      pins: transaction.meta?.epins ?? [],
      pending: transaction.status === "pending",
    };
  }

  async getProducts(serviceId: string, providerId: string) {
    return this.productRepository.find(
      {
        serviceId: new Types.ObjectId(serviceId),
        providerId: new Types.ObjectId(providerId),
        isActive: true,
      },
      // { sort: { amount: 1 } },
    );
  }
}
