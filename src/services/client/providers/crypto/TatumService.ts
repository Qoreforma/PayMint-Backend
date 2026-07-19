import axios, { AxiosInstance } from "axios";
import logger from "@/logger";
import { CacheService } from "@/services/core/CacheService";
import { CACHE_KEYS, CACHE_TTL } from "@/utils/constants";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { ChainType } from "@/models/crypto/Network";

const BASE_URL = "https://api.tatum.io";

const API_KEY = process.env.TATUM_API_KEY!;
const IPN_SECRET = process.env.TATUM_IPN_SECRET!;
const KMS_SIGNATURE_IDS = {
  BTC: process.env.TATUM_KMS_BTC_SIGNATURE_ID!,
  ETH: process.env.TATUM_KMS_ETH_SIGNATURE_ID!,
  TRON: process.env.TATUM_KMS_TRON_SIGNATURE_ID!,
  SOLANA: process.env.TATUM_KMS_SOLANA_SIGNATURE_ID!,
  RIPPLE: process.env.TATUM_KMS_RIPPLE_SIGNATURE_ID!,
};

const IS_TATUM_MOCK = process.env.TATUM_MOCK === "true";

if (IS_TATUM_MOCK) {
  logger.warn("🔴 Tatum is running in MOCK MODE - no real transactions");
}

// TYPES

export interface CreateCustomerParams {
  externalId: string;
}

export interface CreateVirtualAccountParams {
  customerId: string;
  currency: string;
}

export interface GenerateDepositAddressParams {
  accountId: string;
}

export interface SendCryptoParams {
  fromAddress: string;
  to: string;
  amount: string;
  currency: string; // "BTC", "ETH", "USDT" (uppercase)
  signatureId: string;
  chainType: ChainType;
  networkPath: string;
  fee?: string;
  nonce?: number;
  gasPrice?: string;
  gasLimit?: string;
  masterWalletBalance?: string;
}

export interface SweepParams extends SendCryptoParams {
  fromAddress: string;
  to: string;
}

export interface ExchangeRateParams {
  symbol: string;
  basePair?: string;
}

export interface TransactionStatusResponse {
  status: "pending" | "confirmed" | "failed";
  confirmations?: number;
  blockNumber?: number;
  txHash: string;
}

export interface SubscriptionParams {
  type:
    | "ACCOUNT_INCOMING_BLOCKCHAIN_TRANSACTION"
    | "ACCOUNT_PENDING_BLOCKCHAIN_TRANSACTION";
  id: string;
  url: string;
}

export interface IpnPaymentPayload {
  id: string;
  type: string;
  subscriptionType: string;
  accountId: string;
  txId: string;
  address: string;
  amount: string;
  asset: string;
  chain: string;
  blockNumber?: number;
  blockHash?: string;
  txDate?: string;
  counterAddress?: string;
  countConfirmations?: number;
  counterAccountId?: string;
  internalId?: string;
}

export class TatumService {
  private client: AxiosInstance;
  private cacheService: CacheService;

