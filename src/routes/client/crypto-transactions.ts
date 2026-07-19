import { Router } from "express";
import { CryptoController } from "@/controllers/client/CryptoController";
import { authenticate } from "@/middlewares/client/auth";
import {
  validateQuery,
  validateParams,
  validateRequest,
} from "@/middlewares/shared/validation";
import {
  cryptoTransactionQuerySchema,
  transactionReferenceParamSchema,
  uploadProofSchema,
} from "@/validations/client/cryptoValidation";

const router = Router();

const cryptoController = new CryptoController();

// All routes require authentication
router.use(authenticate);

router.get(
  "/",
  validateQuery(cryptoTransactionQuerySchema),
  cryptoController.getCryptoTransactions,
);

router.get("/stats", cryptoController.getUserTransactionStats);

router.get(
  "/export",
  validateQuery(cryptoTransactionQuerySchema),
  cryptoController.exportCryptoTransactions,
);

// Single transaction - by reference (more common for users)
router.get(
  "/:reference",
  validateParams(transactionReferenceParamSchema),
  cryptoController.getCryptoTransactionByReference,
);

router.get(
  "/:reference/receipt",
  validateParams(transactionReferenceParamSchema),
  cryptoController.generateCryptoReceipt,
);

router.put(
  "/:reference/upload-proof",
  validateParams(transactionReferenceParamSchema),
  validateRequest(uploadProofSchema),
  cryptoController.uploadTransactionProof,
);

// Single transaction - by ID (for admin/internal use)
router.get("/:id", cryptoController.getCryptoTransactionById);

export default router;
