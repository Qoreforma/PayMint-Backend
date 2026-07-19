import axios, { AxiosInstance } from "axios";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { PROVIDERS } from "@/config";
import {
  AirtimeData,
  ProviderResponse,
  DataDataDTO,
  CableTvData,
  ElectricityData,
  BettingData,
  AirtimeEPINData,
} from "@/types";

export class VtuNgService {
  private client: AxiosInstance;
  private provider = PROVIDERS.VTUNG;
  private token: string | null = null;
  private tokenExpiryTime: number = 0;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl,
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  // Get or refresh JWT token
  private async getToken(): Promise<string | null> {
    // Check if token exists and is still valid (with 1 hour buffer)
    const now = Date.now();
    if (this.token && this.tokenExpiryTime > now + 3600000) {
      return this.token;
    }

    try {
      const response = await axios.post(
        `${this.provider.baseUrl}/jwt-auth/v1/token`,
        {
          username: this.provider.username,
          password: this.provider.password,
        },
        {
          headers: { "Content-Type": "application/json" },
        },
      );

      if (response.data.token) {
        this.token = response.data.token;
        // Token expires after 7 days, but we'll refresh more frequently
        this.tokenExpiryTime = now + 6 * 24 * 60 * 60 * 1000; // 6 days
        return this.token;
      }

      throw new AppError(
        "Failed to obtain authentication token",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      logger.error(
        "VTU.ng authentication error",
        error.response?.data || error.message,
      );
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Authentication failed. Please try again later."
          : error.response?.data?.message || "Authentication failed";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  // Get headers with Bearer token
  private async getHeaders(): Promise<any> {
    const token = await this.getToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }

  // Map network names to VTU.ng service IDs
  private mapNetworkToServiceId(network: string): string {
    const networkMap: { [key: string]: string } = {
      mtn: "mtn",
      "mtn-ng": "mtn",
      glo: "glo",
      "glo-ng": "glo",
      airtel: "airtel",
      "airtel-ng": "airtel",
      "9mobile": "9mobile",
      etisalat: "9mobile",
    };
    return networkMap[network.toLowerCase()] || network.toLowerCase();
  }

  //  AIRTIME PURCHASE

  async purchaseAirtime(data: AirtimeData): Promise<ProviderResponse> {
    try {
      const headers = await this.getHeaders();
      const serviceId = this.mapNetworkToServiceId(data.network);

      const response = await this.client.post(
        "/api/v2/airtime",
        {
          request_id: data.reference,
          phone: data.phone,
          service_id: serviceId,
          amount: data.amount,
        },
        { headers },
      );

      return this.handleTransactionResponse(response.data, "Airtime purchase");
    } catch (error: any) {
      return this.handleError(error, "Airtime purchase");
    }
  }

  //  DATA PURCHASE

  async purchaseData(data: DataDataDTO): Promise<ProviderResponse> {
    try {
      const headers = await this.getHeaders();
      const serviceId = this.mapNetworkToServiceId(data.serviceCode || "");

      const response = await this.client.post(
        "/api/v2/data",
        {
          request_id: data.reference,
          phone: data.phone,
          service_id: serviceId,
          variation_id: data.variationCode,
        },
        { headers },
      );

      return this.handleTransactionResponse(response.data, "Data purchase");
    } catch (error: any) {
      return this.handleError(error, "Data purchase");
    }
  }

  //  CABLE TV PURCHASE

  async purchaseCableTv(data: CableTvData): Promise<ProviderResponse> {
    try {
      const headers = await this.getHeaders();

      const payload: any = {
        request_id: data.reference,
        customer_id: data.smartCardNumber,
        service_id: data.provider.toLowerCase(),
        variation_id: data.package,
      };

      // Add subscription_type and amount for DStv/GOtv
      if (
        data.provider.toLowerCase() === "dstv" ||
        data.provider.toLowerCase() === "gotv"
      ) {
        payload.subscription_type = data.subscriptionType || "change";
        if (data.subscriptionType === "renew" && data.amount) {
          payload.amount = data.amount;
        }
      }

      const response = await this.client.post("/api/v2/tv", payload, {
        headers,
      });

      return this.handleTransactionResponse(
        response.data,
        "Cable TV subscription",
      );
    } catch (error: any) {
      return this.handleError(error, "Cable TV subscription");
    }
  }

  //  ELECTRICITY PURCHASE

  async purchaseElectricity(data: ElectricityData): Promise<ProviderResponse> {
    try {
      const headers = await this.getHeaders();

      const response = await this.client.post(
        "/api/v2/electricity",
        {
          request_id: data.reference,
          customer_id: data.meterNumber,
          service_id: data.productCode,
          variation_id: data.meterType.toLowerCase(),
          amount: data.amount,
        },
        { headers },
      );

      const result = this.handleTransactionResponse(
        response.data,
        "Electricity payment",
      );

      // Extract token from response
      if (result.success && response.data.data?.token) {
        result.token = response.data.data.token;
      }

      return result;
    } catch (error: any) {
      return this.handleError(error, "Electricity payment");
    }
  }

  //  BETTING FUNDING

  async fundBetting(data: BettingData): Promise<ProviderResponse> {
    try {
      const headers = await this.getHeaders();

      const response = await this.client.post(
        "/api/v2/betting",
        {
          request_id: `BET_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 11)}`,
          customer_id: data.customerId,
          service_id: data.provider,
          amount: data.amount,
        },
        { headers },
      );

      return this.handleTransactionResponse(response.data, "Betting funding");
    } catch (error: any) {
      return this.handleError(error, "Betting funding");
    }
  }

  //  EPIN PURCHASE

  async purchaseEPINs(data: AirtimeEPINData): Promise<ProviderResponse> {
    try {
      const headers = await this.getHeaders();
      const serviceId = this.mapNetworkToServiceId(data.network);

      const response = await this.client.post(
        "/api/v2/epins",
        {
          request_id: data.reference,
          service_id: serviceId,
          value: data.value,
          quantity: data.quantity,
        },
        { headers },
      );

      const result = this.handleTransactionResponse(
        response.data,
        "ePINs purchase",
      );

      // Extract ePINs from response
      if (result.success && response.data.data?.epins) {
        result.data = {
          ...result.data,
          epins: response.data.data.epins,
        };
      }

      return result;
    } catch (error: any) {
      return this.handleError(error, "ePINs purchase");
    }
  }

  //  VERIFICATION METHODS

  async verifySmartCard(
    smartCardNumber: string,
    provider: string,
  ): Promise<any> {
    try {
      const headers = await this.getHeaders();

      const response = await this.client.post(
        "/api/v2/verify-customer",
        {
          customer_id: smartCardNumber,
          service_id: provider.toLowerCase(),
        },
        { headers },
      );

      return this.handleVerificationResponse(
        response.data,
        "Smart card verification",
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "VTU.ng smart card verification error",
        error.response?.data || error.message,
      );

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Smart card verification failed. Please try again later."
          : error.response?.data?.message || "Smart card verification failed";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  async verifyMeterNumber(
    meterNumber: string,
    provider: string,
    meterType: string,
  ): Promise<any> {
    try {
      const headers = await this.getHeaders();

      const response = await this.client.post(
        "/api/v2/verify-customer",
        {
          customer_id: meterNumber,
          service_id: provider,
          variation_id: meterType.toLowerCase(),
        },
        { headers },
      );

      const result = this.handleVerificationResponse(
        response.data,
        "Meter verification",
      );

      // Add meter-specific fields
      if (result.valid && response.data.data) {
        result.address = response.data.data.customer_address;
        result.meterNumber =
          response.data.data.meter_number || response.data.data.customer_id;
        result.meterType = meterType;
        result.minimumAmount = response.data.data.min_purchase_amount;
        result.maximumAmount = response.data.data.max_purchase_amount;
      }

      return result;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "VTU.ng meter verification error",
        error.response?.data || error.message,
      );

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Meter verification failed. Please try again later."
          : error.response?.data?.message || "Meter verification failed";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  async verifyBettingCustomer(
    customerId: string,
    provider: string,
  ): Promise<any> {
    try {
      const headers = await this.getHeaders();

      const response = await this.client.post(
        "/api/v2/verify-customer",
        {
          customer_id: customerId,
          service_id: provider,
        },
        { headers },
      );

      return this.handleVerificationResponse(
        response.data,
        "Betting customer verification",
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "VTU.ng betting verification error",
        error.response?.data || error.message,
      );

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Betting customer verification failed. Please try again later."
          : error.response?.data?.message ||
            "Betting customer verification failed";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  //  QUERY TRANSACTION

  async requeryTransaction(requestId: string): Promise<any> {
    try {
      const headers = await this.getHeaders();

      const response = await this.client.post(
        "/api/v2/requery",
        {
          request_id: requestId,
        },
        { headers },
      );

      if (response.data.code === "success") {
        return {
          success: true,
          data: response.data.data,
          message: response.data.message,
        };
      }

      throw new AppError(
        process.env.NODE_ENV === "production"
          ? "Transaction not found"
          : response.data.message || "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "VTU.ng transaction requery error",
        error.response?.data || error.message,
      );

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Transaction requery failed. Please try again later."
          : error.response?.data?.message || "Transaction requery failed";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  CHECK BALANCE

  async checkBalance(): Promise<any> {
    try {
      const headers = await this.getHeaders();

      const response = await this.client.get("/api/v2/balance", { headers });

      if (response.data.code === "success") {
        return {
          success: true,
          balance: response.data.data.balance,
          currency: response.data.data.currency,
        };
      }

      throw new AppError(
        process.env.NODE_ENV === "production"
          ? "Failed to retrieve balance. Please try again later."
          : response.data.message || "Failed to retrieve balance",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "VTU.ng balance check error",
        error.response?.data || error.message,
      );

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Balance check failed. Please try again later."
          : error.response?.data?.message || "Balance check failed";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //  HELPER METHODS

  private handleTransactionResponse(
    responseData: any,
    operationType: string,
  ): ProviderResponse {
    const code = responseData.code;
    const message = responseData.message;
    const orderData = responseData.data;

    // Check if request was successful
    if (code !== "success") {
      logger.error(`VTU.ng ${operationType} failed`, {
        code: code,
        message: message,
      });

      throw new AppError(
        process.env.NODE_ENV === "production"
          ? `${operationType} failed. Please try again later.`
          : message || `${operationType} failed`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }

    // Map VTU.ng status to our standard format

    // Map VTU.ng status to our standard format
    const status = orderData?.status;

    if (status === "completed-api") {
      return {
        success: true,
        pending: false,
        status: "completed",
        providerReference: orderData.order_id?.toString(),
        message: message || `${operationType} successful`,
        data: orderData,
      };
    } else if (
      status === "processing-api" ||
      status === "initiated-api" ||
      status === "queued-api"
    ) {
      logger.info(`VTU.ng ${operationType} processing`, {
        status: status,
        orderId: orderData.order_id,
      });

      return {
        success: false,
        pending: true,
        status: "pending",
        providerReference: orderData.order_id?.toString(),
        message: message || "Transaction is being processed",
        data: orderData,
      };
    } else if (
      status === "refunded" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      logger.warn(`VTU.ng ${operationType} not successful`, {
        status: status,
        orderId: orderData.order_id,
      });

      throw new AppError(
        process.env.NODE_ENV === "production"
          ? `${operationType} failed. Please try again later.`
          : message || `${operationType} failed`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }

    // Unknown status - treat as pending

    // Unknown status - treat as pending
    logger.warn(`VTU.ng ${operationType} unknown status`, {
      status: status,
      orderId: orderData.order_id,
    });

    return {
      success: false,
      pending: true,
      status: "pending",
      providerReference: orderData.order_id?.toString(),
      message: "Transaction status unclear, please requery",
      data: orderData,
    };
  }

  private handleVerificationResponse(
    responseData: any,
    operationType: string,
  ): any {
    const code = responseData.code;

    if (code === "success") {
      const data = responseData.data;

      return {
        valid: true,
        customerName: data.customer_name,
        status: data.status,
        smartCardNumber: data.customer_id,
        dueDate: data.due_date,
        currentBouquet: data.current_bouquet,
        renewalAmount: data.renewal_amount,
        // Additional fields for betting
        username: data.customer_username,
        email: data.customer_email_address,
        phone: data.customer_phone_number,
        minimumAmount: data.minimum_amount,
        maximumAmount: data.maximum_amount,
      };
    }

    const finalErrorMessage =
      process.env.NODE_ENV === "production"
        ? `${operationType} failed. Please try again later.`
        : responseData.message || `${operationType} failed`;

    throw new AppError(
      finalErrorMessage,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR,
    );
  }

  private handleError(error: any, operationType: string): never {
    if (error instanceof AppError) {
      throw error;
    }

    if (error.response) {
      logger.error(`VTU.ng ${operationType} error`, {
        status: error.response.status,
        data: error.response.data,
      });

      // Map VTU.ng error codes to our error codes
      const errorCode = error.response.data?.code;
      const errorMessage =
        error.response.data?.message || `${operationType} failed`;

      if (error.response.status === 402 || errorCode === "insufficient_funds") {
        throw new AppError(
          "Insufficient wallet balance",
          HTTP_STATUS.PAYMENT_REQUIRED,
          ERROR_CODES.INSUFFICIENT_BALANCE,
        );
      }

      if (
        error.response.status === 409 ||
        errorCode === "duplicate_request_id"
      ) {
        throw new AppError(
          "Duplicate request ID",
          HTTP_STATUS.CONFLICT,
          ERROR_CODES.DUPLICATE_TRANSACTION,
        );
      }

      if (error.response.status === 403 || errorCode === "rest_forbidden") {
        throw new AppError(
          "Unauthorized access - check authentication",
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? `${operationType} failed. Please try again later.`
          : errorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } else {
      logger.error(`VTU.ng ${operationType} error`, error.message);
    }

    const noResponseErrorMessage =
      process.env.NODE_ENV === "production"
        ? `${operationType} failed. Please try again later.`
        : error.message || `${operationType} failed`;

    throw new AppError(
      noResponseErrorMessage,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }

  
}
