import { Response, NextFunction } from "express";
import { CryptoTransactionViewService } from "@/services/admin/crypto/CryptoTransactionViewService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import AdminServiceContainer from "@/services/admin/container";
import { StatsPeriod } from "@/utils/dateRange";

export class CryptoTransactionViewController {
  private cryptoTransactionViewService: CryptoTransactionViewService;

  constructor() {
    this.cryptoTransactionViewService =
      AdminServiceContainer.getCryptoTransactionViewService();
  }

  listCryptoTransactions = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const {
        userId,
        status,
        tradeType,
        cryptoId,
        startDate,
        endDate,
        period,
        search,
      } = req.query;

      const result =
        await this.cryptoTransactionViewService.listCryptoTransactions(
          page,
          limit,
          { userId, status, tradeType, cryptoId, startDate, endDate, period, search },
          req.admin.permissions,
        );

      return sendPaginatedResponse(
        res,
        result.transactions,
        result.pagination,
        "Crypto transactions retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getCryptoTransactionDetails = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const transaction =
        await this.cryptoTransactionViewService.getCryptoTransactionDetails(id);
      return sendSuccessResponse(
        res,
        transaction,
        "Crypto transaction retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getCryptoTransactionStats = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { startDate, endDate, period, tradeType  } = req.query;
      const stats =
        await this.cryptoTransactionViewService.getCryptoTransactionStats({
          startDate,
          endDate,
          period: period as StatsPeriod,
          tradeType: tradeType as string,
        });
      return sendSuccessResponse(
        res,
        stats,
        "Crypto transaction stats retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  approveTransaction = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { reviewNote } = req.body;
      const adminId = req.admin?.adminId;

      if (!adminId) {
        throw new Error("Admin ID not found");
      }

      const result = await this.cryptoTransactionViewService.approveTransaction(
        id,
        adminId,
        reviewNote,
      );

      return sendSuccessResponse(res, result.transaction, result.message);
    } catch (error) {
      next(error);
    }
  };

  declineTransaction = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { declineNote, declinePrompt, declineProof } = req.body;
      const adminId = req.admin?.adminId;

      if (!adminId) {
        throw new Error("Admin ID not found");
      }

      const result = await this.cryptoTransactionViewService.declineTransaction(
        id,
        adminId,
        declineNote,
        declinePrompt,
        declineProof,
      );

      return sendSuccessResponse(res, result.transaction, result.message);
    } catch (error) {
      next(error);
    }
  };

  secondApproveTransaction = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { reviewAmount, reviewRate, reviewNote, reviewProof } = req.body;
      const adminId = req.admin?.adminId;

      if (!adminId) {
        throw new Error("Admin ID not found");
      }

      const result =
        await this.cryptoTransactionViewService.secondApproveTransaction(
          id,
          adminId,
          reviewAmount,
          reviewRate,
          reviewNote,
          reviewProof,
        );

      return sendSuccessResponse(res, result.transaction, result.message);
    } catch (error) {
      next(error);
    }
  };

  markAsTransferred = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { txHash, reviewNote } = req.body;
      const adminId = req.admin?.adminId;

      if (!adminId) {
        throw new Error("Admin ID not found");
      }

      const result = await this.cryptoTransactionViewService.markAsTransferred(
        id,
        adminId,
        txHash,
        reviewNote,
      );

      return sendSuccessResponse(res, result.transaction, result.message);
    } catch (error) {
      next(error);
    }
  };
}
