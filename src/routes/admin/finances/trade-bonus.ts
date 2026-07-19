import { Router } from "express";
import { TradeBonusController } from "@/controllers/admin/finances/TradeBonusController";
import { adminAuth } from "@/middlewares/admin/adminAuth";
import { requirePermission } from "@/middlewares/admin/adminPermission";
import { auditLog } from "@/middlewares/admin/auditLogger";
import { validateRequest } from "@/middlewares/shared/validation";
import { createTradeBonusValidation, updateTradeBonusValidation } from "@/validations/admin/tradeBonusValidation";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";


const router = Router();
const controller = new TradeBonusController();

router.use(adminAuth);

router.post(
  "/",
  requirePermission(ADMIN_PERMISSIONS.TRADE_BONUSES.CREATE),
  validateRequest(createTradeBonusValidation),
  auditLog("create", "trade_bonus"),
  controller.createBonus
);

router.get("/", requirePermission(ADMIN_PERMISSIONS.TRADE_BONUSES.VIEW), controller.getBonuses);

router.get(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.TRADE_BONUSES.VIEW),
  controller.getBonusById
);

router.put(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.TRADE_BONUSES.UPDATE),
  validateRequest(updateTradeBonusValidation),
  auditLog("update", "trade_bonus"),
  controller.updateBonus
);

router.delete(
  "/:id",
  requirePermission(ADMIN_PERMISSIONS.TRADE_BONUSES.DELETE),
  auditLog("delete", "trade_bonus"),
  controller.deleteBonus
);

export default router;