import { Router } from "express";
import { GiftCardCategoryController } from "@/controllers/admin/giftcards/GiftCardCategoryController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  createGiftCardCategoryValidation,
  updateGiftCardCategoryStatusValidation,
  updateGiftCardCategoryValidation,
  updateGiftCardSaleStatusValidation,
} from "@/validations/admin/giftCardCategoryValidation";

const router = Router();
const giftCardCategoryController = new GiftCardCategoryController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.VIEW),
  giftCardCategoryController.listCategories,
);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.CREATE),
  validateRequest(createGiftCardCategoryValidation),
  auditLog("create", "giftcard_category"),
  giftCardCategoryController.createCategory,
);

// Sale activation status (PUT /:id/status/sale-activation)
router.put(
  "/:id/status/sale-activation",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL),
  validateRequest(updateGiftCardSaleStatusValidation),
  auditLog("update_status", "giftcard_category"),
  giftCardCategoryController.updateSaleActivationStatus,
);

// General status (PUT /:id/status)
router.put(
  "/:id/status",
  requirePermission(
    ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL,
    ADMIN_PERMISSIONS.GIFTCARD.MANAGE_BUY,
  ),
  validateRequest(updateGiftCardCategoryStatusValidation),
  auditLog("update_status", "giftcard_category"),
  giftCardCategoryController.updateStatus,
);

// Bulk admin permissions (PUT /:id/admins/bulk)
router.put(
  "/:id/admins/bulk",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.MANAGE_GIFTCARD_ADMINS),
  auditLog("bulk_toggle_category_admin", "giftcard"),
  giftCardCategoryController.bulkToggleCategoryAdminPermission,
);

// Toggle individual admin permission (PUT /:id/admins/:adminId)
router.put(
  "/:id/admins/:adminId",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.MANAGE_GIFTCARD_ADMINS),
  auditLog("toggle_category_admin_permission", "giftcard_category"),
  giftCardCategoryController.toggleCategoryAdminPermission,
);

// Get category products (GET /:id/products)
router.get(
  "/:id/products",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.VIEW),
  giftCardCategoryController.getCategoryProducts,
);

// Get category admins (GET /:id/admins)
router.get(
  "/:id/admins",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.MANAGE_GIFTCARD_ADMINS),
  giftCardCategoryController.getCategoryAdmins,
);

// Get category details (GET /:id)
router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.VIEW),
  giftCardCategoryController.getCategoryDetails,
);

// Update category (PUT /:id)
router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.UPDATE),
  validateRequest(updateGiftCardCategoryValidation),
  auditLog("update", "giftcard_category"),
  giftCardCategoryController.updateCategory,
);

// Delete category (DELETE /:id)
router.delete(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.GIFTCARD.DELETE),
  auditLog("delete", "giftcard_category"),
  giftCardCategoryController.deleteCategory,
);

export default router;
