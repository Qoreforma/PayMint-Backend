import { Router } from "express";
import { AdminWalletController } from "@/controllers/admin/crypto/AdminWalletController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";

const router = Router();
const walletController = new AdminWalletController();

router.use(adminAuth);

router.get(
  "/balances",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.VIEW_TREASURY),
  walletController.getBalances,
);

router.post(
  "/transfer/request-otp",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.MANAGE_TREASURY),
  walletController.requestTransferOtp,
);

router.post(
  "/transfer",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.MANAGE_TREASURY),
  auditLog("transfer", "crypto_wallet"),
  walletController.transfer,
);

export default router;