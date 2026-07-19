import { Response, NextFunction } from "express";
import { GiftCardService } from "@/services/admin/giftcards/GiftCardService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { AuthRequest } from "@/middlewares/client/auth";
import AdminServiceContainer from "@/services/admin/container";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";

export class GiftCardController {
  private giftCardService: GiftCardService;

  constructor() {
    this.giftCardService = AdminServiceContainer.getGiftCardService();
  }

  listGiftCards = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const categoryId = req.query.categoryId as string;
      const countryId = req.query.countryId as string;
      const type = req.query.type as "buy" | "sell";
      const isActive = req.query.isActive as string;
      const saleActivated = req.query.saleActivated as string;
      const purchaseActivated = req.query.purchaseActivated as string;

      const result = await this.giftCardService.listGiftCards(
        page,
        limit,
        search,
        categoryId,
        countryId,
        type,
        isActive,
        saleActivated,
        req.admin.permissions,
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

  createGiftCard = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const giftCard = await this.giftCardService.createGiftCard(req.body);
      return sendSuccessResponse(
        res,
        giftCard,
        "Gift card created successfully",
        201,
      );
    } catch (error) {
      next(error);
    }
  };

  getGiftCardDetails = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const giftCard = await this.giftCardService.getGiftCardById(
        id,
        req.admin.permissions,
      );
      return sendSuccessResponse(
        res,
        giftCard,
        "Gift card retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  updateGiftCard = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const giftCard = await this.giftCardService.updateGiftCard(id, req.body);
      return sendSuccessResponse(
        res,
        giftCard,
        "Gift card updated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  deleteGiftCard = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      await this.giftCardService.deleteGiftCard(id);
      return sendSuccessResponse(res, null, "Gift card deleted successfully");
    } catch (error) {
      next(error);
    }
  };

  updateStatus = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const giftCard = await this.giftCardService.updateStatus(id, isActive);
      return sendSuccessResponse(
        res,
        giftCard,
        "Gift card status updated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  updatePurchaseActivationStatus = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { purchaseActivated } = req.body;
      const giftCard =
        await this.giftCardService.updatePurchaseActivationStatus(
          id,
          purchaseActivated,
        );
      return sendSuccessResponse(
        res,
        giftCard,
        "Gift card purchase activation status updated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  toggleHottest = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { isHottest } = req.body;
      const hottestGiftCards = await this.giftCardService.toggleHottest(
        id,
        isHottest,
      );
      return sendSuccessResponse(
        res,
        hottestGiftCards,
        "Gift card hottest status updated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  bulkToggleHottest = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await this.giftCardService.bulkUpdateHottest(req.body);
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  updateSaleActivationStatus = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { saleActivated } = req.body;
      const giftCard = await this.giftCardService.updateSaleActivationStatus(
        id,
        saleActivated,
      );
      return sendSuccessResponse(
        res,
        giftCard,
        "Gift card sale activation status updated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  bulkUpdateStatus = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await this.giftCardService.bulkUpdateStatus(req.body);
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  bulkDelete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.giftCardService.bulkDelete(req.body);
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };
  bulkUpdateSaleActivationStatus = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await this.giftCardService.bulkUpdateSaleActivationStatus(
        req.body,
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  bulkUpdateSaleRate = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await this.giftCardService.bulkUpdateSaleRate(req.body);
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  bulkUpdateCommission = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await this.giftCardService.bulkUpdateCommission(req.body);
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };
}
