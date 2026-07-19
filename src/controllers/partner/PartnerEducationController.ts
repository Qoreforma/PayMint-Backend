import { NextFunction, Response } from "express";
import { AuthenticatedPartnerRequest } from "@/middlewares/partner/partnerAuth";
import { sendPaginatedResponse, sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";
import { PartnerEducationService } from "@/services/partner/PartnerEducationService";

export class PartnerEducationController {
    private partnerEducationService: PartnerEducationService;

    constructor() {
        this.partnerEducationService = ServiceContainer.getPartnerEducationService();
    }

    // GET /partner/education/services
    listServices = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const result = await this.partnerEducationService.getServices();
            sendSuccessResponse(res, result, "Education services retrieved");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/education/products?serviceId=xxx
    listProducts = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { serviceId } = req.query;
            if (!serviceId) {
                res.status(400).json({ success: false, message: "serviceId is required" });
                return;
            }
            const result = await this.partnerEducationService.getProducts(serviceId as string);
            sendSuccessResponse(res, result, "Products retrieved");
        } catch (error) {
            next(error);
        }
    };

    // POST /partner/education/verify
    verifyProfile = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { number, type } = req.body;
            const result = await this.partnerEducationService.verifyProfile({ number, type });
            sendSuccessResponse(res, result, "Profile verified");
        } catch (error) {
            next(error);
        }
    };

    // POST /partner/education/purchase
    purchase = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { productId, profileId, partnerReference } = req.body;
            const result = await this.partnerEducationService.purchaseEducation({
                partnerId: req.partner!.userId,
                productId,
                profileId,
                partnerReference,
            });
            sendSuccessResponse(res, result, "Education purchase initiated");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/education/transactions/:reference
    getTransactionStatus = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const result = await this.partnerEducationService.getTransactionStatus(
                req.partner!.userId,
                req.params.reference,
            );
            sendSuccessResponse(res, result, "Transaction retrieved");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/education/transactions
    listTransactions = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { status, page = "1", limit = "20" } = req.query;
            const result = await this.partnerEducationService.getTransactions(
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