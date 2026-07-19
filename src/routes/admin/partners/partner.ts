import { Router } from "express";
import { AdminPartnerManagementController } from "@/controllers/partner/AdminPartnerManagementController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { validateRequest } from "@/middlewares/shared/validation";
import { makeUserPartnerValidation } from "@/validations/partner/partnerValidation";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";

const router = Router();

const controller = new AdminPartnerManagementController();

router.use(adminAuth);

// Partner management
router.post(
  "/users/:userId/partner",
  requirePermission(ADMIN_PERMISSIONS.PARTNERS.APPROVE_SUSPEND),
  validateRequest(makeUserPartnerValidation),
  controller.attachPartnerToUser,
);
router.patch(
  "/:userId/approve",
  requirePermission(ADMIN_PERMISSIONS.PARTNERS.APPROVE_SUSPEND),
  controller.approvePartner,
);
router.patch(
  "/:userId/suspend",
  requirePermission(ADMIN_PERMISSIONS.PARTNERS.APPROVE_SUSPEND),
  controller.suspendPartner,
);
router.get(
  "/:userId",
  requirePermission(ADMIN_PERMISSIONS.PARTNERS.VIEW),
  controller.getPartner,
);
router.post(
  "/:userId/api-keys",
  requirePermission(ADMIN_PERMISSIONS.PARTNERS.MANAGE_API_KEYS),
  controller.generateApiKeyForPartner,
);

export default router;
