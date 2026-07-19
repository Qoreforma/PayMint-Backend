import { AdminDepositController } from "@/controllers/admin/finances/AdminDepositController";
import { Router } from "express";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";

const router = Router();
const controller = new AdminDepositController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.FINANCE.VIEW_DEPOSITS),
  controller.getRequests,
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.FINANCE.VIEW_DEPOSITS),
  controller.getRequestById,
);

router.post(
  "/:id/approve",
  requirePermission(ADMIN_PERMISSIONS.FINANCE.APPROVE_DEPOSITS),
  auditLog("approve_deposit", "deposit"),
  controller.approveRequest,
);

router.post(
  "/:id/reject",
  requirePermission(ADMIN_PERMISSIONS.FINANCE.APPROVE_DEPOSITS),
  auditLog("decline_deposit", "deposit"),
  controller.rejectRequest,
);

export default router;
