import axios, { AxiosInstance } from "axios";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { PROVIDERS } from "@/config";
import {
  AirtimeData,
  ProviderResponse,
  DataDataDTO,
  BettingData,
} from "@/types";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";

export class GiftBillsService {
  private client: AxiosInstance;
  private provider = PROVIDERS.GIFTBILLS;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.provider.apiKey}`,
        MerchantId: this.provider.merchantId,
      },
      timeout: 30000,
    });
  }

  //  getAirtimeProviders METHOD
  async getAirtimeProviders(): Promise<any> {
    try {
      const response = await this.client.get("/airtime");

      if (response.data.success && response.data.code === "00000") {
        return response.data.data.map((provider: any) => ({
          provider: provider.provider,
          logoUrl: provider.providerLogoUrl,
          minAmount: provider.minAmount,
          maxAmount: provider.maxAmount,
        }));
      }

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        response.data.message || "Failed to fetch airtime providers";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch providers. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "GiftBills: Failed to get airtime providers",
        error.response?.data || error.message,
      );
      throw this.handleError(error, "Failed to fetch airtime providers");
    }
  }

  //  getDataProviders METHOD
  async getDataProviders(): Promise<any> {
    try {
      const response = await this.client.get("/internet");

      if (response.data.success && response.data.code === "00000") {
        return response.data.data.map((provider: any) => ({
          id: provider.id,
          provider: provider.provider,
          logoUrl: provider.providerLogoUrl,
        }));
      }

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        response.data.message || "Failed to fetch data providers";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch providers. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "GiftBills: Failed to get data providers",
        error.response?.data || error.message,
      );
      throw this.handleError(error, "Failed to fetch data providers");
    }
  }

  //  getDataTypes METHOD
  async getDataTypes(): Promise<any> {
    try {
      const response = await this.client.get("/internet/data_types");

      if (response.data.success && response.data.code === "00000") {
        return response.data.data.map((dataType: any) => ({
          id: dataType.id,
          ipId: dataType.ip_id,
          name: dataType.name,
        }));
      }

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        response.data.message || "Failed to fetch data types";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch data types. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "GiftBills: Failed to get data types",
        error.response?.data || error.message,
      );
      throw this.handleError(error, "Failed to fetch data types");
    }
  }

  //  getDataPlans METHOD
  async getDataPlans(provider: string): Promise<any> {
    try {
      const response = await this.client.get(`/internet/plans/${provider}`);

      if (response.data.success && response.data.code === "00000") {
        return response.data.data.map((plan: any) => ({
          id: plan.id,
          dataTypeId: plan.data_type_id,
          name: plan.name,
          amount: plan.amount,
          discount: plan.api_cent,
        }));
      }

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        response.data.message || "Failed to fetch data plans";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch data plans. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "GiftBills: Failed to get data plans",
        error.response?.data || error.message,
      );
      throw this.handleError(error, "Failed to fetch data plans");
    }
  }

  //  getBettingProviders METHOD
  async getBettingProviders(): Promise<any> {
    try {
      const response = await this.client.get("/betting");


      if (response.data.success && response.data.code === "00000") {
        return response.data.data.map((provider: any) => ({
          provider: provider.provider,
          logoUrl: provider.providerLogoUrl,
          minAmount: provider.minAmount,
          maxAmount: provider.maxAmount,
        }));
      }

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        response.data.message || "Failed to fetch betting providers";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch providers. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "GiftBills: Failed to get betting providers",
        error.response?.data || error.message,
      );
      throw this.handleError(error, "Failed to fetch betting providers");
    }
  }

  //  validateBettingCustomer METHOD
  async validateBettingCustomer(
    customerId: string,
    provider: string,
  ): Promise<any> {
    try {
      const giftBillsprovider = this.getGiftBillsCode(provider);
      const payload = {
        provider: giftBillsprovider,
        customerId: customerId,
      };
      logger.info("GiftBills: Validating betting customer", payload);

      const response = await this.client.post("/betting/validate", payload);

      if (response.data.success && response.data.code === "00000") {
        return {
          valid: true,
          provider: response.data.data.provider,
          customerId: response.data.data.customerId,
          customerName: `${response.data.data.firstName} ${response.data.data.lastName}`,
          userName: response.data.data.userName,
        };
      }

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        response.data.message || "Customer validation failed";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Validation failed. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "GiftBills: Betting customer validation error",
        error.response?.data || error.message,
      );
      throw this.handleError(error, "Customer validation failed");
    }
  }

  //  checkBettingStatus METHOD
  async checkBettingStatus(orderNo: string, reference: string): Promise<any> {
    try {
      const payload = {
        orderNo: orderNo,
        reference: reference,
        serviceType: "betting",
      };

      logger.info("GiftBills: Checking betting transaction status", payload);

      const response = await this.client.post("/betting/status", payload);

      if (response.data.success && response.data.code === "00000") {
        return {
          orderNo: response.data.data.orderNo,
          reference: response.data.data.reference,
          status: response.data.data.status,
          errorMsg: response.data.data.errorMsg,
        };
      }

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        response.data.message || "Failed to check transaction status";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to check status. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "GiftBills: Failed to check betting status",
        error.response?.data || error.message,
      );
      throw this.handleError(error, "Failed to check transaction status");
    }
  }

  //  getTransactionHistory METHOD
  async getTransactionHistory(): Promise<any> {
    try {
      const response = await this.client.get("/bill/history");

      if (response.data.success && response.data.code === "00000") {
        return {
          transactions: response.data.data,
          totalCount: response.data.total_count,
        };
      }

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        response.data.message || "Failed to fetch transaction history";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch history. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "GiftBills: Failed to get transaction history",
        error.response?.data || error.message,
      );
      throw this.handleError(error, "Failed to fetch transaction history");
    }
  }

  //  getTransactionStatus METHOD
  async getTransactionStatus(orderNo: string): Promise<any> {
    try {
      const response = await this.client.get(`/bill/status/${orderNo}`);

      if (response.data.success && response.data.code === "00000") {
        return response.data.data;
      }

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        response.data.message || "Failed to fetch transaction status";
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch status. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "GiftBills: Failed to get transaction status",
        error.response?.data || error.message,
      );
      throw this.handleError(error, "Failed to fetch transaction status");
    }
  }

  //  handleTransactionResponse METHOD
  private handleTransactionResponse(
    responseData: any,
    operationType: string,
    reference: string,
  ): ProviderResponse {
    // Check if request was successful
    if (!responseData.success || responseData.code !== "00000") {
      logger.error(`GiftBills ${operationType} failed`, {
        code: responseData.code,
        message: responseData.message,
      });

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        responseData.message || `${operationType} failed`;
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Transaction failed. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }

    const data = responseData.data;
    const status = data.status?.toLowerCase();

    // Map GiftBills status to our standard format
    const isPending = status === "pending";
    const isSuccess =
      status === "delivered" || status === "successful" || status === "success";
    const isFailed = status === "failed" || status === "fail";

    if (isFailed) {
      logger.error(`GiftBills ${operationType} failed`, {
        status,
        errorMsg: data.errorMsg,
      });

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage = data.errorMsg || `${operationType} failed`;
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Transaction failed. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }

    logger.info(`GiftBills ${operationType} response`, {
      status: status,
      orderNo: data.orderNo,
      reference: data.reference,
    });

    return {
      success: isSuccess,
      pending: isPending,
      status: status,
      reference: data.reference || reference,
      providerReference: data.orderNo,
      message:
        data.errorMsg || responseData.message || `${operationType} processed`,
      data: data,
    };
  }

  //  handleError METHOD
  private handleError(error: any, operationType: string): never {
    if (error instanceof AppError) {
      throw error;
    }

    const errorData = error.response?.data;

    if (errorData) {
      logger.error(`GiftBills ${operationType} error`, {
        status: error.response.status,
        code: errorData.code,
        message: errorData.message,
      });

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        errorData.message || `${operationType} failed`;
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Transaction failed. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }

    logger.error(`GiftBills ${operationType} error`, error.message);

    // PRODUCTION ERROR HANDLING
    const finalErrorMessage =
      process.env.NODE_ENV === "production"
        ? "Transaction failed. Please try again later."
        : error.message || `${operationType} failed`;

    throw new AppError(
      finalErrorMessage,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }

  // Purchase airtime
  async purchaseAirtime(data: AirtimeData): Promise<ProviderResponse> {
     return SentryHelper.trackCriticalOperation(
    "giftbills_airtime",
    async () => {
    try {
      const provider = this.mapProvider(data.network);

      const payload = {
        provider: provider,
        number: data.phone,
        amount: data.amount.toString(),
        reference: data.reference,
      };

      const response = await this.client.post("/airtime/topup", payload);

      return this.handleTransactionResponse(
        response.data,
        "Airtime purchase",
        data.reference,
      );
    } catch (error: any) {
      return this.handleError(error, "Airtime purchase");
    }
     },
    data.reference
  );
  }

  // Purchase data
  async purchaseData(data: DataDataDTO): Promise<ProviderResponse> {
     return SentryHelper.trackCriticalOperation(
    "giftbills_data",
    async () => {
    try {
      // Extract provider ID or name from productCode or provider field
      const provider = data.serviceCode || data.productCode;

      if (!provider) {
        throw new AppError(
          "Provider information is required",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
      const mappedProvider = this.mapProvider(provider);

      const payload = {
        provider: mappedProvider,
        number: data.phone,
        plan_id: data.plan,
        reference: data.reference,
      };

      logger.info("GiftBills: Purchasing data", payload);

      const response = await this.client.post("/internet/data", payload);

      return this.handleTransactionResponse(
        response.data,
        "Data purchase",
        data.reference || "",
      );
    } catch (error: any) {
      return this.handleError(error, "Data purchase");
    } },
    data.reference
  );
  }

  // Fund betting account
  async fundBetting(data: BettingData): Promise<ProviderResponse> {
    return SentryHelper.trackCriticalOperation(
    "giftbills_betting",
    async () => {
    try {
      const giftBillsprovider = this.getGiftBillsCode(data.provider);

      const payload = {
        provider: giftBillsprovider,
        customerId: data.customerId,
        amount: data.amount.toString(),
        reference:
          data.reference ||
          `BET_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      };

      // Generate HMAC SHA512 signature for encryption header
      // Note: This requires the encryption key from the provider config
      const signature = this.generateSignature(payload);

      logger.info("GiftBills: Funding betting account", payload);

      const response = await this.client.post("/betting/topup", payload, {
        headers: {
          Encryption: signature,
        },
      });

      return this.handleTransactionResponse(
        response.data,
        "Betting funding",
        payload.reference,
      );
    } catch (error: any) {
      return this.handleError(error, "Betting funding");
    } },
    data.reference
  );
  }

  //  HELPER METHODS
  private mapProvider(provider: string): string {
    if (!provider) {
      return provider;
    }

    const upperProvider = provider.toUpperCase().trim();

    const suffixes = ["-AIRTIME", "-DATA", "-BETTING", "-BILL", "-TOPUP"];

    let mappedProvider = upperProvider;
    for (const suffix of suffixes) {
      if (upperProvider.endsWith(suffix)) {
        mappedProvider = upperProvider.replace(suffix, "");
        break;
      }
    }

    return mappedProvider;
  }

  // Generate HMAC SHA512 signature for betting transactions
  private generateSignature(payload: any): string {
    const crypto = require("crypto");

    // Sort payload keys alphabetically
    const sortedPayload = Object.keys(payload)
      .sort()
      .reduce((acc: any, key: string) => {
        acc[key] = payload[key];
        return acc;
      }, {});

    // Convert to string
    const payloadString = JSON.stringify(sortedPayload);

    // Generate HMAC SHA512 signature
    const signature = crypto
      .createHmac("sha512", this.provider.encryptionKey || "")
      .update(payloadString)
      .digest("hex");

    return signature;
  }

  private readonly GIFTBILLS_REVERSE_MAP: { [key: string]: string } = {
    bangbet: "BANGBET",
    sportybet: "SPORTYBET",
    betking: "BETKING",
    "1xbet": "ONE_XBET",
    betway: "BETWAY",
    merrybet: "MERRYBET",
    ilot: "ILOT",
    naijabet: "NAIJABET",
    mylottohub: "MYLOTTOHUB",
    betbonanza: "BETBONANZA",
    paripesa: "PARIPESA",
    nairamillion: "NAIRAMILLION",
    parimatch: "PARIMATCH",
    frapapa: "FRAPAPA",
    easywin: "EASYWIN",
    betlion: "BETLION",
  };

  private getGiftBillsCode(serviceCode: string): string {
    const code = this.GIFTBILLS_REVERSE_MAP[serviceCode.toLowerCase()];
    if (!code) {
      throw new Error(`Unsupported service code for GiftBills: ${serviceCode}`);
    }
    return code;
  }
}
