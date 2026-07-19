import { Request, Response, NextFunction } from "express";
import Sentry from "@/config/sentry";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import { decryptApiSecret } from "@/utils/cryptography";

export interface SignedRequest extends Request {
  rawBody?: string;
}

export const partnerSignatureVerification = () => {
  const apiKeyRepository = ServiceContainer.getApiKeyRepository();
  const apiKeyService = ServiceContainer.getApiKeyService();
  return async (
    req: SignedRequest & { partner?: any },
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const signature = req.headers["x-signature"] as string;
      const timestamp = req.headers["x-timestamp"] as string;

      if (!signature || !timestamp) {
        try {
          Sentry.captureMessage(
            `Webhook signature verification: missing headers`,
            {
              level: "warning",
              tags: {
                event: "webhook_missing_headers",
                hasSignature: !!signature,
                hasTimestamp: !!timestamp,
                ip: req.ip || "unknown",
              },
            },
          );
        } catch (sentryErr) {
          logger.error(
            "[Sentry] Failed to capture missing headers:",
            sentryErr,
          );
        }

        throw new AppError(
          "Signature and timestamp required",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Check timestamp is within 5 minutes
      const requestTime = parseInt(timestamp);
      const currentTime = Date.now();
      const timeDiff = Math.abs(currentTime - requestTime);
      const maxAge = 5 * 60 * 1000;

      if (timeDiff > maxAge) {
        try {
          Sentry.captureMessage(
            `Webhook signature verification: request expired (replay attack attempt)`,
            {
              level: "warning",
              tags: {
                event: "webhook_replay_attempt",
                timeDiffMs: timeDiff.toString(),
                ip: req.ip || "unknown",
              },
            },
          );
        } catch (sentryErr) {
          logger.error("[Sentry] Failed to capture replay attempt:", sentryErr);
        }

        throw new AppError(
          "Request expired. Timestamp outside 5 minute window",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Use raw body if available, otherwise stringify
      const body =
        req.method === "GET" || !req.body || Object.keys(req.body).length === 0
          ? ""
          : req.rawBody; // Use rawBody, NOT JSON.stringify(req.body)

      const message = `${timestamp}.${body}`;

      // Get partner's API secret from database
      if (!req.partner?.keyId) {
        throw new AppError(
          "Partner not authenticated",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.UNAUTHORIZED,
        );
      }

      const apiKeyRecord = await apiKeyRepository.findById(
        req.partner.keyId,
        undefined,
        "apiSecret",
      );

      if (!apiKeyRecord) {
        throw new AppError(
          "API key not found",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.UNAUTHORIZED,
        );
      }

      // apiSecret is stored encrypted at rest — decrypt before HMAC verification
      const decryptedSecret = decryptApiSecret(apiKeyRecord.apiSecret);

      // Verify signature
      const isValid = await apiKeyService.verifySignature(
        decryptedSecret,
        message,
        signature,
      );

      if (!isValid) {
        try {
          Sentry.captureMessage(`Webhook signature verification failed`, {
            level: "warning",
            tags: {
              event: "webhook_signature_failure",
              partnerId: req.partner!.userId,
              ip: req.ip || "unknown",
            },
            contexts: {
              webhookSecurity: {
                signatureMatch: false,
                timestampValid: true,
              },
            },
          });
        } catch (sentryErr) {
          logger.error(
            "[Sentry] Failed to capture signature failure:",
            sentryErr,
          );
        }

        throw new AppError(
          "Invalid signature",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.UNAUTHORIZED,
        );
      }

      next();
    } catch (error: any) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.errorCode,
            message: error.message,
          },
        });
      }

      logger.error("Signature verification failed", error);

      try {
        Sentry.captureException(error, {
          tags: {
            event: "webhook_verification_error",
            ip: req.ip || "unknown",
          },
        });
      } catch (sentryErr) {
        logger.error(
          "[Sentry] Failed to capture verification exception:",
          sentryErr,
        );
      }

      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: ERROR_CODES.UNAUTHORIZED,
          message: "Unauthorized",
        },
      });
    }
  };
};
