import { NextFunction, Response } from "express";
import { PartnerGiftCardService } from "@/services/partner/PartnerGiftCardService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { AuthenticatedPartnerRequest } from "@/middlewares/partner/partnerAuth";
import { GiftCardService } from "@/services/client/GiftCardService";
import {
  sendErrorResponse,
  sendPaginatedResponse,
  sendSuccessResponse,
} from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";
import { Service } from "@/models/reference/Service";

export class PartnerGiftCardController {
  private partnerGiftCardService: PartnerGiftCardService;
  private giftCardService: GiftCardService;
  constructor() {
    this.giftCardService = ServiceContainer.getGiftCardService();
    this.partnerGiftCardService = ServiceContainer.getPartnerGiftCardService();
  }

  // GET: List available giftcards
  listProducts = async (
    req: AuthenticatedPartnerRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { category, type, page = 1, limit = 20 } = req.query;
      const pageNumber = parseInt(page as string) || 1;
      const limitNumber = parseInt(limit as string) || 20;

      const filters = {
        categoryId: category as string,
        type: (type as string) || "buy",
      };

      const result = await this.giftCardService.getGiftCards(
        filters,
        parseInt(page as string),
        parseInt(limit as string),
      );
      sendPaginatedResponse(res, result.data, {
        total: result.total,
        page: pageNumber,
        limit: limitNumber,
      });
    } catch (error: any) {
      next(error);
    }
  };

  // POST: Purchase giftcard
  purchase = async (
    req: AuthenticatedPartnerRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { giftCardId, productId, amount, quantity, partnerReference } =
        req.body;
      const partnerId = req.partner!.userId;

      if (!partnerId) {
        sendErrorResponse(
          res,
          "Partner authentication required",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.UNAUTHORIZED,
        );
        return;
      }

      const result = await this.partnerGiftCardService.purchaseGiftCard({
        partnerId,
        giftCardId,
        productId,
        amount: parseFloat(amount),
        quantity: parseInt(quantity),
        partnerReference,
      });

      sendSuccessResponse(
        res,
        result,
        "Giftcard purchased successfully",
        HTTP_STATUS.CREATED,
      );
    } catch (error: any) {
      next(error);
    }
  };

  // POST: Sell giftcard
  sell = async (
    req: AuthenticatedPartnerRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const {
        giftCardId,
        productId,
        amount,
        quantity,
        cards,
        comment,
        partnerReference,
      } = req.body;
      const partnerId = req.partner!.userId;

      // Validate required fields

      if (!partnerId) {
        sendErrorResponse(
          res,
          "Partner authentication required",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.UNAUTHORIZED,
        );
        return;
      }
      const result = await this.partnerGiftCardService.sellGiftCard({
        partnerId,
        giftCardId,
        productId,
        amount: parseFloat(amount),
        quantity: parseInt(quantity),
        cards,
        comment,
        partnerReference,
      });
      sendSuccessResponse(
        res,
        result,
        "Giftcard sold successfully",
        HTTP_STATUS.CREATED,
      );
    } catch (error: any) {
      next(error);
    }
  };

  // GET: Transaction status
  getStatus = async (
    req: AuthenticatedPartnerRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { transactionRef } = req.params;
      const partnerId = req.partner!.userId;
      if (!partnerId) {
        sendErrorResponse(
          res,
          "Partner authentication required",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.UNAUTHORIZED,
        );
        return;
      }
      if (!transactionRef) {
        sendErrorResponse(
          res,
          "Transaction reference required",
          HTTP_STATUS.BAD_REQUEST,
        );
        return;
      }

      const result = await this.partnerGiftCardService.getTransactionStatus(
        partnerId,
        transactionRef,
      );

      sendSuccessResponse(
        res,
        result,
        "Transaction status retrieved successfully",
      );
    } catch (error: any) {
      next(error);
    }
  };

  // GET: List transactions
  listTransactions = async (
    req: AuthenticatedPartnerRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { tradeType, status, page = 1, limit = 20 } = req.query;
      const partnerId = req.partner!.userId;

      if (!partnerId) {
        sendErrorResponse(
          res,
          "Partner authentication required",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.UNAUTHORIZED,
        );
        return;
      }

      const result = await this.partnerGiftCardService.getTransactions(
        partnerId,
        {
          tradeType: tradeType as string,
          status: status as string,
          page: parseInt(page as string),
          limit: parseInt(limit as string),
        },
      );

      sendPaginatedResponse(res, result.data, {
        total: result.total,
        page: result.page,
        limit: result.limit,
      });
    } catch (error: any) {
      next(error);
    }
  };
}
