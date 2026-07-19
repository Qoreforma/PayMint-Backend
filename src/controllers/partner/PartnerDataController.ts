import { NextFunction, Response } from "express";
import { AuthenticatedPartnerRequest } from "@/middlewares/partner/partnerAuth";
import { sendPaginatedResponse, sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";
import { PartnerDataService } from "@/services/partner/PartnerDataService";

export class PartnerDataController {
    private partnerDataService: PartnerDataService;

    constructor() {
        this.partnerDataService = ServiceContainer.getPartnerDataService();
    }

    // GET /partner/data/networks
    listNetworks = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const networks = await this.partnerDataService.getNetworks();
            sendSuccessResponse(res, networks, "Networks retrieved");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/data/products?serviceId=xxx&dataType=xxx
    listProducts = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { serviceId, dataType } = req.query;
            if (!serviceId) {
                res.status(400).json({ success: false, message: "serviceId is required" });
                return;
            }
            const products = await this.partnerDataService.getProducts(
                serviceId as string,
                dataType as string | undefined,
            );
            sendSuccessResponse(res, products, "Products retrieved");
        } catch (error) {
            next(error);
        }
    };

    // POST /partner/data/purchase
    purchase = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const partnerId = req.partner!.userId;
            const { phone, productId, partnerReference } = req.body;

            const result = await this.partnerDataService.purchaseData({
                partnerId,
                phone,
                productId,
                partnerReference,
            });

            sendSuccessResponse(res, result, "Data purchase initiated");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/data/transactions/:reference
    getTransactionStatus = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const result = await this.partnerDataService.getTransactionStatus(
                req.partner!.userId,
                req.params.reference,
            );
            sendSuccessResponse(res, result, "Transaction retrieved");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/data/transactions
    listTransactions = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { status, page = "1", limit = "20" } = req.query;
            const result = await this.partnerDataService.getTransactions(
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