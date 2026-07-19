import cron from "node-cron";
import { GiftCardSyncService } from "@/services/sync/GiftCardSyncService";
import { Provider } from "@/models/reference/Provider";
import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
import cacheService from "@/services/core/CacheService";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

const giftCardSyncService = new GiftCardSyncService();
const giftCardService = ServiceContainer.getGiftCardService();
const reloadlyService = ServiceContainer.getReloadlyService();
const giftCardRepository = ServiceContainer.getGiftCardRepository();

let isProductSyncRunning = false;
let isRateUpdateRunning = false;

export function startGiftCardSync() {
  logger.info("Starting gift card sync cron jobs...");

  const job = cron.schedule("0 2 * * *", async () => {
    if (isProductSyncRunning) {
      logger.warn(
        "⚠️ Gift card product sync already running, skipping this cycle",
      );
      return;
    }

    isProductSyncRunning = true;

    try {
      await SentryHelper.wrapCronJob(
        "gift-card-product-sync",
        "0 2 * * *",
        async () => {
          logger.info("Starting daily gift card product sync...");

          const provider = await Provider.findOne({
            code: "reloadly",
            isActive: true,
          });

          if (!provider) {
            logger.warn("Reloadly provider not found or inactive");
            return;
          }

          const syncResult =
            await giftCardSyncService.syncGiftCardsFromProvider(
              provider.id.toString(),
            );

          SentryHelper.addCronBreadcrumb("Product sync complete", {
            created: syncResult.created,
            updated: syncResult.updated,
            failed: syncResult.failed,
            total: syncResult.total,
            duration: syncResult.duration,
          });

          logger.info("Daily gift card product sync completed", {
            created: syncResult.created,
            updated: syncResult.updated,
            failed: syncResult.failed,
            total: syncResult.total,
            duration: syncResult.duration,
          });

          logger.info("Starting gift card cleanup...");
          const cleanupResult =
            await giftCardSyncService.cleanupOrphanedProducts(
              provider.id.toString(),
            );

          SentryHelper.addCronBreadcrumb("Cleanup complete", {
            deleted: cleanupResult.deleted,
            duration: cleanupResult.duration,
          });

          giftCardService.invalidateCategoriesCache();
          giftCardService.invalidateCountriesCache();

          SentryHelper.addCronBreadcrumb("Cache invalidated");

          logger.info("Gift card cleanup completed", {
            deleted: cleanupResult.deleted,
            duration: cleanupResult.duration,
          });
        },
      );
    } catch (error: any) {
      logger.error("Daily gift card product sync failed", error);
    } finally {
      isProductSyncRunning = false;
    }
  });

  logger.info("Gift card sync cron jobs started");
  logger.info("- Products + Brand Groups: Daily at 2:00 AM");
  logger.info("- Cleanup: After each product sync");
  logger.info(
    "- Category sync from Reloadly: DISABLED (handled by product sync)",
  );

  return job;
}

export const syncImmediately = async (): Promise<void> => {
  if (isProductSyncRunning) {
    logger.warn("⚠️ Gift card sync already running, manual trigger skipped");
    throw new Error("Gift card sync is already in progress");
  }

  isProductSyncRunning = true;

  try {
    logger.info("🧹 Clearing gift card cache...");
    await Promise.all([
      cacheService.delete("giftcard:categories:reloadly"),
      cacheService.delete("provider:active:giftcard"),
      cacheService.delete(
        "provider_health:bill_provider:reloadly:getGiftCardCategories",
      ),
      cacheService.delete(
        "provider_health:bill_provider:reloadly:getGiftCardProducts",
      ),
      cacheService.delete(
        "provider_health:bill_provider:reloadly:orderGiftCard",
      ),
      cacheService.delete(
        "provider_health:giftcard_provider:giftcard:buyGiftCard",
      ),
    ]);
    logger.info("Cache cleared");

    const provider = await Provider.findOne({
      code: "reloadly",
      isActive: true,
    });

    if (!provider) {
      logger.warn("Reloadly provider not found or inactive");
      return;
    }

    const providerId = provider.id.toString();

    logger.info(
      "Step 1/2: Starting gift card product sync (includes brand group creation)...",
    );
    const productSyncResult =
      await giftCardSyncService.syncGiftCardsFromProvider(providerId);
    logger.info("Product sync completed", {
      created: productSyncResult.created,
      updated: productSyncResult.updated,
      failed: productSyncResult.failed,
      total: productSyncResult.total,
      duration: productSyncResult.duration,
    });

    await cacheService.delete("provider:active:giftcard");

    logger.info("Step 2/2: Starting gift card cleanup...");
    const cleanupResult =
      await giftCardSyncService.cleanupOrphanedProducts(providerId);
    logger.info("Cleanup completed", {
      deleted: cleanupResult.deleted,
      duration: cleanupResult.duration,
    });

    giftCardService.invalidateCategoriesCache();
    giftCardService.invalidateCountriesCache();

    logger.info("Full gift card sync completed successfully");
  } catch (error: any) {
    logger.error("Full gift card sync failed", error);
    throw error;
  } finally {
    isProductSyncRunning = false;
  }
};

