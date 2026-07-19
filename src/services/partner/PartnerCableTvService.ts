import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import { UserRepository } from "@/repositories/client/UserRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { CableTvService } from "../client/billPayment/CableTvService";
import { ProviderService } from "../client/ProviderService";
import { PartnerWebhookService } from "./PartnerWebhookService";
import { ProviderDTO } from "@/middlewares/shared/checkServiceAvailability";

export class PartnerCableTvService {
    constructor(
        private cableTvService: CableTvService,
        private providerService: ProviderService,
        private userRepository: UserRepository,
        private transactionRepository: TransactionRepository,
        private partnerWebhookService: PartnerWebhookService,
    ) { }

    async purchaseCableTv(data: {
        partnerId: string;
        provider: string;        // e.g. "dstv", "gotv"
        smartCardNumber: string;
        productId: string;
        type: "renew" | "change";
        partnerReference?: string;
    }): Promise<any> {
        const partner = await this.userRepository.findById(data.partnerId);
        if (!partner?.partner?.isPartner) {
            throw new AppError("Partner not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
        }
        if (partner.partner.status !== "active") {
            throw new AppError("Partner account is not active", HTTP_STATUS.FORBIDDEN, ERROR_CODES.INVALID_STATUS);
        }

        const serviceProvider = await this.providerService.getActiveApiProvider(
            TRANSACTION_TYPES.CABLE,
        );

        // CableTvService uses user.phone for delivery SMS — partner's registered phone is correct here
        const result = await this.cableTvService.purchase({
            userId: data.partnerId,
            user: partner,
            provider: data.provider,
            smartCardNumber: data.smartCardNumber,
            productId: data.productId,
            type: data.type,
            serviceProvider,
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
                event: "cabletv.purchase.success",
                webhookUrl: partner.partner.webhookUrl,
                payload: {
                    event: "cabletv.purchase.success",
                    transactionReference: txn?.reference,
                    partnerReference: data.partnerReference ?? null,
                    status: "success",
                    product: "cabletv",
                    smartCardNumber: data.smartCardNumber,
                    provider: data.provider,
                    amount: result.chargeInfo?.totalAmount,
                    timestamp: Date.now(),
                },
                transactionId,
                transactionModel: "Transaction",
            });
            if (log) {
                this.partnerWebhookService.sendWebhook(log._id).catch((err) =>
                    logger.error("Partner cabletv webhook delivery failed", err),
                );
            }
        }

        return {
            success: true,
            transactionReference: txn?.reference,
            partnerReference: data.partnerReference ?? null,
            status: result.pending ? "pending" : "success",
            smartCardNumber: data.smartCardNumber,
            provider: data.provider,
            amount: result.chargeInfo?.totalAmount,
            timestamp: Date.now(),
        };
    }

    async verifySmartCard(data: {
        smartCardNumber: string;
        serviceCode: string;
        serviceProvider: ProviderDTO;
    }): Promise<any> {
        return this.cableTvService.verifySmartCard(
            data.smartCardNumber,
            data.serviceCode,
            data.serviceProvider,
        );
    }

    async getTransactionStatus(partnerId: string, transactionReference: string): Promise<any> {
        const txn = await this.transactionRepository.findByReference(transactionReference);
        if (!txn || txn.sourceId?.toString() !== partnerId) {
            throw new AppError("Transaction not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
        }
        return {
            transactionReference: txn.reference,
            partnerReference: txn.meta?.partnerReference ?? null,
            status: txn.status,
            smartCardNumber: txn.meta?.smartCardNumber,
            provider: txn.meta?.provider,
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
            type: TRANSACTION_TYPES.CABLE,
            status: filters.status,
            page,
            limit,
        });
        return {
            data: result.data.map((txn: any) => ({
                transactionReference: txn.reference,
                partnerReference: txn.meta?.partnerReference ?? null,
                status: txn.status,
                smartCardNumber: txn.meta?.smartCardNumber,
                provider: txn.meta?.provider,
                amount: txn.amount,
                createdAt: txn.createdAt,
            })),
            total: result.total,
            page,
            limit,
        };
    }
}