import { Router } from "express";
import { TelegramController } from "@/controllers/client/chat/TelegramController";
import { WhatsAppController } from "@/controllers/client/chat/WhatsAppController";

const router = Router();
const telegramController = new TelegramController();
const whatsappController = new WhatsAppController();

// IMPORTANT: These routes must NOT be behind JWT authentication.
// They are called by external providers (Telegram/Meta).

router.post("/telegram/webhook", telegramController.handleWebhook);

router.get("/whatsapp/webhook", whatsappController.verifyWebhook);
router.post("/whatsapp/webhook", whatsappController.handleWebhook);

export default router;
