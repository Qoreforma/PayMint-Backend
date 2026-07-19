import { Router } from "express";
import { GiftCardTransactionViewController } from "@/controllers/admin/giftcards/GiftCardTransactionViewController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requireCategoryPermission, requirePermission } from "@/middlewares/admin/adminPermission";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  approveTransactionValidation,
  declineTransactionValidation,
  secondApprovalValidation,
} from "@/validations/admin/giftCardTransactionValidation";

const router = Router();
const giftCardTransactionViewController =
  new GiftCardTransactionViewController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.VIEW),
  giftCardTransactionViewController.listGiftCardTransactions
);

router.get(
  "/stats",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.VIEW),
  giftCardTransactionViewController.getGiftCardTransactionStats
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.VIEW),
  requireCategoryPermission,
  giftCardTransactionViewController.getGiftCardTransactionDetails
);

router.get(
  `/:parentId/multiple`,
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.UPDATE),
  auditLog("second_approve_transaction", "giftcard_transaction"),
  giftCardTransactionViewController.getTransactionsByParentId
);

router.put(
  "/:parentId/multiple/approve",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.UPDATE),
  validateRequest(approveTransactionValidation),
  auditLog("approve_all_transaction", "giftcard_transaction"),
  giftCardTransactionViewController.approveAllByParentId
);

router.put(
  "/:parentId/multiple/decline",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.UPDATE),
  validateRequest(declineTransactionValidation),
  auditLog("decline_all_transaction", "giftcard_transaction"),
  giftCardTransactionViewController.declineAllByParentId
);

router.put(
  "/:parentId/multiple/second-approve",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.UPDATE),
  validateRequest(secondApprovalValidation),
  auditLog("second_approve_all_transaction", "giftcard_transaction"),
  giftCardTransactionViewController.secondApproveAllByParentId
);

router.put(
  "/:id/approve",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.UPDATE),
  requireCategoryPermission,
  validateRequest(approveTransactionValidation),
  auditLog("approve_transaction", "giftcard_transaction"),
  giftCardTransactionViewController.approveTransaction
);

router.put(
  "/:id/decline",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.UPDATE),
  requireCategoryPermission,
  validateRequest(declineTransactionValidation),
  auditLog("decline_transaction", "giftcard_transaction"),
  giftCardTransactionViewController.declineTransaction
);

router.put(
  "/:id/second-approve",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.UPDATE),
  requireCategoryPermission,
  validateRequest(secondApprovalValidation),
  auditLog("second_approve_transaction", "giftcard_transaction"),
  giftCardTransactionViewController.secondApproveTransaction
);

router.put(
  "/:id/archived",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.UPDATE),
  requireCategoryPermission,
  auditLog("archive_transaction", "giftcard_transaction"),
  giftCardTransactionViewController.archiveTransaction
);

export default router;
