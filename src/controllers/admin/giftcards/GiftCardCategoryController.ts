import { Response, NextFunction } from "express";
import { GiftCardCategoryService } from "@/services/admin/giftcards/GiftCardCategoryService";
import {
  sendSuccessResponse,
  sendPaginatedResponse,
  sendErrorResponse,
} from "@/utils/helpers";
import { AuthRequest } from "@/middlewares/client/auth";
import AdminServiceContainer from "@/services/admin/container";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import { HTTP_STATUS } from "@/utils/constants";

export class GiftCardCategoryController {
  private giftCardCategoryService: GiftCardCategoryService;

  constructor() {
    this.giftCardCategoryService =
      AdminServiceContainer.getGiftCardCategoryService();
  }

  listCategories = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const isActive = req.query.isActive as string;

      const result = await this.giftCardCategoryService.listCategories(
        page,
        limit,
        search,
        isActive,
        req.admin.permissions,
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

  createCategory = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const category = await this.giftCardCategoryService.createCategory(
        req.body,
      );
      return sendSuccessResponse(
        res,
        category,
        "Gift card category created successfully",
        201,
      );
    } catch (error) {
      next(error);
    }
  };

  getCategoryProducts = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;

      // Extract and validate query parameters
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const type = req.query.type as "buy" | "sell" | undefined;
      const isActive = req.query.isActive as string;
      const sortBy = (req.query.sortBy as string) || "createdAt";
      const sortOrder = (req.query.sortOrder as "asc" | "desc") || "desc";

      const result = await this.giftCardCategoryService.getCategoryProducts(
        id,
        page,
        limit,
        search,
        type,
        isActive,
        sortBy,
        sortOrder,
        req.admin.permissions,
      );

      return sendPaginatedResponse(
        res,
        result.data,
        result.pagination,
        "Gift card category products retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getCategoryDetails = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const category = await this.giftCardCategoryService.getCategoryById(
        id,
        req.admin.permissions,
      );
      return sendSuccessResponse(
        res,
        category,
        "Gift card category retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  updateCategory = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const category = await this.giftCardCategoryService.updateCategory(
        id,
        req.body,
      );
      return sendSuccessResponse(
        res,
        category,
        "Gift card category updated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  deleteCategory = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const result = await this.giftCardCategoryService.deleteCategory(id);
      return sendSuccessResponse(
        res,
        null,
        result.message,
      );
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
      const category = await this.giftCardCategoryService.updateStatus(
        id,
        isActive,
      );
      return sendSuccessResponse(
        res,
        category,
        "Gift card category status updated successfully",
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
      const category =
        await this.giftCardCategoryService.updatePurchaseActivationStatus(
          id,
          purchaseActivated,
        );
      return sendSuccessResponse(
        res,
        category,
        "Gift card category status updated successfully",
      );
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
      const category =
        await this.giftCardCategoryService.updateSaleActivationStatus(
          id,
          saleActivated,
        );
      return sendSuccessResponse(
        res,
        category,
        "Gift card category status updated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  // Add to existing GiftCardCategoryController class

  getCategoryAdmins = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const admins = await this.giftCardCategoryService.getCategoryAdmins(id);
      return sendSuccessResponse(
        res,
        admins,
        "Category admins retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  toggleCategoryAdminPermission = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id, adminId } = req.params;
      const { enabled } = req.body;
      const result =
        await this.giftCardCategoryService.toggleCategoryAdminPermission(
          id,
          adminId,
          enabled,
        );
      return sendSuccessResponse(
        res,
        result,
        `Admin ${enabled ? "granted" : "revoked"} sell permission for category successfully`,
      );
    } catch (error) {
      next(error);
    }
  };

  bulkToggleCategoryAdminPermission = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { adminIds, enabled } = req.body;

      const result =
        await this.giftCardCategoryService.bulkToggleCategoryAdminPermission(
          id,
          adminIds,
          enabled,
        );

      return sendSuccessResponse(
        res,
        result,
        `Admins ${enabled ? "granted" : "revoked"} category permission successfully`,
      );
    } catch (error) {
      next(error);
    }
  };
}
