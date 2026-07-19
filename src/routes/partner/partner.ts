import { Router } from "express";
import { PartnerAuthController } from "@/controllers/partner/PartnerAuthController";
import { PartnerProfileController } from "@/controllers/partner/PartnerProfileController";
import { authenticate } from "@/middlewares/client/auth";
import { partnerAuth } from "@/middlewares/partner/partnerAuth";
import { partnerSignatureVerification } from "@/middlewares/partner/partnerSignatureVerification";
import { PartnerGiftCardController } from "@/controllers/partner/PartnerGiftCardController";
import { PartnerDashboardController } from "@/controllers/partner/PartnerDashboardController";
import { PartnerAirtimeController } from "@/controllers/partner/PartnerAirtimeController";
import { PartnerDataController } from "@/controllers/partner/PartnerDataController";
import { PartnerCableTvController } from "@/controllers/partner/PartnerCableTvController";
import { PartnerBettingController } from "@/controllers/partner/PartnerBettingController";
import { PartnerEducationController } from "@/controllers/partner/PartnerEducationController";
import { PartnerInternationalController } from "@/controllers/partner/PartnerInternationalController";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  partnerRegistrationValidation,
  partnerWebhookUrlValidation,
  partnerGiftcardPurchaseValidation,
  partnerSellGiftcardValidation,
  partnerAirtimePurchaseValidation,
  partnerDataPurchaseValidation,
  partnerElectricityPurchaseValidation,
  partnerCableTvVerifyValidation,
  partnerCableTvPurchaseValidation,
  partnerBettingVerifyValidation,
  partnerBettingFundValidation,
  partnerEducationVerifyValidation,
  partnerEducationPurchaseValidation,
  partnerIntlAirtimePurchaseValidation,
  partnerIntlDataPurchaseValidation,
} from "@/validations/partner/partnerValidation";
import { PartnerElectricityController } from "@/controllers/partner/PartnerElectricityController";
import { partnerRateLimiter } from "@/middlewares/shared/rateLimiter";

const router = Router();

const authController = new PartnerAuthController();
const profileController = new PartnerProfileController();
const dashboardController = new PartnerDashboardController();
const giftCardController = new PartnerGiftCardController();
const airtimeController = new PartnerAirtimeController();
const cableTvController = new PartnerCableTvController();
const bettingController = new PartnerBettingController();
const educationController = new PartnerEducationController();
const intlController = new PartnerInternationalController();


// Public: Self-register as partner
router.post(
  "/auth/register",
  validateRequest(partnerRegistrationValidation),
  authController.register,
);

// Protected: Partner routes (require API key + signature)
router.use("/giftcards", partnerAuth());
router.use("/giftcards", partnerRateLimiter(30, 60000));

router.get("/profile", authenticate, profileController.getProfile);
router.patch(
  "/webhook",
  validateRequest(partnerWebhookUrlValidation),
  authenticate,
  profileController.updateWebhook,
);
router.post("/api-keys", authenticate, profileController.generateApiKey);
router.get("/api-keys", authenticate, profileController.getApiKeys);
router.delete(
  "/api-keys/:keyId",
  authenticate,
  profileController.deactivateApiKey,
);

// Giftcard endpoints (protected by partnerAuth + partnerSignatureVerification)
router.get("/giftcards/products", giftCardController.listProducts);
router.post(
  "/giftcards/purchase",
  partnerSignatureVerification(),
  validateRequest(partnerGiftcardPurchaseValidation),
  giftCardController.purchase,
);
router.post(
  "/giftcards/sell",
  partnerSignatureVerification(),
  validateRequest(partnerSellGiftcardValidation),

  giftCardController.sell,
);
router.get(
  "/giftcards/transactions/:transactionRef",
  giftCardController.getStatus,
);
router.get("/giftcards/transactions", giftCardController.listTransactions);

// Airtime endpoints (partnerAuth + partnerSignatureVerification)
router.use("/airtime", partnerAuth());
router.use("/airtime", partnerRateLimiter(30, 60000));

router.get("/airtime/networks", airtimeController.listNetworks);
router.post(
  "/airtime/purchase",
  partnerSignatureVerification(),
  validateRequest(partnerAirtimePurchaseValidation),
  airtimeController.purchase,
);
router.get("/airtime/transactions/:reference", airtimeController.getTransactionStatus);
router.get("/airtime/transactions", airtimeController.listTransactions);

// Data endpoints (partnerAuth + partnerSignatureVerification on writes; auth only on reads)
router.use("/data", partnerAuth());
router.use("/data", partnerRateLimiter(30, 60000));
const dataController = new PartnerDataController();