  constructor() {
    this.client = axios.create({
      baseURL: BASE_URL,
      headers: {
        "x-api-key": API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 30_000,
    });

    this.client.interceptors.response.use(
      (res) => res,
      (err) => {
        const msg = err?.response?.data?.message || err.message;
        logger.error("Tatum API error - FULL RESPONSE", {
          status: err?.response?.status,
          message: msg,
          data: err?.response?.data,
          url: err?.config?.url,
          requestBody: err?.config?.data ? JSON.parse(err.config.data) : null,
        });
        return Promise.reject(new Error(`Tatum: ${msg}`));
      },
    );

    this.cacheService = new CacheService();
  }

  // CUSTOMER MANAGEMENT
  async createCustomer(
    params: CreateCustomerParams,
  ): Promise<{ customerId: string }> {
    if (IS_TATUM_MOCK) {
      logger.info(`[MOCK] createCustomer: ${params.externalId}`);
      return { customerId: `mock_customer_${params.externalId}` };
    }

    try {
      const res = await this.client.post("/v3/ledger/customer", {
        externalId: params.externalId,
        accountingCurrency: "NGN",
      });

      logger.info(`Customer created for user ${params.externalId}`, {
        customerId: res.data.id,
      });

      return { customerId: res.data.id };
    } catch (error: any) {
      this.handleError(error, "Create customer");
    }
  }

  // VIRTUAL ACCOUNTS
  async createVirtualAccount(
    params: CreateVirtualAccountParams,
  ): Promise<{ accountId: string; balance: string }> {
    if (IS_TATUM_MOCK) {
      logger.info(`[MOCK] createVirtualAccount: ${params.currency}`);
      return {
        accountId: `mock_account_${params.currency}_${Date.now()}`,
        balance: "0",
      };
    }

    try {
      const res = await this.client.post("/v3/ledger/accounts", {
        currency: params.currency,
        customerId: params.customerId,
        accountingCurrency: "NGN",
      });

      logger.info(`Virtual Account created`, {
        accountId: res.data.id,
        currency: params.currency,
      });

      return {
        accountId: res.data.id,
        balance: res.data.balance || "0",
      };
    } catch (error: any) {
      this.handleError(error, "Create virtual account");
    }
  }

  // DEPOSIT ADDRESSES
  async generateDepositAddress(
    params: GenerateDepositAddressParams,
  ): Promise<{ address: string; derivationIndex: number }> {
    if (IS_TATUM_MOCK) {
      logger.info(
        `[MOCK] generateDepositAddress for account ${params.accountId}`,
      );
      return {
        address: this.mockGenerateAddress(),
        derivationIndex: Math.floor(Math.random() * 1000),
      };
    }

    try {
      const res = await this.client.post(
        `/v3/ledger/accounts/${params.accountId}/address`,
        {},
      );

      logger.info(`Deposit address generated`, {
        accountId: params.accountId,
        address: res.data.address,
      });

      return {
        address: res.data.address,
        derivationIndex: res.data.derivationIndex || 0,
      };
    } catch (error: any) {
      this.handleError(error, "Generate deposit address");
    }
  }

  // TRANSACTIONS: SEND/SWEEP - DYNAMIC ROUTING
  async sendCryptoFromMasterWallet(
    params: SendCryptoParams,
  ): Promise<{ txHash: string; tatumPendingId?: string }> {
    if (IS_TATUM_MOCK) {
      logger.info(`[MOCK] sendCryptoFromMasterWallet to ${params.to}`, {
        amount: params.amount,
        currency: params.currency,
        chainType: params.chainType,
      });
      return { txHash: this.mockGenerateTxHash() };
    }

    try {
      const currency = params.currency.toUpperCase();

      // DYNAMIC: Build endpoint from networkPath instead of hardcoded switch
      const endpoint = `/v3/${params.networkPath.toLowerCase()}/transaction`;

      // DYNAMIC: Build payload based on chainType
      const body = this.buildTransactionPayload(params);

      logger.info(`Sending ${params.amount} ${currency} to ${params.to}`, {
        endpoint,
        chainType: params.chainType,
        networkPath: params.networkPath,
      });

      logger.info(`[DEBUG] TATUM PAYLOAD`, {
        payload: JSON.stringify(body, null, 2),
      });

      const res = await this.client.post(endpoint, body);

      const tatumPendingId = res.data.id ?? res.data.signatureId ?? undefined;
      const txHash =
        res.data.txId ?? res.data.hash ?? tatumPendingId ?? "pending";

      logger.info(`Crypto sent / queued`, {
        txHash,
        tatumPendingId,
        currency: params.currency,
      });

      return { txHash, tatumPendingId };
    } catch (error: any) {
      this.handleError(error, "Send crypto", HTTP_STATUS.BAD_GATEWAY);
    }
  }

  async sweepToMasterWallet(
    params: SweepParams,
  ): Promise<{ txHash: string; tatumPendingId?: string }> {
    if (IS_TATUM_MOCK) {
      logger.info(`[MOCK] sweepToMasterWallet from ${params.fromAddress}`, {
        amount: params.amount,
      });
      return { txHash: this.mockGenerateTxHash() };
    }

    try {
      const currency = params.currency.toUpperCase();

      // DYNAMIC: Build endpoint from networkPath
      const endpoint = `/v3/${params.networkPath.toLowerCase()}/transaction`;

      // DYNAMIC: Build payload based on chainType
      const body = this.buildTransactionPayload(params);

      logger.info(`Sweeping ${params.amount} ${currency} to master wallet`, {
        fromAddress: params.fromAddress,
        endpoint,
        chainType: params.chainType,
      });

      const res = await this.client.post(endpoint, body);

      const tatumPendingId = res.data.id ?? res.data.signatureId ?? undefined;
      const txHash =
        res.data.txId ?? res.data.hash ?? tatumPendingId ?? "pending";

      logger.info(`Sweep initiated successfully`, {
        txHash,
        tatumPendingId,
        from: params.fromAddress,
      });

      return { txHash, tatumPendingId };
    } catch (error: any) {
      this.handleError(
        error,
        "Sweep to master wallet",
        HTTP_STATUS.BAD_GATEWAY,
      );
    }
  }

  async generateAddressFromXpub(params: {
    networkPath: string;
    xpub: string;
    index: number;
    isTestnet?: boolean;
  }): Promise<{ address: string }> {
    if (IS_TATUM_MOCK) {
      return { address: this.mockGenerateAddress() };
    }

    const testnetParam = params.isTestnet ? "?type=testnet" : "";
    const res = await this.client.get(
      `/v3/${params.networkPath}/address/${params.xpub}/${params.index}${testnetParam}`,
    );

    return { address: res.data.address };
  }

  async createAddressSubscription(params: {
    address: string;
    chain: string; // "BTC", "ETH", "TRON" etc
    url: string;
    isTestnet?: boolean;
  }): Promise<{ subscriptionId: string }> {
    if (IS_TATUM_MOCK) {
      return { subscriptionId: `mock_sub_${Date.now()}` };
    }

    try {
      const typeParam = params.isTestnet ? "?type=testnet" : "?type=mainnet";
      const res = await this.client.post(`/v4/subscription${typeParam}`, {
        type: "ADDRESS_EVENT",
        attr: {
          address: params.address,
          chain: params.chain,
          url: params.url,
        },
      });

      logger.info(`Address subscription created`, {
        subscriptionId: res.data.id,
        address: params.address,
        chain: params.chain,
      });

      return { subscriptionId: res.data.id };
    } catch (error: any) {
      this.handleError(error, "Create address subscription");
    }
  }

  // HELPER: BUILD PAYLOAD BASED ON CHAIN TYPE
  private buildTransactionPayload(params: SendCryptoParams): any {
    const {
      chainType,
      fromAddress,
      to,
      amount,
      signatureId,
      fee,
      gasPrice,
      gasLimit,
      nonce,
    } = params;

    switch (chainType) {
      case "BITCOIN":
        const signingMethod =
          process.env.TATUM_ENVIRONMENT === "mainnet"
            ? { signatureId }
            : { privateKey: process.env.TATUM_BTC_PRIVATE_KEY! };

        const balance = params.masterWalletBalance
          ? parseFloat(params.masterWalletBalance)
          : 0;
        const sendAmount = parseFloat(amount);
        const feeAmount = parseFloat(fee || "0.0005");
        const changeAmount = balance - sendAmount - feeAmount;

        const toArray: any[] = [
          {
            address: to,
            value: sendAmount,
          },
        ];

        if (changeAmount > 0.00000001) {
          toArray.push({
            address: fromAddress, // Change goes back to master wallet
            value: Math.round(changeAmount * 100000000) / 100000000, // Round to 8 decimals
          });
        }

        return {
          fromAddress: [
            {
              address: fromAddress,
              ...signingMethod,
            },
          ],
          to: toArray,
          fee: fee || "0.0005",
          changeAddress: fromAddress,
        };

      case "EVM":
        // All EVM chains: Ethereum, BSC, Polygon, Arbitrum, Base, Optimism, Avalanche, etc.
        const evmSigningMethod =
          process.env.TATUM_ENVIRONMENT === "mainnet"
            ? { signatureId }
            : { privateKey: process.env.TATUM_ETH_PRIVATE_KEY! }; // Private key for testnet

        return {
          to,
          amount,
          fromAddress,
          ...evmSigningMethod,
          gasPrice: gasPrice || "20",
          gasLimit: gasLimit || "21000",
          nonce,
        };

      case "TRON":
        // Tron specific
        const tronSigningMethod =
          process.env.TATUM_ENVIRONMENT === "mainnet"
            ? { signatureId } // KMS for production
            : { privateKey: process.env.TATUM_TRON_PRIVATE_KEY! }; // Private key for testnet

        return {
          from: fromAddress,
          to,
          amount,
          ...tronSigningMethod,
          feeLimit: fee || "1",
        };

      case "SOLANA":
        // Solana specific (if implemented in future)
        return {
          from: fromAddress,
          to,
          amount,
          signatureId,
          fee: fee || "5000",
        };

      case "RIPPLE":
        // XRP specific (if implemented in future)
        return {
          from: fromAddress,
          to,
          amount,
          signatureId,
          fee: fee || "12",
        };

      default:
        throw new AppError(
          `Unsupported blockchain architecture: ${chainType}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
    }
  }

  // TRANSACTION STATUS
  async getTransactionStatus(
    txHash: string,
    chainType: ChainType,
    networkPath: string,
  ): Promise<TransactionStatusResponse> {
    if (IS_TATUM_MOCK) {
      logger.info(`[MOCK] getTransactionStatus: ${txHash}`);
      return {
        status: "confirmed",
        confirmations: 6,
        blockNumber: 18000000,
        txHash,
      };
    }

    try {
      // DYNAMIC: Endpoint based on networkPath
      const endpoint = `/v3/${networkPath.toLowerCase()}/transaction/${txHash}`;

      const res = await this.client.get(endpoint);

      const status = res.data.status?.toLowerCase() || "pending";
      const confirmations =
        res.data.confirmations || res.data.countConfirmations || 0;

      return {
        status: ["confirmed", "success"].includes(status)
          ? "confirmed"
          : status === "failed"
            ? "failed"
            : "pending",
        confirmations,
        blockNumber: res.data.blockNumber,
        txHash,
      };
    } catch (error: any) {
      logger.error("Tatum getTransactionStatus failed", error);
      return {
        status: "pending",
        confirmations: 0,
        txHash,
      };
    }
  }

  // EXCHANGE RATES
  async getExchangeRate(params: ExchangeRateParams): Promise<number> {
    if (IS_TATUM_MOCK) {
      logger.info(`[MOCK] getExchangeRate: ${params.symbol}`);
      const mockRates: Record<string, number> = {
        BTC: 45000,
        ETH: 2500,
        USDT: 1,
        USDC: 1,
        TRON: 0.15,
      };
      return mockRates[params.symbol.toUpperCase()] || 1;
    }

    try {
      const cacheKey = CACHE_KEYS.TATUM_EXCHANGE_RATE(
        params.symbol,
        params.basePair || "USD",
      );

      const cached = await this.cacheService.get<number>(cacheKey);
      if (cached) {
        logger.debug(`Using cached rate for ${params.symbol}`);
        return cached;
      }

      const res = await this.client.get("/v4/data/rate/symbol", {
        params: {
          symbol: params.symbol.toUpperCase(),
          basePair: params.basePair || "USD",
        },
      });

      const rate = res.data.value ?? null;

      if (!rate || rate <= 0) {
        throw new AppError(
          `Invalid exchange rate returned for ${params.symbol}`,
          HTTP_STATUS.BAD_GATEWAY,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

      await this.cacheService.set(
        cacheKey,
        rate,
        CACHE_TTL.FIVE_MINUTES || 300,
      );

      logger.info(
        `Exchange rate fetched: ${params.symbol}/${params.basePair || "USD"} = ${rate}`,
      );

      return rate;
    } catch (error: any) {
      this.handleError(error, "Fetch exchange rate");
    }
  }
  // BALANCE

  async getAccountBalance(accountId: string): Promise<string> {
    if (IS_TATUM_MOCK) {
      logger.info(`[MOCK] getAccountBalance: ${accountId}`);
      return "0";
    }

    try {
      const res = await this.client.get(`/v3/ledger/accounts/${accountId}`);
      const balance =
        res.data?.balance?.availableBalance ??
        res.data?.balance?.accountBalance ??
        "0";
      return balance;
    } catch (error: any) {
      logger.error("Tatum getAccountBalance failed", error);
      return "0";
    }
  }

  async getMasterWalletBalance(
    currency: string,
    networkPath: string,
    walletAddress: string,
  ): Promise<string> {
    if (IS_TATUM_MOCK) {
      logger.info(`[MOCK] getMasterWalletBalance: ${currency}`);
      return "10.5";
    }

    try {
      let endpoint: string;

      if (networkPath.toLowerCase() === "bitcoin") {
        endpoint = `/v3/${networkPath.toLowerCase()}/address/balance/${walletAddress}`;
      } else {
        endpoint = `/v3/${networkPath.toLowerCase()}/account/balance/${walletAddress}`;
      }

      const res = await this.client.get(endpoint);

      // Different responses for different chains
      const balance = res.data.balance || res.data.incoming || "0";

      logger.debug(`Wallet balance fetched`, {
        currency,
        walletAddress: walletAddress.substring(0, 10) + "...",
        balance,
      });

      return balance;
    } catch (error: any) {
      logger.error("Tatum getMasterWalletBalance failed", error);
      logger.error("Balance fetch details", {
        currency,
        networkPath,
        address: walletAddress.substring(0, 10) + "...",
      });
      return "0";
    }
  }

  async estimateGas(params: {
    fromAddress: string;
    toAddress: string;
    amount?: string;
    networkPath: string;
  }): Promise<{ gasCostUsd: number; gasPrice: string }> {
    try {
      const endpoint = `/v3/${params.networkPath.toLowerCase()}/transaction/estimate`;

      const res = await this.client.post(endpoint, {
        from: params.fromAddress,
        to: params.toAddress,
        amount: params.amount || "0.1",
      });

      // Parse response - adjust based on actual Tatum response
      const gasPrice = res.data.gasPrice || res.data.gwei || "50";
      const gasUnits = res.data.gasLimit || res.data.gas || "21000";

      return {
        gasCostUsd: parseFloat(res.data.gasCostUsd || "0"),
        gasPrice: gasPrice,
      };
    } catch (error) {
      logger.warn("Gas estimation failed", error);
      return { gasCostUsd: 0.5, gasPrice: "unknown" };
    }
  }

  // HMAC SETUP

  async enableHmac(): Promise<void> {
    if (IS_TATUM_MOCK) {
      logger.info("[MOCK] enableHmac skipped");
      return;
    }

    if (!process.env.TATUM_IPN_SECRET) {
      throw new AppError(
        "TATUM_IPN_SECRET is not set",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }

    try {
      await this.client.put("/v4/subscription", {
        hmacSecret: process.env.TATUM_IPN_SECRET,
      });

      logger.info("Tatum HMAC enabled successfully");
    } catch (error: any) {
      this.handleError(error, "Enable HMAC");
    }
  }

  // PRIVATE HELPERS

  //  ERROR HANDLING
  private handleError(
    error: any,
    operationType: string,
    statusCode: number = HTTP_STATUS.BAD_REQUEST,
    errorCode: string = ERROR_CODES.PROVIDER_ERROR,
  ): never {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error(`Tatum ${operationType} failed`, error);

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

  private mockGenerateAddress(): string {
    return `0x${[...Array(40)]
      .map(() => Math.floor(Math.random() * 16).toString(16))
      .join("")}`;
  }

  private mockGenerateTxHash(): string {
    return `0x${[...Array(64)]
      .map(() => Math.floor(Math.random() * 16).toString(16))
      .join("")}`;
  }

  getKmsSignatureIdForChain(chainType: ChainType): string {
    // Map ChainType to master blockchain in Tatum
    const chainMasterMap: Record<ChainType, keyof typeof KMS_SIGNATURE_IDS> = {
      EVM: "ETH", // All EVM use ETH master key (Ethereum mainnet)
      BITCOIN: "BTC", // All UTXO use BTC master key
      TRON: "TRON", // TRON specific
      SOLANA: "SOLANA", // Solana (if implemented)
      RIPPLE: "RIPPLE", // XRP (if implemented)
      OTHER: "ETH", // Default fallback to EVM
    };

    const masterChain = chainMasterMap[chainType];
    const signatureId =
      KMS_SIGNATURE_IDS[masterChain as keyof typeof KMS_SIGNATURE_IDS];

    if (!signatureId) {
      throw new AppError(
        `KMS signature ID not configured for blockchain ${masterChain}`,
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return signatureId;
  }
}

export default new TatumService();
