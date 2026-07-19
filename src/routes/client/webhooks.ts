import { Router } from "express";
import { WebhookController } from "@/controllers/admin/WebhookController";
const router = Router();

const webhookController = new WebhookController();

// VTPASS
router.post("/vtpass", webhookController.handleVTPassWebhook);

// SAFEHAVEN
router.post("/savehaven", webhookController.handleSafeHavenWebhook);
router.post("/savehaven/subaccount", webhookController.handleSafeHavenWebhook);

// FLUTTERWAVE
router.post("/flutterwave", webhookController.handleFlutterwaveWebhook);

router.get(
  "/flutterwave/callback",
  webhookController.handleFlutterwaveCallback,
);

// MONNIFY
router.post("/monnify", webhookController.handleMonnifyWebhook);

router.get("/monnify/callback", webhookController.handleMonnifyCallback);

router.post("/xixapay", webhookController.handleXixapayWebhook);

router.post("/nowpayments", webhookController.handleNowPaymentsWebhook);

router.post("/clubkonnect", webhookController.handleClubKonnectWebhook);
router.get("/clubkonnect", webhookController.handleClubKonnectWebhook);

router.post("/tatum", (req, res, next) =>
  webhookController.handleTatumWebhook(req, res, next)
);

router.post("/breet", webhookController.handleBreetWebhook);

// COOLSUB
// router.post("/webhook/coolsub", coolsubController.handleWebhook);
//TODO: Add CoolSub webhook handler

// MYSIMHOSTING
// router.post("/webhook/mysimhosting", mysimhostingController.handleWebhook);
//TODO: Add MySimHosting webhook handler

// VTUNG
// router.post("/webhook/vtung", vtungController.handleWebhook);
//TODO: Add Vtung webhook handler

// BILALSADASUB
// router.post("/webhook/bilalsadasub", bilalsadasubController.handleWebhook);
//TODO: Add BilalSadaSub webhook handler

// GIFTBILLS
// router.post("/webhook/giftbills", giftbillsController.handleWebhook);
//TODO: Add GiftBills webhook handler

// AMADEUS
// router.post("/webhook/amadeus", amadeusController.handleWebhook);
//TODO: Add Amadeus webhook handler

export default router;
