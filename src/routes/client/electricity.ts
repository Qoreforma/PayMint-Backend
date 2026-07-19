import { Router } from "express";
import { BillPaymentController } from "@/controllers/client/BillPaymentController";
import { authenticate } from "@/middlewares/client/auth";
import { walletLock } from "@/middlewares/client/walletLock";
import { rateLimiter } from "@/middlewares/shared/rateLimiter";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  electricitySchema,
  verifyElectricitySchema,
} from "@/validations/client/billpaymentValidation";
import { checkAndVerifyPin } from "@/middlewares/client/checkAndVerifyPin";
import { checkServiceAvailability } from "@/middlewares/shared/checkServiceAvailability";
import { TRANSACTION_TYPES } from "@/utils/constants";

const router = Router();

const billPaymentController = new BillPaymentController();

// All routes require authentication and service check
router.use(authenticate);

router.get(
  "/providers",
  checkServiceAvailability(TRANSACTION_TYPES.ELECTRICITY),
  billPaymentController.getElectricityProviders,
);
router.post(
  "/verify",
  validateRequest(verifyElectricitySchema),
  checkServiceAvailability(TRANSACTION_TYPES.ELECTRICITY),
  billPaymentController.verifyMeterNumber,
);
router.post(
  "/",
  rateLimiter(10, 60000),
  validateRequest(electricitySchema),
  checkServiceAvailability(TRANSACTION_TYPES.ELECTRICITY),
  checkAndVerifyPin,
  walletLock,
  billPaymentController.purchaseElectricity,
);

export default router;
