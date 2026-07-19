import logger from "@/logger";
import { AppError } from "@/middlewares/shared/errorHandler";
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
import {
  recordTransactionSuccess,
  recordTransactionFailure,
} from "@/services/monitoring/transactionFailureTracker";
import { IProvider } from "@/models/reference/Provider";
import { isImmediateResponseProvider } from "@/config/providers";

// BETTING SERVICE
export class BettingService {
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

  async fundAccount(data: {
    userId: string;
    customerId: string;
    amount: number;
    providerId: string;
    reference?: string;
    serviceProvider: ProviderDTO;
    discountCode?: string;
    useCashback?: boolean;
    isPartnerPurchase?: boolean;
    partnerReference?: string;
  }) {
    const { userId, customerId, amount, providerId } = data;
    const reference = generateReference("BET");

    const [service, wallet] = await Promise.all([
      this.cacheManager.getServiceWithTypeCached(providerId),
      this.walletService.getWallet(userId),
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
        "Service not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const isPartner = !!data.isPartnerPurchase;
    const rule = isPartner
      ? ((await this.partnerCommissionService?.getPartnerDiscountCached(
          service._id,
          data.serviceProvider._id,
        )) ?? null)
      : await this.cacheManager.getApplicableCashbackRuleCached(service.serviceTypeId);

    // apply discount first, then calculate charge on discounted amount
    let baseAmountForCharge = roundAmount(amount);
    let amountSaved = 0;
    let discountedAmount = baseAmountForCharge;

    if (isPartner && rule) {
      const res = this.helperService.applyRate(baseAmountForCharge, rule);
      discountedAmount = res.newAmount;
      amountSaved = res.amountDifference;
    }

    const chargeCalculation = isPartner
      ? {
          baseAmount: roundAmount(amount),
          chargeAmount: 0,
          totalAmount: discountedAmount,
          serviceCharge: null,
        }
      : await this.helperService.calculateAmountWithCharge(
          baseAmountForCharge,
          TRANSACTION_TYPES.BETTING,
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

    const serviceCode = service.code;

    if (bonusApplied > 0) {
      await this.walletService.debitBonus(
        data.userId,
        bonusApplied,
        "Cashback used for Betting funding",
        {
          type: "cashback_spent",
          provider: serviceCode,
          idempotencyKey: data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.BETTING}:${data.partnerReference}_bonus`
            : `${reference}_bonus`,
          initiatedBy: new Types.ObjectId(userId),
        }
      );
    }

    const debitResult = await this.walletService.debitWallet(
      userId,
      mainWalletDebitAmount,
      "Betting funding",
      {
        type: TRANSACTION_TYPES.BETTING,
        provider: serviceCode,
        idempotencyKey:
          data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.BETTING}:${data.partnerReference}`
            : reference,
        initiatedBy: new Types.ObjectId(userId),
        initiatedByType: "user",
        remark: `Betting Funding: ₦${chargeCalculation.totalAmount} for ${serviceCode} (${customerId}) (Ref: ${reference})`,
        suppressNotification: true,
        meta: {
          customerId,
          serviceCode,
          chargeInfo: {
            baseAmount: roundAmount(amount),
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
    const isImmediate = isImmediateResponseProvider(providerCode);

    // IMMEDIATE providers (Coolsub, GiftBills) — keep synchronous
    if (isImmediate) {
      try {
        const providerResult = await this.providerService.fundBetting({
          customerId: customerId!,
          amount, // raw amount to provider, unchanged
          provider: serviceCode,
          reference,
          serviceProvider: data.serviceProvider,
        });

        const { status, transaction: updatedTransaction } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResult,
          );

        const context = {
          userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.BETTING,
          serviceName: serviceCode,
          meta: { customerId },
          providerReference: providerResult.providerReference,
        };

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.BETTING);

          if (!isPartner && !data.useCashback && rule) {
             const earned = this.helperService.applyRate(roundAmount(amount), rule).amountDifference;
             if (earned > 0) {
                 await this.walletService.creditBonus(
                     userId,
                     earned,
                     "Cashback earned from Betting funding",
                     {
                         type: "cashback_earned",
                         provider: serviceCode,
                         linkedTransactionId: transaction.id,
                         initiatedBy: new Types.ObjectId(userId),
                     }
                 ).catch(e => logger.error("Failed to credit cashback", e));
             }
          }

          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: data.amount,
              serviceType: TRANSACTION_TYPES.BETTING,
            })
            .catch((err) =>
              logger.error(
                `Trade bonus processing failed: ${TRANSACTION_TYPES.BETTING}`,
                err,
              ),
            );
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }

        return {
          result: TransactionMapper.toDTO(updatedTransaction),
          providerStatus: providerResult.status,
          pending: false,
          chargeInfo: {
            baseAmount: roundAmount(amount),
            discountedAmount,
            amountSaved,
            serviceCharge: chargeCalculation.chargeAmount,
            totalAmount: chargeCalculation.totalAmount,
            bonusApplied,
          },
        };
      } catch (error: any) {
        await this.transactionProcessor.handleError({
          userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.BETTING,
          serviceName: serviceCode,
          meta: { customerId },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.BETTING);

        throw error;
      }
    }

    // ASYNC path — ClubKonnect (POLLING), VTU.ng (POLLING)
    // Stamp polling bootstrap on the transaction NOW so the cron can rescue it
    // if the process dies before the provider responds.
    await this.transactionRepository.update(transaction.id, {
      "polling.nextPollAt": new Date(Date.now() + 30000),
      "polling.pollCount": 0,
      "polling.pollingProvider": providerCode,
      "polling.startedAt": new Date(),
    });

    // Fire provider call — do NOT await
    this.providerService
      .fundBetting({
        customerId: customerId!,
        amount,
        provider: serviceCode,
        reference,
        serviceProvider: data.serviceProvider,
      })
      .then(async (providerResult) => {
        const { status } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResult,
          );

        const context = {
          userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.BETTING,
          serviceName: serviceCode,
          meta: { customerId },
          providerReference: providerResult.providerReference,
        };

        if (status === "pending" && providerResult.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.BETTING);
          this.transactionProcessor
            .initializeTransactionHandling(
              transaction.id,
              providerResult.providerReference,
              providerCode || providerResult.providerCode!,
              status,
              data.userId,
            )
            .catch((err) => logger.error("Polling init failed", err));
          return;
        }

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.BETTING);

          if (!isPartner && !data.useCashback && rule) {
             const earned = this.helperService.applyRate(roundAmount(amount), rule).amountDifference;
             if (earned > 0) {
                 await this.walletService.creditBonus(
                     userId,
                     earned,
                     "Cashback earned from Betting funding",
                     {
                         type: "cashback_earned",
                         provider: serviceCode,
                         linkedTransactionId: transaction.id,
                         initiatedBy: new Types.ObjectId(userId),
                     }
                 ).catch(e => logger.error("Failed to credit cashback", e));
             }
          }

          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: data.amount,
              serviceType: TRANSACTION_TYPES.BETTING,
            })
            .catch((err) =>
              logger.error(
                `Trade bonus processing failed: ${TRANSACTION_TYPES.BETTING}`,
                err,
              ),
            );
          return;
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }
      })
      .catch(async (error) => {
        logger.error(`Betting provider call failed async [${reference}]:`, error);
        await this.transactionProcessor.handleError({
          userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.BETTING,
          serviceName: serviceCode,
          meta: { customerId },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.BETTING);
      });

    // Return immediately — wallet is debited, transaction is created, provider is running
    return {
      result: TransactionMapper.toDTO(transaction),
      providerStatus: "pending",
      pending: true,
      chargeInfo: {
        baseAmount: roundAmount(amount),
        discountedAmount,
        amountSaved,
        serviceCharge: chargeCalculation.chargeAmount,
        totalAmount: chargeCalculation.totalAmount,
        bonusApplied,
      },
    };
  }

  async verifyAccount(data: {
    customerId: string;
    providerId: string;
    serviceProvider: ProviderDTO;
  }) {
    const service = await this.cacheManager.getServiceByIdCached(
      data.providerId,
    );

    if (!service) {
      throw new AppError(
        "Service not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return this.providerService.validateBettingCustomer({
      customerId: data.customerId,
      providerId: service.code,
      serviceProvider: data.serviceProvider,
    });
  }

  async getProviders(provider: IProvider) {
    return this.cacheManager.getProviderServices(
      provider._id.toString(),
      TRANSACTION_TYPES.BETTING,
    );
  }
}
