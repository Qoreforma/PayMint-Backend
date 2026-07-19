import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import { UserRepository } from "@/repositories/client/UserRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { ElectricityService } from "../client/billPayment/ElectricityService";
import { ProviderService } from "../client/ProviderService";
import { PartnerWebhookService } from "./PartnerWebhookService";

export class PartnerElectricityService {
    constructor(
        private electricityService: ElectricityService,
        private providerService: ProviderService,
        private userRepository: UserRepository,
        private transactionRepository: TransactionRepository,
        private partnerWebhookService: PartnerWebhookService,
    ) { }

    async purchaseElectricity(data: {
        partnerId: string;
        meterNumber: string;
        providerId: string; // service code e.g. "ekedc-prepaid"
        amount: number;
        meterType: string; // "prepaid" | "postpaid"
        phone: string;
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
            TRANSACTION_TYPES.ELECTRICITY,
        );

        const result = await this.electricityService.purchase({
            userId: data.partnerId,
            meterNumber: data.meterNumber,
            providerId: data.providerId,
            amount: data.amount,
            meterType: data.meterType,
            phone: data.phone,
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
            const payload: any = {
                event: "electricity.purchase.success",
                transactionReference: txn?.reference,
                partnerReference: data.partnerReference ?? null,
                status: "success",
                product: "electricity",
                meterNumber: data.meterNumber,
                meterType: data.meterType,
                amount: data.amount,
                token: txn?.metadata?.token ?? null,
                timestamp: Date.now(),
            };

            const log = await this.partnerWebhookService.createWebhookLog({
                userId: data.partnerId,
                event: "electricity.purchase.success",
                webhookUrl: partner.partner.webhookUrl,
                payload,
                transactionId,
                transactionModel: "Transaction",
            });
            if (log) {
                this.partnerWebhookService.sendWebhook(log._id).catch((err) =>
                    logger.error("Partner electricity webhook delivery failed", err),
                );
            }
        }

        return {
            success: true,
            transactionReference: txn?.reference,
            partnerReference: data.partnerReference ?? null,
            status: result.pending ? "pending" : "success",
            meterNumber: data.meterNumber,
            meterType: data.meterType,
            amount: data.amount,
            token: result.pending ? null : txn?.metadata?.token ?? null,
            timestamp: Date.now(),
        };
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
            meterNumber: txn.meta?.meterNumber,
            meterType: txn.meta?.meterType,
            amount: txn.amount,
            token: txn.meta?.token ?? null,
            customerName: txn.meta?.customerName ?? null,
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
            type: TRANSACTION_TYPES.ELECTRICITY,
            status: filters.status,
            page,
            limit,
        });
        return {
            data: result.data.map((txn: any) => ({
                transactionReference: txn.reference,
                partnerReference: txn.meta?.partnerReference ?? null,
                status: txn.status,
                meterNumber: txn.meta?.meterNumber,
                amount: txn.amount,
                token: txn.meta?.token ?? null,
                createdAt: txn.createdAt,
            })),
            total: result.total,
            page,
            limit,
        };
    }
}