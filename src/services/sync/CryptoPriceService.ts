import logger from "@/logger";
import { Crypto, ICrypto } from "@/models/crypto/Crypto";

interface CoinGeckoPriceResponse {
  [coinId: string]: {
    usd: number;
  };
}

export class CryptoPriceService {
  // Map your crypto codes to CoinGecko IDs
  private coinGeckoIdMap: Record<string, string> = {
    BTC: "bitcoin",
    ETH: "ethereum",
    USDT: "tether",
    SOL: "solana",
    SOLA: "solana", // Your duplicate Solana
    XRP: "ripple",
    LTC: "litecoin",
    BNB: "binancecoin",
    USDC: "usd-coin",
    ADA: "cardano",
    DOGE: "dogecoin",
    // Add more as needed
  };

  //Fetch current prices from CoinGecko API

  private async fetchPricesFromCoinGecko(
    cryptoCodes: string[],
  ): Promise<Record<string, number>> {
    try {
      // Convert codes to CoinGecko IDs
      const coinIds = cryptoCodes
        .map((code) => this.coinGeckoIdMap[code])
        .filter(Boolean);

      if (coinIds.length === 0) {
        logger.warn("No valid crypto codes to fetch prices for");
        return {};
      }

      // Remove duplicates
      const uniqueCoinIds = [...new Set(coinIds)];

      // CoinGecko API endpoint
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${uniqueCoinIds.join(
        ",",
      )}&vs_currencies=usd`;

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `CoinGecko API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as CoinGeckoPriceResponse;

      // Map back to crypto codes
      const prices: Record<string, number> = {};
      for (const [code, coinId] of Object.entries(this.coinGeckoIdMap)) {
        if (data[coinId]) {
          prices[code] = data[coinId].usd;
        }
      }

      return prices;
    } catch (error) {
      logger.error("Error fetching prices from CoinGecko:", error);
      throw error;
    }
  }

  //Update all active crypto prices in database

  async updateAllCryptoPrices(): Promise<void> {
    try {
      logger.info("Starting crypto price update...");

      // Get all active cryptos
      const cryptos = await Crypto.find({
        isActive: true,
        deletedAt: null,
        providerId: { $exists: false },
      }).select("_id code sellRate buyRate currentPriceUSD");

      if (cryptos.length === 0) {
        logger.info("No active cryptos found to update");
        return;
      }

      // Get all crypto codes
      const cryptoCodes = cryptos.map((c) => c.code);

      // Fetch prices
      const prices = await this.fetchPricesFromCoinGecko(cryptoCodes);

      if (Object.keys(prices).length === 0) {
        logger.warn("No prices fetched from API");
        return;
      }

      // Update each crypto
      let updatedCount = 0;
      let failedCount = 0;

      for (const crypto of cryptos) {
        try {
          const priceUSD = prices[crypto.code];

          if (!priceUSD || priceUSD <= 0) {
            logger.warn(`No valid price found for ${crypto.code}, skipping...`);
            failedCount++;
            continue;
          }

          // Calculate NGN price using sellRate (NGN per $1 USD)
          const priceNGN = crypto.sellRate
            ? priceUSD * crypto.sellRate
            : undefined;

          // Update the crypto document
          await Crypto.findByIdAndUpdate(crypto._id, {
            currentPriceUSD: priceUSD,
            currentPriceNGN: priceNGN,
            lastPriceUpdate: new Date(),
            priceSource: "coingecko",
          });

          logger.info(
            `Updated ${crypto.code}: $${priceUSD.toFixed(2)}${
              priceNGN ? ` (₦${priceNGN.toLocaleString()})` : ""
            }`,
          );

          updatedCount++;
        } catch (error) {
          logger.error(`Failed to update ${crypto.code}:`, error);
          failedCount++;
        }
      }

      logger.info(
        `Crypto price update completed: ${updatedCount} updated, ${failedCount} failed`,
      );
    } catch (error) {
      logger.error("Error in updateAllCryptoPrices:", error);
      throw error;
    }
  }

  //Update price for a specific crypto

  async updateCryptoPrice(cryptoId: string): Promise<ICrypto | null> {
    try {
      const crypto = await Crypto.findById(cryptoId);

      if (!crypto) {
        throw new Error(`Crypto not found: ${cryptoId}`);
      }

      const prices = await this.fetchPricesFromCoinGecko([crypto.code]);
      const priceUSD = prices[crypto.code];

      if (!priceUSD || priceUSD <= 0) {
        throw new Error(`No valid price found for ${crypto.code}`);
      }

      const priceNGN = crypto.sellRate ? priceUSD * crypto.sellRate : undefined;

      const updated = await Crypto.findByIdAndUpdate(
        cryptoId,
        {
          currentPriceUSD: priceUSD,
          currentPriceNGN: priceNGN,
          lastPriceUpdate: new Date(),
          priceSource: "coingecko",
        },
        { new: true },
      );

      logger.info(
        `Updated ${crypto.code}: $${priceUSD.toFixed(2)}${
          priceNGN ? ` (₦${priceNGN.toLocaleString()})` : ""
        }`,
      );

      return updated;
    } catch (error) {
      logger.error(`Error updating price for crypto ${cryptoId}:`, error);
      throw error;
    }
  }

  //Get current price for a crypto (fetch if stale)

  async getCurrentPrice(
    cryptoId: string,
    maxAgeMinutes: number = 5,
  ): Promise<{ priceUSD: number; priceNGN?: number }> {
    const crypto = await Crypto.findById(cryptoId);

    if (!crypto) {
      throw new Error(`Crypto not found: ${cryptoId}`);
    }

    // Check if price is stale
    const now = new Date();
    const lastUpdate = crypto.lastPriceUpdate;
    const maxAge = maxAgeMinutes * 60 * 1000; // Convert to milliseconds

    const isStale =
      !lastUpdate ||
      !crypto.currentPriceUSD ||
      now.getTime() - lastUpdate.getTime() > maxAge;

    if (isStale) {
      logger.info(`Price for ${crypto.code} is stale, fetching new price...`);
      const updated = await this.updateCryptoPrice(cryptoId);
      return {
        priceUSD: updated!.currentPriceUSD!,
        priceNGN: updated!.currentPriceNGN,
      };
    }

    return {
      priceUSD: crypto.currentPriceUSD!,
      priceNGN: crypto.currentPriceNGN,
    };
  }
}
