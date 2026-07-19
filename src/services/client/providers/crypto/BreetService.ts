import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import logger from "@/logger";
import { CacheService } from "@/services/core/CacheService";
import { CACHE_KEYS, CACHE_TTL } from "@/utils/constants";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { Network } from "@/models/crypto/Network";
import { BankRepository } from "@/repositories/shared/BankRepository";
import { ProviderRepository } from "@/repositories/shared/ProviderRepository";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";

// TYPES
export interface GenerateWalletParams {
  assetId: string;
  label: string;
  bankId?: string;
  accountNumber?: string;
  narration?: string;
  autoSettlement?: boolean;
}

export interface GenerateWalletResponse {
  id: string;
  address: string;
  qrCode?: string;
}

export interface FetchWalletsResponse {
  id: string;
  address: string;
  asset: string;
  identifier: string;
  label: string;
  qrCode?: string;
  isActive: boolean;
}

export interface UpdateWalletBankParams {
  walletId: string;
  bankId: string;
  accountNumber: string;
  narration?: string;
  autoSettlement?: boolean;
}

export interface WithdrawStablecoinParams {
  amount: number;
  token: "USDT" | "USDC";
  network: "ERC20" | "TRC20" | "BSC" | "SOL" | "TON";
  walletAddress: string;
  pin: string;
  externalId?: string;
}

export interface WithdrawStablecoinResponse {
  id: string;
  status: "pending" | "completed" | "reversed" | "rejected";
  amount: number;
  fee: number;
  txHash?: string;
}

export interface RateCalculatorParams {
  assetId: string;
  amountInUSD: number;
  currency: "ngn" | "ghs";
}

export interface RateCalculatorResponse {
  NGNAmount: number;
  GHSAmount: number;
  rate: number;
  cryptoAmount: number;
}

export interface FetchDepositAssetsResponse {
  id: string;
  identifier: string;
  name: string;
  symbol: string;
  icon: string;
  network: string;
  minimum: number;
  flagFeeUSD: number;
  type: string;
  isAccountBased: boolean;
  txLink: string;
  rate: {
    NGN: number;
    GHS: number;
  };
}

export interface FetchBanksResponse {
  id: string;
  name: string;
  slug: string;
  country: string;
  currency: string;
  type: string;
  monnifyCode: string;
  avatar?: string;
}

export interface FetchTransactionResponse {
  id: string;
  asset: string;
  cryptoAmount: number;
  amountInUSD: number;
  feeAmountInUsd: number;
  rate: number;
  status: "pending" | "completed" | "flagged";
  txHash: string;
  confirmations: number;
  destinationAddress: string;
  destinationDescription: string;
  event: "trade.pending" | "trade.completed" | "trade.flagged";
  createdAt: string;
  updatedAt: string;
  // Auto-settlement fields (if enabled)
  markupPercent?: number;
  markupAmount?: number;
  amountSettled?: number;
}
const IS_BREET_MOCK = process.env.BREET_MOCK === "true";

if (IS_BREET_MOCK) {
  logger.warn("🔴 Breet is running in MOCK MODE - no real transactions");
}
export class BreetService {
  private client: AxiosInstance;
  private cacheService: CacheService;
  private cryptoRepository: CryptoRepository;
  private bankRepository: BankRepository;
  private providerRepository: ProviderRepository;
  private networkRepository: NetworkRepository;

