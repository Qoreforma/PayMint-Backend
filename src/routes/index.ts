import { Router } from "express";
import adminRoute from "./admin";
import clientRoute from "./client";
import partnerRoute from "./partner";
import tatumRoute from "./client/tatum";
const router = Router();

router.use("/admin", adminRoute);
router.use("/", clientRoute);
router.use("/partner", partnerRoute);
router.use("/tatum", tatumRoute);

import chatRoute from "./client/chatRoutes";
router.use("/chat", chatRoute);
router.get("/", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: `${process.env.APP_NAME} Api Running`,
  });
});

export default router;
