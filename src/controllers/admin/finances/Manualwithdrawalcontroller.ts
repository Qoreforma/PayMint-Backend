import { Response, NextFunction } from "express";
import { sendSuccessResponse } from "@/utils/helpers";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import { ManualWithdrawalService } from "@/services/admin/finances/Manualwithdrawalservice";
import AdminServiceContainer from "@/services/admin/container";

export class ManualWithdrawalController {
  private manualWithdrawalService: ManualWithdrawalService;
  constructor() {
    this.manualWithdrawalService = AdminServiceContainer.getManualWithdrawalService();
  }

  // List all manual withdrawal requests with optional filters.
  getRequests = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const {
        status,
        userId,
        startDate,
        endDate,
        page = 1,
        limit = 20,
      } = req.query;

      const result = await this.manualWithdrawalService.getRequests(
        {
          status: status as string | undefined,
          userId: userId as string | undefined,
          startDate: startDate ? new Date(startDate as string) : undefined,
          endDate: endDate ? new Date(endDate as string) : undefined,
        },
        Number(page),
        Number(limit),
      );

      return sendSuccessResponse(
        res,
        result,
        "Manual withdrawal requests retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  // Get a single manual withdrawal request.

  getRequestById = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const result = await this.manualWithdrawalService.getRequestById(id);
      return sendSuccessResponse(
        res,
        result,
        "Manual withdrawal request retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  // Admin has manually sent the money — mark as approved.

  approveRequest = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const adminId = req.admin?.adminId;

      const result = await this.manualWithdrawalService.approveRequest(
        id,
        adminId,
      );
      return sendSuccessResponse(
        res,
        result,
        "Withdrawal approved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  // Admin rejects the request — funds are reversed back to user.

  rejectRequest = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const adminId = req.admin?.adminId;

      const result = await this.manualWithdrawalService.rejectRequest(
        id,
        adminId,
        reason,
      );
      return sendSuccessResponse(
        res,
        result,
        "Withdrawal rejected and funds refunded",
      );
    } catch (error) {
      next(error);
    }
  };
}