  constructor() {
    // CONFIG
    const BASE_URL = "https://api.breet.io/v1";

    const APP_ID = process.env.BREET_APP_ID!;
    const APP_SECRET = process.env.BREET_APP_SECRET!;
    const WEBHOOK_SECRET = process.env.BREET_WEBHOOK_SECRET!;
    const BREET_ENV = (process.env.BREET_ENV || "development") as
      | "development"
      | "production";

    // if (!APP_ID || !APP_SECRET || !WEBHOOK_SECRET) {
    //   throw new AppError(
    //     "Breet credentials not configured",
    //     HTTP_STATUS.INTERNAL_SERVER_ERROR,
    //     ERROR_CODES.CONFIGURATION_ERROR,
    //   );
    // }

    this.client = axios.create({
      baseURL: BASE_URL,
      headers: {
        "x-app-id": APP_ID,
        "x-app-secret": APP_SECRET,
        "X-Breet-Env": BREET_ENV,
        "Content-Type": "application/json",
      },
      timeout: 30_000,
    });
   
    this.client.interceptors.response.use(
      (res) => res,
      (err) => {
        const msg = err?.response?.data?.message || err.message;
        logger.error("Breet API error", {
          status: err?.response?.status,
          message: msg,
          url: err?.config?.url,
        });
        return Promise.reject(new Error(`Breet: ${msg}`));
      },
    );

    this.cacheService = new CacheService();
    this.cryptoRepository = new CryptoRepository();
    this.bankRepository = new BankRepository();
    this.providerRepository = new ProviderRepository();
    this.networkRepository = new NetworkRepository();
  }

  // ==================== WALLET MANAGEMENT ====================

  // Generate a permanent deposit wallet address for a user
  async generateWalletAddress(
    params: GenerateWalletParams,
  ): Promise<GenerateWalletResponse> {
    if (IS_BREET_MOCK) {
      logger.info(`[MOCK] generateWalletAddress: ${params.label}`);
      return {
        id: `mock_wallet_${Date.now()}`,
        address: this.mockGenerateAddress(),
        qrCode: undefined,
      };
    }

    try {
      const body: any = {
        label: params.label,
      };

      if (params.bankId && params.accountNumber) {
        body.bankId = params.bankId;
        body.accountNumber = params.accountNumber;
        if (params.narration) body.narration = params.narration;
        if (params.autoSettlement !== undefined)
          body.autoSettlement = params.autoSettlement;
      }

      const res = await this.client.post(
        `/trades/sell/assets/${params.assetId}/generate-address`,
        body,
      );

      logger.info(`Wallet address generated`, {
        walletId: res.data.data.id,
        asset: params.assetId,
      });

      return {
        id: res.data.data.id,
        address: res.data.data.address,
        qrCode: res.data.data.qrCode,
      };
    } catch (error: any) {
      this.handleError(error, "Generate wallet address");
    }
  }

  // Fetch all wallet addresses
  async fetchWalletAddresses(): Promise<FetchWalletsResponse[]> {
    if (IS_BREET_MOCK) {
      logger.info(`[MOCK] fetchWalletAddresses`);
      return [];
    }

    try {
      const res = await this.client.get(`/trades/wallets`);

      logger.info(`Wallets fetched`, {
        count: res.data.data?.length || 0,
      });

      return res.data.data || [];
  } catch (error: any) {
      this.handleError(error, "Fetch wallet addresses");
    }
  }