router.get("/data/networks", dataController.listNetworks);
router.get("/data/products", dataController.listProducts);
router.use("/data/purchase", partnerSignatureVerification());
router.post(
  "/data/purchase",
  validateRequest(partnerDataPurchaseValidation),
  dataController.purchase,
);
router.get("/data/transactions/:reference", dataController.getTransactionStatus);
router.get("/data/transactions", dataController.listTransactions);

// Electricity (partnerAuth + partnerSignatureVerification on writes)
router.use("/electricity", partnerAuth());
router.use("/electricity", partnerRateLimiter(30, 60000));
const electricityController = new PartnerElectricityController();

router.use("/electricity/purchase", partnerSignatureVerification());
router.post(
  "/electricity/purchase",
  validateRequest(partnerElectricityPurchaseValidation),
  electricityController.purchase,
);
router.get("/electricity/transactions/:reference", electricityController.getTransactionStatus);
router.get("/electricity/transactions", electricityController.listTransactions);

// Cable TV (partnerAuth + partnerSignatureVerification on writes)
router.use("/cabletv", partnerAuth());
router.use("/cabletv", partnerRateLimiter(30, 60000));
router.use("/cabletv/verify", partnerSignatureVerification());
router.post(
  "/cabletv/verify",
  validateRequest(partnerCableTvVerifyValidation),
  cableTvController.verifySmartCard,
);
router.use("/cabletv/purchase", partnerSignatureVerification());
router.post(
  "/cabletv/purchase",
  validateRequest(partnerCableTvPurchaseValidation),
  cableTvController.purchase,
);
router.get("/cabletv/transactions/:reference", cableTvController.getTransactionStatus);
router.get("/cabletv/transactions", cableTvController.listTransactions);

// Betting (partnerAuth + partnerSignatureVerification on writes)
router.use("/betting", partnerAuth());
router.use("/betting", partnerRateLimiter(30, 60000));

router.use("/betting/verify", partnerSignatureVerification());
router.post(
  "/betting/verify",
  validateRequest(partnerBettingVerifyValidation),
  bettingController.verifyAccount,
);
router.use("/betting/fund", partnerSignatureVerification());
router.post(
  "/betting/fund",
  validateRequest(partnerBettingFundValidation),
  bettingController.fundAccount,
);
router.get("/betting/transactions/:reference", bettingController.getTransactionStatus);
router.get("/betting/transactions", bettingController.listTransactions);

// Education (partnerAuth + partnerSignatureVerification on writes)
router.use("/education", partnerAuth());
router.use("/education", partnerRateLimiter(30, 60000));

router.get("/education/services", educationController.listServices);
router.get("/education/products", educationController.listProducts);
router.use("/education/verify", partnerSignatureVerification());
router.post(
  "/education/verify",
  validateRequest(partnerEducationVerifyValidation),
  educationController.verifyProfile,
);
router.use("/education/purchase", partnerSignatureVerification());
router.post(
  "/education/purchase",
  validateRequest(partnerEducationPurchaseValidation),
  educationController.purchase,
);
router.get("/education/transactions/:reference", educationController.getTransactionStatus);
router.get("/education/transactions", educationController.listTransactions);

// International Airtime (partnerAuth only on reads; +signature on purchase)
router.use("/intl-airtime", partnerAuth());
router.use("/intl-airtime", partnerRateLimiter(30, 60000));

router.get("/intl-airtime/countries", intlController.getAirtimeCountries);
router.get("/intl-airtime/providers", intlController.getAirtimeProviders);
router.get("/intl-airtime/products", intlController.getAirtimeProducts);
router.use("/intl-airtime/purchase", partnerSignatureVerification());
router.post(
  "/intl-airtime/purchase",
  validateRequest(partnerIntlAirtimePurchaseValidation),
  intlController.purchaseAirtime,
);
router.get("/intl-airtime/transactions/:reference", intlController.getAirtimeTransactionStatus);

// International Data (partnerAuth only on reads; +signature on purchase)
router.use("/intl-data", partnerAuth());
router.use("/intl-data", partnerRateLimiter(30, 60000));
router.get("/intl-data/countries", intlController.getDataCountries);
router.get("/intl-data/providers", intlController.getDataProviders);
router.get("/intl-data/products", intlController.getDataProducts);
router.use("/intl-data/purchase", partnerSignatureVerification());
router.post(
  "/intl-data/purchase",
  validateRequest(partnerIntlDataPurchaseValidation),
  intlController.purchaseData,
);
router.get("/intl-data/transactions/:reference", intlController.getDataTransactionStatus);


// Dashboard endpoints
router.get("/dashboard", authenticate, dashboardController.getDashboard);
router.get("/wallet", authenticate, dashboardController.getWallet);
router.get(
  "/transactions/:reference",
  authenticate,
  dashboardController.getTransactionDetails,
);
router.get("/webhooks", authenticate, dashboardController.getWebhookHistory);

export default router;
