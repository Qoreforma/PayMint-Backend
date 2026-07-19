import { Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { GiftCardService } from "@/services/client/GiftCardService";
import {
  sendSuccessResponse,
  sendPaginatedResponse,
  sendErrorResponse,
} from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import ServiceContainer from "@/services/client/container";

export class GiftCardController {
  private giftCardService: GiftCardService;

  constructor() {
    this.giftCardService = ServiceContainer.getGiftCardService();
  }

  getCategories = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const type = req.query.type as "both" | "sell" | "buy";
      const countryId = req.query.countryId as string;
      const search = req.query.search as string;

      const result = await this.giftCardService.getCategories(
        page,
        limit,
        type,
        countryId,
        search,
      );
      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Gift card categories retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getCategoryById = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { categoryId } = req.params;
      const category = await this.giftCardService.getCategoryById(categoryId);
      return sendSuccessResponse(
        res,
        category,
        "Category retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getGiftCards = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const { categoryId, countryId, search, type } = req.query;

      let filters: any = {};
      if (categoryId) filters.categoryId = categoryId;
      if (countryId) filters.countryId = countryId;
      if (search) filters.search = search;
      if (type) filters.type = type;

      const result = await this.giftCardService.getGiftCards(
        filters,
        page,
        limit,
      );
      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Gift cards retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getGiftCardById = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { giftCardId } = req.params;
      const giftCard = await this.giftCardService.getGiftCardById(giftCardId);
      return sendSuccessResponse(
        res,
        giftCard,
        "Gift card retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };
  getHottestGiftCards = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { limit = 10, tradeType = "both", countryId } = req.query;

      const limitNum = Math.min(parseInt(limit as string) || 10, 100);
      const type = (tradeType as string).toLowerCase() as
        | "buy"
        | "sell"
        | "both";

      if (type !== "buy" && type !== "sell" && type !== "both") {
        return sendErrorResponse(
          res,
          "Invalid tradeType. Must be 'buy', 'sell', or 'both'",
          HTTP_STATUS.BAD_REQUEST,
        );
      }

      const hottest = await this.giftCardService.getHottestGiftCards(
        limitNum,
        type,
        countryId as string,
      );

      return sendSuccessResponse(
        res,
        hottest,
        "Hottest gift cards retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getGiftCardDenominations = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { giftCardId } = req.params;
      const denominations =
        await this.giftCardService.getAvailableDenominations(giftCardId);
      return sendSuccessResponse(
        res,
        denominations,
        "Gift card denominations retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getGiftCardsByType = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { type } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await this.giftCardService.getGiftCardsByType(
        type,
        page,
        limit,
      );
      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Gift cards retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getRates = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      let filters: any = {};
      const { type, categoryId, countryId } = req.query;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      if (type) filters.type = type;
      if (categoryId) filters.categoryId = categoryId;
      if (countryId) filters.countryId = countryId;
      filters.page = page;
      filters.limit = limit;

      const rates = await this.giftCardService.getGiftCardRates(filters);
      const total = rates.total;
      return sendPaginatedResponse(
        res,
        rates.data,
        { total, page, limit },
        "Gift card rates retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getBreakdown = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const breakdown = await this.giftCardService.calculateBreakdown(req.body);
      return sendSuccessResponse(
        res,
        breakdown,
        "Breakdown calculated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  buyGiftCard = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const user = req.userData!;
      const channel = (req as any).channel || "web";
      const { giftCardId, amount, quantity } = req.body;
      const result = await this.giftCardService.buyGiftCard({
        giftCardId,
        amount,
        quantity,
        userId,
        user,
        serviceProvider: req.serviceProvider,
        channel,
      });
      return sendSuccessResponse(
        res,
        result,
        "Gift card purchase initiated",
        HTTP_STATUS.CREATED,
      );
    } catch (error) {
      next(error);
    }
  };

  sellGiftCard = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const channel = (req as any).channel || "web";

      const {
        giftCardId,
        amount,
        quantity,
        cardType,
        cards,
        comment,
        bankAccountId,
      } = req.body;

      const result = await this.giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount,
        quantity,
        cardType,
        cards,
        comment,
        bankAccountId,
        channel,
      });

      return sendSuccessResponse(
        res,
        result,
        "Gift card submitted for review successfully",
        HTTP_STATUS.CREATED,
      );
    } catch (error) {
      next(error);
    }
  };

  getRedeemCode = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { transactionId } = req.query;
      const redeemCode = await this.giftCardService.getRedeemCode(
        transactionId as string,
        userId,
      );
      return sendSuccessResponse(
        res,
        redeemCode,
        "Redeem code retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getUserTransactions = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const filters = {
        tradeType: req.query.tradeType as "buy" | "sell",
        status: req.query.status as string,
        cardType: req.query.cardType as "physical" | "e-code",
        giftCardType: req.query.giftCardType as string,
        giftCardId: req.query.giftCardId as string,
        reference: req.query.reference as string,
        groupTag: req.query.groupTag as string,
        search: req.query.search as string,

        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        startAmount: req.query.startAmount
          ? parseFloat(req.query.startAmount as string)
          : undefined,
        endAmount: req.query.endAmount
          ? parseFloat(req.query.endAmount as string)
          : undefined,
        startRate: req.query.startRate
          ? parseFloat(req.query.startRate as string)
          : undefined,
        endRate: req.query.endRate
          ? parseFloat(req.query.endRate as string)
          : undefined,
      };
      const result = await this.giftCardService.getUserTransactions(
        userId,
        filters,
        page,
        limit,
      );

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Gift card transactions retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getUserTransactionStats = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;

      const filters: any = {};

      // Period filter derives startDate/endDate automatically
      const period = req.query.period as string | undefined;
      if (period) {
        const periodDaysMap: Record<string, number> = {
          "1week": 7,
          "1month": 30,
          "1year": 365,
        };
        const days = periodDaysMap[period];
        if (days) {
          const now = new Date();
          filters.endDate = now;
          filters.startDate = new Date(
            now.getTime() - days * 24 * 60 * 60 * 1000,
          );
        }
      } else {
        // Fall back to explicit date range if no period provided
        if (req.query.startDate) {
          filters.startDate = new Date(req.query.startDate as string);
        }
        if (req.query.endDate) {
          filters.endDate = new Date(req.query.endDate as string);
        }
      }

      if (req.query.giftCardId) {
        filters.giftCardId = req.query.giftCardId as string;
      }

      const stats = await this.giftCardService.getUserTransactionsStats(
        userId,
        filters,
      );

      return sendSuccessResponse(
        res,
        stats,
        "Gift card transaction stats retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getTransaction = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { reference } = req.params;
      const userId = req.user!.id;
      const includeChildren = req.query.includeChildren === "true";

      const transaction = includeChildren
        ? await this.giftCardService.getTransactionWithChildren(
            reference,
            userId,
          )
        : await this.giftCardService.getTransaction(reference, userId);

      return sendSuccessResponse(
        res,
        transaction,
        "Gift card transaction retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getGroupedTransactions = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { groupTag } = req.params;
      const userId = req.user!.id;

      const transactions = await this.giftCardService.getGroupedTransactions(
        groupTag,
        userId,
      );

      return sendSuccessResponse(
        res,
        transactions,
        "Grouped transactions retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  exportTransactions = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;

      const filters = {
        tradeType: req.query.tradeType as "buy" | "sell",
        status: req.query.status as string,
        cardType: req.query.cardType as "physical" | "e-code",
        giftCardType: req.query.giftCardType as string,
        giftCardId: req.query.giftCardId as string,
        groupTag: req.query.groupTag as string,

        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      const csvData = await this.giftCardService.exportTransactions(
        userId,
        filters,
      );

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=giftcard_transactions_${
          new Date().toISOString().split("T")[0]
        }.csv`,
      );

      return res.send(csvData);
    } catch (error) {
      next(error);
    }
  };

  generateReceipt = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { reference } = req.params;
      const userId = req.user!.id;

      const receipt = await this.giftCardService.generateReceipt(
        reference,
        userId,
      );

      return sendSuccessResponse(
        res,
        receipt,
        "Receipt generated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getCountriesWithGiftCards = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const type = req.query.type as "buy" | "sell" | undefined;

      const countries =
        await this.giftCardService.getCountriesWithGiftCards(type);

      return sendSuccessResponse(
        res,
        countries,
        "Countries with gift cards retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getCategoryCountries = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { categoryId } = req.params;
      const type = (req.query.type as "buy" | "sell") || "buy";

      const countries = await this.giftCardService.getCategoryCountries(
        categoryId,
        type,
      );

      return sendSuccessResponse(
        res,
        countries,
        "Countries for category retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };
}
