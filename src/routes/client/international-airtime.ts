import { Router } from "express";
import { BillPaymentController } from "@/controllers/client/BillPaymentController";

import { authenticate } from "@/middlewares/client/auth";
import { walletLock } from "@/middlewares/client/walletLock";
import { rateLimiter } from "@/middlewares/shared/rateLimiter";
import { checkAndVerifyPin } from "@/middlewares/client/checkAndVerifyPin";
import { validateRequest } from "@/middlewares/shared/validation";
import { purchaseInternationAirtimeSchema } from "@/validations/client/billpaymentValidation";
import { checkServiceAvailability } from "@/middlewares/shared/checkServiceAvailability";
import { TRANSACTION_TYPES } from "@/utils/constants";

const router = Router();

const billPaymentController = new BillPaymentController();

// All routes require authentication and service check
router.use(authenticate);

router.get(
  "/countries",
  billPaymentController.getInternationalAirtimeCountries
);
router.get(
  "/providers/:countryCode",
  billPaymentController.getInternationalAirtimeProviders
);

router.get(
  "/products/:providerId",
  billPaymentController.getInternationalAirtimeProducts
);
router.post(
  "/",
  rateLimiter(10, 60000),
  validateRequest(purchaseInternationAirtimeSchema),
  checkServiceAvailability(TRANSACTION_TYPES.INTERNATIONALAIRTIME),
  checkAndVerifyPin,
  walletLock,
  billPaymentController.purchaseInternationalAirtime
);

export default router;
