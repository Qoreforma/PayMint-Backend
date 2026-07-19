import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import logger from "@/logger";
import { CacheService } from "@/services/core/CacheService";
import { CACHE_KEYS } from "@/utils/constants";
import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";
import { ProviderRepository } from "@/repositories/shared/ProviderRepository";
import { Network } from "@/models/crypto/Network";
import { Crypto } from "@/models/crypto/Crypto";
import { ProviderRateConfigRepository } from "@/repositories/admin/Providerrateconfigrepository";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

//  Config
const BASE_URL =
  process.env.NOWPAYMENTS_SANDBOX === "true"
    ? "https://api-sandbox.nowpayments.io/v1"
    : "https://api.nowpayments.io/v1";

const API_KEY = process.env.NOWPAYMENTS_API_KEY!;
const API_EMAIL = process.env.NOWPAYMENTS_EMAIL!;
const API_PASSWORD = process.env.NOWPAYMENTS_PASSWORD!;
export const IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET!;

// Mock mode flag
const IS_NOWPAYMENTS_MOCK = process.env.ISNOWPAYMENTMOCK === "true";

if (IS_NOWPAYMENTS_MOCK) {
  logger.warn("🔴 NowPayments is running in MOCK MODE - no real transactions");
}

// MOCK UTILITIES

class MockDataGenerator {
  //Generate random address based on network code

  static generateAddressByNetwork(networkCode: string): string {
    const code = networkCode.toUpperCase();

    // ERC20 & EVM chains (Ethereum, BSC, Polygon)
    if (["ERC20", "BEP20", "MATIC"].includes(code)) {
      return `0x${this.randomHex(40)}`;
    }

    // TRON
    if (code === "TRC20") {
      return `T${this.randomBase58(34)}`;
    }

    // Bitcoin
    if (code === "BTC") {
      return `1${this.randomBase58(33)}`;
    }

    // Litecoin
    if (code === "LTC") {
      return `L${this.randomBase58(33)}`;
    }

    // Solana
    if (code === "SOL") {
      return this.randomBase58(44);
    }

    // Cardano
    if (code === "ADA") {
      return `addr1${this.randomBase58(58)}`;
    }

    // XRP
    if (code === "XRP") {
      return `r${this.randomBase58(33)}`;
    }

    // Dogecoin
    if (code === "DOGE") {
      return `D${this.randomBase58(33)}`;
    }

    // Default
    return `0x${this.randomHex(40)}`;
  }

