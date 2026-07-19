import { Router } from "express";
import { TransactionManagementController } from "@/controllers/admin/transactions/TransactionManagementController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";

const router = Router();
const transactionController = new TransactionManagementController();

// All routes require admin authentication
router.use(adminAuth);

// SERVICE TRANSACTIONS
router.get(
  "/services/overview",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getServiceTransactionsOverview
);

router.get(
  "/services",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.listServiceTransactions
);

router.get(
  "/services/:serviceType",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getSpecificServiceTransactions
);

// WALLET TRANSACTIONS
router.get(
  "/wallet/overview",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getWalletTransactionsOverview
);

router.get(
  "/wallet",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.listWalletTransactions
);

router.get(
  "/wallet/:walletType",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getSpecificWalletTransactions
);

// UTILITY ENDPOINTS
router.get(
  "/failed",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getFailedTransactions
);

router.get(
  "/pending",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getPendingTransactions
);

router.post(
  "/bulk-update",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.UPDATE),
  auditLog("bulk_update_transactions", "transaction"),
  transactionController.bulkUpdateTransactions
);

router.get(
  "/export",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.EXPORT),
  auditLog("export_transactions", "transaction"),
  transactionController.exportTransactions
);

// GENERAL TRANSACTION ENDPOINTS
router.get(
  "/",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.listTransactions
);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.VIEW),
  transactionController.getTransactionDetails
);

router.put(
  "/:id/status/:status",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.UPDATE),
  auditLog("update_transaction_status", "transaction"),
  transactionController.updateTransactionStatus
);

router.post(
  "/:id/retry",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.UPDATE),
  auditLog("retry_transaction", "transaction"),
  transactionController.retryFailedTransaction
);

router.post(
  "/:id/reverse",
  requirePermission(ADMIN_PERMISSIONS.TRANSACTIONS.REVERSE),
  auditLog("reverse_transaction", "transaction"),
  transactionController.reverseTransaction
);

export default router;