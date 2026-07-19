import { Router } from "express";
import { BillPaymentController } from "@/controllers/client/BillPaymentController";

import { authenticate } from "@/middlewares/client/auth";
import { walletLock } from "@/middlewares/client/walletLock";
import { rateLimiter } from "@/middlewares/shared/rateLimiter";
import { checkAndVerifyPin } from "@/middlewares/client/checkAndVerifyPin";
import {
  purchaseEducationSchema,
  verifyEducationSchema,
} from "@/validations/client/billpaymentValidation";
import { validateRequest } from "@/middlewares/shared/validation";
import { TRANSACTION_TYPES } from "@/utils/constants";
import { checkServiceAvailability } from "@/middlewares/shared/checkServiceAvailability";

const router = Router();

const billPaymentController = new BillPaymentController();

// All routes require authentication and service check
router.use(authenticate);

router.get("/", billPaymentController.getEducationServices);
router.get("/:service", billPaymentController.getEducationProducts);
router.post(
  "/verify",
  validateRequest(verifyEducationSchema),
  billPaymentController.verifyEducationMerchant
);
router.post(
  "/",
  rateLimiter(10, 60000),
  validateRequest(purchaseEducationSchema),
  checkServiceAvailability(TRANSACTION_TYPES.EDUCATION),
  checkAndVerifyPin,
  walletLock,
  billPaymentController.purchaseEducation
);

export default router;
