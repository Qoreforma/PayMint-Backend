import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import { UserRepository } from "@/repositories/client/UserRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { EducationService } from "../client/billPayment/EducationService";
import { ProviderService } from "../client/ProviderService";
import { PartnerWebhookService } from "./PartnerWebhookService";

export class PartnerEducationService {
  constructor(
    private educationService: EducationService,
    private providerService: ProviderService,
    private userRepository: UserRepository,
    private transactionRepository: TransactionRepository,
    private partnerWebhookService: PartnerWebhookService,
  ) {}

  async purchaseEducation(data: {
    partnerId: string;
    productId: string;
    profileId: string;
    partnerReference?: string;
  }): Promise<any> {
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

    const provider = await this.providerService.getActiveApiProvider(
      TRANSACTION_TYPES.EDUCATION,
    );

    // EducationService uses user.phone — partner's registered phone is used
    const result = await this.educationService.purchase({
      userId: data.partnerId,
      user: partner,
      productId: data.productId,
      profileId: data.profileId,
      provider,
      isPartnerPurchase: true,
partnerReference: data.partnerReference,
    });

    const txn = result.result;
    const transactionId = txn?.id;

    if (transactionId) {
      await this.transactionRepository.update(transactionId.toString(), {
        $set: {
          "meta.isPartnerTransaction": true,
          "meta.partnerReference": data.partnerReference ?? null,
        },
      });
    }

    if (!result.pending && partner.partner.webhookUrl) {
      const log = await this.partnerWebhookService.createWebhookLog({
        userId: data.partnerId,
        event: "education.purchase.success",
        webhookUrl: partner.partner.webhookUrl,
        payload: {
          event: "education.purchase.success",
          transactionReference: txn?.reference,
          partnerReference: data.partnerReference ?? null,
          status: "success",
          product: "education",
          productId: data.productId,
          profileId: data.profileId,
          pin: txn?.metadata?.pin ?? null,
          amount: result.chargeInfo?.totalAmount,
          timestamp: Date.now(),
        },
        transactionId,
        transactionModel: "Transaction",
      });
      if (log) {
        this.partnerWebhookService
          .sendWebhook(log._id)
          .catch((err) =>
            logger.error("Partner education webhook delivery failed", err),
          );
      }
    }

    return {
      success: true,
      transactionReference: txn?.reference,
      partnerReference: data.partnerReference ?? null,
      status: result.pending ? "pending" : "success",
      productId: data.productId,
      profileId: data.profileId,
      pin: result.pending ? null : (txn?.metadata?.pin ?? null),
      amount: result.chargeInfo?.totalAmount,
      timestamp: Date.now(),
    };
  }

  async verifyProfile(data: { number: string; type: string }): Promise<any> {
    return this.educationService.verifyProfile(data);
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
      productId: txn.meta?.productId,
      pin: txn.meta?.pin ?? null,
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
      type: TRANSACTION_TYPES.EDUCATION,
      status: filters.status,
      page,
      limit,
    });
    return {
      data: result.data.map((txn: any) => ({
        transactionReference: txn.reference,
        partnerReference: txn.meta?.partnerReference ?? null,
        status: txn.status,
        productId: txn.meta?.productId,
        amount: txn.amount,
        createdAt: txn.createdAt,
      })),
      total: result.total,
      page,
      limit,
    };
  }

  async getServices(): Promise<any> {
    return this.educationService.getServices?.() ?? [];
  }

  async getProducts(serviceId: string): Promise<any> {
    return this.educationService.getProducts?.(serviceId) ?? [];
  }
}
