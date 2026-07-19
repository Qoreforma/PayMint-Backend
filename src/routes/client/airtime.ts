import { Router } from "express";
import { BillPaymentController } from "@/controllers/client/BillPaymentController";

import { authenticate } from "@/middlewares/client/auth";
import { walletLock } from "@/middlewares/client/walletLock";
import { rateLimiter } from "@/middlewares/shared/rateLimiter";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  airtimeEpinPurchaseSchema,
  airtimePurchaseSchema,
  verifyPhoneNumberSchema,
} from "@/validations/client/billpaymentValidation";
import { checkAndVerifyPin } from "@/middlewares/client/checkAndVerifyPin";
import { checkServiceAvailability } from "@/middlewares/shared/checkServiceAvailability";
import { TRANSACTION_TYPES } from "@/utils/constants";

const router = Router();

const billPaymentController = new BillPaymentController();

// All routes require authentication and service check
router.use(authenticate);

router.get("/providers", billPaymentController.getAirtimeProviders);
router.post(
  "/verify",
  validateRequest(verifyPhoneNumberSchema),
  billPaymentController.verifyPhone
);
router.post(
  "/verify-number",
  validateRequest(verifyPhoneNumberSchema),
  billPaymentController.verifyPhoneWithNetwork
);
router.post(
  "/epin",
  rateLimiter(5, 60000),
  validateRequest(airtimeEpinPurchaseSchema),
  checkServiceAvailability(TRANSACTION_TYPES.AIRTIME_EPIN),
  checkAndVerifyPin,
  walletLock,
  billPaymentController.purchaseAirtimeEPIN,
);

router.get("/epin/:reference", billPaymentController.getAirtimeEPIN);

router.post(
  "/",
  rateLimiter(10, 60000),
  validateRequest(airtimePurchaseSchema),
  checkServiceAvailability(TRANSACTION_TYPES.AIRTIME),
  checkAndVerifyPin,
  walletLock,
  billPaymentController.purchaseAirtime
);

export default router;
