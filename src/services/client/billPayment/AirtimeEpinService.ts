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
import {
  recordTransactionSuccess,
  recordTransactionFailure,
} from "@/services/monitoring/transactionFailureTracker";

export class AirtimeEpinService {
  constructor(
    private transactionRepository: TransactionRepository,
    private walletService: WalletService,
    private providerService: ProviderService,
    private helperService: HelperService,
    private transactionProcessor: TransactionProcessor,
    private cacheManager: CacheManager,
  ) {}

  async purchase(data: {
    userId: string;
    network: string;
    denomination: number;
    quantity: number;
    provider: ProviderDTO;
    useCashback?: boolean;
    isPartnerPurchase?: boolean;
    partnerReference?: string;
  }) {
    const reference = generateReference("EPIN");

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
        "Service not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const isPartner = !!data.isPartnerPurchase;
    const rule = isPartner
      ? null // Or add partnerCommissionService if needed, but not injected here currently
      : await this.cacheManager.getApplicableCashbackRuleCached(service._id);

    let baseAmountForCharge = roundAmount(data.denomination * data.quantity);
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
          TRANSACTION_TYPES.AIRTIME_EPIN,
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
        "Cashback used for Airtime E-PIN purchase",
        {
          type: "cashback_spent",
          provider: service.name,
          idempotencyKey: data.isPartnerPurchase && data.partnerReference
            ? `partner:${data.userId}:${TRANSACTION_TYPES.AIRTIME_EPIN}:${data.partnerReference}_bonus`
            : `${reference}_bonus`,
          initiatedBy: new Types.ObjectId(data.userId),
        }
      );
    }

    const debitResult = await this.walletService.debitWallet(
      data.userId,
      mainWalletDebitAmount,
      "Airtime E-PIN purchase",
      {
        type: TRANSACTION_TYPES.AIRTIME_EPIN,
        provider: service.name,
        idempotencyKey: reference,
        initiatedBy: new Types.ObjectId(data.userId),
        initiatedByType: "user",
        suppressNotification: true,
        meta: {
          network: data.network,
          denomination: data.denomination,
          quantity: data.quantity,
          serviceCode: service.code,
          serviceName: service.name,
          logo: service.logo || "",
          remark: `Airtime E-PIN: ${data.quantity}x ₦${data.denomination} ${data.network} (Ref: ${reference})`,
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
      const providerResponse = await this.providerService.purchaseAirtimeEPIN({
        network: data.network,
        value: data.denomination,
        quantity: data.quantity,
        reference,
      });

      if (!providerResponse.success || !providerResponse.pins?.length) {
        throw new AppError(
          "Provider did not return PINs",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

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

      recordTransactionSuccess(data.userId, TRANSACTION_TYPES.AIRTIME_EPIN);

      if (!isPartner && !data.useCashback && rule) {
         const earned = this.helperService.applyRate(baseAmountForCharge, rule).amountDifference;
         if (earned > 0) {
             await this.walletService.creditBonus(
                 data.userId,
                 earned,
                 "Cashback earned from Airtime E-PIN purchase",
                 {
                     type: "cashback_earned",
                     provider: service.name,
                     linkedTransactionId: transaction.id,
                     initiatedBy: new Types.ObjectId(data.userId),
                 }
             ).catch(e => logger.error("Failed to credit cashback", e));
         }
      }

      const context = {
        userId: data.userId,
        walletId: wallet.id,
        transactionId: transaction.id,
        reference,
        amount: baseAmountForCharge,
        totalAmount: chargeCalculation.totalAmount,
        chargeInfo: chargeCalculation,
        transactionType: TRANSACTION_TYPES.AIRTIME_EPIN,
        serviceName: service.name,
        network: data.network,
        serviceCode: service.code,
        logo: service.logo || "",
      };

      this.transactionProcessor.handleSuccess(context).catch((err) =>
        logger.error("E-PIN success handler failed", err),
      );

      return {
        result: TransactionMapper.toDTO(updatedTransaction),
        pins: providerResponse.pins,
        chargeInfo: {
          baseAmount: baseAmountForCharge,
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
        amount: baseAmountForCharge,
        totalAmount: chargeCalculation.totalAmount,
        chargeInfo: chargeCalculation,
        transactionType: TRANSACTION_TYPES.AIRTIME_EPIN,
        serviceName: service.name,
        network: data.network,
        serviceCode: service.code,
        logo: service.logo || "",
      });

      recordTransactionFailure(data.userId, TRANSACTION_TYPES.AIRTIME_EPIN);
      throw error;
    }
  }

  async getByReference(reference: string, userId: string) {
    const transaction = await this.transactionRepository.findOne({
      reference,
      userId: new Types.ObjectId(userId),
      type: TRANSACTION_TYPES.AIRTIME_EPIN,
    });

    if (!transaction) {
      throw new AppError(
        "E-PIN transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return {
      result: TransactionMapper.toDTO(transaction),
      pins: transaction.meta?.epins ?? [],
    };
  }
}