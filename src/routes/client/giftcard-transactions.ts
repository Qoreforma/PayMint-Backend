import { Router } from "express";
import { GiftCardController } from "@/controllers/client/GiftCardController";

import { authenticate } from "@/middlewares/client/auth";
import { validateQuery } from "@/middlewares/shared/validation";
import { giftCardTransactionaginationSchema } from "@/validations/client/giftCardTransactionValidation";

const router = Router();

const giftCardController = new GiftCardController();

// All routes require authentication
router.use(authenticate);

// Transaction queries
router.get(
  "/",
  validateQuery(giftCardTransactionaginationSchema),
  giftCardController.getUserTransactions
);

router.get("/stats", giftCardController.getUserTransactionStats);

router.get(
  "/export",
  validateQuery(giftCardTransactionaginationSchema),
  giftCardController.exportTransactions
);

// Single transaction
router.get("/:reference", giftCardController.getTransaction);

router.get("/:reference/receipt", giftCardController.generateReceipt);

// Grouped transactions (for multiple status)
router.get("/group/:groupTag", giftCardController.getGroupedTransactions);

export default router;