  private static randomHex(length: number): string {
    const chars = "0123456789abcdef";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private static randomBase58(length: number): string {
    const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  static generateTxHash(): string {
    return `0x${this.randomHex(64)}`;
  }

  static generatePaymentId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  static generatePayoutId(): string {
    return `payout_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  static generateExpirationEstimate(): string {
    const date = new Date();
    date.setHours(date.getHours() + 1);
    return date.toISOString();
  }

  static generateWithdrawalId(): string {
    return `withdrawal_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}

// Types

export type NowPaymentsPaymentStatus =
  | "waiting"
  | "confirming"
  | "confirmed"
  | "sending"
  | "partially_paid"
  | "finished"
  | "failed"
  | "refunded"
  | "expired";

export type NowPaymentsPayoutStatus =
  | "waiting"
  | "processing"
  | "sending"
  | "finished"
  | "failed"
  | "rejected";

export interface CreatePaymentParams {
  priceAmount: number;
  priceCurrency: string;
  payAmount?: number;
  payCurrency: string;
  orderId: string;
  ipnCallbackUrl: string;
  payoutAddress?: string;
  payoutCurrency?: string;
}

export interface CreatePaymentResponse {
  paymentId: string;
  payAddress: string;
  payAmount: number;
  payCurrency: string;
  paymentStatus: NowPaymentsPaymentStatus;
  orderId: string;
  priceAmount: number;
  priceCurrency: string;
  createdAt: string;
  expirationEstimate: string;
}

export interface PaymentStatusResponse {
  paymentId: string;
  paymentStatus: NowPaymentsPaymentStatus;
  payAddress: string;
  payAmount: number;
  actuallyPaid: number;
  payCurrency: string;
  orderId: string;
  outcomeAmount?: number;
  outcomeCurrency?: string;
  txHash?: string;
  confirmedBlockCount?: number;
  updatedAt: string;
}

export interface PayoutWithdrawal {
  address: string;
  currency: string;
  amount?: number; // Optional if fiat_amount is used
  fiat_amount?: number; // The USD value to send
  fiat_currency?: string; // e.g., "usd"
  ipn_callback_url?: string;
  extra_id?: string;
}

export interface CreatePayoutParams {
  ipnCallbackUrl: string;
  withdrawals: PayoutWithdrawal[];
}

export interface CreatePayoutResponse {
  id: string;
  status: NowPaymentsPayoutStatus;
  withdrawals: Array<{
    id: string;
    address: string;
    currency: string;
    amount: number;
    status: NowPaymentsPayoutStatus;
    batchWithdrawalId: string;
  }>;
  createdAt: string;
}

export interface IpnPaymentPayload {
  payment_id: string;
  payment_status: NowPaymentsPaymentStatus;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  actually_paid: number;
  pay_currency: string;
  order_id: string;
  order_description?: string;
  purchase_id?: string;
  outcome_amount?: number;
  outcome_currency?: string;
  hash?: string;
  updated_at: string;
  created_at: string;
  fee?: {
    currency: string;
    depositFee: number;
    withdrawalFee: number;
    serviceFee: number;
  };
}

export interface IpnPayoutPayload {
  id: string;
  withdrawal_id?: string;
  status: NowPaymentsPayoutStatus;
  address: string;
  amount: number;
  currency: string;
  hash?: string;
  error?: string;
  batch_withdrawal_id?: string;
  created_at: string;
  updated_at: string;
  fee?: {
    currency: string;
    depositFee: number;
    withdrawalFee: number;
    serviceFee: number;
  };
}

export class NowPaymentsService {
  private client: AxiosInstance;
  private jwtToken: string | null = null;
  private jwtExpiresAt: number = 0;
  private cryptoRepository: CryptoRepository;
  private networkRepository: NetworkRepository;
  private providerRepository: ProviderRepository;
  private providerRateConfigRepository: ProviderRateConfigRepository;
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
        logger.error("NowPayments API error", {
          status: err?.response?.status,
          message: msg,
          url: err?.config?.url,
        });
        return Promise.reject(new Error(`NowPayments: ${msg}`));
      },
    );

    this.cryptoRepository = new CryptoRepository();
    this.networkRepository = new NetworkRepository();
    this.providerRepository = new ProviderRepository();
    this.providerRateConfigRepository = new ProviderRateConfigRepository();
    this.cacheService = new CacheService();
  }

  // getJwt METHOD
  private async getJwt(): Promise<string> {
    const now = Date.now();

    // Check if token is still valid (with 1-minute buffer)
    if (this.jwtToken && now < this.jwtExpiresAt - 60_000) {
      return this.jwtToken;
    }

    if (IS_NOWPAYMENTS_MOCK) {
      this.jwtToken = `mock_jwt_token_${Date.now()}`;
      this.jwtExpiresAt = now + 23 * 60 * 60 * 1000;
      return this.jwtToken;
    }

    try {
      const res = await this.client.post("/auth", {
        email: API_EMAIL,
        password: API_PASSWORD,
      });

      this.jwtToken = res.data.token as string;
      // NOWPayments tokens usually last 24 hours
      this.jwtExpiresAt = now + 23 * 60 * 60 * 1000;

      return this.jwtToken;
    } catch (error: any) {
      // Clear token on failure to prevent using stale/invalid credentials
      this.jwtToken = null;
      this.jwtExpiresAt = 0;

      logger.error("NowPayments JWT authentication failed", error);

      //  PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error?.response?.data?.message ||
        error.message ||
        "Authentication failed";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Payment service authentication failed. Please try again later."
          : detailedErrorMessage;

      throw new Error(finalErrorMessage);
    }
  }

