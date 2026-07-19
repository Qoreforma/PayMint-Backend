import { Router } from "express";
import { BillPaymentController } from "@/controllers/client/BillPaymentController";
import { authenticate } from "@/middlewares/client/auth";
import { rateLimiter } from "@/middlewares/shared/rateLimiter";
import { walletLock } from "@/middlewares/client/walletLock";
import { validateRequest } from "@/middlewares/shared/validation";
import { checkAndVerifyPin } from "@/middlewares/client/checkAndVerifyPin";
import { purchaseInternationDataSchema } from "@/validations/client/billpaymentValidation";
import { checkServiceAvailability } from "@/middlewares/shared/checkServiceAvailability";
import { TRANSACTION_TYPES } from "@/utils/constants";

const router = Router();

const billPaymentController = new BillPaymentController();

// All routes require authentication and service check
router.use(authenticate);

router.get("/countries", billPaymentController.getInternationalDataCountries);
router.get(
  "/providers/:countryCode",
  billPaymentController.getInternationalDataProviders
);
router.get(
  "/products/:providerId",
  billPaymentController.getInternationalDataProducts
);
router.post(
  "/",
  rateLimiter(10, 60000),
  validateRequest(purchaseInternationDataSchema),
  checkServiceAvailability(TRANSACTION_TYPES.INTERNATIONALDATA),
  checkAndVerifyPin,
  walletLock,
  billPaymentController.purchaseInternationalData
);

export default router;
