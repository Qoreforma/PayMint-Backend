import logger from "@/logger";
import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";
import { TatumService } from "./TatumService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Types } from "mongoose";

interface TatumNetworkData {
  networkId: string;
  name: string;
  code: string;
  chainType: "EVM" | "BITCOIN" | "TRON" | "SOLANA";
  networkPath: string;
  tatumChainCode: string;
  confirmationsRequired: number;
  priority: number;
  platformDepositAddress: string;
  masterXpub: string;
}
const TATUM_NETWORKS: TatumNetworkData[] = [
  {
    networkId: "BITCOIN",
    name: "Bitcoin",
    code: "BTC",
    chainType: "BITCOIN",
    networkPath: "bitcoin",
    tatumChainCode: "bitcoin-mainnet", // was "BTC"
    confirmationsRequired: 6,
    priority: 1,
    platformDepositAddress: "bc1qzweeg42u5kk0c0nhgcqzf0xg650jxn54pkfv7x",
    masterXpub: "xpub6EurACbXLBXCCz4yAAU7pV1L6hTzxG2QUAUjQbBdZ1GeqFaowZujj58jsg7P5SqeMsdgrvwFbrfFbopEJdCHxRoBu6cWpPWzNDerok8yB73"
  },
  {
    networkId: "ETHEREUM",
    name: "Ethereum",
    code: "ETH",
    chainType: "EVM",
    networkPath: "ethereum",
    tatumChainCode: "ethereum-mainnet", // was "ETH"
    confirmationsRequired: 12,
    priority: 2,
    platformDepositAddress: "0xd3819c8c2df17791055a0b7ac81016e5f7bca656",
    masterXpub: "xpub6DzJTYdJjLJdon3b5qbuxWB5212dETrEjH1CjiJaCY6myj1Dw8jd9Eqhb5zxjC4XX83bKbha4NxxFD5C3Z2XwSNeMAVrZaJe7jx4EfKGFLj"
  },
  {
    networkId: "TRON",
    name: "Tron",
    code: "TRX",
    chainType: "TRON",
    networkPath: "tron",
    tatumChainCode: "tron-mainnet", // was "TRON"
    confirmationsRequired: 19,
    priority: 3,
    platformDepositAddress: "TEYjPALP4dGNFAcNfCVhmdtEkCPW3Apqns",
    masterXpub: "xpub6EbKkjhvHdjkPsgtQthKx44Enu4UnnAGdAMBhhWhQc8P9eKdBV7wjfaSgLn89PyGxLUbVqx8e14JKncck6vpGRc2UtVgQmqKbzYGEiVWTTa"
  },
  {
    networkId: "SOLANA",
    name: "Solana",
    code: "SOL",
    chainType: "SOLANA",
    networkPath: "solana",
    tatumChainCode: "solana-mainnet", // was "SOL"
    confirmationsRequired: 32,
    priority: 4,
    platformDepositAddress: "9wfJyqYbs4ys4PVZhGjN5hYxt6EqaMSZGoHtaBMb2B8f",
    masterXpub: ""
  },
];

interface TatumCryptoData {
  code: string;
  name: string;
  tatumCurrencyCode: string;
  networkIds: string[]; // matches TATUM_NETWORKS[].networkId
  priority: number;
}

const TATUM_CRYPTOS: TatumCryptoData[] = [
  {
    code: "BTC",
    name: "Bitcoin",
    tatumCurrencyCode: "btc",
    networkIds: ["BITCOIN"],
    priority: 1,
  },
  {
    code: "ETH",
    name: "Ethereum",
    tatumCurrencyCode: "eth",
    networkIds: ["ETHEREUM"],
    priority: 2,
  },
  {
    code: "USDT",
    name: "Tether",
    tatumCurrencyCode: "usdt",
    networkIds: ["ETHEREUM", "TRON"],
    priority: 3,
  },
  {
    code: "USDC",
    name: "USD Coin",
    tatumCurrencyCode: "usdc",
    networkIds: ["ETHEREUM", "TRON"],
    priority: 4,
  },
  {
    code: "SOL",
    name: "Solana",
    tatumCurrencyCode: "sol",
    networkIds: ["SOLANA"],
    priority: 5,
  },
];

export class TatumSeedService {
  constructor(
    private cryptoRepository: CryptoRepository,
    private networkRepository: NetworkRepository,
    private tatumService: TatumService,
  ) { }

