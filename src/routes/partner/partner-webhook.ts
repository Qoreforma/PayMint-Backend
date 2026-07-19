import { Router } from "express";
import { authenticate } from "@/middlewares/client/auth";
import { WebhookLogRepository } from "@/repositories/partner/WebhookLogRepository";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { AdminWebhookMonitoringController } from "@/controllers/partner/AdminWebhookMonitoringController";

const router = Router();

const webhookLogRepository = new WebhookLogRepository();
const controller = new AdminWebhookMonitoringController(webhookLogRepository);

// Admin middleware
router.use(adminAuth);

// Webhook monitoring
router.get("/partners/:userId/webhooks", controller.getPartnerWebhookLogs);
router.get("/webhooks/:logId", controller.getWebhookLogDetails);
router.post("/webhooks/:logId/retry", controller.retryWebhook);

export default router;
