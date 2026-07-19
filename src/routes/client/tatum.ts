import { Router, Request, Response } from "express";
import logger from "@/logger";
import { CacheService } from "@/services/core/CacheService";
import { CACHE_KEYS, CACHE_TTL } from "@/utils/constants";

const router = Router();
const cacheService = new CacheService();

export async function registerKmsTransaction(id: string): Promise<void> {
  await cacheService.set(
    CACHE_KEYS.KMS_PENDING_TX(id),
    "1",
    CACHE_TTL.THIRTY_MINUTES,
  );
  logger.info(`[KMS] Registered pending tx: ${id}`);
}

router.get("/approve-tx/:transactionId", async (req: Request, res: Response) => {
  const { transactionId } = req.params;
  logger.info(`[KMS] Approval check: ${transactionId}`);

  if (!transactionId) {
    return res.status(400).end();
  }

  const key = CACHE_KEYS.KMS_PENDING_TX(transactionId);
  const isPending = await cacheService.get<string>(key);

  if (isPending) {
    await cacheService.delete(key);
    logger.info(`[KMS] ✅ Approved: ${transactionId}`);
    return res.status(200).end();
  }

  logger.warn(`[KMS] ❌ Rejected unknown tx: ${transactionId}`);
  return res.status(403).end();
});

export default router;