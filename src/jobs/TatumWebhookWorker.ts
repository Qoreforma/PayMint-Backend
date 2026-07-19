import redisConfig from "@/config/redis";
import { CACHE_KEYS } from "@/utils/constants";
import logger from "@/logger";
import { TatumWebhookService } from "@/services/client/webhooks/Tatumwebhookservice";

export class TatumWebhookWorker {
  constructor(private tatumWebhookService: TatumWebhookService) {}

  async processBatch(batchSize: number = 10): Promise<void> {
    let processed = 0;
    let failed = 0;

    for (let i = 0; i < batchSize; i++) {
      // rPop = process oldest first (FIFO)
      const raw = await redisConfig.client.rPop(CACHE_KEYS.TATUM_WEBHOOK_QUEUE);

      if (!raw) break; // queue is empty

      let entry: { payload: any; receivedAt: string };

      try {
        entry = JSON.parse(raw);
      } catch {
        logger.error("Tatum webhook worker: invalid queue entry, discarding", {
          raw,
        });
        failed++;
        continue;
      }

      try {
        await this.tatumWebhookService.processWebhook(entry.payload);
        processed++;
        logger.debug("Tatum webhook worker: processed", {
          txId: entry.payload?.txId,
          receivedAt: entry.receivedAt,
        });
      } catch (err: any) {
        failed++;
        const retryCount = (entry as any).retryCount ?? 0;

        if (retryCount >= 5) {
          // Dead-letter: stop requeueing, flag for manual intervention
          logger.error(
            "CRITICAL: Tatum webhook exceeded max retries — manual review required",
            {
              txId: entry.payload?.txId,
              address: entry.payload?.address,
              retryCount,
              lastError: err.message,
              originalReceivedAt: entry.receivedAt,
            },
          );

          await redisConfig.client.lPush(
            CACHE_KEYS.TATUM_WEBHOOK_DEAD_LETTER,
            JSON.stringify({
              ...entry,
              deadLetteredAt: new Date().toISOString(),
              lastError: err.message,
              reason: "max_retries_exceeded",
            }),
          );

          // do NOT requeue — just move on
          continue;
        }

        // Under retry limit — requeue at the back
        logger.error("Tatum webhook worker: processing failed, requeueing", {
          txId: entry.payload?.txId,
          error: err.message,
          retryCount: retryCount + 1,
        });

        await redisConfig.client.rPush(
          CACHE_KEYS.TATUM_WEBHOOK_QUEUE,
          JSON.stringify({
            ...entry,
            retryCount: retryCount + 1,
            lastFailedAt: new Date().toISOString(),
            lastError: err.message,
          }),
        );
      }
    }

    if (processed > 0 || failed > 0) {
      logger.info("Tatum webhook worker: batch complete", {
        processed,
        failed,
      });
    }
  }
}
