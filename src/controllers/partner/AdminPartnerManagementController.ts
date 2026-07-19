import { NextFunction, Request, Response } from "express";
import { PartnerService } from "@/services/partner/PartnerService";
import { UserRepository } from "@/repositories/client/UserRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { sendSuccessResponse } from "@/utils/helpers";
import AdminServiceContainer from "@/services/admin/container";
import ServiceContainer from "@/services/client/container";

export class AdminPartnerManagementController {
  private partnerService: PartnerService;
  private userRepository: UserRepository;
  constructor() {
    this.partnerService = ServiceContainer.getPartnerService();
    this.userRepository = ServiceContainer.getUserRepository();
  }

  // Admin: Attach partner to existing user
  attachPartnerToUser = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { userId } = req.params;
      const { companyName, contactPerson } = req.body;

      const result = await this.partnerService.attachPartnerToUser(userId, {
        companyName,
        contactPerson,
      });
      sendSuccessResponse(res, result, "Partner Attached to user");
    } catch (error: any) {
      next(error);
    }
  };

  // Admin: Approve pending partner
  approvePartner = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { userId } = req.params;

      const result = await this.partnerService.approvePartner(userId);

      sendSuccessResponse(res, result, "Partner Approved Successfully");
    } catch (error: any) {
      next(error);
    }
  };

  // Admin: Suspend partner
  suspendPartner = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { userId } = req.params;

      const result = await this.partnerService.suspendPartner(userId);

      sendSuccessResponse(res, result, "Partner Suspended Successfully ");
    } catch (error: any) {
      next(error);
    }
  };

  // Admin: Get partner details
  getPartner = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { userId } = req.params;

      const partner = await this.partnerService.getPartnerProfile(userId);

      sendSuccessResponse(res, partner, "Partner Fetched Successfully ");
    } catch (error: any) {
      next(error);
    }
  };

  // Admin: Generate API key for partner
  generateApiKeyForPartner = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { userId } = req.params;

      const result = await this.partnerService.generateApiKey(userId);

      sendSuccessResponse(res, result, "Api Key Generated");
    } catch (error: any) {
      next(error);
    }
  };
}
