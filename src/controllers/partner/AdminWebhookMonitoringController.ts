import { NextFunction, Request, Response } from "express";
import { WebhookLogRepository } from "@/repositories/partner/WebhookLogRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";

export class AdminWebhookMonitoringController {
  constructor(private webhookLogRepository: WebhookLogRepository) {}

  // Get partner's webhook logs
  async getPartnerWebhookLogs(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { userId } = req.params;
      const { page = 1, limit = 20 } = req.query;

      const result = await this.webhookLogRepository.findByUserId(
        userId,
        parseInt(page as string),
        parseInt(limit as string),
      );
      const data = result.data.map((log) => ({
        id: log._id,
        event: log.event,
        status: log.status,
        webhookUrl: log.webhookUrl,
        retryCount: log.retryCount,
        responseStatus: log.responseStatus,
        lastAttemptAt: log.lastAttemptAt,
        succeededAt: log.succeededAt,
        nextRetryAt: log.nextRetryAt,
        createdAt: log.createdAt,
      }));

      sendPaginatedResponse(res, data, {
        total: result.total,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
      });
    } catch (error: any) {
      logger.error("Failed to get webhook logs", error);
      next(error);
    }
  }

  // Get webhook log details
  async getWebhookLogDetails(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { logId } = req.params;

      const log = await this.webhookLogRepository.findById(logId);

      if (!log) {
        throw new AppError(
          "Webhook log not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }
      const data = {
        id: log._id,
        event: log.event,
        status: log.status,
        webhookUrl: log.webhookUrl,
        payload: log.payload,
        signature: log.signature,
        timestamp: log.timestamp,
        retryCount: log.retryCount,
        responseStatus: log.responseStatus,
        responseBody: log.responseBody,
        lastAttemptAt: log.lastAttemptAt,
        succeededAt: log.succeededAt,
        nextRetryAt: log.nextRetryAt,
        createdAt: log.createdAt,
      };
      sendSuccessResponse(res, data, "Webhook log details retrieved");
    } catch (error: any) {
      logger.error("Failed to get webhook log details", error);
      next(error);
    }
  }

  // Manually retry failed webhook
  async retryWebhook(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { logId } = req.params;

      const log = await this.webhookLogRepository.findById(logId);

      if (!log) {
        throw new AppError(
          "Webhook log not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      // Reset for manual retry
      await this.webhookLogRepository.update(logId, {
        status: "pending",
        nextRetryAt: new Date(),
        retryCount: 0, // Reset counter for manual retry
      });
      sendSuccessResponse(res, null, "Webhook retry scheduled");
    } catch (error: any) {
      next(error);

      logger.error("Failed to retry webhook", error);
    }
  }
}
