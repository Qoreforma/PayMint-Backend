import { NextFunction, Response } from "express";
import { AuthenticatedPartnerRequest } from "@/middlewares/partner/partnerAuth";
import { sendPaginatedResponse, sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";
import { PartnerBettingService } from "@/services/partner/PartnerBettingService";

export class PartnerBettingController {
    private partnerBettingService: PartnerBettingService;

    constructor() {
        this.partnerBettingService = ServiceContainer.getPartnerBettingService();
    }

    // POST /partner/betting/verify
    verifyAccount = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { customerId, providerId } = req.body;
            const result = await this.partnerBettingService.verifyAccount({
                partnerId: req.partner!.userId,
                customerId,
                providerId,
            });
            sendSuccessResponse(res, result, "Betting account verified");
        } catch (error) {
            next(error);
        }
    };

    // POST /partner/betting/fund
    fundAccount = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { customerId, amount, providerId, partnerReference } = req.body;
            const result = await this.partnerBettingService.fundAccount({
                partnerId: req.partner!.userId,
                customerId,
                amount: Number(amount),
                providerId,
                partnerReference,
            });
            sendSuccessResponse(res, result, "Betting account funded");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/betting/transactions/:reference
    getTransactionStatus = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const result = await this.partnerBettingService.getTransactionStatus(
                req.partner!.userId,
                req.params.reference,
            );
            sendSuccessResponse(res, result, "Transaction retrieved");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/betting/transactions
    listTransactions = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { status, page = "1", limit = "20" } = req.query;
            const result = await this.partnerBettingService.getTransactions(
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