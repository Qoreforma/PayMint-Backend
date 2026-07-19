import logger from "@/logger";
import ServiceContainer from "@/services/client/container";
 

const breetService = ServiceContainer.getBreetService();

// Sync Breet deposit assets to database
// Purpose: Populate Crypto collection with Breet-supported cryptocurrencies
// Runs: Once when app starts
// Note: Assets can be re-synced manually if needed, but typically done once
export async function syncBreetAssets(): Promise<void> {
  try {
    logger.info("🔄 Starting Breet asset sync...");
    await ServiceContainer.getBreetService().syncDepositAssets();
    logger.info("Breet asset sync completed successfully");
  } catch (error: any) {
    logger.error("Breet asset sync failed", { error: error.message, stack: error.stack });
  }
}

export async function syncBreetBanks(): Promise<void> {
  try {
    logger.info("🔄 Starting Breet bank sync...");
    await ServiceContainer.getBreetService().syncAllBanks();
    logger.info("Breet bank sync completed successfully");
  } catch (error: any) {
    logger.error("Breet bank sync failed", { error: error.message, stack: error.stack });
  }
}

export async function initializeBreetSyncJobs(): Promise<void> {
  logger.info("🔄 Initializing Breet sync jobs (one-time on startup)");
  try {
    // await syncBreetBanks();
    await syncBreetAssets();
    logger.info("All Breet sync jobs completed successfully");
  } catch (error: any) {
    logger.error("Breet sync initialization failed", { error: error.message, stack: error.stack });
  }
}
