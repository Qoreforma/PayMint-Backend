import { Response, NextFunction } from "express";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import AdminServiceContainer from "@/services/admin/container";
import { DepositManagementService } from "@/services/admin/transactions/DepositManagementService";

export class AdminDepositController {
  private depositService: DepositManagementService;

  constructor() {
    this.depositService = AdminServiceContainer.getDepositManagementService();
  }
  //GET /admin/deposit-requests
  //List all manual deposit requests across all users.
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

      const result = await this.depositService.listDeposits(
        Number(page),
        Number(limit),
        {
          status: status as string | undefined,
          userId: userId as string | undefined,
          startDate: startDate ? new Date(startDate as string) : undefined,
          endDate: endDate ? new Date(endDate as string) : undefined,
        },
      );

      return sendPaginatedResponse(
        res,
        result.deposits,
        result.pagination,
        "Deposit requests retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  //GET /admin/deposit-requests/:id
  //Get a single deposit request with full details.
  getRequestById = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const result = await this.depositService.getDepositDetails(id);
      return sendSuccessResponse(
        res,
        result,
        "Deposit request retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  //POST /admin/deposit-requests/:id/approve
  //Approve a manual deposit — wallet is credited immediately.
  approveRequest = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const adminId = req.admin?.adminId;

      const result = await this.depositService.approveDeposit(id, adminId);
      return sendSuccessResponse(
        res,
        result,
        "Deposit request approved and wallet credited",
      );
    } catch (error) {
      next(error);
    }
  };

  //POST /admin/deposit-requests/:id/reject
  //Reject a manual deposit — wallet unchanged, user notified.
  //Body: { reason: string }
  rejectRequest = async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const adminId = req.admin?.adminId;
      const { reason } = req.body;

      const result = await this.depositService.declineDeposit(
        id,
        reason,
        adminId,
      );
      return sendSuccessResponse(res, result, "Deposit request rejected");
    } catch (error) {
      next(error);
    }
  };
}