  // createPayment METHOD (error handling in catch)
  async createPayment(
    params: CreatePaymentParams,
  ): Promise<CreatePaymentResponse> {
    return SentryHelper.trackCriticalOperation(
      "nowpayments_create_payment",
      async () => {
        if (IS_NOWPAYMENTS_MOCK) {
          return this.mockCreatePayment(params);
        }

        try {
          const body = {
            price_amount: params.priceAmount,
            price_currency: params.priceCurrency,
            pay_currency: params.payCurrency,
            order_id: params.orderId,
            ipn_callback_url: params.ipnCallbackUrl,
            ...(params.payoutAddress && {
              payout_address: params.payoutAddress,
              payout_currency: params.payoutCurrency,
            }),
          };

          const res = await this.client.post("/payment", body);
          const d = res.data;

          return {
            paymentId: String(d.payment_id),
            payAddress: d.pay_address,
            payAmount: d.pay_amount,
            payCurrency: d.pay_currency,
            paymentStatus: d.payment_status,
            orderId: d.order_id,
            priceAmount: d.price_amount,
            priceCurrency: d.price_currency,
            createdAt: d.created_at,
            expirationEstimate: d.expiration_estimate_date || "",
          };
        } catch (error: any) {
          logger.error("NowPayments createPayment failed", error);

          //  PRODUCTION ERROR HANDLING
          const detailedErrorMessage =
            error?.response?.data?.message ||
            error.message ||
            "Payment creation failed";
          const finalErrorMessage =
            process.env.NODE_ENV === "production"
              ? "Payment creation failed. Please try again later."
              : detailedErrorMessage;

          throw new Error(finalErrorMessage);
        }
      },
      params.orderId,
    );
  }

  // getPaymentStatus METHOD
  async getPaymentStatus(paymentId: string): Promise<PaymentStatusResponse> {
    if (IS_NOWPAYMENTS_MOCK) {
      return this.mockGetPaymentStatus(paymentId);
    }

    try {
      const res = await this.client.get(`/payment/${paymentId}`);
      const d = res.data;

      return {
        paymentId: String(d.payment_id),
        paymentStatus: d.payment_status,
        payAddress: d.pay_address,
        payAmount: d.pay_amount,
        actuallyPaid: d.actually_paid,
        payCurrency: d.pay_currency,
        orderId: d.order_id,
        outcomeAmount: d.outcome_amount,
        outcomeCurrency: d.outcome_currency,
        txHash: d.hash,
        confirmedBlockCount: d.confirmedBlockCount,
        updatedAt: d.updated_at,
      };
    } catch (error: any) {
      logger.error("NowPayments getPaymentStatus failed", error);

      //  PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error?.response?.data?.message ||
        error.message ||
        "Failed to fetch payment status";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch payment status. Please try again later."
          : detailedErrorMessage;

      throw new Error(finalErrorMessage);
    }
  }

  // getMinimumPaymentAmount METHOD
  async getMinimumPaymentAmount(
    currencyFrom: string,
    currencyTo: string,
  ): Promise<number> {
    if (IS_NOWPAYMENTS_MOCK) {
      logger.info(
        `[MOCK] getMinimumPaymentAmount: ${currencyFrom} -> ${currencyTo}`,
      );
      return 0.1;
    }

    try {
      const res = await this.client.get("/min-amount", {
        params: { currency_from: currencyFrom, currency_to: currencyTo },
      });
      return res.data.min_amount;
    } catch (error: any) {
      logger.error("NowPayments getMinimumPaymentAmount failed", error);

      //  PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error?.response?.data?.message ||
        error.message ||
        "Failed to fetch minimum amount";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch minimum amount. Please try again later."
          : detailedErrorMessage;

      throw new Error(finalErrorMessage);
    }
  }

