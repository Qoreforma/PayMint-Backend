import { NextFunction, Request, Response } from "express";
import { PartnerService } from "@/services/partner/PartnerService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import { sendSuccessResponse } from "@/utils/helpers";

export class PartnerAuthController {
  private partnerService: PartnerService;

  constructor() {
    this.partnerService = ServiceContainer.getPartnerService();
  }

  // Self-register as partner
  register = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const {
        firstname,
        lastname,
        email,
        password,
        phone,
        companyName,
        contactPerson,
      } = req.body;

      const result = await this.partnerService.selfRegisterPartner({
        firstname,
        lastname,
        email,
        password,
        phone,
        companyName,
        contactPerson,
      });

      sendSuccessResponse(
        res,
        result,
        "Partner registration successful. Awaiting admin approval.",
        HTTP_STATUS.CREATED,
      );
    } catch (error: any) {
      next(error);
    }
  };
}
