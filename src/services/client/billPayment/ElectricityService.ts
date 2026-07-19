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
import {
  recordTransactionSuccess,
  recordTransactionFailure,
} from "@/services/monitoring/transactionFailureTracker";
import { isImmediateResponseProvider } from "@/config/providers";
import { IProvider } from "@/models/reference/Provider";

// ELECTRICITY SERVICE
export class ElectricityService {
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
    meterNumber: string;
    providerId: string;
    amount: number;
    meterType: string;
    phone: string;
    serviceProvider: ProviderDTO;
    discountCode?: string;
    useCashback?: boolean;
    isPartnerPurchase?: boolean;
    partnerReference?: string;
  }) {
    const reference = generateReference("ELECTRICITY");

    const [service, wallet] = await Promise.all([
      this.cacheManager.getServiceWithTypeCached(data.providerId),
      this.walletService.getWallet(data.userId),
    ]);

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
          data.serviceProvider._id,
        )) ?? null)
      : await this.cacheManager.getApplicableCashbackRuleCached(service.serviceTypeId);

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
          TRANSACTION_TYPES.ELECTRICITY,
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
        "Cashback used for Electricity bill payment",
        {
          type: "cashback_spent",
          provider: service.name,
          idempotencyKey: data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.ELECTRICITY}:${data.partnerReference}_bonus`
            : `${reference}_bonus`,
          initiatedBy: new Types.ObjectId(data.userId),
        }
      );
    }

    const debitResult = await this.walletService.debitWallet(
      data.userId,
      mainWalletDebitAmount,
      "Electricity bill payment",
      {
        type: TRANSACTION_TYPES.ELECTRICITY,
        provider: service.code,
        idempotencyKey:
          data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.ELECTRICITY}:${data.partnerReference}`
            : reference,
        initiatedBy: new Types.ObjectId(data.userId),
        initiatedByType: "user",
        transactableType: "Product",
        transactableId: service.id,
        remark: `Electricity Bill: ₦${chargeCalculation.totalAmount} for ${service.name} (${data.meterNumber}) (Ref: ${reference})`,
        suppressNotification: true,
        meta: {
          meterNumber: data.meterNumber,
          meterType: data.meterType,
          serviceCode: service.code,
          serviceName: service.name,
          logo: service.logo || "",
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
    const providerCode = data.serviceProvider.code;

    if (isImmediateResponseProvider(providerCode)) {
      try {
        const providerResponse = await this.providerService.purchaseElectricity({
          reference,
          meterNumber: data.meterNumber,
          amount: data.amount,
          provider: service.code,
          meterType: data.meterType,
          productCode: service.code,
          phone: data.phone,
          serviceProvider: data.serviceProvider,
          serviceCode: service.code,
        });

        let finalTransaction = transaction;

        const { status, transaction: updatedTransaction } =
          await this.transactionProcessor.updateTransactionStatus(
            finalTransaction.id,
            providerResponse,
          );

        finalTransaction = updatedTransaction;

        const updated = await this.transactionRepository.update(
          finalTransaction.id,
          {
            meta: {
              ...finalTransaction.meta,
              token: providerResponse.token || "",
              customerName: providerResponse.meta?.customerName || "",
              customerAddress: providerResponse.meta?.customerAddress || "",
              meterNumber: providerResponse.meta?.meterNumber || "",
              ...(providerResponse.meta?.units && {
                units: providerResponse.meta.units,
              }),
              ...(providerResponse.meta?.tokenAmount && {
                tokenAmount: providerResponse.meta.tokenAmount,
              }),
              ...(providerResponse.meta?.exchangeReference && {
                exchangeReference: providerResponse.meta.exchangeReference,
              }),
            },
          },
        );
        if (updated) {
          finalTransaction = updated;
        }

        const context = {
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: data.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.ELECTRICITY,
          serviceName: service.code,
          meta: {
            meterNumber: data.meterNumber,
            meterType: data.meterType,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
          },
          providerReference: providerResponse.providerReference,
          providerResponse,
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.ELECTRICITY);
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
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.ELECTRICITY);

          if (!isPartner && !data.useCashback && rule) {
             const earned = this.helperService.applyRate(roundAmount(data.amount), rule).amountDifference;
             if (earned > 0) {
                 await this.walletService.creditBonus(
                     data.userId,
                     earned,
                     "Cashback earned from Electricity bill payment",
                     {
                         type: "cashback_earned",
                         provider: service.name,
                         linkedTransactionId: finalTransaction.id,
                         initiatedBy: new Types.ObjectId(data.userId),
                     }
                 ).catch(e => logger.error("Failed to credit cashback", e));
             }
          }

          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: data.amount,
              serviceType: TRANSACTION_TYPES.ELECTRICITY,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.ELECTRICITY}`, err),
            );
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }

        return {
          result: TransactionMapper.toDTO(finalTransaction),
          status,
          providerStatus: providerResponse.status,
          token: providerResponse.token,
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
        let verifiedCustomerName = "";
        let verifiedCustomerAddress = "";

        try {
          const verification = await this.providerService.verifyMeterNumber(
            data.meterNumber,
            service.code,
            data.meterType,
            data.serviceProvider,
          );
          verifiedCustomerName = verification.customerName || "";
          verifiedCustomerAddress = verification.address || "";
        } catch {
          // best-effort only
        }

        await this.transactionRepository.update(transaction.id, {
          meta: {
            ...transaction.meta,
            customerName: verifiedCustomerName,
            customerAddress: verifiedCustomerAddress,
            meterNumber: data.meterNumber,
          },
        });

        await this.transactionProcessor.handleError({
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: data.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.ELECTRICITY,
          serviceName: service.code,
          meta: {
            meterNumber: data.meterNumber,
            meterType: data.meterType,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
          },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.ELECTRICITY);
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
      .purchaseElectricity({
        reference,
        meterNumber: data.meterNumber,
        amount: data.amount,
        provider: service.code,
        meterType: data.meterType,
        productCode: service.code,
        phone: data.phone,
        serviceProvider: data.serviceProvider,
        serviceCode: service.code,
      })
      .then(async (providerResponse) => {
        let finalTransaction = transaction;
        const { status, transaction: updatedTransaction } =
          await this.transactionProcessor.updateTransactionStatus(
            finalTransaction.id,
            providerResponse,
          );

        finalTransaction = updatedTransaction;

        const updated = await this.transactionRepository.update(
          finalTransaction.id,
          {
            meta: {
              ...finalTransaction.meta,
              token: providerResponse.token || "",
              customerName: providerResponse.meta?.customerName || "",
              customerAddress: providerResponse.meta?.customerAddress || "",
              meterNumber: providerResponse.meta?.meterNumber || "",
              ...(providerResponse.meta?.units && {
                units: providerResponse.meta.units,
              }),
              ...(providerResponse.meta?.tokenAmount && {
                tokenAmount: providerResponse.meta.tokenAmount,
              }),
              ...(providerResponse.meta?.exchangeReference && {
                exchangeReference: providerResponse.meta.exchangeReference,
              }),
            },
          },
        );
        if (updated) {
          finalTransaction = updated;
        }

        const context = {
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: data.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.ELECTRICITY,
          serviceName: service.code,
          meta: {
            meterNumber: data.meterNumber,
            meterType: data.meterType,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
          },
          providerReference: providerResponse.providerReference,
          providerResponse,
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.ELECTRICITY);
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
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.ELECTRICITY);

          if (!isPartner && !data.useCashback && rule) {
             const earned = this.helperService.applyRate(roundAmount(data.amount), rule).amountDifference;
             if (earned > 0) {
                 await this.walletService.creditBonus(
                     data.userId,
                     earned,
                     "Cashback earned from Electricity bill payment",
                     {
                         type: "cashback_earned",
                         provider: service.name,
                         linkedTransactionId: finalTransaction.id,
                         initiatedBy: new Types.ObjectId(data.userId),
                     }
                 ).catch(e => logger.error("Failed to credit cashback", e));
             }
          }

          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: data.amount,
              serviceType: TRANSACTION_TYPES.ELECTRICITY,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.ELECTRICITY}`, err),
            );
          return;
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }
      })
      .catch(async (error) => {
        logger.error(`Electricity provider call failed async [${reference}]:`, error);

        let verifiedCustomerName = "";
        let verifiedCustomerAddress = "";

        try {
          const verification = await this.providerService.verifyMeterNumber(
            data.meterNumber,
            service.code,
            data.meterType,
            data.serviceProvider,
          );
          verifiedCustomerName = verification.customerName || "";
          verifiedCustomerAddress = verification.address || "";
        } catch {
          // best-effort only
        }

        await this.transactionRepository.update(transaction.id, {
          meta: {
            ...transaction.meta,
            customerName: verifiedCustomerName,
            customerAddress: verifiedCustomerAddress,
            meterNumber: data.meterNumber,
          },
        });

        await this.transactionProcessor.handleError({
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: data.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.ELECTRICITY,
          serviceName: service.code,
          meta: {
            meterNumber: data.meterNumber,
            meterType: data.meterType,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
          },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.ELECTRICITY);
      });

    return {
      result: TransactionMapper.toDTO(transaction),
      status: "pending",
      providerStatus: "pending",
      token: undefined,
      pending: true,
      chargeInfo: {
        baseAmount: roundAmount(data.amount),
        discountedAmount,
        amountSaved,
        serviceCharge: chargeCalculation.chargeAmount,
        totalAmount: chargeCalculation.totalAmount,
        bonusApplied,
      },
    };
  }

  async verifyMeterNumber(data: {
    meterNumber: string;
    serviceCode: string;
    meterType: string;
    serviceProvider: ProviderDTO;
  }) {
    return this.providerService.verifyMeterNumber(
      data.meterNumber,
      data.serviceCode,
      data.meterType,
      data.serviceProvider,
    );
  }

  async getProviders(provider: IProvider) {
    return this.cacheManager.getProviderServices(
      provider._id.toString(),
      TRANSACTION_TYPES.ELECTRICITY,
    );
  }

  async getProducts(serviceId: string) {
    return this.cacheManager.getProductsByServiceCached(serviceId);
  }
}
