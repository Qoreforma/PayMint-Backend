import { Router } from "express";
import { CryptoController } from "@/controllers/admin/crypto/CryptoController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import {
  requireNetworkAccess,
  requirePermission,
} from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  createCryptoValidation,
  updateCryptoValidation,
  updateCryptoStatusValidation,
  updateCryptoPurchaseStatusValidation,
  updateCryptoSaleStatusValidation,
  bulkUpdateStatusValidation,
  bulkDeleteValidation,
  addNetworkToCryptoValidation,
  bulkUpdateSellRateValidation,
  bulkUpdateBuyRateValidation,
  bulkUpdatePurchaseActivationValidation,
  bulkUpdateSaleActivationValidation,
} from "@/validations/admin/cryptoValidation";
import { createNetworkValidation } from "@/validations/admin/networkValidation";

const router = Router();
const cryptoController = new CryptoController();

router.use(adminAuth);

router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.VIEW),
  cryptoController.listCryptos,
);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.CREATE),
  validateRequest(createCryptoValidation),
  auditLog("create", "crypto"),
  cryptoController.createCrypto,
);

router.get("/get-provider", cryptoController.getProvider);

router.put(
  "/bulk/status",
  requirePermission(
    ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL,
    ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY,
  ),
  validateRequest(bulkUpdateStatusValidation),
  auditLog("bulk_update_status", "crypto"),
  cryptoController.bulkUpdateStatus,
);

router.post(
  "/bulk/delete",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.DELETE),
  validateRequest(bulkDeleteValidation),
  auditLog("bulk_delete", "crypto"),
  cryptoController.bulkDelete,
);

router.put(
  "/bulk/sell-rate",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL),
  validateRequest(bulkUpdateSellRateValidation),
  auditLog("bulk_update_sell_rate", "crypto"),
  cryptoController.bulkUpdateSellRate,
);

router.put(
  "/bulk/buy-rate",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY),
  validateRequest(bulkUpdateBuyRateValidation),
  auditLog("bulk_update_buy_rate", "crypto"),
  cryptoController.bulkUpdateBuyRate,
);

router.put(
  "/bulk/sale-activation",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL),
  validateRequest(bulkUpdateSaleActivationValidation),
  auditLog("bulk_update_sale_activation", "crypto"),
  cryptoController.bulkUpdateSaleActivation,
);

router.put(
  "/bulk/purchase-activation",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY),
  validateRequest(bulkUpdatePurchaseActivationValidation),
  auditLog("bulk_update_purchase_activation", "crypto"),
  cryptoController.bulkUpdatePurchaseActivation,
);

router.get(
  "/networks",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.VIEW),
  cryptoController.listNetworks,
);

router.post(
  "/networks",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.CREATE),
  validateRequest(createNetworkValidation),
  auditLog("add_network_to_crypto", "crypto"),
  cryptoController.createNetwork,
);

router.get(
  "/networks/:id/overview",
  requireNetworkAccess(ADMIN_PERMISSIONS.CRYPTO.MANAGE_CRYPTO_ADMINS),
  cryptoController.getNetworkOverview,
);

// Assets list
router.get(
  "/networks/:id/assets",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.VIEW),
  cryptoController.getNetworkAssets,
);
router.get(
  "/networks/:id/admins",
  requireNetworkAccess(ADMIN_PERMISSIONS.CRYPTO.MANAGE_CRYPTO_ADMINS),
  cryptoController.getNetworkAdmins,
);

// Admin bulk operations
router.put(
  "/networks/:id/admins/bulk/buy",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.MANAGE_CRYPTO_ADMINS),
  auditLog("bulk_toggle_network_admin_buy", "crypto"),
  cryptoController.bulkToggleNetworkAdminBuyPermission,
);

router.put(
  "/networks/:id/admins/bulk/sell",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.MANAGE_CRYPTO_ADMINS),
  auditLog("bulk_toggle_network_admin_sell", "crypto"),
  cryptoController.bulkToggleNetworkAdminSellPermission,
);

// Individual admin permission
router.put(
  "/networks/:id/admins/:adminId",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.MANAGE_CRYPTO_ADMINS),
  auditLog("toggle_network_admin_permission", "crypto"),
  cryptoController.toggleNetworkAdminPermission,
);

// Generic network detail routes (LAST for /networks/:id)

router.put(
  "/networks/:id",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.UPDATE_NETWORK),
  auditLog("update_network", "crypto"),
  cryptoController.updateNetwork,
);

router.delete(
  "/networks/:id",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.DELETE_NETWORK),
  auditLog("delete_network", "crypto"),
  cryptoController.deleteNetwork,
);

router.get(
  "/:id/networks",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.VIEW),
  cryptoController.getCryptoNetworks,
);

router.post(
  "/:id/networks",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.CREATE_NETWORK),
  validateRequest(addNetworkToCryptoValidation),
  auditLog("add_network_to_crypto", "crypto"),
  cryptoController.addNetworkToCrypto,
);

router.delete(
  "/:id/networks/:networkId",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.DELETE_NETWORK),
  auditLog("remove_network_from_crypto", "crypto"),
  cryptoController.removeNetworkFromCrypto,
);

// Most specific status routes (3 segments)
router.put(
  "/:id/status/purchase-activation",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY),
  validateRequest(updateCryptoPurchaseStatusValidation),
  auditLog("update_purchase_status", "crypto"),
  cryptoController.updatePurchaseActivationStatus,
);

router.put(
  "/:id/status/sale-activation",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL),
  validateRequest(updateCryptoSaleStatusValidation),
  auditLog("update_sale_status", "crypto"),
  cryptoController.updateSaleActivationStatus,
);

// Specific activation routes (2 segments)
router.put(
  "/:id/status",
  requirePermission(
    ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL,
    ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY,
  ),
  validateRequest(updateCryptoStatusValidation),
  auditLog("update_status", "crypto"),
  cryptoController.updateStatus,
);

router.put(
  "/:id/sale-activated",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL),
  validateRequest(updateCryptoSaleStatusValidation),
  auditLog("update_status", "crypto"),
  cryptoController.activateSale,
);

router.put(
  "/:id/purchase-activated",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY),
  validateRequest(updateCryptoPurchaseStatusValidation),
  auditLog("update_status", "crypto"),
  cryptoController.activatePurchase,
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.VIEW),
  cryptoController.getCryptoDetails,
);

router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.UPDATE),
  validateRequest(updateCryptoValidation),
  auditLog("update", "crypto"),
  cryptoController.updateCrypto,
);

router.delete(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.CRYPTO.DELETE),
  auditLog("delete", "crypto"),
  cryptoController.deleteCrypto,
);

export default router;
