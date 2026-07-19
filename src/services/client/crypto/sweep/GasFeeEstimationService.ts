import { TatumService } from "../../providers/crypto/TatumService";
import logger from "@/logger";

export class GasFeeEstimationService {
  constructor(private tatumService: TatumService) {}

  async estimateGasCostUsd(params: {
    network: any;
    fromAddress: string;
    toAddress: string;
    cryptoAmount: number;
  }): Promise<{
    gasCostUsd: number;
    gasPrice: string;
    confidence: "high" | "medium" | "low";
  } | null> {
    try {
      const { network, fromAddress, toAddress, cryptoAmount } = params;

      if (network.chainType === "EVM") {
        // Only if Tatum has estimateGas method
        if (typeof this.tatumService.estimateGas !== "function") {
          logger.warn("TatumService.estimateGas not available for EVM");
          return null;
        }

        const estimate = await this.tatumService.estimateGas({
          fromAddress,
          toAddress,
          networkPath: network.networkPath,
        });

        if (!estimate || !estimate.gasCostUsd) {
          logger.warn("EVM gas estimation returned no cost");
          return null;
        }

        return {
          gasCostUsd: estimate.gasCostUsd,
          gasPrice: estimate.gasPrice || "unknown",
          confidence: "high",
        };
      }

      if (network.chainType === "BITCOIN") {
        const btcPrice = await this.getCryptoPriceUsd("BTC");
        if (!btcPrice) {
          logger.warn("BTC price unavailable for gas estimation");
          return null;
        }

        const estimatedBytes = 250;
        const satPerByte = 50;
        const totalSats = estimatedBytes * satPerByte;
        const btcAmount = totalSats / 100000000;
        const gasCostUsd = btcAmount * btcPrice;

        return {
          gasCostUsd,
          gasPrice: `${satPerByte} sat/byte`,
          confidence: "medium",
        };
      }

      if (network.chainType === "TRON") {
        const tronPrice = await this.getCryptoPriceUsd("TRON");
        if (!tronPrice) {
          logger.warn("TRON price unavailable for gas estimation");
          return null;
        }

        const tronFixedFee = 1;
        const gasCostUsd = tronFixedFee * tronPrice;

        return {
          gasCostUsd,
          gasPrice: "fixed",
          confidence: "high",
        };
      }

      if (network.chainType === "SOLANA") {
        const solPrice = await this.getCryptoPriceUsd("SOL");
        if (!solPrice) {
          logger.warn("SOL price unavailable for gas estimation");
          return null;
        }

        const solFixedFee = 0.00025;
        const gasCostUsd = solFixedFee * solPrice;

        return {
          gasCostUsd,
          gasPrice: "fixed",
          confidence: "high",
        };
      }

      logger.warn("Unknown chainType for gas estimation", {
        chainType: network.chainType,
      });
      return null;
    } catch (error) {
      logger.error("GasFeeEstimationService: estimation failed", error);
      return null;
    }
  }

  private async getCryptoPriceUsd(cryptoCode: string): Promise<number | null> {
    try {
      if (
        this.tatumService &&
        typeof (this.tatumService as any).getLatestPrice === "function"
      ) {
        const price = await (this.tatumService as any).getLatestPrice(
          cryptoCode,
        );
        if (price && price > 0) {
          return price;
        }
      }
      logger.warn(`Price not available for ${cryptoCode}`);
      return null;
    } catch (error) {
      logger.error(`Failed to get price for ${cryptoCode}`, error);
      return null;
    }
  }


}
