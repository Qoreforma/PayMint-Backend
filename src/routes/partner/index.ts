import {Router} from "express"
import partnerRoutes from './partner'
import partnerWebhookRoutes from "./partner-webhook"

const router = Router()

router.use("/", partnerRoutes)
router.use("/webhooks", partnerWebhookRoutes)

router.get("/", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: `${process.env.APP_NAME} Partner Api Running`,
  });
});

export default router