import { Request, Response, NextFunction } from "express";
import { GiftCardTransactionViewService } from "@/services/admin/giftcards/GiftCardTransactionViewService";
import { sendSuccessResponse } from "@/utils/helpers";
import { send } from "process";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import AdminServiceContainer from "@/services/admin/container";
import { StatsPeriod } from "@/utils/dateRange";

export class GiftCardTransactionViewController {
  private giftCardTransactionViewService: GiftCardTransactionViewService;

  constructor() {
    this.giftCardTransactionViewService =
      AdminServiceContainer.getGiftCardTransactionViewService();
  }

  listGiftCardTransactions = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const {
        page = 1,
        limit = 20,
        userId,
        status,
        cardType,
        tradeType,
        startDate,
        endDate,
        period,
        search,
      } = req.query;

      const result =
        await this.giftCardTransactionViewService.listGiftCardTransactions(
          Number(page),
          Number(limit),
          { userId, status, cardType, tradeType, startDate, endDate, period, search },
          req.admin.permissions, // pass admin permissions
        );

      sendSuccessResponse(
        res,
        result,
        "Giftcard Transactions fetched successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getGiftCardTransactionDetails = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const transaction =
        await this.giftCardTransactionViewService.getGiftCardTransactionDetails(
          id,
        );
      sendSuccessResponse(res, transaction, "Giftcard Transaction fetched");
    } catch (error) {
      next(error);
    }
  };

  getGiftCardTransactionStats = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { startDate, endDate, period,
        tradeType 
       } = req.query;
      const stats =
        await this.giftCardTransactionViewService.getGiftCardTransactionStats({
          startDate,
          endDate,
          period: period as StatsPeriod,
          tradeType 
        });
      sendSuccessResponse(
        res,
        stats,
        "Giftcard Transaction statistics fetched successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getTransactionsByParentId = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { parentId } = req.params;

      const result =
        await this.giftCardTransactionViewService.getTransactionsByParentId(
          parentId,
        );

      sendSuccessResponse(
        res,
        result,
        "Multiple Giftcard Trasaction fetched successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  approveAllByParentId = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { parentId } = req.params;
      const { reviewNote } = req.body;
      const adminId = req.admin!.id;

      const result =
        await this.giftCardTransactionViewService.approveAllByParentId(
          parentId,
          adminId,
        );

      sendSuccessResponse(
        res,
        result,
        "All transactions under parent ID approved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  declineAllByParentId = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { parentId } = req.params;
      const { declineNote, declineProof, declinePrompt } = req.body;
      const adminId = req.admin!.id;

      const result =
        await this.giftCardTransactionViewService.declineAllByParentId(
          parentId,
          adminId,
          declineNote,
          declineProof,
          declinePrompt,
        );

      sendSuccessResponse(
        res,
        result,
        "All transactions under parent ID declined successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  secondApproveAllByParentId = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { parentId } = req.params;
      const { reviewProof, reviewedAmount, reviewNote } = req.body;
      const adminId = req.admin!.id;

      const result =
        await this.giftCardTransactionViewService.secondApproveAllByParentId(
          parentId,
          adminId,
          reviewedAmount,
          reviewNote,
          reviewProof,
        );

      sendSuccessResponse(
        res,
        result,
        "All transactions under parent ID second approved successfully",
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
      const adminId = req.admin.adminId;

      const result =
        await this.giftCardTransactionViewService.approveTransaction(
          id,
          adminId,
          reviewNote,
        );

      sendSuccessResponse(res, result, "Transaction approved successfully");
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
      const { declineNote, declineProof, declinePrompt } = req.body;
      const adminId = req.admin!.adminId;

      const result =
        await this.giftCardTransactionViewService.declineTransaction(
          id,
          adminId,
          declineNote,
          declineProof,
          declinePrompt,
        );

      sendSuccessResponse(res, result, "Transaction declined successfully");
    } catch (error) {
      next(error);
    }
  };

  archiveTransaction = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;

      const result =
        await this.giftCardTransactionViewService.archiveTransaction(id);

      sendSuccessResponse(res, result, "Transaction archived successfully");
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
      const { reviewProof, reviewedAmount, reviewNote } = req.body;
      const adminId = req.admin!.id;

      const result =
        await this.giftCardTransactionViewService.secondApproveTransaction(
          id,
          adminId,
          reviewedAmount,
          reviewNote,
          reviewProof,
        );

      sendSuccessResponse(
        res,
        result,
        "Transaction second approved successfully",
      );
    } catch (error) {
      next(error);
    }
  };
}
