import { Request, Response, NextFunction } from "express";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { PartnerCommissionService } from "@/services/partner/PartnerCommissionService";
import ServiceContainer from "@/services/client/container";

export class AdminPartnerCommissionController {
  private commissionService: PartnerCommissionService;

  constructor() {
    this.commissionService = ServiceContainer.getPartnerCommissionService();
  }

  // GET /admin/partner/commissions
  listCommissions = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const { providerId, serviceId, status, code } = req.query;
      const result = await this.commissionService.listCommissions(
        page,
        limit,
        providerId as string,
        serviceId as string,
        status as string,
        code as string,
      );
      sendPaginatedResponse(res, result.data, {
        total: result.total,
        page,
        limit,
      });
    } catch (error) {
      next(error);
    }
  };

  bulkUpdateCommissions = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { ids, data } = req.body;
      const result = await this.commissionService.bulkUpdateCommissions(
        ids,
        data,
      );
      sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  // GET /admin/partner/commissions/:id
  getCommission = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const commission = await this.commissionService.getCommissionById(
        req.params.id,
      );
      sendSuccessResponse(res, commission, "Commission retrieved");
    } catch (error) {
      next(error);
    }
  };

  // POST /admin/partner/commissions
  upsertCommission = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { providerId, serviceId, name, type, value, active } = req.body;
      const commission = await this.commissionService.upsertCommission({
        providerId,
        serviceId,
        name,
        type,
        value: Number(value),
        active,
      });
      sendSuccessResponse(res, commission, "Commission saved");
    } catch (error) {
      next(error);
    }
  };

  // PATCH /admin/partner/commissions/:id/toggle
  toggleCommission = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const commission = await this.commissionService.toggleCommission(
        req.params.id,
        Boolean(req.body.active),
      );
      sendSuccessResponse(res, commission, "Commission updated");
    } catch (error) {
      next(error);
    }
  };
}
