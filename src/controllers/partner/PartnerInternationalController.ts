import { NextFunction, Response } from "express";
import { AuthenticatedPartnerRequest } from "@/middlewares/partner/partnerAuth";
import { sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";
import { PartnerInternationalService } from "@/services/partner/PartnerInternationalService";

export class PartnerInternationalController {
    private partnerInternationalService: PartnerInternationalService;

    constructor() {
        this.partnerInternationalService = ServiceContainer.getPartnerInternationalService();
    }

    // ── Airtime listing ──────────────────────────────────────────

    // GET /partner/intl-airtime/countries
    getAirtimeCountries = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const result = await this.partnerInternationalService.getAirtimeCountries();
            sendSuccessResponse(res, result, "Countries retrieved");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/intl-airtime/providers?countryCode=NG
    getAirtimeProviders = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { countryCode } = req.query;
            if (!countryCode) {
                res.status(400).json({ success: false, message: "countryCode is required" });
                return;
            }
            const result = await this.partnerInternationalService.getAirtimeProviders(
                countryCode as string,
            );
            sendSuccessResponse(res, result, "Providers retrieved");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/intl-airtime/products?providerId=xxx&productTypeId=1
    getAirtimeProducts = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { providerId, productTypeId } = req.query;
            if (!providerId || !productTypeId) {
                res.status(400).json({ success: false, message: "providerId and productTypeId are required" });
                return;
            }
            const result = await this.partnerInternationalService.getAirtimeProducts(
                providerId as string,
                parseInt(productTypeId as string),
            );
            sendSuccessResponse(res, result, "Products retrieved");
        } catch (error) {
            next(error);
        }
    };

    // POST /partner/intl-airtime/purchase
    purchaseAirtime = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { phone, productCode, operatorId, countryCode, countryName, amount, partnerReference } = req.body;
            const result = await this.partnerInternationalService.purchaseData({
                partnerId: req.partner!.userId,
                phone,
                productCode,
                operatorId,
                countryCode,
                countryName,
                amount: Number(amount),
                partnerReference,
            });
            sendSuccessResponse(res, result, "International airtime purchase initiated");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/intl-airtime/transactions/:reference
    getAirtimeTransactionStatus = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const result = await this.partnerInternationalService.getTransactionStatus(
                req.partner!.userId,
                req.params.reference,
            );
            sendSuccessResponse(res, result, "Transaction retrieved");
        } catch (error) {
            next(error);
        }
    };

    // ── Data listing ─────────────────────────────────────────────

    // GET /partner/intl-data/countries
    getDataCountries = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const result = await this.partnerInternationalService.getDataCountries();
            sendSuccessResponse(res, result, "Countries retrieved");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/intl-data/providers?countryCode=NG
    getDataProviders = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { countryCode } = req.query;
            if (!countryCode) {
                res.status(400).json({ success: false, message: "countryCode is required" });
                return;
            }
            const result = await this.partnerInternationalService.getDataProviders(
                countryCode as string,
            );
            sendSuccessResponse(res, result, "Providers retrieved");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/intl-data/products?operator=xxx
    getDataProducts = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { operator } = req.query;
            if (!operator) {
                res.status(400).json({ success: false, message: "operator is required" });
                return;
            }
            const result = await this.partnerInternationalService.getDataProducts(
                operator as string,
            );
            sendSuccessResponse(res, result, "Products retrieved");
        } catch (error) {
            next(error);
        }
    };

    // POST /partner/intl-data/purchase
    purchaseData = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { phone, productCode, operatorId, countryCode, countryName, amount, partnerReference } = req.body;
            const result = await this.partnerInternationalService.purchaseData({
                partnerId: req.partner!.userId,
                phone,
                productCode,
                operatorId,
                countryCode,
                countryName,
                amount: Number(amount),
                partnerReference,
            });
            sendSuccessResponse(res, result, "International data purchase initiated");
        } catch (error) {
            next(error);
        }
    };

    // GET /partner/intl-data/transactions/:reference
    getDataTransactionStatus = async (
        req: AuthenticatedPartnerRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const result = await this.partnerInternationalService.getTransactionStatus(
                req.partner!.userId,
                req.params.reference,
            );
            sendSuccessResponse(res, result, "Transaction retrieved");
        } catch (error) {
            next(error);
        }
    };
}