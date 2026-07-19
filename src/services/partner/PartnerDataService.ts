import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import { UserRepository } from "@/repositories/client/UserRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { DataService } from "../client/billPayment/DataService";
import { PartnerWebhookService } from "./PartnerWebhookService";

export class PartnerDataService {
    constructor(
        private dataService: DataService,
        private userRepository: UserRepository,
        private transactionRepository: TransactionRepository,
        private partnerWebhookService: PartnerWebhookService,
    ) { }

    async purchaseData(data: {
        partnerId: string;
        phone: string;
        productId: string;
        partnerReference?: string;
    }): Promise<any> {
        const partner = await this.userRepository.findById(data.partnerId);
        if (!partner?.partner?.isPartner) {
            throw new AppError("Partner not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.NOT_FOUND);
        }
        if (partner.partner.status !== "active") {
            throw new AppError("Partner account is not active", HTTP_STATUS.FORBIDDEN, ERROR_CODES.INVALID_STATUS);
        }

        // DataService resolves its own provider from the product — no provider param needed
        const result = await this.dataService.purchase({
            userId: data.partnerId,
            phone: data.phone,
            productId: data.productId,
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
                event: "data.purchase.success",
                webhookUrl: partner.partner.webhookUrl,
                payload: {
                    event: "data.purchase.success",
                    transactionReference: txn?.reference,
                    partnerReference: data.partnerReference ?? null,
                    status: "success",
                    product: "data",
                    phone: data.phone,
                    productId: data.productId,
                    amount: result.chargeInfo?.totalAmount,
                    timestamp: Date.now(),
                },
                transactionId,
                transactionModel: "Transaction",
            });
            if (log) {
                this.partnerWebhookService.sendWebhook(log._id).catch((err) =>
                    logger.error("Partner data webhook delivery failed", err),
                );
            }
        }

        return {
            success: true,
            transactionReference: txn?.reference,
            partnerReference: data.partnerReference ?? null,
            status: result.pending ? "pending" : "success",
            phone: data.phone,
            productId: data.productId,
            amount: result.chargeInfo?.totalAmount,
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
            phone: txn.meta?.phone,
            productName: txn.meta?.productName,
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
            type: TRANSACTION_TYPES.DATA,
            status: filters.status,
            page,
            limit,
        });
        return {
            data: result.data.map((txn: any) => ({
                transactionReference: txn.reference,
                partnerReference: txn.meta?.partnerReference ?? null,
                status: txn.status,
                phone: txn.meta?.phone,
                productName: txn.meta?.productName,
                amount: txn.amount,
                createdAt: txn.createdAt,
            })),
            total: result.total,
            page,
            limit,
        };
    }

    async getNetworks(): Promise<any> {
        return this.dataService.getProviders();
    }

    async getProducts(serviceId: string, dataType?: string): Promise<any> {
        return this.dataService.getProducts(serviceId, dataType);
    }
}