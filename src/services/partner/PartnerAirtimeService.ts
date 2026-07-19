import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import { UserRepository } from "@/repositories/client/UserRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { AirtimeService } from "../client/billPayment/AirtimeService";
import { ProviderService } from "../client/ProviderService";
import { PartnerWebhookService } from "./PartnerWebhookService";

export class PartnerAirtimeService {
  constructor(
    private airtimeService: AirtimeService,
    private providerService: ProviderService,
    private userRepository: UserRepository,
    private transactionRepository: TransactionRepository,
    private partnerWebhookService: PartnerWebhookService,
  ) {}

  async purchaseAirtime(data: {
    partnerId: string;
    phone: string;
    amount: number;
    network: string; // service code e.g. "mtn", "airtel"
    partnerReference?: string;
  }): Promise<any> {
    // Validate partner
    const partner = await this.userRepository.findById(data.partnerId);
    if (!partner?.partner?.isPartner) {
      throw new AppError(
        "Partner not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    if (partner.partner.status !== "active") {
      throw new AppError(
        "Partner account is not active",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.INVALID_STATUS,
      );
    }

    // Resolve active provider for airtime — same logic the middleware uses
    const provider = await this.providerService.getActiveApiProvider(
      TRANSACTION_TYPES.AIRTIME,
    );

    // Delegate entirely to AirtimeService — it handles balance check, debit, provider call
    const result = await this.airtimeService.purchase({
      userId: data.partnerId,
      phone: data.phone,
      amount: data.amount,
      network: data.network,
      provider,
      isPartnerPurchase: true,
      partnerReference: data.partnerReference,
    });
    const txn = result.result;
    const transactionId = txn?.id;

    // Stamp partner metadata onto the transaction
    if (transactionId) {
      await this.transactionRepository.update(transactionId.toString(), {
        $set: {
          "meta.isPartnerTransaction": true,
          "meta.partnerReference": data.partnerReference ?? null,
        },
      });
    }

    // Fire webhook immediately for sync success; polling handles pending via hook in TransactionPollingService
    if (!result.pending && partner.partner.webhookUrl) {
      const log = await this.partnerWebhookService.createWebhookLog({
        userId: data.partnerId,
        event: "airtime.purchase.success",
        webhookUrl: partner.partner.webhookUrl,
        payload: {
          event: "airtime.purchase.success",
          transactionReference: txn?.reference,
          partnerReference: data.partnerReference ?? null,
          status: "success",
          product: "airtime",
          phone: data.phone,
          network: data.network,
          amount: data.amount,
          totalCost: result.chargeInfo?.totalAmount,
          timestamp: Date.now(),
        },
        transactionId,
        transactionModel: "Transaction",
      });
      if (log) {
        this.partnerWebhookService
          .sendWebhook(log._id)
          .catch((err) =>
            logger.error("Partner airtime webhook delivery failed", err),
          );
      }
    }

    return {
      success: true,
      transactionReference: txn?.reference,
      partnerReference: data.partnerReference ?? null,
      status: result.pending ? "pending" : "success",
      phone: data.phone,
      network: data.network,
      amount: data.amount,
      totalCost: result.chargeInfo?.totalAmount,
      timestamp: Date.now(),
    };
  }

  async getTransactionStatus(
    partnerId: string,
    transactionReference: string,
  ): Promise<any> {
    const txn =
      await this.transactionRepository.findByReference(transactionReference);

    if (!txn || txn.sourceId?.toString() !== partnerId) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return {
      transactionReference: txn.reference,
      partnerReference: txn.meta?.partnerReference ?? null,
      status: txn.status,
      phone: txn.meta?.phone,
      network: txn.meta?.network,
      amount: txn.amount,
      createdAt: txn.createdAt,
      updatedAt: txn.updatedAt,
    };
  }

  async getTransactions(
    partnerId: string,
    filters: { status?: string; page?: number; limit?: number },
  ): Promise<any> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    const result = await this.transactionRepository.findWithAdvancedFilters({
      userId: partnerId,
      type: TRANSACTION_TYPES.AIRTIME,
      status: filters.status,
      page,
      limit,
    });

    return {
      data: (result.data ?? result).map((txn: any) => ({
        transactionReference: txn.reference,
        partnerReference: txn.meta?.partnerReference ?? null,
        status: txn.status,
        phone: txn.meta?.phone,
        network: txn.meta?.network,
        amount: txn.amount,
        createdAt: txn.createdAt,
      })),
      total: result.total ?? undefined,
      page,
      limit,
    };
  }

  async getNetworks(): Promise<any> {
    return this.airtimeService.getProviders();
  }
}
