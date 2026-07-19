import { Request, Response, NextFunction } from "express";
import Sentry from "@/config/sentry";
import { ApiKeyService } from "@/services/partner/ApiKeyService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { ApiKeyRepository } from "@/repositories/partner/ApiKeyRepository";
import ServiceContainer from "@/services/client/container";
import { sendErrorResponse } from "@/utils/helpers";

export interface AuthenticatedPartnerRequest extends Request {
  partner?: {
    userId: string;
    keyId: string;
    user: any;
  };
}

export const partnerAuth = () => {
  const apiKeyRepository = ServiceContainer.getApiKeyRepository();
  const apiKeyService = ServiceContainer.getApiKeyService();
  return async (
    req: AuthenticatedPartnerRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const apiKey = req.headers["x-api-key"] as string;
      if (!apiKey) {
        try {
          Sentry.captureMessage(`Partner API key missing from request`, {
            level: "warning",
            tags: {
              event: "missing_api_key",
              route: req.path,
              ip: req.ip || "unknown",
            },
          });
        } catch (sentryErr) {
          logger.error(
            "[Sentry] Failed to capture missing API key:",
            sentryErr,
          );
        }

        throw new AppError(
          "API key required",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.UNAUTHORIZED,
        );
      }

      // Verify API key and get partner
      const partner = await apiKeyService.verifyApiKey(apiKey);

      // Attach to request
      req.partner = partner;

      try {
        Sentry.setUser({
          id: partner.userId,
          username: `partner_${partner.userId}`,
          partnerId: partner.keyId,
        });
      } catch (err) {
        logger.error("[Sentry] Failed to set partner context:", err);
      }

      // Update last used
      await apiKeyRepository.updateLastUsed(partner.keyId, req.ip || "unknown");

      next();
    } catch (error: any) {
      if (error instanceof AppError) {
        try {
          Sentry.captureMessage(
            `Partner API key verification failed: ${error.message}`,
            {
              level: "warning",
              tags: {
                event: "invalid_api_key",
                route: req.path,
                ip: req.ip || "unknown",
              },
            },
          );
        } catch (sentryErr) {
          logger.error(
            "[Sentry] Failed to capture API key failure:",
            sentryErr,
          );
        }

        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.errorCode,
            message: error.message,
          },
        });
      }

      logger.error("Partner auth failed", error);
      try {
        Sentry.captureException(error, {
          tags: {
            event: "partner_auth_error",
            route: req.path,
            ip: req.ip || "unknown",
          },
        });
      } catch (sentryErr) {
        logger.error(
          "[Sentry] Failed to capture partner auth exception:",
          sentryErr,
        );
      }

      sendErrorResponse(
        res,
        "Unauthorized",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
      );
    }
  };
};