export function startGiftCardRateUpdate() {
  logger.info("Starting gift card rate update cron jobs...");

  // Schedule 3 times per day: 6 AM, 2 PM, 10 PM
  const timings = ["0 6 * * *", "0 14 * * *", "0 22 * * *"];

  const jobs = timings.map((timing) => {
    return cron.schedule(timing, async () => {
      if (isRateUpdateRunning) {
        logger.warn(
          "⚠️ Gift card rate update already running, skipping this cycle",
        );
        return;
      }

      isRateUpdateRunning = true;

      try {
        // Use the first timing as the representative slug schedule
        await SentryHelper.wrapCronJob(
          "gift-card-rate-update",
          "0 6 * * *",
          async () => {
            logger.info("Starting gift card rate update...");
            const result = await updateAllGiftCardRates();

            logger.info("Gift card rate update completed", {
              total: result.total,
              success: result.success,
              failed: result.failed,
              duration: result.duration,
            });
          },
        );
      } catch (error: any) {
        logger.error("Gift card rate update failed", error);
      } finally {
        isRateUpdateRunning = false;
      }
    });
  });

  logger.info("Gift card rate update cron jobs started");
  logger.info("- Rate updates: Daily at 6:00 AM, 2:00 PM, 10:00 PM");

  return jobs;
}

// Update exchange rates for ALL gift card products
export const updateAllGiftCardRates = async (): Promise<{
  total: number;
  success: number;
  failed: number;
  duration: number;
}> => {
  const startTime = Date.now();

  try {
    logger.info("🔄 Starting gift card rate update for all products...");

    // Get all active products
    const products = await giftCardRepository.find({
      isActive: true,
      type: "buy",
      deletedAt: { $exists: false },
    });

    if (!products || products.length === 0) {
      logger.warn("No active gift cards found for rate update");
      return {
        total: 0,
        success: 0,
        failed: 0,
        duration: Date.now() - startTime,
      };
    }

    logger.info(`📊 Updating rates for ${products.length} products...`);

    let successCount = 0;
    let failureCount = 0;

    for (const product of products) {
      try {
        // Get sample amount to use for FX call
        let sampleAmount = 1;
        if (product.buyMinAmount) {
          sampleAmount = product.buyMinAmount;
        }

        // Get USD cost
        const fxData = await reloadlyService.getGiftCardFxRate(
          product.currency!,
          sampleAmount,
        );

        if (
          !fxData.senderAmount ||
          fxData.senderAmount <= 0 ||
          fxData.senderCurrency !== "USD"
        ) {
          throw new Error(`Invalid FX data: ${JSON.stringify(fxData)}`);
        }

        //  Get USD→NGN rate
        const usdToNgnFx = await reloadlyService.getGiftCardFxRate("NGN", 100);
        const usdToNgnRate = 100 / usdToNgnFx.senderAmount;

        if (!usdToNgnRate || usdToNgnRate <= 0) {
          throw new Error(`Invalid USD→NGN rate: ${usdToNgnRate}`);
        }

        //  Calculate NGN-based exchange rate
        const ngnCost = fxData.senderAmount * usdToNgnRate;
        const exchangeRate = ngnCost / sampleAmount;

        //  Update product in DB
        await giftCardRepository.update(product._id.toString(), {
          exchangeRate,
          rateLastUpdated: new Date(),
          rateSource: "cron",
        });

        successCount++;

        logger.debug(`Rate updated: ${product.name} (${product.currency})`, {
          exchangeRate,
          usdCost: fxData.senderAmount,
          usdToNgnRate,
        });
      } catch (error: any) {
        failureCount++;
        logger.warn(
          `Failed to update rate for ${product.name}: ${error.message}`,
        );
        // Continue to next product, don't stop the whole process
      }
    }

    logger.info(`Rate update completed`, {
      total: products.length,
      success: successCount,
      failed: failureCount,
    });

    return {
      total: products.length,
      success: successCount,
      failed: failureCount,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    logger.error("Gift card rate update batch failed", error);
    throw error;
  }
};
