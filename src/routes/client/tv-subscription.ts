import { Router } from "express";
import { BillPaymentController } from "@/controllers/client/BillPaymentController";

import { authenticate } from "@/middlewares/client/auth";
import { walletLock } from "@/middlewares/client/walletLock";
import { rateLimiter } from "@/middlewares/shared/rateLimiter";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  cableTvSchema,
  verifySmartCardNumberSchema,
} from "@/validations/client/billpaymentValidation";
import { checkAndVerifyPin } from "@/middlewares/client/checkAndVerifyPin";
import { checkServiceAvailability } from "@/middlewares/shared/checkServiceAvailability";
import { TRANSACTION_TYPES } from "@/utils/constants";

const router = Router();

const billPaymentController = new BillPaymentController();

router.use(authenticate);

router.get("/", billPaymentController.getTvProviders);
router.get("/:providerId", billPaymentController.getTvPackages);
router.post(
  "/verify",
  validateRequest(verifySmartCardNumberSchema),
  checkServiceAvailability(TRANSACTION_TYPES.CABLE),
  billPaymentController.verifySmartCardNumber,
);
router.post(
  "/",
  rateLimiter(10, 60000),
  validateRequest(cableTvSchema),
  checkServiceAvailability(TRANSACTION_TYPES.CABLE),
  checkAndVerifyPin,
  walletLock,
  billPaymentController.purchaseCableTv,
);

export default router;
