import { NextFunction, Response } from "express";
import { AuthenticatedPartnerRequest } from "@/middlewares/partner/partnerAuth";
import { sendErrorResponse, sendPaginatedResponse, sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";
import { PartnerAirtimeService } from "@/services/partner/PartnerAirtimeService";

export class PartnerAirtimeController {
    private partnerAirtimeService: PartnerAirtimeService;

    constructor() {
        this.partnerAirtimeService = ServiceContainer.getPartnerAirtimeService();
    }

    // GET /partner/airtime/networks
    listNetworks = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const networks = await this.partnerAirtimeService.getNetworks();
            sendSuccessResponse(res, networks, "Networks retrieved");
        } catch (error) {
            next(error);
        }
    };

    // POST /partner/airtime/purchase
    purchase = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const partnerId = req.partner!.userId;
            const { phone, amount, network, partnerReference } = req.body;

            const result = await this.partnerAirtimeService.purchaseAirtime({
                partnerId,
                phone,
                amount: Number(amount),
                network,
                partnerReference,
            });

            sendSuccessResponse(res, result, "Airtime purchase initiated");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/airtime/transactions/:reference
    getTransactionStatus = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const partnerId = req.partner!.userId;
            const { reference } = req.params;

            const result = await this.partnerAirtimeService.getTransactionStatus(
                partnerId,
                reference,
            );

            sendSuccessResponse(res, result, "Transaction retrieved");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/airtime/transactions
    listTransactions = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const partnerId = req.partner!.userId;
            const { status, page = "1", limit = "20" } = req.query;

            const result = await this.partnerAirtimeService.getTransactions(
                partnerId,
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