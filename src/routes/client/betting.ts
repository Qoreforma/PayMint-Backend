import { Router } from "express";
import { BillPaymentController } from "@/controllers/client/BillPaymentController";

import { authenticate } from "@/middlewares/client/auth";
import { walletLock } from "@/middlewares/client/walletLock";
import { rateLimiter } from "@/middlewares/shared/rateLimiter";
import { checkAndVerifyPin } from "@/middlewares/client/checkAndVerifyPin";
import { validateRequest } from "@/middlewares/shared/validation";
import { bettingPurchaseSchema } from "@/validations/client/billpaymentValidation";
import { checkServiceAvailability } from "@/middlewares/shared/checkServiceAvailability";
import { TRANSACTION_TYPES } from "@/utils/constants";

const router = Router();

const billPaymentController = new BillPaymentController();

// All routes require authentication and service check
router.use(authenticate);

router.get(
  "/providers",
  checkServiceAvailability(TRANSACTION_TYPES.BETTING),
  billPaymentController.getBettingProviders,
);
router.post(
  "/verify",
  checkServiceAvailability(TRANSACTION_TYPES.BETTING),
  billPaymentController.verifyBettingAccount,
);
router.post(
  "/",
  rateLimiter(10, 60000),
  validateRequest(bettingPurchaseSchema),
  checkServiceAvailability(TRANSACTION_TYPES.BETTING),
  checkAndVerifyPin,
  walletLock,
  billPaymentController.fundBetting,
);

export default router;
