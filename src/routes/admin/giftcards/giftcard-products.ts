import { Router } from "express";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  createGiftCardValidation,
  updateGiftCardValidation,
  updateGiftCardStatusValidation,
  updateGiftCardPurchaseStatusValidation,
  updateGiftCardSaleStatusValidation,
  bulkUpdateStatusValidation,
  bulkDeleteValidation,
  bulkUpdateSaleActivationStatusValidation,
  bulkUpdateSaleRateValidation,
  bulkUpdateCommissionValidation,
  toggleHottestValidation,
  bulkToggleHottestValidation
} from "@/validations/admin/giftCardValidation";
import { GiftCardController } from "@/controllers/admin/giftcards/GiftCardController";

const router = Router();
const giftCardController = new GiftCardController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.VIEW),
  giftCardController.listGiftCards
);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.CREATE),
  validateRequest(createGiftCardValidation),
  auditLog("create", "giftcard"),
  giftCardController.createGiftCard
);

// Bulk status
router.put(
  "/bulk/status",
  requirePermission(
    ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL,
    ADMIN_PERMISSIONS.GIFTCARD.MANAGE_BUY
  ),
  validateRequest(bulkUpdateStatusValidation),
  auditLog("bulk_update_status", "giftcard"),
  giftCardController.bulkUpdateStatus
);

// Bulk delete
router.post(
  "/bulk/delete",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.DELETE),
  validateRequest(bulkDeleteValidation),
  auditLog("bulk_delete", "giftcard"),
  giftCardController.bulkDelete
);

// Bulk sale activation
router.put(
  "/bulk/saleactivation",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL),
  validateRequest(bulkUpdateSaleActivationStatusValidation),
  auditLog("bulk_update_sale_activation", "giftcard"),
  giftCardController.bulkUpdateSaleActivationStatus
);

// Bulk sale rate
router.put(
  "/bulk/sale-rate",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL),
  validateRequest(bulkUpdateSaleRateValidation),
  auditLog("bulk_update_sale_rate", "giftcard"),
  giftCardController.bulkUpdateSaleRate
);

// Bulk commission
router.put(
  "/bulk/commission",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL),
  validateRequest(bulkUpdateCommissionValidation),
  auditLog("bulk_update_commission", "giftcard"),
  giftCardController.bulkUpdateCommission
);

// Bulk hottest
router.put(
  "/bulk/hottest",
  requirePermission(
    ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL,
    ADMIN_PERMISSIONS.GIFTCARD.MANAGE_BUY
  ),
  validateRequest(bulkToggleHottestValidation),
  auditLog("bulk_update_hottest_status", "giftcard"),
  giftCardController.bulkToggleHottest
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.VIEW),
  giftCardController.getGiftCardDetails
);

router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.UPDATE),
  validateRequest(updateGiftCardValidation),
  auditLog("update", "giftcard"),
  giftCardController.updateGiftCard
);

router.delete(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.DELETE),
  auditLog("delete", "giftcard"),
  giftCardController.deleteGiftCard
);

// General status
router.put(
  "/:id/status",
  requirePermission(
    ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL,
    ADMIN_PERMISSIONS.GIFTCARD.MANAGE_BUY
  ),
  validateRequest(updateGiftCardStatusValidation),
  auditLog("update_status", "giftcard"),
  giftCardController.updateStatus
);

// Purchase activation
router.put(
  "/:id/status/purchase-activation",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.MANAGE_BUY),
  validateRequest(updateGiftCardPurchaseStatusValidation),
  auditLog("update_purchase_status", "giftcard"),
  giftCardController.updatePurchaseActivationStatus
);

// Sale activation
router.put(
  "/:id/status/sale-activation",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL),
  validateRequest(updateGiftCardSaleStatusValidation),
  auditLog("update_sale_status", "giftcard"),
  giftCardController.updateSaleActivationStatus
);

// Toggle hottest
router.put(
  "/:id/hottest",
  requirePermission(
    ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL,
    ADMIN_PERMISSIONS.GIFTCARD.MANAGE_BUY
  ),
  validateRequest(toggleHottestValidation),
  auditLog("update_hottest_status", "giftcard"),
  giftCardController.toggleHottest
);

export default router;