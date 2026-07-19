import { TransactionRepository } from "@/repositories/client/TransactionRepository";

import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import { Types } from "mongoose";
import { generateReference, roundAmount } from "@/utils/helpers";
import { TransactionMapper } from "@/utils/mapper/TransactionMapper";
import logger from "@/logger";
import { TransactionProcessor } from "./shared/TransactionProcessor";
import { CacheManager } from "./shared/CacheManager";
import { ValidationHelpers } from "./shared/ValidationHelpers";
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

export class AirtimeService {
  constructor(
    private transactionRepository: TransactionRepository,
    private walletService: WalletService,
    private providerService: ProviderService,
    private helperService: HelperService,
    private transactionProcessor: TransactionProcessor,
    private bonusProcessor: TradeBonusProcessorService,
    private cacheManager: CacheManager,
    private partnerCommissionService?: PartnerCommissionService,
  ) {}

  async purchase(data: {
    userId: string;
    phone: string;
    amount: number;
    network: string;
    provider: ProviderDTO;
    discountCode?: string;
    useCashback?: boolean;
    isPartnerPurchase?: boolean;
    partnerReference?: string;
  }) {
    const reference = generateReference("AIRTIME");

    // replace with
    const [wallet, service] = await Promise.all([
      this.walletService.getWallet(data.userId),
      this.cacheManager.getServiceByCodeCached(data.network),
    ]);

    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    if (!service) {
      throw new AppError(
        "Service Not Found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const isPartner = !!data.isPartnerPurchase;
    const rule = isPartner
      ? ((await this.partnerCommissionService?.getPartnerDiscountCached(
          service._id,
          data.provider._id,
        )) ?? null)
      : await this.cacheManager.getApplicableCashbackRuleCached(service._id);

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
          TRANSACTION_TYPES.AIRTIME,
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
        "Cashback used for Airtime purchase",
        {
          type: "cashback_spent",
          provider: service.name,
          idempotencyKey: data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.AIRTIME}:${data.partnerReference}_bonus`
            : `${reference}_bonus`,
          initiatedBy: new Types.ObjectId(data.userId),
        }
      );
    }

    const debitResult = await this.walletService.debitWallet(
      data.userId,
      mainWalletDebitAmount,
      "Airtime purchase",
      {
        type: TRANSACTION_TYPES.AIRTIME,
        provider: service.name,
        idempotencyKey:
          data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.AIRTIME}:${data.partnerReference}`
            : reference,
        initiatedBy: new Types.ObjectId(data.userId),
        initiatedByType: "user",
        suppressNotification: true,
        meta: {
          phone: data.phone,
          network: data.network,
          serviceCode: service.code,
          serviceName: service.name,
          logo: service.logo || "",
          remark: `Airtime Purchase: ₦${chargeCalculation.totalAmount} for ${data.network} ${data.phone} (Ref: ${reference})`,
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
    const providerCode = data.provider.code;

    // IMMEDIATE providers — stay synchronous (fast response, no polling needed)
    if (isImmediateResponseProvider(providerCode)) {
      try {
        const providerResponse = await this.providerService.purchaseAirtime({
          phone: data.phone,
          amount: data.amount,
          network: data.network,
          reference,
          provider: data.provider,
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
          amount: data.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.AIRTIME,
          serviceName: service.name,
          providerReference: providerResponse.providerReference,
          phone: data.phone,
          network: data.network,
          serviceCode: service.code,
          logo: service.logo || "",
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.AIRTIME);
          this.transactionProcessor
            .initializeTransactionHandling(
              transaction.id,
              providerResponse.providerReference,
              data.provider.code || providerResponse.providerCode!,
              status,
              data.userId,
            )
            .catch((err) => logger.error("Polling init failed", err));
        }

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.AIRTIME);

          if (!isPartner && !data.useCashback && rule) {
             const earned = this.helperService.applyRate(roundAmount(data.amount), rule).amountDifference;
             if (earned > 0) {
                 await this.walletService.creditBonus(
                     data.userId,
                     earned,
                     "Cashback earned from Airtime purchase",
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
              amount: data.amount,
              serviceType: TRANSACTION_TYPES.AIRTIME,
            })
            .catch((err) =>
              logger.error(
                `Trade bonus processing failed: ${TRANSACTION_TYPES.AIRTIME}`,
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
          pending: false,
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
          transactionType: TRANSACTION_TYPES.AIRTIME,
          serviceName: service.name,
          phone: data.phone,
          network: data.network,
          serviceCode: service.code,
          logo: service.logo || "",
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.AIRTIME);
        throw error;
      }
    }

    // ASYNC path — VTPass (WEBHOOK), ClubKonnect (POLLING), VTU.ng (POLLING), MySimHosting (WEBHOOK)
    // Stamp polling bootstrap now so the cron can rescue if the process dies mid-flight
    await this.transactionRepository.update(transaction.id, {
      "polling.nextPollAt": new Date(Date.now() + 30000),
      "polling.pollCount": 0,
      "polling.pollingProvider": providerCode,
      "polling.startedAt": new Date(),
    });

    this.providerService
      .purchaseAirtime({
        phone: data.phone,
        amount: data.amount,
        network: data.network,
        reference,
        provider: data.provider,
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
          amount: data.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.AIRTIME,
          serviceName: service.name,
          providerReference: providerResponse.providerReference,
          phone: data.phone,
          network: data.network,
          serviceCode: service.code,
          logo: service.logo || "",
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.AIRTIME);
          this.transactionProcessor
            .initializeTransactionHandling(
              transaction.id,
              providerResponse.providerReference,
              providerCode || providerResponse.providerCode!,
              status,
              data.userId,
            )
            .catch((err) => logger.error("Polling init failed", err));
          return;
        }

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.AIRTIME);

          if (!isPartner && !data.useCashback && rule) {
             const earned = this.helperService.applyRate(roundAmount(data.amount), rule).amountDifference;
             if (earned > 0) {
                 await this.walletService.creditBonus(
                     data.userId,
                     earned,
                     "Cashback earned from Airtime purchase",
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
              amount: data.amount,
              serviceType: TRANSACTION_TYPES.AIRTIME,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.AIRTIME}`, err),
            );
          return;
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }
      })
      .catch(async (error) => {
        logger.error(`Airtime provider call failed async [${reference}]:`, error);
        await this.transactionProcessor.handleError({
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: data.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.AIRTIME,
          serviceName: service.name,
          phone: data.phone,
          network: data.network,
          serviceCode: service.code,
          logo: service.logo || "",
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.AIRTIME);
      });

    return {
      result: TransactionMapper.toDTO(transaction),
      providerStatus: "pending",
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

  async verifyPhone(phone: string) {
    return ValidationHelpers.verifyPhone(phone);
  }

  async verifyPhoneWithNetwork(
    phone: string,
    network: string,
  ): Promise<boolean> {
    return ValidationHelpers.verifyPhoneWithNetwork(phone, network);
  }

  async getProviders() {
    return this.cacheManager.getServicesByTypeCodeCached(
      TRANSACTION_TYPES.AIRTIME,
    );
  }
}
