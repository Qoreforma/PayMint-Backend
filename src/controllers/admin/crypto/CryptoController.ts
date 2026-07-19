import { Response, NextFunction } from "express";
import { CryptoService } from "@/services/admin/crypto/CryptoService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { AuthRequest } from "@/middlewares/client/auth";
import AdminServiceContainer from "@/services/admin/container";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";

export class CryptoController {
  private cryptoService: CryptoService;

  constructor() {
    this.cryptoService = AdminServiceContainer.getCryptoService();
  }

  listCryptos = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const providerId = req.query.providerId as string;
      const isActive = req.query.isActive as string;
      const saleActivated = req.query.saleActivated as string;
      const purchaseActivated = req.query.purchaseActivated as string;

      const result = await this.cryptoService.listCryptos(
        page,
        limit,
        search,
        providerId,
        isActive,
        saleActivated,
        purchaseActivated,
      );

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Cryptos retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  createCrypto = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const crypto = await this.cryptoService.createCrypto(req.body);
      return sendSuccessResponse(
        res,
        crypto,
        "Crypto created successfully",
        201,
      );
    } catch (error) {
      next(error);
    }
  };

  getCryptoDetails = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const crypto = await this.cryptoService.getCryptoById(id);
      return sendSuccessResponse(res, crypto, "Crypto retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  updateCrypto = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const crypto = await this.cryptoService.updateCrypto(id, req.body);
      return sendSuccessResponse(res, crypto, "Crypto updated successfully");
    } catch (error) {
      next(error);
    }
  };

  deleteCrypto = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      await this.cryptoService.deleteCrypto(id);
      return sendSuccessResponse(res, null, "Crypto deleted successfully");
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
      const crypto = await this.cryptoService.updateStatus(id, isActive);
      return sendSuccessResponse(
        res,
        crypto,
        "Crypto status updated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  activateSale = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { saleActivated } = req.body;
      const crypto = await this.cryptoService.activateSale(id, saleActivated);
      return sendSuccessResponse(res, crypto, "Sale Activated successfully");
    } catch (error) {
      next(error);
    }
  };

  activatePurchase = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { purchaseActivated } = req.body;
      const crypto = await this.cryptoService.activatePurchase(
        id,
        purchaseActivated,
      );
      return sendSuccessResponse(
        res,
        crypto,
        "Purchase Activated successfully",
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
      const crypto = await this.cryptoService.updatePurchaseActivationStatus(
        id,
        purchaseActivated,
      );
      return sendSuccessResponse(
        res,
        crypto,
        "Crypto purchase activation status updated successfully",
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
      const crypto = await this.cryptoService.updateSaleActivationStatus(
        id,
        saleActivated,
      );
      return sendSuccessResponse(
        res,
        crypto,
        "Crypto sale activation status updated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getProvider = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const provider = await this.cryptoService.getProvider();
      return sendSuccessResponse(
        res,
        provider,
        "Provider retrieved successfully",
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
      const result = await this.cryptoService.bulkUpdateStatus(req.body);
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  bulkDelete = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.cryptoService.bulkDelete(req.body);
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };
  // CONTROLLER METHODS
  bulkUpdateSellRate = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await this.cryptoService.bulkUpdateSellRate(req.body);
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  bulkUpdateBuyRate = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await this.cryptoService.bulkUpdateBuyRate(req.body);
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  bulkUpdateSaleActivation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await this.cryptoService.bulkUpdateSaleActivation(
        req.body,
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  bulkUpdatePurchaseActivation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await this.cryptoService.bulkUpdatePurchaseActivation(
        req.body,
      );
      return sendSuccessResponse(res, result, result.message);
    } catch (error) {
      next(error);
    }
  };

  // Network Management for Crypto

  getCryptoNetworks = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const networks = await this.cryptoService.getCryptoNetworks(id);
      return sendSuccessResponse(
        res,
        networks,
        "Crypto networks retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  listNetworks = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const providerId = req.query.providerId as string;
      const isActive = req.query.isActive as string;

      const networks = await this.cryptoService.listNetworks(
        page,
        limit,
        isActive,
        search,
        providerId,
        req.admin?.permissions,
      );
      return sendPaginatedResponse(
        res,
        networks.data,
        { total: networks.total, page, limit },
        "Networks retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  createNetwork = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const network = await this.cryptoService.createNetwork(req.body);
      return sendSuccessResponse(
        res,
        network,
        "Network created successfully",
        201,
      );
    } catch (error) {
      next(error);
    }
  };

  updateNetwork = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const network = await this.cryptoService.updateNetwork(id, req.body);
      return sendSuccessResponse(res, network, "Network updated successfully");
    } catch (error) {
      next(error);
    }
  };

  deleteNetwork = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      await this.cryptoService.deleteNetwork(id);
      return sendSuccessResponse(res, null, "Network deleted successfully");
    } catch (error) {
      next(error);
    }
  };

  addNetworkToCrypto = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { networkId } = req.body;
      const crypto = await this.cryptoService.addNetworkToCrypto(id, networkId);
      return sendSuccessResponse(
        res,
        crypto,
        "Network added to crypto successfully",
        201,
      );
    } catch (error) {
      next(error);
    }
  };

  removeNetworkFromCrypto = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id, networkId } = req.params;
      const crypto = await this.cryptoService.removeNetworkFromCrypto(
        id,
        networkId,
      );
      return sendSuccessResponse(
        res,
        crypto,
        "Network removed from crypto successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getNetworkAdmins = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const admins = await this.cryptoService.getNetworkAdmins(id);
      return sendSuccessResponse(
        res,
        admins,
        "Network admins retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  toggleNetworkAdminPermission = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id, adminId } = req.params;
      const { type, enabled } = req.body;
      const result = await this.cryptoService.toggleNetworkAdminPermission(
        id,
        adminId,
        type,
        enabled,
      );
      return sendSuccessResponse(
        res,
        result,
        `Admin ${enabled ? "granted" : "revoked"} ${type} permission for network successfully`,
      );
    } catch (error) {
      next(error);
    }
  };

  getNetworkAssets = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const assets = await this.cryptoService.getNetworkAssets(id);
      return sendSuccessResponse(
        res,
        assets,
        "Network assets retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getNetworkOverview = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const search = req.query.search as string;
      const overview = await this.cryptoService.getNetworkOverview(
        id,
        page,
        limit,
        search,
      );
      return sendSuccessResponse(
        res,
        overview,
        "Network overview retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  bulkToggleNetworkAdminBuyPermission = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { adminIds, enabled } = req.body;

      const result =
        await this.cryptoService.bulkToggleNetworkAdminBuyPermission(
          id,
          adminIds,
          enabled,
        );

      return sendSuccessResponse(
        res,
        result,
        `Admins ${enabled ? "granted" : "revoked"} buy permission successfully`,
      );
    } catch (error) {
      next(error);
    }
  };

  bulkToggleNetworkAdminSellPermission = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { adminIds, enabled } = req.body;

      const result =
        await this.cryptoService.bulkToggleNetworkAdminSellPermission(
          id,
          adminIds,
          enabled,
        );

      return sendSuccessResponse(
        res,
        result,
        `Admins ${enabled ? "granted" : "revoked"} sell permission successfully`,
      );
    } catch (error) {
      next(error);
    }
  };
}