  // createPayout METHOD
  async createPayout(
    params: CreatePayoutParams,
  ): Promise<CreatePayoutResponse> {
    return SentryHelper.trackCriticalOperation(
      "nowpayments_create_payout",
      async () => {
        if (IS_NOWPAYMENTS_MOCK) return this.mockCreatePayout(params);

        try {
          const jwt = await this.getJwt();

          const body = {
            ipn_callback_url: params.ipnCallbackUrl,
            withdrawals: params.withdrawals.map((w) => ({
              address: w.address,
              currency: w.currency.toLowerCase(),
              ...(w.fiat_amount
                ? {
                    fiat_amount: w.fiat_amount,
                    fiat_currency: w.fiat_currency || "usd",
                  }
                : {
                    amount: w.amount,
                  }),
              ...(w.ipn_callback_url && {
                ipn_callback_url: w.ipn_callback_url,
              }),
              ...(w.extra_id && { extra_id: w.extra_id }),
            })),
          };

          const res = await this.client.post("/payout", body, {
            headers: { Authorization: `Bearer ${jwt}` },
          });

          const d = res.data;
          return {
            id: String(d.id),
            status: d.status,
            withdrawals: (d.withdrawals || []).map((w: any) => ({
              id: String(w.id),
              address: w.address,
              currency: w.currency,
              amount: w.amount,
              status: w.status,
              batchWithdrawalId: String(w.batch_withdrawal_id || d.id),
            })),
            createdAt: d.created_at,
          };
        } catch (error: any) {
          logger.error("NowPayments createPayout failed", error);

          //  PRODUCTION ERROR HANDLING
          const detailedErrorMessage =
            error?.response?.data?.message ||
            error.message ||
            "Payout creation failed";
          const finalErrorMessage =
            process.env.NODE_ENV === "production"
              ? "Payout creation failed. Please try again later."
              : detailedErrorMessage;

          throw new Error(finalErrorMessage);
        }
      },
      params.withdrawals[0]?.address || "batch_payout",
    );
  }

  // verifyPayout METHOD
  async verifyPayout(
    payoutId: string,
    verificationCode: string,
  ): Promise<void> {
    if (IS_NOWPAYMENTS_MOCK) {
      logger.info(`[MOCK] verifyPayout: ${payoutId}`, {
        verificationCode,
      });
      return;
    }

    try {
      const jwt = await this.getJwt();

      await this.client.post(
        "/payout/verify",
        { id: payoutId, verification_code: verificationCode },
        { headers: { Authorization: `Bearer ${jwt}` } },
      );
    } catch (error: any) {
      logger.error("NowPayments verifyPayout failed", error);

      //  PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error?.response?.data?.message ||
        error.message ||
        "Payout verification failed";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Payout verification failed. Please try again later."
          : detailedErrorMessage;

      throw new Error(finalErrorMessage);
    }
  }

