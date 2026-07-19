import { Router } from "express";
import { GiftCardController } from "@/controllers/client/GiftCardController";
import { authenticate } from "@/middlewares/client/auth";
import {
  validateRequest,
  validateQuery,
} from "@/middlewares/shared/validation";
import {
  buyGiftCardSchema,
  sellGiftCardSchema,
  breakdownSchema,
} from "@/validations/client/giftcardValidation";
import {
  checkAndVerifyPin,
  checkAndVerifyPinOptional,
} from "@/middlewares/client/checkAndVerifyPin";
import { walletLock } from "@/middlewares/client/walletLock";
import { checkServiceTypeStatus } from "@/middlewares/shared/checkServiceAvailability";
import { TRANSACTION_TYPES } from "@/utils/constants";
import { detectChannel } from "@/middlewares/client/detectChannel";

const router = Router();
const giftCardController = new GiftCardController();


router.get("/", giftCardController.getGiftCards);

// Categories
router.get("/categories", giftCardController.getCategories);
router.get("/categories/:categoryId", giftCardController.getCategoryById);

router.get(
  "/categories/:categoryId/countries",
  giftCardController.getCategoryCountries,
);

router.get("/countries", giftCardController.getCountriesWithGiftCards);

router.get("/hottest", giftCardController.getHottestGiftCards);
// Products
router.get("/products/:giftCardId", giftCardController.getGiftCardById);
router.get("/giftcard-rates", giftCardController.getRates);
router.get("/:type", giftCardController.getGiftCardsByType);
router.post("/redeem-codes", authenticate, giftCardController.getRedeemCode);

// Breakdown
router.post(
  "/breakdown",
  authenticate,
  validateRequest(breakdownSchema),
  giftCardController.getBreakdown,
);

// Transactions
router.post(
  "/buy",
  authenticate,
  validateRequest(buyGiftCardSchema),
  checkAndVerifyPin,
  checkServiceTypeStatus(TRANSACTION_TYPES.GIFTCARD_PURCHASE),
  walletLock,
  detectChannel,
  giftCardController.buyGiftCard,
);
router.post(
  "/sell",
  authenticate,
  validateRequest(sellGiftCardSchema),
  checkAndVerifyPinOptional,
  checkServiceTypeStatus(TRANSACTION_TYPES.GIFTCARD_SALE),
  detectChannel,
  giftCardController.sellGiftCard,
);

export default router;
