import { Response, NextFunction } from "express";
import { AuthenticatedAdminRequest } from "@/middlewares/admin/adminAuth";
import { sendSuccessResponse } from "@/utils/helpers";
import AdminServiceContainer from "@/services/admin/container";

export class AdminWalletController {
  private adminWalletService = AdminServiceContainer.getAdminWalletService();

  getBalances = async (req: AuthenticatedAdminRequest, res: Response, next: NextFunction) => {
    try {
      const balances = await this.adminWalletService.getMasterWalletBalances();
      return sendSuccessResponse(res, balances, "Master wallet balances retrieved");
    } catch (error) {
      next(error);
    }
  };

  requestTransferOtp = async (req: AuthenticatedAdminRequest, res: Response, next: NextFunction) => {
    try {
      await this.adminWalletService.requestTransferOtp(
        req.admin.id.toString(),
        req.admin.email,
        req.admin.fullName,
      );
      return sendSuccessResponse(res, null, "Verification code sent to your email");
    } catch (error) {
      next(error);
    }
  };

  transfer = async (req: AuthenticatedAdminRequest, res: Response, next: NextFunction) => {
    try {
      const { networkId, toAddress, amount, otp } = req.body;
      const result = await this.adminWalletService.transfer({
        adminId: req.admin.id.toString(),
        networkId,
        toAddress,
        amount,
        otp,
      });
      delete req.body.otp; // keep the OTP out of the audit log body
      return sendSuccessResponse(res, result, "Transfer submitted for signing");
    } catch (error) {
      next(error);
    }
  };
}