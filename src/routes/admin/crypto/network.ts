import { Router } from "express";
import { NetworkController } from "@/controllers/admin/crypto/NetworkController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission, requireNetworkAccess } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  createNetworkValidation,
  updateNetworkValidation,
  updateNetworkStatusValidation,
  bulkUpdateStatusValidation,
  bulkDeleteValidation,
} from "@/validations/admin/networkValidation";

const router = Router();
const networkController = new NetworkController();

router.use(adminAuth);

// List all networks
router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.VIEW),
  networkController.listNetworks
);

// Create a new network
router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.CREATE_NETWORK),
  validateRequest(createNetworkValidation),
  auditLog("create", "network"),
  networkController.createNetwork
);

// Get network details by ID
router.get(
  "/:id",
  requireNetworkAccess(ADMIN_PERMISSIONS.CRYPTO.VIEW),
  networkController.getNetworkDetails
);

// Update a network
router.put(
  "/:id",
  requireNetworkAccess(ADMIN_PERMISSIONS.CRYPTO.UPDATE_NETWORK),
  validateRequest(updateNetworkValidation),
  auditLog("update", "network"),
  networkController.updateNetwork
);

// Delete a network (soft delete)
router.delete(
  "/:id",
  requireNetworkAccess(ADMIN_PERMISSIONS.CRYPTO.DELETE_NETWORK),
  auditLog("delete", "network"),
  networkController.deleteNetwork
);

// Update network status (isActive)
router.put(
  "/:id/status",
  requireNetworkAccess(ADMIN_PERMISSIONS.CRYPTO.UPDATE_NETWORK),
  validateRequest(updateNetworkStatusValidation),
  auditLog("update_status", "network"),
  networkController.updateStatus
);

// Bulk update status
router.put(
  "/bulk/status",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.UPDATE_NETWORK),
  validateRequest(bulkUpdateStatusValidation),
  auditLog("bulk_update_status", "network"),
  networkController.bulkUpdateStatus
);

// Bulk delete
router.post(
  "/bulk/delete",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.DELETE_NETWORK),
  validateRequest(bulkDeleteValidation),
  auditLog("bulk_delete", "network"),
  networkController.bulkDelete
);

export default router;