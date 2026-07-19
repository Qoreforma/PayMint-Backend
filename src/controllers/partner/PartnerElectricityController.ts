import { NextFunction, Response } from "express";
import { AuthenticatedPartnerRequest } from "@/middlewares/partner/partnerAuth";
import { sendPaginatedResponse, sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";
import { PartnerElectricityService } from "@/services/partner/PartnerElectricityService";

export class PartnerElectricityController {
    private partnerElectricityService: PartnerElectricityService;

    constructor() {
        this.partnerElectricityService = ServiceContainer.getPartnerElectricityService();
    }

    // POST /partner/electricity/purchase
    purchase = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { meterNumber, providerId, amount, meterType, phone, partnerReference } = req.body;
            const result = await this.partnerElectricityService.purchaseElectricity({
                partnerId: req.partner!.userId,
                meterNumber,
                providerId,
                amount: Number(amount),
                meterType,
                phone,
                partnerReference,
            });
            sendSuccessResponse(res, result, "Electricity purchase initiated");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/electricity/transactions/:reference
    getTransactionStatus = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const result = await this.partnerElectricityService.getTransactionStatus(
                req.partner!.userId,
                req.params.reference,
            );
            sendSuccessResponse(res, result, "Transaction retrieved");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/electricity/transactions
    listTransactions = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { status, page = "1", limit = "20" } = req.query;
            const result = await this.partnerElectricityService.getTransactions(
                req.partner!.userId,
                {
                    status: status as string | undefined,
                    page: parseInt(page as string),
                    limit: parseInt(limit as string),
                },
            );
            sendPaginatedResponse(res, result.data, {
                total: result.total,
                page: parseInt(page as string),
                limit: parseInt(limit as string),
            });
        } catch (error) {
            next(error);
        }
    };
}