  async seedTatumCryptosAndNetworks(providerId?: string): Promise<any> {
    logger.info(
      "🌱 Starting Tatum seed: clearing old, seeding new networks/cryptos",
    );

    try {
      // STEP 0: Clear existing Tatum networks + cryptos for this provider
      const providerFilter: any = { deletedAt: null };
      if (providerId)
        providerFilter.providerId = new Types.ObjectId(providerId);
      else providerFilter.providerCode = "tatum"; // fallback if no providerId

      const oldNetworks = await this.networkRepository["model"]
        .find(providerFilter)
        .select("_id")
        .exec();
      const oldCryptos = await this.cryptoRepository["model"]
        .find({ ...providerFilter, providerCode: "tatum" })
        .select("_id")
        .exec();

      if (oldNetworks.length) {
        await this.networkRepository.deleteMany({
          providerId: new Types.ObjectId(providerId),
        });
      }
      if (oldCryptos.length) {
        await this.cryptoRepository.deleteMany({
          providerId: new Types.ObjectId(providerId),
        });
        // await this.cryptoRepository.deleteMany(
        //   oldCryptos.map((c: any) => c._id.toString()),
        // );
      }

      logger.info("Cleared old Tatum data", {
        networksRemoved: oldNetworks.length,
        cryptosRemoved: oldCryptos.length,
      });

      // STEP 1: Seed networks, keep a map of networkId -> ObjectId
      const networkIdMap = new Map<string, Types.ObjectId>();

      for (const net of TATUM_NETWORKS) {
        const network = await this.networkRepository.upsertByNetworkId(
          net.networkId,
          providerId,
          {
            providerId: providerId ? new Types.ObjectId(providerId) : undefined,
            networkId: net.networkId,
            name: net.name,
            code: net.code,
            chainType: net.chainType,
            networkPath: net.networkPath,
            tatumChainCode: net.tatumChainCode,
            confirmationsRequired: net.confirmationsRequired,
            isActive: true,
            priority: net.priority,
            masterXpub: net.masterXpub,
            platformDepositAddress: net.platformDepositAddress,
          },
        );
        networkIdMap.set(net.networkId, network._id as Types.ObjectId);
      }

      // STEP 2: Seed cryptos, attaching the right network(s)
      let seededCryptos = 0;
      for (const crypto of TATUM_CRYPTOS) {
        const networkObjectIds = crypto.networkIds.map(
          (id) => networkIdMap.get(id)!,
        );

        await this.cryptoRepository.upsertByCode(crypto.code, providerId, {
          providerId: providerId ? new Types.ObjectId(providerId) : undefined,
          code: crypto.code,
          name: crypto.name,
          providerCode: "tatum",
          tatumCurrencyCode: crypto.tatumCurrencyCode,
          networks: networkObjectIds,
          isActive: true,
          purchaseActivated: true,
          saleActivated: true,
          priority: crypto.priority,
          buyMinAmount: 10,
          buyMaxAmount: 100000,
          sellMinAmount: 10,
          sellMaxAmount: 100000,
          minSweepThresholdUsd: 50,
        });
        seededCryptos++;
      }

      logger.info("✅ Tatum seed completed", {
        seededNetworks: TATUM_NETWORKS.length,
        seededCryptos,
      });

      return {
        success: true,
        seededNetworks: TATUM_NETWORKS.length,
        seededCryptos,
      };
    } catch (error: any) {
      logger.error("Tatum seed failed", error);
      throw new AppError(
        "Failed to seed Tatum cryptos and networks",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  async validateSeededCryptos(): Promise<any> {
    logger.info("🔍 Validating seeded cryptos against Tatum");

    const validation = {
      valid: [] as string[],
      invalid: [] as string[],
      errors: [] as string[],
    };

    for (const cryptoData of TATUM_CRYPTOS) {
      try {
        // Try to get exchange rate - if it works, Tatum supports this currency
        const rate = await this.tatumService.getExchangeRate({
          symbol: cryptoData.code,
          basePair: "USD",
        });

        if (rate > 0) {
          validation.valid.push(cryptoData.code);
        } else {
          validation.invalid.push(cryptoData.code);
        }
      } catch (error: any) {
        validation.errors.push(`${cryptoData.code}: ${error.message}`);
      }
    }

    logger.info(" Validation complete", validation);
    return validation;
  }

    async setupHmacSecret(): Promise<any> {
    logger.info("Setting up Tatum HMAC webhook secret");

    try {
      await this.tatumService.enableHmac();

      logger.info("✅ Tatum HMAC secret configured successfully");

      return { success: true };
    } catch (error: any) {
      logger.error("Failed to setup Tatum HMAC secret", error);
      throw new AppError(
        "Failed to setup Tatum HMAC secret",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }
}
