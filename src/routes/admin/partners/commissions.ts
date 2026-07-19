import { Router } from "express";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { AdminPartnerCommissionController } from "@/controllers/partner/AdminPartnerCommissionController";
import { validateRequest } from "@/middlewares/shared/validation";
import { bulkUpdateCommissionValidation } from "@/validations/admin/commissionValidation";

const router = Router();
const controller = new AdminPartnerCommissionController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.VIEW),
  controller.listCommissions,
);
router.put(
  "/bulk-update",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.UPDATE),
  validateRequest(bulkUpdateCommissionValidation),
  controller.bulkUpdateCommissions,
);
router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.VIEW),
  controller.getCommission,
);
router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.UPDATE),
  controller.upsertCommission,
);
router.patch(
  "/:id/toggle",
  requirePermission(ADMIN_PERMISSIONS.DISCOUNTS.UPDATE),
  controller.toggleCommission,
);

export default router;