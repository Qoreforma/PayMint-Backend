import { Response, NextFunction } from "express";
import { NetworkService } from "@/services/admin/crypto/NetworkService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { AuthRequest } from "@/middlewares/client/auth";
import AdminServiceContainer from "@/services/admin/container";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";

export class NetworkController {
  private networkService: NetworkService;

  constructor() {
    this.networkService = AdminServiceContainer.getNetworkService();
  }

  listNetworks = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const isActive = req.query.isActive as string;
      const providerId = req.query.providerId as string;

      const result = await this.networkService.listNetworks(
        page,
        limit,
        search,
        isActive,
        providerId,
        req.admin?.permissions,
      );

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Networks retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  createNetwork = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const network = await this.networkService.createNetwork(req.body);
      return sendSuccessResponse(
        res,
        network,
        "Network created successfully",
        201
      );
    } catch (error) {
      next(error);
    }
  };

  getNetworkDetails = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const network = await this.networkService.getNetworkById(id);
      return sendSuccessResponse(
        res,
        network,
        "Network retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  updateNetwork = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const network = await this.networkService.updateNetwork(id, req.body);
      return sendSuccessResponse(res, network, "Network updated successfully");
    } catch (error) {
      next(error);
    }
  };

  deleteNetwork = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      await this.networkService.deleteNetwork(id);
      return sendSuccessResponse(res, null, "Network deleted successfully");
    } catch (error) {
      next(error);
    }
  };

  updateStatus = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const network = await this.networkService.updateStatus(id, isActive);
      return sendSuccessResponse(
        res,
        network,
        "Network status updated successfully"
      );
    } catch (error) {
      next(error);
    }
  };

  bulkUpdateStatus = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const result = await this.networkService.bulkUpdateStatus(req.body);
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  bulkDelete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.networkService.bulkDelete(req.body);
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };
}
