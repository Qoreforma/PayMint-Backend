import { Router } from "express";
import { CryptoTransactionViewController } from "@/controllers/admin/crypto/CryptoTransactionViewController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requireNetworkPermission, requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  approveTransactionValidation,
  declineTransactionValidation,
  secondApproveTransactionValidation,
  markAsTransferredValidation,
} from "@/validations/admin/cryptoTransactionValidation";

const router = Router();
const cryptoTransactionViewController = new CryptoTransactionViewController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.VIEW),
  cryptoTransactionViewController.listCryptoTransactions
);

// Get crypto transaction stats
router.get(
  "/stats",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.VIEW),
  cryptoTransactionViewController.getCryptoTransactionStats
);

// Get crypto transaction details
router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.VIEW),
  requireNetworkPermission,
  cryptoTransactionViewController.getCryptoTransactionDetails
);

// Approve crypto transaction (for sell transactions)
router.put(
  "/:id/approve",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.UPDATE),
  requireNetworkPermission,
  validateRequest(approveTransactionValidation),
  auditLog("approve", "crypto_transaction"),
  cryptoTransactionViewController.approveTransaction
);

// Decline crypto transaction
router.put(
  "/:id/decline",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.UPDATE),
  requireNetworkPermission,

  validateRequest(declineTransactionValidation),
  auditLog("decline", "crypto_transaction"),
  cryptoTransactionViewController.declineTransaction
);

// Second  approve crypto transaction (adjusted amount/rate)
router.put(
  "/:id/second-approve",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.UPDATE),
  requireNetworkPermission,
  validateRequest(secondApproveTransactionValidation),
  auditLog("second_approve", "crypto_transaction"),
  cryptoTransactionViewController.secondApproveTransaction
);

// Mark as transferred (for buy transactions)
router.put(
  "/:id/transferred",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.UPDATE),
  requireNetworkPermission,
  validateRequest(markAsTransferredValidation),
  auditLog("mark_transferred", "crypto_transaction"),
  cryptoTransactionViewController.markAsTransferred
);

export default router;