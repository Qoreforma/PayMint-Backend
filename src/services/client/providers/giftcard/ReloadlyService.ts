import axios, { AxiosInstance } from "axios";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import {
  GiftCardOrderData,
  InternationalAirtimeData,
  InternationalDataData,
  ProviderResponse,
  UtilityPaymentData,
} from "@/types";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

interface ReloadlyAuthResponse {
  access_token: string;
  scope: string;
  expires_in: number;
  token_type: string;
}

export class ReloadlyService {
  private airtimeClient: AxiosInstance;
  private giftCardClient: AxiosInstance;
  private utilityClient: AxiosInstance;
  private authClient: AxiosInstance;
  private airtimeBaseUrl: string;
  private giftCardBaseUrl: string;
  private utilityBaseUrl: string;
  private authBaseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private isSandbox: boolean;

  // Token cache for all three APIs
  private airtimeToken: string | null = null;
  private airtimeTokenExpiry: number = 0;
  private giftCardToken: string | null = null;
  private giftCardTokenExpiry: number = 0;
  private utilityToken: string | null = null;
  private utilityTokenExpiry: number = 0;

  constructor() {
    // Get configuration from environment variables
    this.clientId = process.env.RELOADLY_CLIENT_ID || "";
    this.clientSecret = process.env.RELOADLY_CLIENT_SECRET || "";
    this.isSandbox = process.env.RELOADLY_SANDBOX === "true";

    // Set base URLs based on environment
    this.authBaseUrl = "https://auth.reloadly.com";
    this.airtimeBaseUrl = this.isSandbox
      ? "https://topups-sandbox.reloadly.com"
      : "https://topups.reloadly.com";
    this.giftCardBaseUrl = this.isSandbox
      ? "https://giftcards-sandbox.reloadly.com"
      : "https://giftcards.reloadly.com";
    this.utilityBaseUrl = this.isSandbox
      ? "https://utilities-sandbox.reloadly.com"
      : "https://utilities.reloadly.com";

    // Initialize auth client
    this.authClient = axios.create({
      baseURL: this.authBaseUrl,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Initialize airtime client (token will be set dynamically)
    this.airtimeClient = axios.create({
      baseURL: this.airtimeBaseUrl,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Initialize gift card client (token will be set dynamically)
    this.giftCardClient = axios.create({
      baseURL: this.giftCardBaseUrl,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Initialize utility client (token will be set dynamically)
    this.utilityClient = axios.create({
      baseURL: this.utilityBaseUrl,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  // TOKEN MANAGEMEN

  private async getAirtimeToken(): Promise<string> {
    if (this.airtimeToken && Date.now() < this.airtimeTokenExpiry) {
      return this.airtimeToken;
    }

    try {
      const response = await this.authClient.post<ReloadlyAuthResponse>(
        "/oauth/token",
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "client_credentials",
          audience: this.airtimeBaseUrl,
        },
      );

      this.airtimeToken = response.data.access_token;
      this.airtimeTokenExpiry =
        Date.now() + (response.data.expires_in - 300) * 1000;

      return this.airtimeToken;
    } catch (error: any) {
      logger.error("Reloadly airtime token generation failed", error);

      throw new AppError(
        "Failed to authenticate with Reloadly Airtime API",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getGiftCardToken METHOD
  private async getGiftCardToken(): Promise<string> {
    if (this.giftCardToken && Date.now() < this.giftCardTokenExpiry) {
      return this.giftCardToken;
    }

    try {
      const response = await this.authClient.post<ReloadlyAuthResponse>(
        "/oauth/token",
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "client_credentials",
          audience: this.giftCardBaseUrl,
        },
      );

      this.giftCardToken = response.data.access_token;
      this.giftCardTokenExpiry =
        Date.now() + (response.data.expires_in - 300) * 1000;

      return this.giftCardToken;
    } catch (error: any) {
      logger.error("Reloadly gift card token generation failed", error);

      throw new AppError(
        "Failed to authenticate with Reloadly Gift Card API",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getUtilityToken METHOD
  private async getUtilityToken(): Promise<string> {
    if (this.utilityToken && Date.now() < this.utilityTokenExpiry) {
      return this.utilityToken;
    }

    try {
      const response = await this.authClient.post<ReloadlyAuthResponse>(
        "/oauth/token",
        {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "client_credentials",
          audience: this.utilityBaseUrl,
        },
      );

      this.utilityToken = response.data.access_token;
      this.utilityTokenExpiry =
        Date.now() + (response.data.expires_in - 300) * 1000;

      return this.utilityToken;
    } catch (error: any) {
      logger.error("Reloadly utility token generation failed", error);

      throw new AppError(
        "Failed to authenticate with Reloadly Utility API",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getInternationalAirtimeCountries METHOD
  async getInternationalAirtimeCountries(): Promise<any> {
    try {
      const token = await this.getAirtimeToken();
      const response = await this.airtimeClient.get("/countries", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data.map((country: any) => ({
        isoName: country.isoName,
        name: country.name,
        currencyCode: country.currencyCode,
        currencyName: country.currencyName,
        currencySymbol: country.currencySymbol,
        flag: country.flag,
        callingCodes: country.callingCodes,
      }));
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get Reloadly countries", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch countries";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch countries. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getOperatorsByCountry METHOD
  async getOperatorsByCountry(
    countryCode: string,
    includeDataOnly: boolean = false,
  ): Promise<any> {
    try {
      const token = await this.getAirtimeToken();
      const response = await this.airtimeClient.get(
        `/operators/countries/${countryCode}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      let operators = response.data.map((operator: any) => ({
        operatorId: operator.operatorId,
        name: operator.name,
        bundle: operator.bundle,
        data: operator.data,
        denominationType: operator.denominationType,
        senderCurrencyCode: operator.senderCurrencyCode,
        senderCurrencySymbol: operator.senderCurrencySymbol,
        destinationCurrencyCode: operator.destinationCurrencyCode,
        destinationCurrencySymbol: operator.destinationCurrencySymbol,
        commission: operator.commission,
        minAmount: operator.minAmount,
        maxAmount: operator.maxAmount,
        localMinAmount: operator.localMinAmount,
        localMaxAmount: operator.localMaxAmount,
        fixedAmounts: operator.fixedAmounts,
        fixedAmountsDescriptions: operator.fixedAmountsDescriptions,
        logoUrls: operator.logoUrls,
        country: operator.country,
      }));

      // Filter for data operators if requested
      if (includeDataOnly) {
        operators = operators.filter(
          (op: any) => op.data === true || op.bundle === true,
        );
      }

      return operators;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get Reloadly operators", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch operators";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch operators. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getOperatorById METHOD
  async getOperatorById(operatorId: string): Promise<any> {
    try {
      const token = await this.getAirtimeToken();

      const response = await this.airtimeClient.get(
        `/operators/${operatorId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get operator details", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch operator";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch operator. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  detectOperator METHOD
  async detectOperator(phone: string, countryCode: string): Promise<any> {
    try {
      const token = await this.getAirtimeToken();
      const response = await this.airtimeClient.get(
        `/operators/auto-detect/phone/${phone}/countries/${countryCode}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to detect operator", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to detect operator";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to detect operator. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getAirtimeTransactionStatus METHOD
  async getAirtimeTransactionStatus(transactionId: string): Promise<any> {
    try {
      const token = await this.getAirtimeToken();
      const response = await this.airtimeClient.get(
        `/topups/${transactionId}/status`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get transaction status", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to get transaction status";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to get transaction status. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getAirtimeBalance METHOD
  async getAirtimeBalance(): Promise<any> {
    try {
      const token = await this.getAirtimeToken();
      const response = await this.airtimeClient.get("/accounts/balance", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get account balance", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to get balance";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to get balance. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getGiftCardProducts METHOD
  async getGiftCardProducts(filters?: {
    countryCode?: string;
    productName?: string;
    categoryId?: number;
    page?: number;
    size?: number;
  }): Promise<any> {
    try {
      const token = await this.getGiftCardToken();
      const params: any = {};

      if (filters?.countryCode) params.countryCode = filters.countryCode;
      if (filters?.productName) params.productName = filters.productName;
      if (filters?.categoryId) params.productCategoryId = filters.categoryId;
      if (filters?.page) params.page = filters.page;
      if (filters?.size) params.size = filters.size;

      const response = await this.giftCardClient.get("/products", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params,
      });

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get gift card products", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch gift card products";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch products. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getGiftCardProductById METHOD
  async getGiftCardProductById(productId: number): Promise<any> {
    try {
      const token = await this.getGiftCardToken();
      const response = await this.giftCardClient.get(`/products/${productId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get gift card product", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch gift card product";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch product. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getGiftCardProductsByCountry METHOD
  async getGiftCardProductsByCountry(countryCode: string): Promise<any> {
    try {
      const token = await this.getGiftCardToken();
      const response = await this.giftCardClient.get(
        `/countries/${countryCode}/products`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get gift card products by country", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch gift card products";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch products. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getGiftCardCountries METHOD
  async getGiftCardCountries(): Promise<any> {
    try {
      const token = await this.getGiftCardToken();
      const response = await this.giftCardClient.get("/countries", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get gift card countries", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch countries";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch countries. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getGiftCardCategories METHOD
  async getGiftCardCategories(): Promise<any> {
    try {
      const token = await this.getGiftCardToken();
      const response = await this.giftCardClient.get("/product-categories", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get gift card categories", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch categories";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch categories. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getGiftCardDiscounts METHOD
  async getGiftCardDiscounts(productId?: number): Promise<any> {
    try {
      const token = await this.getGiftCardToken();
      const url = productId ? `/products/${productId}/discounts` : "/discounts";

      const response = await this.giftCardClient.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get gift card discounts", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch discounts";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch discounts. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getGiftCardRedeemCode METHOD
  async getGiftCardRedeemCode(transactionId: string): Promise<any> {
    try {
      const token = await this.getGiftCardToken();
      const response = await this.giftCardClient.get(
        `/orders/transactions/${transactionId}/cards`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get gift card redeem code", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch redeem code";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch redeem code. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getGiftCardTransaction METHOD
  async getGiftCardTransaction(transactionId: string): Promise<any> {
    try {
      const token = await this.getGiftCardToken();
      const response = await this.giftCardClient.get(
        `/reports/transactions/${transactionId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get gift card transaction", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch transaction";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch transaction. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getGiftCardFxRate METHOD
  async getGiftCardFxRate(currencyCode: string, amount: number): Promise<any> {
    try {
      const token = await this.getGiftCardToken();
      const response = await this.giftCardClient.get("/fx-rate", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          currencyCode,
          amount,
        },
      });

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get gift card FX rate", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch FX rate";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch FX rate. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getUtilityBillers METHOD
  async getUtilityBillers(filters?: {
    type?: string;
    serviceType?: string;
    countryCode?: string;
    page?: number;
    size?: number;
  }): Promise<any> {
    try {
      const token = await this.getUtilityToken();
      const params: any = {};

      if (filters?.type) params.type = filters.type;
      if (filters?.serviceType) params.serviceType = filters.serviceType;
      if (filters?.countryCode) params.countryISOCode = filters.countryCode;
      if (filters?.page) params.page = filters.page;
      if (filters?.size) params.size = filters.size;

      const response = await this.utilityClient.get("/billers", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params,
      });

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get utility billers", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch billers";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch billers. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getBillerById METHOD
  async getBillerById(billerId: number): Promise<any> {
    try {
      const token = await this.getUtilityToken();
      const response = await this.utilityClient.get(`/billers/${billerId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get biller details", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch biller";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch biller. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getUtilityTransaction METHOD
  async getUtilityTransaction(transactionId: string): Promise<any> {
    try {
      const token = await this.getUtilityToken();
      const response = await this.utilityClient.get(
        `/transactions/${transactionId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get utility transaction", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to fetch transaction";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch transaction. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  getUtilityBalance METHOD
  async getUtilityBalance(): Promise<any> {
    try {
      const token = await this.getUtilityToken();
      const response = await this.utilityClient.get("/accounts/balance", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error("Failed to get utility balance", error);

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.message || "Failed to get balance";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to get balance. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  handleError METHOD
  private handleError(error: any, operationType: string): never {
    if (error instanceof AppError) {
      throw error;
    }

    if (error.response) {
      logger.error(`Reloadly ${operationType} error`, {
        status: error.response.status,
        data: error.response.data,
      });

      const detailedErrorMessage =
        error.response.data?.message ||
        error.response.data?.response_description ||
        `${operationType} failed`;

      // PRODUCTION ERROR HANDLING
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Transaction failed. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } else {
      logger.error(`Reloadly ${operationType} error`, error.message);

      // PRODUCTION ERROR HANDLING
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Transaction failed. Please try again later."
          : `${operationType} failed`;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  // Get data bundle operators by country
  // This is just a convenience method that filters operators with data support

  async getDataBundleOperators(countryCode: string): Promise<any> {
    return await this.getOperatorsByCountry(countryCode, true);
  }

  // Purchase international airtime
  // NOTE: This same endpoint is used for data bundles!
  // Just use an operatorId that has data: true

  async purchaseInternationalAirtime(
    data: InternationalDataData,
  ): Promise<ProviderResponse> {
    return SentryHelper.trackCriticalOperation(
      "reloadly_international_data",
      async () => {
        try {
          const token = await this.getAirtimeToken();
          const response = await this.airtimeClient.post(
            "/topups",
            {
              operatorId: data.operatorId,
              amount: data.amount,
              useLocalAmount: false,
              customIdentifier: data.reference,
              recipientPhone: {
                countryCode: data.countryCode,
                number: data.phone,
              },
            },
            {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          );

          const responseData = response.data;

          return {
            success: responseData.status === "SUCCESSFUL",
            pending:
              responseData.status === "PROCESSING" ||
              responseData.status === "PENDING",
            reference: data.reference,
            providerReference: responseData.transactionId?.toString(),
            status: responseData.status,
            message: this.getStatusMessage(responseData.status),
            data: responseData,
          };
        } catch (error: any) {
          return this.handleError(error, "International airtime purchase");
        }
      },
      data.reference,
    );
  }

  // Purchase international data bundle
  // This is the SAME as purchaseInternationalAirtime
  // Reloadly uses the same endpoint for both

  async purchaseInternationalData(
    data: InternationalDataData,
  ): Promise<ProviderResponse> {
    // Just call the airtime method - it's the same API!
    return await this.purchaseInternationalAirtime(data);
  }

  // Order/Purchase gift card

  async orderGiftCard(data: GiftCardOrderData): Promise<ProviderResponse> {
    return SentryHelper.trackCriticalOperation(
      "reloadly_gift_card",
      async () => {
        try {
          const token = await this.getGiftCardToken();

          const payload: any = {
            productId: data.productId,
            quantity: data.quantity,
            unitPrice: data.unitPrice,
            customIdentifier: data.customIdentifier,
            senderName: data.senderName,
          };

          if (data.recipientEmail) {
            payload.recipientEmail = data.recipientEmail;
          }

          if (data.recipientPhoneDetails) {
            payload.recipientPhoneDetails = data.recipientPhoneDetails;
          }

          if (data.userId) {
            payload.productAdditionalRequirements = {
              userId: data.userId,
            };
          }

          const response = await this.giftCardClient.post("/orders", payload, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          const responseData = response.data;

          return {
            success: responseData.status === "SUCCESSFUL",
            pending:
              responseData.status === "PROCESSING" ||
              responseData.status === "PENDING",
            reference: data.customIdentifier,
            providerReference: responseData.transactionId?.toString(),
            status: responseData.status,
            message: this.getStatusMessage(responseData.status),
            data: responseData,
            // Reloadly cost fields for profit calculation
            providerCost:
              responseData.balanceInfo?.cost ?? responseData.amount ?? 0,
            providerFee: responseData.fee ?? 0,
            providerSmsFee: responseData.smsFee ?? 0,
            providerTotalFee: responseData.totalFee ?? 0,
            providerDiscount: responseData.discount ?? 0,
          };
        } catch (error: any) {
          logger.error("Failed to order gift card", {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data,
          });
          return this.handleError(error, "Gift card purchase");
        }
      },
      data.customIdentifier,
    );
  }

  // Pay utility bill

  async payUtilityBill(data: UtilityPaymentData): Promise<ProviderResponse> {
    return SentryHelper.trackCriticalOperation(
      "reloadly_utility_payment",
      async () => {
        try {
          const token = await this.getUtilityToken();

          const payload: any = {
            subscriberAccountNumber: data.subscriberAccountNumber,
            amount: data.amount,
            billerId: data.billerId,
            referenceId: data.referenceId,
          };

          if (data.useLocalAmount !== undefined) {
            payload.useLocalAmount = data.useLocalAmount;
          }

          if (data.amountId) {
            payload.amountId = data.amountId;
          }

          if (data.additionalInfo) {
            payload.additionalInfo = data.additionalInfo;
          }

          const response = await this.utilityClient.post("/pay", payload, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          const responseData = response.data;

          return {
            success: responseData.status === "SUCCESSFUL",
            pending: responseData.status === "PROCESSING",
            reference: data.referenceId,
            providerReference: responseData.id?.toString(),
            status: responseData.status,
            message:
              responseData.message ||
              this.getStatusMessage(responseData.status),
            data: responseData,
          };
        } catch (error: any) {
          return this.handleError(error, "Utility payment");
        }
      },
      data.referenceId,
    );
  }

  // HELPER METHOD

  private getStatusMessage(status: string): string {
    const messages: { [key: string]: string } = {
      SUCCESSFUL: "Transaction completed successfully",
      PENDING: "Transaction is pending",
      PROCESSING: "Transaction is being processed",
      FAILED: "Transaction failed",
      REFUNDED: "Transaction was refunded",
    };

    return messages[status] || "Transaction status unknown";
  }
}
