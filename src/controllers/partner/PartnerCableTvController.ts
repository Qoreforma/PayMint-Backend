import { NextFunction, Response } from "express";
import { AuthenticatedPartnerRequest } from "@/middlewares/partner/partnerAuth";
import { sendPaginatedResponse, sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";
import { PartnerCableTvService } from "@/services/partner/PartnerCableTvService";

export class PartnerCableTvController {
    private partnerCableTvService: PartnerCableTvService;

    constructor() {
        this.partnerCableTvService = ServiceContainer.getPartnerCableTvService();
    }

    // POST /partner/cabletv/verify
    verifySmartCard = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { smartCardNumber, serviceCode, serviceProvider } = req.body;
            const result = await this.partnerCableTvService.verifySmartCard({
                smartCardNumber,
                serviceCode,
                serviceProvider,
            });
            sendSuccessResponse(res, result, "Smart card verified");
        } catch (error) {
            next(error);
        }
    };

    // POST /partner/cabletv/purchase
    purchase = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { provider, smartCardNumber, productId, type, partnerReference } = req.body;
            const result = await this.partnerCableTvService.purchaseCableTv({
                partnerId: req.partner!.userId,
                provider,
                smartCardNumber,
                productId,
                type,
                partnerReference,
            });
            sendSuccessResponse(res, result, "Cable TV purchase initiated");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/cabletv/transactions/:reference
    getTransactionStatus = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const result = await this.partnerCableTvService.getTransactionStatus(
                req.partner!.userId,
                req.params.reference,
            );
            sendSuccessResponse(res, result, "Transaction retrieved");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/cabletv/transactions
    listTransactions = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { status, page = "1", limit = "20" } = req.query;
            const result = await this.partnerCableTvService.getTransactions(
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