import { NextFunction, Response } from "express";
import { PartnerDashboardService } from "@/services/partner/PartnerDashboardService";
import logger from "@/logger";
import { sendPaginatedResponse, sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";
import { AuthRequest } from "@/middlewares/client/auth";

export class PartnerDashboardController {
  private dashboardService: PartnerDashboardService;
  constructor() {
    this.dashboardService = ServiceContainer.getPartnerDashboardService();
  }

  // GET: Dashboard overview
  getDashboard = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // const partnerId = req.partner!.userId!;
      const partnerId = req.user?.id!;
      const { startDate, endDate, period } = req.query;

      const stats = await this.dashboardService.getDashboardStats(partnerId, {
        startDate: startDate as string,
        endDate: endDate as string,
        period: period as any,
      });

      sendSuccessResponse(res, stats, "Dashboard retrieved successfully");
    } catch (error: any) {
      logger.error("Failed to get dashboard", error);
      next(error);
    }
  };

  // GET: Wallet details
  getWallet = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // const partnerId = req.partner!.userId!;
      const partnerId = req.user?.id!;

      const wallet = await this.dashboardService.getWalletDetails(partnerId);

      sendSuccessResponse(res, wallet, "Wallet retrieved successfully");
    } catch (error: any) {
      logger.error("Failed to get wallet", error);
      next(error);
    }
  };

  // GET: Transaction details
  getTransactionDetails = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { reference } = req.params;
      // const partnerId = req.partner!.userId!;
      const partnerId = req.user?.id!;

      const details = await this.dashboardService.getTransactionDetails(
        partnerId,
        reference,
      );
      sendSuccessResponse(res, details, "Transaction details retrieved");
    } catch (error: any) {
      logger.error("Failed to get transaction details", error);
      next(error);
    }
  };

  // GET: Webhook history
  getWebhookHistory = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { page = 1, limit = 20 } = req.query;
      // const partnerId = req.partner!.userId!;
      const partnerId = req.user?.id!;

      const history = await this.dashboardService.getWebhookHistory(
        partnerId,
        parseInt(page as string),
        parseInt(limit as string),
      );

      sendPaginatedResponse(res, history.data, {
        page: history.page,
        limit: history.limit,
        total: history.total,
      });
    } catch (error: any) {
      logger.error("Failed to get webhook history", error);
      next(error);
    }
  };
}