  // Fetch a single wallet by ID
  async fetchWalletById(walletId: string): Promise<FetchWalletsResponse> {
    if (IS_BREET_MOCK) {
      logger.info(`[MOCK] fetchWalletById: ${walletId}`);
      return {
        id: walletId,
        address: this.mockGenerateAddress(),
        asset: "TRX_TEST",
        identifier: "TRX_TEST",
        label: "mock-wallet",
        isActive: true,
      };
    }

    try {
      const res = await this.client.get(`/trades/wallets/${walletId}`);

      return res.data.data;
   } catch (error: any) {
      this.handleError(
        error,
        "Fetch wallet",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }
  }

  // Update bank for existing wallet
  async updateWalletBank(params: UpdateWalletBankParams): Promise<void> {
    if (IS_BREET_MOCK) {
      logger.info(`[MOCK] updateWalletBank: ${params.walletId}`);
      return;
    }

    try {
      const body: any = {
        id: params.bankId,
        accountNumber: params.accountNumber,
      };

      if (params.narration) body.narration = params.narration;
      if (params.autoSettlement !== undefined)
        body.autoSettlement = params.autoSettlement;

      await this.client.put(`/trades/wallets/${params.walletId}/bank`, body);

      logger.info(`Wallet bank updated`, {
        walletId: params.walletId,
        bankId: params.bankId,
      });
   } catch (error: any) {
      this.handleError(error, "Update wallet bank");
    }
  }

  // Set auto-settlement status on wallet
  async setAutoSettlement(walletId: string, enabled: boolean): Promise<void> {
    if (IS_BREET_MOCK) {
      logger.info(`[MOCK] setAutoSettlement: ${walletId} = ${enabled}`);
      return;
    }

    try {
      await this.client.put(`/trades/wallets/${walletId}/auto-settlement`, {
        autoSettlement: enabled,
      });

      logger.info(`Auto-settlement updated`, {
        walletId,
        enabled,
      });
    } catch (error: any) {
      this.handleError(error, "Set auto-settlement");
    }
  }

  // ==================== RATES & CONVERSION ====================

  // Calculate conversion rate for crypto to fiat
  async calculateRate(
    params: RateCalculatorParams,
  ): Promise<RateCalculatorResponse> {
    if (IS_BREET_MOCK) {
      logger.info(`[MOCK] calculateRate: ${params.assetId}`);
      return {
        NGNAmount: params.amountInUSD * 1600,
        GHSAmount: (params.amountInUSD * 1600) / 90.909,
        rate: 1600,
        cryptoAmount: params.amountInUSD / 40000,
      };
    }

    try {
      const cacheKey = CACHE_KEYS.BREET_RATE_CALCULATOR(
        params.assetId,
        params.currency,
      );

      // Try cache first (5 minute TTL)
      const cached =
        await this.cacheService.get<RateCalculatorResponse>(cacheKey);
      if (cached) {
        logger.debug(`Using cached rate for ${params.assetId}`);
        return cached;
      }

      const res = await this.client.post(
        `/trades/pbc/sell/rate-calculator/${params.assetId}`,
        {
          amountInUSD: params.amountInUSD,
          currency: params.currency,
        },
      );

      const result: RateCalculatorResponse = res.data.data;

      // Cache for 5 minutes
      await this.cacheService.set(
        cacheKey,
        result,
        CACHE_TTL.FIVE_MINUTES || 300,
      );

      logger.info(`Rate calculated`, {
        asset: params.assetId,
        usdAmount: params.amountInUSD,
        currency: params.currency,
        rate: result.rate,
      });

      return result;
   } catch (error: any) {
      this.handleError(error, "Calculate rate");
    }
  }

  // ==================== DEPOSITS ====================

  // Fetch a single transaction by ID
  async fetchTransaction(
    transactionId: string,
  ): Promise<FetchTransactionResponse> {
    if (IS_BREET_MOCK) {
      logger.info(`[MOCK] fetchTransaction: ${transactionId}`);
      return {
        id: transactionId,
        asset: "TRX_TEST",
        cryptoAmount: 100,
        amountInUSD: 15,
        feeAmountInUsd: 0.225,
        rate: 1600,
        status: "completed",
        txHash: this.mockGenerateTxHash(),
        confirmations: 6,
        destinationAddress: this.mockGenerateAddress(),
        destinationDescription: "mock-user",
        event: "trade.completed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    try {
      const res = await this.client.get(
        `/trades/transactions/${transactionId}`,
      );

      return res.data.data;
   } catch (error: any) {
      this.handleError(
        error,
        "Fetch transaction",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }
  }

  // ==================== WITHDRAWALS ====================

  // Withdraw stablecoins to external wallet
  async withdrawStablecoin(
    params: WithdrawStablecoinParams,
  ): Promise<WithdrawStablecoinResponse> {
    if (IS_BREET_MOCK) {
      logger.info(
        `[MOCK] withdrawStablecoin: ${params.amount} ${params.token}`,
      );
      return {
        id: `mock_withdrawal_${Date.now()}`,
        status: "pending",
        amount: params.amount,
        fee: 1,
        txHash: undefined,
      };
    }

    try {
      const body = {
        amount: params.amount,
        token: params.token,
        network: params.network,
        walletAddress: params.walletAddress,
        pin: params.pin,
        ...(params.externalId && { externalId: params.externalId }),
      };
      const res = await this.client.post(`/payments/withdraw/address`, body);

      logger.info(`Stablecoin withdrawal initiated`, {
        withdrawalId: res.data.data.id,
        amount: params.amount,
        token: params.token,
      });

      return {
        id: res.data.data.id,
        status: res.data.data.status,
        amount: res.data.data.amount,
        fee: res.data.data.fee,
        txHash: res.data.data.txHash,
      };
    } catch (error: any) {
      this.handleError(error, "Withdraw stablecoin");
    }
  }
  
  // ASSETS & BANKS
  // Sync deposit assets from Breet to your database
  async syncDepositAssets(): Promise<void> {
    try {
      logger.info("Starting Breet asset sync...");

      if (IS_BREET_MOCK) {
        logger.info("[MOCK] Asset sync completed");
        return;
      }

      const res = await this.client.get(`/trades/assets`);

      if (!res.data.success || !res.data.data) {
        throw new Error("Failed to fetch assets from Breet");
      }

      const breetProvider = await this.providerRepository.findOne({
        code: "breet",
      });
      if (!breetProvider) {
        throw new Error(
          "Breet provider not found in database. Make sure it's seeded.",
        );
      }

      const assets: FetchDepositAssetsResponse[] = res.data.data;

      // Group assets by symbol — e.g. all USDT variants together
      const assetsBySymbol = new Map<string, FetchDepositAssetsResponse[]>();
      for (const asset of assets) {
        const existing = assetsBySymbol.get(asset.symbol) || [];
        assetsBySymbol.set(asset.symbol, [...existing, asset]);
      }

      let synced = 0;
      let skipped = 0;

      for (const [symbol, assetVariants] of assetsBySymbol) {
        try {
          // Find or create ONE crypto record per symbol, scoped to Breet provider
          let crypto = await this.cryptoRepository.findOne({
            code: symbol,
            providerCode: "breet",
            deletedAt: null,
          });

          if (!crypto) {
            crypto = await this.cryptoRepository.create({
              assetId: symbol,
              breetAssetId: symbol,
              name: assetVariants[0].name,
              code: symbol,
              icon: assetVariants[0].icon,
              breetAssetName: assetVariants[0].name,
              breetMinimumUSD: assetVariants[0].minimum,
              breetFlagFeeUSD: assetVariants[0].flagFeeUSD,
              breetLastSyncedAt: new Date(),
              providerId: breetProvider._id,
              providerCode: "breet",
              saleActivated: true,
              purchaseActivated: false,
              isActive: true,
              networks: [],
              deletedAt: undefined,
            });
            logger.info(`Created new crypto for ${symbol}`);
          } else {
            await this.cryptoRepository.updateOne(
              { _id: crypto._id },
              {
                breetAssetName: assetVariants[0].name,
                breetMinimumUSD: assetVariants[0].minimum,
                breetFlagFeeUSD: assetVariants[0].flagFeeUSD,
                breetLastSyncedAt: new Date(),
              },
            );
          }

          // For each network variant, find-or-create a Breet-owned Network doc
          for (const asset of assetVariants) {
            try {
              const networkCode = asset.network.toUpperCase();

              // Look for an existing Breet-owned network for this asset identifier
              let network = await this.networkRepository.findOne({
                breetAssetId: asset.identifier,
                providerId: breetProvider._id,
              });

              if (!network) {
                // Also check by network code + breet provider (avoid dupes)
                network = await this.networkRepository.findOne({
                  code: networkCode,
                  providerId: breetProvider._id,
                  isActive: true,
                });
              }

              if (!network) {
                // Create a brand-new Breet-scoped network
                network = await this.networkRepository.create({
                  networkId: asset.identifier.toUpperCase(),
                  name: asset.network, // e.g. "Tron", "Ethereum"
                  code: networkCode, // e.g. "TRON", "ETHEREUM"
                  chainType: "OTHER", // safe default; can be enriched later
                  networkPath: asset.network.toLowerCase(),
                  tatumChainCode: networkCode,
                  confirmationsRequired: 1,
                  isActive: true,
                  providerId: breetProvider._id,
                  breetAssetId: asset.identifier,
                  breetNetworkCode: asset.network,
                });
                logger.info(
                  `Created Breet network ${network.code} for ${asset.identifier}`,
                );
              } else {
                // Keep breet fields fresh on the Breet-owned network
                await this.networkRepository.updateOne(
                  { _id: network._id },
                  {
                    breetAssetId: asset.identifier,
                    breetNetworkCode: asset.network,
                  },
                );
              }

              // Link this Breet network to the Breet crypto
              await this.cryptoRepository.updateOne(
                { _id: crypto._id },
                { $addToSet: { networks: network._id } },
              );

              synced++;
              logger.info(
                `Linked ${asset.identifier} → ${symbol} via Breet network ${network.code}`,
              );
            } catch (error: any) {
              logger.warn(
                `Failed to sync Breet asset variant ${asset.identifier}`,
                { error: error.message },
              );
              skipped++;
            }
          }
        } catch (error: any) {
          logger.warn(`Failed to sync Breet symbol ${symbol}`, {
            error: error.message,
          });
          skipped++;
        }
      }

      logger.info(
        `Breet asset sync completed. Synced: ${synced}, Skipped: ${skipped}`,
      );
    } catch (error: any) {
      logger.error("Breet asset sync failed:", error.message);
      throw error;
    }
  }

  // Sync banks from Breet to your database
  async syncBanks(currency: "NGN" | "GHS"): Promise<void> {
    try {
      logger.info(`Starting Breet bank sync for ${currency}...`);

      if (IS_BREET_MOCK) {
        logger.info(`[MOCK] Bank sync completed for ${currency}`);
        return;
      }

      const res = await this.client.get(
        `/payments/banks?currency=${currency.toLowerCase()}`,
      );

      if (!res.data.success || !res.data.data) {
        throw new Error(`Failed to fetch ${currency} banks from Breet`);
      }

      const banks: FetchBanksResponse[] = res.data.data;
      let matched = 0;
      let unmatched = 0;
      let failed = 0;

      for (const bank of banks) {
        try {
          const result = await this.bankRepository.syncBreetBank({
            id: bank.id,
            name: bank.name,
            slug: bank.slug,
            country: bank.country,
            currency: bank.currency,
            monnifyCode: bank.monnifyCode,
          });

          if (result.matched) matched++;
          else unmatched++;
        } catch (error: any) {
          logger.warn(`Failed to sync Breet bank ${bank.name}:`, error.message);
          failed++;
        }
      }

      logger.info(`Breet ${currency} bank sync completed`, {
        totalFetchedFromBreet: banks.length,
        matchedAndUpdated: matched,
        notFoundInDb: unmatched,
        failed,
      });
    } catch (error: any) {
      logger.error(`Breet ${currency} bank sync failed:`, error.message);
      throw error;
    }
  }

  // Sync both NGN and GHS banks
  async syncAllBanks(): Promise<void> {
    await this.syncBanks("NGN");
    // await this.syncBanks("GHS");
  }

  // ==================== MOCK UTILITIES ====================

  private mockGenerateAddress(): string {
    const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let result = "T";
    for (let i = 0; i < 33; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private mockGenerateTxHash(): string {
    return `0x${[...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join("")}`;
  }

  // ==================== WEBHOOK VERIFICATION ====================

  static verifyWebhookSecret(receivedSecret: string): boolean {
    const WEBHOOK_SECRET = process.env.BREET_WEBHOOK_SECRET!;
    if (IS_BREET_MOCK) {
      logger.info("[MOCK] Webhook secret verified");
      return true;
    }

    if (!WEBHOOK_SECRET) {
      logger.error("BREET_WEBHOOK_SECRET is not configured");
      return false;
    }

    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(receivedSecret),
        Buffer.from(WEBHOOK_SECRET),
      );
      return isValid;
    } catch (err) {
      logger.error("Webhook secret verification failed", { err });
      return false;
    }
  }


  private handleError(
    error: any,
    operationType: string,
    statusCode: number = HTTP_STATUS.BAD_REQUEST,
    errorCode: string = ERROR_CODES.PROVIDER_ERROR,
  ): never {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error(`Breet ${operationType} failed`, error);

    const detailedErrorMessage =
      error?.response?.data?.message ||
      error?.message ||
      `${operationType} failed`;

    const finalErrorMessage =
      process.env.NODE_ENV === "production"
        ? `${operationType} failed. Please try again later.`
        : detailedErrorMessage;

    throw new AppError(finalErrorMessage, statusCode, errorCode);
  }
}
