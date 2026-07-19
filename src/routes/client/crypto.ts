import { Router } from "express";
import { CryptoController } from "@/controllers/client/CryptoController";
import { authenticate } from "@/middlewares/client/auth";
import {
  validateRequest,
  validateQuery,
  validateParams,
} from "@/middlewares/shared/validation";
import {
  buyCryptoSchema,
  sellCryptoSchema,
  calculateBreakdownSchema,
  cryptoQuerySchema,
  cryptoIdParamSchema,
  buyCryptoAutomatedSchema,
  sellCryptoAutomatedSchema,
} from "@/validations/client/cryptoValidation";
import {
  checkAndVerifyPin,
  checkAndVerifyPinOptional,
} from "@/middlewares/client/checkAndVerifyPin";
import { checkServiceTypeStatus } from "@/middlewares/shared/checkServiceAvailability";
import { TRANSACTION_TYPES } from "@/utils/constants";
import { detectChannel } from "@/middlewares/client/detectChannel";

const router = Router();
const cryptoController = new CryptoController();

router.use(authenticate);

router.get("/", validateQuery(cryptoQuerySchema), cryptoController.getCryptos);

router.get("/rates", cryptoController.getCryptoRates);
router.get("/providers", cryptoController.getCryptoPaymentProviders);

router.post(
  "/calculate-breakdown",
  validateRequest(calculateBreakdownSchema),
  
  cryptoController.calculateBreakdown,
);

router.post(
  "/buy",
  validateRequest(buyCryptoSchema),
  checkAndVerifyPinOptional,
  checkServiceTypeStatus(TRANSACTION_TYPES.CRYPTO_PURCHASE),
  detectChannel,
  cryptoController.buyCrypto,
);

router.post(
  "/sell",
  validateRequest(sellCryptoSchema),
  checkAndVerifyPinOptional,
  checkServiceTypeStatus(TRANSACTION_TYPES.CRYPTO_SALE),
  detectChannel,
  cryptoController.sellCrypto,
);

router.post(
  "/buy-automated",
  validateRequest(buyCryptoAutomatedSchema),
  checkAndVerifyPin,
  detectChannel,
  cryptoController.buyCryptoAutomated,
);

router.post(
  "/sell-automated",
  validateRequest(sellCryptoAutomatedSchema),
  checkAndVerifyPinOptional,
  detectChannel,
  cryptoController.sellCryptoAutomated,
);
router.get(
  "/nowpayments/status/:paymentId",
  cryptoController.getNowPaymentsPaymentStatus,
);

router.get(
  "/:cryptoId",
  validateParams(cryptoIdParamSchema),
  cryptoController.getCryptoById,
);

router.get(
  "/:cryptoId/networks",
  validateParams(cryptoIdParamSchema),
  cryptoController.getCryptoNetworks,
);

export default router;
