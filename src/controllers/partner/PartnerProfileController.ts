import { NextFunction, Response } from "express";
import { PartnerService } from "@/services/partner/PartnerService";
import { ApiKeyService } from "@/services/partner/ApiKeyService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { AuthenticatedPartnerRequest } from "@/middlewares/partner/partnerAuth";
import { sendErrorResponse, sendSuccessResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";
import { AuthRequest } from "@/middlewares/client/auth";

export class PartnerProfileController {
  private partnerService: PartnerService;
  private apiKeyService: ApiKeyService;

  constructor() {
    this.partnerService = ServiceContainer.getPartnerService();
    this.apiKeyService = ServiceContainer.getApiKeyService();
  }

  // Get partner profile
  getProfile = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        sendErrorResponse(
          res,
          "Partner not authenticated",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.UNAUTHORIZED,
        );
        return;
      }

      const profile = await this.partnerService.getPartnerProfile(userId);

      sendSuccessResponse(res, profile, "Profile retrieved successfully");
    } catch (error: any) {
      next(error);
    }
  };

  // Update webhook URL
  updateWebhook = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { webhookUrl } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        sendErrorResponse(
          res,
          "Partner not authenticated",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.UNAUTHORIZED,
        );
        return;
      }

      const result = await this.partnerService.updatePartnerWebhook(
        userId,
        webhookUrl,
      );

      sendSuccessResponse(res, result, "Webhook updated successfully");
    } catch (error: any) {
      if (error instanceof AppError) {
        next(error);
      }
    }
  };

  // Generate new API key
  generateApiKey = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        sendErrorResponse(
          res,
          "Partner not authenticated",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.UNAUTHORIZED,
        );
        return;
      }

      const result = await this.partnerService.generateApiKey(userId);

      sendSuccessResponse(
        res,
        result,
        "Save your API key and secret. You won't see them again.",
      );
    } catch (error: any) {
      next(error);
    }
  };

  // Get API keys list
  getApiKeys = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        sendErrorResponse(
          res,
          "Partner not authenticated",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.UNAUTHORIZED,
        );
        return;
      }

      const keys = await this.apiKeyService.getUserKeys(userId);

      sendSuccessResponse(res, keys, "API keys retrieved successfully");
    } catch (error: any) {
      next(error);
    }
  };

  // Deactivate API key
  deactivateApiKey = async (
    req: AuthenticatedPartnerRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { keyId } = req.params;

      await this.apiKeyService.deactivateKey(keyId);

      res.json({
        success: true,
        message: "API key deactivated",
      });
    } catch (error: any) {
      next(error);
    }
  };
}
