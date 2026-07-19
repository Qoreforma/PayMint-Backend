import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import { UserRepository } from "@/repositories/client/UserRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { InternationalService } from "../client/billPayment/InternationalService";
import { ProviderService } from "../client/ProviderService";
import { PartnerWebhookService } from "./PartnerWebhookService";

export class PartnerInternationalService {
  constructor(
    private internationalService: InternationalService,
    private providerService: ProviderService,
    private userRepository: UserRepository,
    private transactionRepository: TransactionRepository,
    private partnerWebhookService: PartnerWebhookService,
  ) {}

  private async validatePartner(partnerId: string) {
    const partner = await this.userRepository.findById(partnerId);
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
    return partner;
  }

  private async fireWebhook(
    partnerId: string,
    webhookUrl: string,
    event: string,
    payload: any,
    transactionId: any,
  ) {
    const log = await this.partnerWebhookService.createWebhookLog({
      userId: partnerId,
      event,
      webhookUrl,
      payload: { event, ...payload, timestamp: Date.now() },
      transactionId,
      transactionModel: "Transaction",
    });
    if (log) {
      this.partnerWebhookService
        .sendWebhook(log._id)
        .catch((err) =>
          logger.error(`Partner ${event} webhook delivery failed`, err),
        );
    }
  }

  async purchaseAirtime(data: {
    partnerId: string;
    phone: string;
    amount: number;
    countryCode: string;
    operatorId: string;
    productCode: string;
    partnerReference?: string;
    countryName?: string;
    variationCode?: string;
  }): Promise<any> {
    const partner = await this.validatePartner(data.partnerId);

    const provider = await this.providerService.getActiveApiProvider(
      TRANSACTION_TYPES.INTERNATIONALAIRTIME,
    );

    // Use partner's registered email for provider receipt
    const result = await this.internationalService.purchaseAirtime({
      userId: data.partnerId,
      phone: data.phone,
      amount: data.amount,
      countryCode: data.countryCode,
      operatorId: data.operatorId,
      email: partner.email,
      productCode: data.productCode,
      provider,
      countryName: data.countryName,
      variationCode: data.variationCode,
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

    if (!result.pending && partner?.partner?.webhookUrl) {
      await this.fireWebhook(
        data.partnerId,
        partner.partner.webhookUrl,
        "intl_airtime.purchase.success",
        {
          transactionReference: txn?.reference,
          partnerReference: data.partnerReference ?? null,
          status: "success",
          product: "intl_airtime",
          phone: data.phone,
          countryCode: data.countryCode,
          amount: data.amount,
        },
        transactionId,
      );
    }

    return {
      success: true,
      transactionReference: txn?.reference,
      partnerReference: data.partnerReference ?? null,
      status: result.pending ? "pending" : "success",
      phone: data.phone,
      countryCode: data.countryCode,
      amount: data.amount,
      timestamp: Date.now(),
    };
  }

  async purchaseData(data: {
    partnerId: string;
    phone: string;
    productCode: string;
    operatorId: string;
    countryCode: string;
    countryName: string;
    amount: number;
    partnerReference?: string;
  }): Promise<any> {
    const partner = await this.validatePartner(data.partnerId);

    const provider = await this.providerService.getActiveApiProvider(
      TRANSACTION_TYPES.INTERNATIONALDATA,
    );

    const result = await this.internationalService.purchaseData({
      userId: data.partnerId,
      phone: data.phone,
      productCode: data.productCode,
      operatorId: data.operatorId,
      countryCode: data.countryCode,
      countryName: data.countryName,
      amount: data.amount,
      email: partner.email,
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
    if (partner.partner) {
      if (!result.pending && partner.partner.webhookUrl) {
        await this.fireWebhook(
          data.partnerId,
          partner.partner.webhookUrl,
          "intl_data.purchase.success",
          {
            transactionReference: txn?.reference,
            partnerReference: data.partnerReference ?? null,
            status: "success",
            product: "intl_data",
            phone: data.phone,
            countryCode: data.countryCode,
            amount: data.amount,
          },
          transactionId,
        );
      }
    }
    return {
      success: true,
      transactionReference: txn?.reference,
      partnerReference: data.partnerReference ?? null,
      status: result.pending ? "pending" : "success",
      phone: data.phone,
      countryCode: data.countryCode,
      amount: data.amount,
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
      countryCode: txn.meta?.countryCode,
      amount: txn.amount,
      createdAt: txn.createdAt,
      updatedAt: txn.updatedAt,
    };
  }

  // Listing helpers — read-only, no provider resolution needed
  async getAirtimeCountries() {
    return this.internationalService.getAirtimeCountries();
  }
  async getAirtimeProviders(countryCode: string) {
    return this.internationalService.getAirtimeProviders(countryCode);
  }
  async getAirtimeProducts(providerId: string, productTypeId: number) {
    return this.internationalService.getAirtimeProducts(
      providerId,
      productTypeId,
    );
  }
  async getDataCountries() {
    return this.internationalService.getDataCountries();
  }
  async getDataProviders(countryCode: string) {
    return this.internationalService.getDataProviders(countryCode);
  }
  async getDataProducts(operator: string) {
    return this.internationalService.getDataProducts(operator);
  }
}