  // getPayoutStatus METHOD
  async getPayoutStatus(
    payoutId: string,
  ): Promise<{ id: string; status: NowPaymentsPayoutStatus }> {
    if (IS_NOWPAYMENTS_MOCK) {
      logger.info(`[MOCK] getPayoutStatus: ${payoutId}`);
      return { id: payoutId, status: "finished" };
    }

    try {
      const jwt = await this.getJwt();

      const res = await this.client.get(`/payout/${payoutId}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });

      return { id: String(res.data.id), status: res.data.status };
    } catch (error: any) {
      logger.error("NowPayments getPayoutStatus failed", error);

      //  PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error?.response?.data?.message ||
        error.message ||
        "Failed to fetch payout status";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch payout status. Please try again later."
          : detailedErrorMessage;

      throw new Error(finalErrorMessage);
    }
  }
  // getAvailableCurrencies METHOD
  async getAvailableCurrencies(): Promise<string[]> {
    if (IS_NOWPAYMENTS_MOCK) {
      logger.info(`[MOCK] getAvailableCurrencies`);
      return [
        "btc",
        "eth",
        "ltc",
        "usdttrc20",
        "usdterc20",
        "usdtbsc",
        "usdtsol",
        "sol",
        "bnbbsc",
        "maticpolygon",
      ];
    }

    try {
      const cacheKey = CACHE_KEYS.NOWPAYMENTS_AVAILABLE_CURRENCIES;

      const cached = await this.cacheService.get(cacheKey);
      if (cached) return cached as string[];

      // Use merchant/coins to return only admin-selected coins
      const res = await this.client.get("/merchant/coins");
      return res.data?.selectedCurrencies ?? res.data?.currencies ?? [];
    } catch (error: any) {
      logger.error("NowPayments getAvailableCurrencies failed", error);

      const detailedErrorMessage =
        error?.response?.data?.message ||
        error.message ||
        "Failed to fetch available currencies";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch available currencies. Please try again later."
          : detailedErrorMessage;

      throw new Error(finalErrorMessage);
    }
  }

  // syncNowPaymentsCryptos METHOD
  async syncNowPaymentsCryptos(): Promise<any> {
    return SentryHelper.trackCriticalOperation(
      "nowpayments_sync_cryptos",
      async () => {
        try {
          logger.info("Starting NowPayments crypto sync...");

          const provider = await this.providerRepository.findOne({
            code: "nowpayment",
          });
          if (!provider) {
            const errorMsg = "NOWPAYMENTS provider not found";
            logger.error(errorMsg);
            throw new Error(errorMsg);
          }

          const rateConfig =
            await this.providerRateConfigRepository.findByProviderCode(
              "nowpayment",
            );

          const buyRate = rateConfig?.buyRate ?? null;
          const sellRate = rateConfig?.sellRate ?? null;

          if (!rateConfig) {
            logger.warn(
              "No ProviderRateConfig found for nowpayment — cryptos will sync without buy/sell rates",
            );
          } else {
            logger.info(
              `Using rate config for nowpayment — buyRate: ${buyRate}, sellRate: ${sellRate}`,
            );
          }

          //  Get only the coins the admin enabled in NowPayments Coins Settings
          const merchantCoinsRes = await this.client.get("/merchant/coins");

          const merchantCurrencies: string[] =
            merchantCoinsRes.data?.selectedCurrencies ??
            merchantCoinsRes.data?.currencies ??
            [];

          if (
            !Array.isArray(merchantCurrencies) ||
            !merchantCurrencies.length
          ) {
            throw new Error(
              `No coins found in NowPayments merchant settings — please enable at least one coin in your NowPayments dashboard. Response: ${JSON.stringify(merchantCoinsRes.data)}`,
            );
          }

          const selectedCodes = new Set<string>(
            merchantCurrencies
              .map((c: any) =>
                (typeof c === "string" ? c : (c?.code ?? "")).toLowerCase(),
              )
              .filter(Boolean),
          );

          logger.info(
            `Admin has ${selectedCodes.size} coins enabled in NowPayments Coins Settings`,
            {
              coins: Array.from(selectedCodes),
            },
          );
          if (!selectedCodes.size) {
            throw new Error(
              "No coins selected in NowPayments Coins Settings — please enable at least one coin in your NowPayments dashboard before syncing",
            );
          }

          //  Get full metadata for all platform currencies
          const fullRes = await this.client.get("/full-currencies");
          const allCurrencies: any[] = fullRes.data.currencies || [];

          if (!allCurrencies.length) {
            throw new Error(
              "No currencies returned from NowPayments full-currencies API",
            );
          }

          //  Filter down to only admin-selected coins
          const currencies = allCurrencies.filter((c: any) =>
            selectedCodes.has(c.code?.toLowerCase()),
          );

          logger.info(
            `Matched ${currencies.length} of ${selectedCodes.size} selected coins with full metadata`,
          );

          if (!currencies.length) {
            throw new Error(
              "None of the admin-selected coins were found in full-currencies metadata — this is unexpected, contact NowPayments support",
            );
          }

          const cryptoMap = new Map();
          const networkMap = new Map();

          // Extract currencies and prepare data
          for (const currency of currencies) {
            if (!currency.code || !currency.network || !currency.network.trim())
              continue;

            const cryptoCode = currency.code.toUpperCase();
            const networkId = currency.network.toLowerCase();
            const pCode = currency.code.toLowerCase();
            const iconFullUrl = currency.logo_url
              ? `https://nowpayments.io${currency.logo_url}`
              : null;

            if (!networkMap.has(networkId)) {
              networkMap.set(networkId, {
                networkId: networkId,
                providerId: provider._id,
                code: currency.network.toUpperCase(),
                name: currency.name,
                addressPattern: currency.wallet_regex,
                isActive: true,
              });
            }

            if (!cryptoMap.has(pCode)) {
              cryptoMap.set(pCode, {
                providerId: provider._id,
                providerCode: pCode,
                code: cryptoCode,
                name: currency.name.split(" ")[0],
                icon: iconFullUrl,
                isActive: currency.enable,
                purchaseActivated: currency.available_for_payout,
                saleActivated: false,
                assetId: currency.id.toString(),
                targetNetworkId: networkId,
                walletAddressRegex: currency.wallet_regex,
                extraIdRequired: currency.extra_id_exists || false,
                extraIdRegex: currency.extra_id_regex,
                extraIdName: this.inferExtraIdName(networkId),
                ...(buyRate !== null && { buyRate }),
                ...(sellRate !== null && { sellRate }),
              });
            }
          }

          // Fetch minimum amounts for each coin and convert to USD
          logger.info("Fetching minimum payment amounts from NowPayments...");
          for (const [pCode, cryptoData] of cryptoMap) {
            try {
              // Get minimum in crypto units (e.g., 0.001 BTC)
              const minAmountInCrypto = await this.getMinimumPaymentAmount(
                pCode.toLowerCase(),
                pCode.toLowerCase(),
              );

              // Determine exchange rate for conversion
              let exchangeRate = buyRate;

              if (!exchangeRate) {
                const rateConfig =
                  await this.providerRateConfigRepository.findByProviderCode(
                    "nowpayment",
                  );
                exchangeRate = rateConfig?.buyRate || 0;
              }

              if (!exchangeRate || exchangeRate <= 0) {
                logger.warn(
                  `No valid exchange rate found for ${pCode}, cannot convert minimum amount. Using default $5 USD.`,
                );
                cryptoData.buyMinAmount = 5;
                cryptoData.sellMinAmount = 5;
                continue;
              }

              // Convert crypto minimum to USD
              const minAmountInUSD = minAmountInCrypto * exchangeRate;

              cryptoData.buyMinAmount = minAmountInUSD;
              cryptoData.sellMinAmount = minAmountInUSD;

              logger.info(
                `Minimum amount for ${pCode}: ${minAmountInCrypto} ${pCode.toUpperCase()} = $${minAmountInUSD.toFixed(2)} USD`,
                {
                  cryptoMinimum: minAmountInCrypto,
                  usdMinimum: minAmountInUSD,
                  exchangeRate,
                },
              );
            } catch (err: any) {
              logger.warn(
                `Failed to get/convert minimum amount for ${pCode}, using default $5 USD`,
                err.message,
              );
              cryptoData.buyMinAmount = 5;
              cryptoData.sellMinAmount = 5;
            }
          }

          // Save Networks
          const savedNetworks = new Map();
          for (const [netId, networkData] of networkMap) {
            const saved = await Network.findOneAndUpdate(
              { networkId: netId, providerId: provider._id },
              { ...networkData },
              { upsert: true, new: true },
            );
            savedNetworks.set(netId, saved._id);
          }

          for (const [pCode, cryptoData] of cryptoMap) {
            const networkObjectId = savedNetworks.get(
              cryptoData.targetNetworkId,
            );
            const { targetNetworkId, ...finalCryptoData } = cryptoData;

            const {
              isActive,
              purchaseActivated,
              saleActivated,
              buyRate,
              sellRate,
              ...metadataFields
            } = finalCryptoData;

            await Crypto.findOneAndUpdate(
              { providerCode: pCode, providerId: provider._id },
              {
                $setOnInsert: {
                  isActive,
                  purchaseActivated,
                  saleActivated,
                  ...(buyRate !== null && { buyRate }),
                  ...(sellRate !== null && { sellRate }),
                },
                $set: {
                  ...metadataFields,
                  networks: [networkObjectId],
                  lastSyncUpdate: new Date(),
                },
              },
              { upsert: true, new: true },
            );
          }

          logger.info("NowPayments sync successful.");
          return {
            cryptosCount: cryptoMap.size,
            networksCount: networkMap.size,
            syncedAt: new Date(),
          };
        } catch (err: any) {
          logger.error("NowPayments sync failed", { error: err.message });

          const detailedErrorMessage = err.message || "Sync failed";
          const finalErrorMessage =
            process.env.NODE_ENV === "production"
              ? "Sync failed. Please try again later."
              : detailedErrorMessage;

          throw new Error(finalErrorMessage);
        }
      },
      `sync_${new Date().toISOString()}`,
    );
  }

  private inferExtraIdName(networkId: string): string | null {
    const mapping: Record<string, string> = {
      xrp: "destination_tag",
      ripple: "destination_tag",
      eos: "memo",
      xlm: "memo",
      stellar: "memo",
      atom: "memo",
      cosmos: "memo",
      xem: "message",
      nem: "message",
    };

    const lowerNetId = networkId.toLowerCase();
    return mapping[lowerNetId] || null;
  }

  private mockCreatePayment(
    params: CreatePaymentParams,
  ): CreatePaymentResponse {
    const now = new Date();
    const expiration = new Date();
    expiration.setHours(expiration.getHours() + 1);

    // Generate random address for this currency (rotates each call)
    const mockAddress = MockDataGenerator.generateAddressByNetwork(
      params.payCurrency.toUpperCase(),
    );

    logger.info(`[MOCK] createPayment: ${params.orderId}`, {
      address: mockAddress,
      amount: params.payAmount,
      currency: params.payCurrency,
    });

    return {
      paymentId: MockDataGenerator.generatePaymentId(),
      payAddress: mockAddress,
      payAmount: params.payAmount || 0,
      payCurrency: params.payCurrency,
      paymentStatus: "waiting",
      orderId: params.orderId,
      priceAmount: params.priceAmount,
      priceCurrency: params.priceCurrency,
      createdAt: now.toISOString(),
      expirationEstimate: expiration.toISOString(),
    };
  }

  private mockGetPaymentStatus(paymentId: string): PaymentStatusResponse {
    logger.info(`[MOCK] getPaymentStatus: ${paymentId}`);

    return {
      paymentId,
      paymentStatus: "confirmed",
      payAddress: MockDataGenerator.generateAddressByNetwork("ERC20"),
      payAmount: 1.5,
      actuallyPaid: 1.5,
      payCurrency: "eth",
      orderId: `order_${paymentId}`,
      outcomeAmount: 1.5,
      outcomeCurrency: "eth",
      txHash: MockDataGenerator.generateTxHash(),
      confirmedBlockCount: 12,
      updatedAt: new Date().toISOString(),
    };
  }

  private mockCreatePayout(params: CreatePayoutParams): CreatePayoutResponse {
    const payoutId = MockDataGenerator.generatePayoutId();

    logger.info(`[MOCK] createPayout: ${payoutId}`, {
      withdrawals: params.withdrawals.length,
      amounts: params.withdrawals.map((w) => `${w.amount} ${w.currency}`),
    });

    return {
      id: payoutId,
      status: "waiting",
      withdrawals: params.withdrawals.map((w) => ({
        id: MockDataGenerator.generateWithdrawalId(),
        address: w.address,
        currency: w.currency,
        amount: w.amount ?? w.fiat_amount ?? 0,
        status: "waiting",
        batchWithdrawalId: payoutId,
      })),
      createdAt: new Date().toISOString(),
    };
  }

  // IPN VERIFICATION

  static verifyIpnSignature(rawBody: string, signature: string): boolean {
    if (IS_NOWPAYMENTS_MOCK) {
      logger.info("[MOCK] IPN signature verified");
      return true;
    }

    if (!IPN_SECRET) {
      logger.error("NOWPAYMENTS_IPN_SECRET is not set — cannot verify IPN");
      return false;
    }

    try {
      const expected = crypto
        .createHmac("sha512", IPN_SECRET)
        .update(rawBody)
        .digest("hex");

      return crypto.timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(signature, "hex"),
      );
    } catch (err) {
      logger.error("IPN signature verification threw", { err });
      return false;
    }
  }
}
