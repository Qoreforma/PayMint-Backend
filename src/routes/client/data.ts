import { Router } from "express";
import { BillPaymentController } from "@/controllers/client/BillPaymentController";
import { authenticate } from "@/middlewares/client/auth";
import { walletLock } from "@/middlewares/client/walletLock";
import { rateLimiter } from "@/middlewares/shared/rateLimiter";
import { validateRequest } from "@/middlewares/shared/validation";
import { dataEpinPurchaseSchema, dataPurchaseSchema } from "@/validations/client/billpaymentValidation";
import { checkAndVerifyPin } from "@/middlewares/client/checkAndVerifyPin";
import { checkServiceAvailability, checkServiceTypeStatus } from "@/middlewares/shared/checkServiceAvailability";
import { TRANSACTION_TYPES } from "@/utils/constants";

const router = Router();

const billPaymentController = new BillPaymentController();

router.use(authenticate);

// Get data services by type (SME, GIFTING, DIRECT)
router.get("/providers", billPaymentController.getDataProviders);
router.post("/verify", billPaymentController.verifyPhone);

router.get("/", billPaymentController.getData);
// Get active data types for a specific network/service (e.g. mtn-data, airtel-data)
router.get("/types/:serviceCode", billPaymentController.getDataTypesByServiceCode);
// Get data products by service (MTN data, Airtel data.....)
router.get("/:providerId/:dataType", billPaymentController.getDataProducts);
router.post(
  "/epin",
  rateLimiter(5, 60000),
  validateRequest(dataEpinPurchaseSchema),
  checkServiceAvailability(TRANSACTION_TYPES.DATA_EPIN),
  checkAndVerifyPin,
  walletLock,
  billPaymentController.purchaseDataEPIN,
);

router.get(
  "/epin/products/:serviceId",
  checkServiceAvailability(TRANSACTION_TYPES.DATA_EPIN),
  billPaymentController.getDataEPINProducts,
);

router.get("/epin/:reference", billPaymentController.getDataEPIN);

router.post(
  "/",
  rateLimiter(10, 60000),
  validateRequest(dataPurchaseSchema),
  checkServiceTypeStatus(TRANSACTION_TYPES.DATA),
  checkAndVerifyPin,
  walletLock,
  billPaymentController.purchaseData,
);

export default router;