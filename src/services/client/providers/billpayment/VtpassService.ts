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
  EducationData,
  ElectricityData,
  BettingData,
} from "@/types";
import { WebhookProcessResult } from "@/services/WebhookService";
import SentryHelper from "@/utils/monitoring/sentryMonitoring";
import { getEnviroment } from "@/utils/helpers";

interface VTPassWebhookPayload {
  type: string;
  data: {
    code: string;
    content: {
      transactions: {
        status: "delivered" | "reversed" | "pending" | "failed" | "initiated";
        product_name: string;
        unique_element: string;
        unit_price: number;
        quantity: number;
        service_verification: any;
        channel: string;
        commission: number;
        total_amount: number;
        discount: any;
        type: string;
        email: string;
        phone: string;
        name: string | null;
        convinience_fee: number;
        amount: number;
        platform: string;
        method: string;
        transactionId: string;
        wallet_credit_id?: string; // Only present in reversal
      };
    };
    response_description: string;
    amount: number;
    transaction_date: any;
    requestId: string;
    purchased_code: string;
  };
}
const enviroment = getEnviroment();

export class VTPassService {
  private client: AxiosInstance;
  private provider = PROVIDERS.VTPASS;

  constructor() {
    this.client = axios.create({
      baseURL:
        enviroment === "development"
          ? "https://sandbox.vtpass.com/api"
          : this.provider.baseUrl,
      maxRedirects: 0,
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
        "api-key": this.provider.apiKey,
        "secret-key": this.provider.secretKey,
      },
    });
    // this.client.interceptors.request.use((config) => {
    //   logger.debug("VTPass outgoing request", {
    //     method: config.method?.toUpperCase(),
    //     url: `${config.baseURL}${config.url}`,
    //     headers: config.headers,
    //     body: config.data,
    //   });
    //   return config;
    // });
  }

  public getClient(): AxiosInstance {
    return this.client;
  }

  // AIRTIME PURCHASE
  async purchaseAirtime(data: AirtimeData): Promise<ProviderResponse> {
    return SentryHelper.trackCriticalOperation(
      "vtpass_airtime",
      async () => {
        try {
          const networkCode = this.getNetworkCode(data.network);
          const response = await this.client.post("/pay", {
            request_id: data.reference,
            serviceID: networkCode || data.network,
            amount: data.amount,
            phone: data.phone,
          });

          logger.info(response.data, "VTPass Airtime Purchase Response");

          return this.handleTransactionResponse(
            response.data,
            "Airtime purchase",
          );
        } catch (error: any) {
          return this.handleError(error, "Airtime purchase");
        }
      },
      data.reference,
    );
  }

  async getInternationalAirtimeCountries(): Promise<any> {
    try {
      const response = await this.client.get(
        "/get-international-airtime-countries",
      );

      if (response.data.response_description === "000") {
        return response.data.content.countries.map((country: any) => ({
          iso2: country.code,
          name: country.name,
          flag: country.flag,
          iso3: country.currency,
          phoneCode: `+${country.prefix}`,
        }));
      }

      // PRODUCTION ERROR HANDLING
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch countries. Please try again later."
          : "Failed to fetch international airtime countries";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "Failed to get international airtime countries",
        error.response?.data || error.message,
      );

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.response_description ||
        error.message ||
        "Failed to fetch international airtime countries";

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

  async getInternationalAirtimeProductTypes(countryCode: string): Promise<any> {
    try {
      const response = await this.client.get(
        `/get-international-airtime-product-types?code=${countryCode}`,
      );

      if (response.data.response_description === "000") {
        return response.data.content.map((type: any) => ({
          productTypeId: type.product_type_id,
          name: type.name,
        }));
      }

      // PRODUCTION ERROR HANDLING
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch product types. Please try again later."
          : "Failed to fetch product types";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "Failed to get international airtime product types",
        error.response?.data || error.message,
      );

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.response_description ||
        error.message ||
        "Failed to fetch product types";

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch product types. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  async getInternationalAirtimeProviders(countryCode?: string): Promise<any> {
    try {
      if (!countryCode) {
        return [];
      }

      const response = await this.client.get(
        `/get-international-airtime-operators?code=${countryCode}&product_type_id=1`,
      );

      if (response.data.response_description === "000") {
        return response.data.content.map((operator: any) => ({
          operatorId: operator.operator_id,
          name: operator.name,
          logo: operator.operator_image,
        }));
      }

      // PRODUCTION ERROR HANDLING
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch providers. Please try again later."
          : "Failed to fetch international airtime providers";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "Failed to get international airtime providers",
        error.response?.data || error.message,
      );

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.response_description ||
        error.message ||
        "Failed to fetch international airtime providers";

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch providers. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  async getInternationalAirtimeVariations(
    operatorId: string,
    productTypeId: number = 1,
  ): Promise<any> {
    try {
      const response = await this.client.get(
        `/service-variations?serviceID=foreign-airtime&operator_id=${operatorId}&product_type_id=${productTypeId}`,
      );

      if (response.data.response_description === "000") {
        return {
          serviceName: response.data.content.ServiceName,
          serviceId: response.data.content.serviceID,
          convenienceFee: response.data.content.convinience_fee,
          variations: response.data.content.variations.map(
            (variation: any) => ({
              variationCode: variation.variation_code,
              name: variation.name,
              amount: variation.variation_amount,
              fixedPrice: variation.fixedPrice,
            }),
          ),
        };
      }

      // PRODUCTION ERROR HANDLING
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch variations. Please try again later."
          : "Failed to fetch variations";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "Failed to get international airtime variations",
        error.response?.data || error.message,
      );

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.response_description ||
        error.message ||
        "Failed to fetch variations";

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch variations. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  async getInternationalDataProviders(countryCode?: string): Promise<any> {
    try {
      if (!countryCode) {
        return [];
      }

      const response = await this.client.get(
        `/get-international-airtime-operators?code=${countryCode}&product_type_id=4`,
      );

      if (response.data.response_description === "000") {
        return response.data.content.map((operator: any) => ({
          operatorId: operator.operator_id,
          name: operator.name,
          image: operator.operator_image,
        }));
      }

      // PRODUCTION ERROR HANDLING
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch providers. Please try again later."
          : "Failed to fetch international data providers";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "Failed to get international data providers",
        error.response?.data || error.message,
      );

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.response_description ||
        error.message ||
        "Failed to fetch international data providers";

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch providers. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  async getInternationalDataProducts(operator: string): Promise<any> {
    try {
      const response = await this.client.get(
        `/service-variations?serviceID=foreign-airtime&operator_id=${operator}&product_type_id=4`,
      );

      if (response.data.response_description === "000") {
        return {
          serviceName: response.data.content.ServiceName,
          serviceId: response.data.content.serviceID,
          convenienceFee: response.data.content.convinience_fee,
          variations: response.data.content.variations.map(
            (variation: any) => ({
              variationCode: variation.variation_code,
              name: variation.name,
              amount: variation.variation_amount,
              fixedPrice: variation.fixedPrice,
            }),
          ),
        };
      }

      // PRODUCTION ERROR HANDLING
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch data products. Please try again later."
          : "Failed to fetch international data products";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "Failed to get international data products",
        error.response?.data || error.message,
      );

      // PRODUCTION ERROR HANDLING
      const detailedErrorMessage =
        error.response?.data?.response_description ||
        error.message ||
        "Failed to fetch international data products";

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Failed to fetch data products. Please try again later."
          : detailedErrorMessage;

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  async purchaseInternationalAirtime(data: {
    phone: string;
    amount: number;
    countryCode: string;
    operatorId: string;
    variationCode: string;
    reference: string;
    email: string;
  }): Promise<ProviderResponse> {
    return SentryHelper.trackCriticalOperation(
      "vtpass_international_airtime",
      async () => {
        try {
          const response = await this.client.post("/pay", {
            request_id: data.reference,
            serviceID: "foreign-airtime",
            billersCode: data.phone,
            variation_code: data.variationCode,
            amount: data.amount,
            phone: data.phone,
            operator_id: data.operatorId,
            country_code: data.countryCode,
            product_type_id: "1",
            email: data.email,
          });

          return this.handleTransactionResponse(
            response.data,
            "International airtime purchase",
          );
        } catch (error: any) {
          return this.handleError(error, "International airtime purchase");
        }
      },
      data.reference,
    );
  }

  // DATA PURCHASE
  async purchaseData(data: DataDataDTO): Promise<ProviderResponse> {
    return SentryHelper.trackCriticalOperation(
      "vtpass_data",
      async () => {
        try {
          const networkCode = this.getNetworkCode(data.serviceCode);

          const response = await this.client.post("/pay", {
            request_id: data.reference,
            serviceID: data.serviceCode,
            billersCode: data.phone,
            variation_code: data.productCode,
            amount: data.amount,
            phone: data.phone,
          });

          return this.handleTransactionResponse(response.data, "Data purchase");
        } catch (error: any) {
          return this.handleError(error, "Data purchase");
        }
      },
      data.reference,
    );
  }

  // INTERNATIONAL DATA METHODS
  async getInternationalDataCountries(): Promise<any> {
    return this.getInternationalAirtimeCountries();
  }

  async getInternationalDataProductDetails(
    variationCode: string,
    operatorId: string,
  ): Promise<any> {
    try {
      const productsData = await this.getInternationalDataProducts(operatorId);
      const product = productsData.variations.find(
        (v: any) => v.variationCode === variationCode,
      );

      if (!product) {
        throw new AppError(
          "Product not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      return {
        variationCode: product.variationCode,
        name: product.name,
        amount: parseFloat(product.amount) || 0,
        fixedPrice: product.fixedPrice,
      };
    } catch (error: any) {
      logger.error(
        "Failed to get international data product details",
        error.message,
      );
      throw error;
    }
  }

  async purchaseInternationalData(data: {
    phone: string;
    amount: number;
    countryCode: string;
    operatorId: string;
    variationCode: string | undefined;
    reference: string;
    email: string;
  }): Promise<ProviderResponse> {
    return SentryHelper.trackCriticalOperation(
      "vtpass_international_data",
      async () => {
        try {
          const response = await this.client.post("/pay", {
            request_id: data.reference,
            serviceID: "foreign-airtime",
            billersCode: data.phone,
            variation_code: data.variationCode,
            amount: data.amount,
            phone: data.phone,
            operator_id: data.operatorId,
            country_code: data.countryCode,
            product_type_id: "4",
            email: data.email,
          });
          console.log(response.data, "vtpass response ");
          return this.handleTransactionResponse(
            response.data,
            "International data purchase",
          );
        } catch (error: any) {
          return this.handleError(error, "International data purchase");
        }
      },
      data.reference,
    );
  }

  // CABLE TV PURCHASE
  async purchaseCableTv(data: CableTvData): Promise<ProviderResponse> {
    return SentryHelper.trackCriticalOperation(
      "vtpass_cableTV",
      async () => {
        try {
          const response = await this.client.post("/pay", {
            request_id: data.reference,
            serviceID: data.provider,
            billersCode: data.smartCardNumber,
            variation_code: data.package,
            amount: data.amount,
            phone: data.phone,
            subscription_type: data.subscriptionType,
          });

          return this.handleTransactionResponse(
            response.data,
            "Cable TV subscription",
          );
        } catch (error: any) {
          return this.handleError(error, "Cable TV subscription");
        }
      },
      data.reference,
    );
  }

  // EDUCATION/E-PIN PURCHASE
  async purchaseEducation(data: EducationData): Promise<ProviderResponse> {
    return SentryHelper.trackCriticalOperation(
      "vtpass_education",
      async () => {
        try {
          const basePayload = {
            request_id: data.reference,
            serviceID: data.serviceCode,
            phone: data.phone,
          };

          let payload: any;

          switch (data.serviceCode) {
            case "jamb":
              payload = {
                ...basePayload,
                variation_code: data.variationCode,
                billersCode: data.profileId,
                amount: data.amount,
              };
              break;

            case "waec-registration":
              payload = {
                ...basePayload,
                variation_code: data.variationCode,
                amount: data.amount,
                quantity: data.quantity || 1,
              };
              break;

            case "waec":
              payload = {
                ...basePayload,
                variation_code: data.variationCode,
                amount: data.amount,
                quantity: data.quantity || 1,
              };
              break;

            default:
              payload = {
                ...basePayload,
                variation_code: data.variationCode,
                billersCode: data.profileId,
                amount: data.amount,
              };
          }

          const response = await this.client.post("/pay", payload);

          const result = this.handleTransactionResponse(
            response.data,
            "E-Pin purchase",
          );

          // Add token/PIN if available
          if (result.success && response.data.purchased_code) {
            result.token = response.data.purchased_code || response.data.Pin;
          }

          return result;
        } catch (error: any) {
          return this.handleError(error, "E-Pin purchase");
        }
      },
      data.reference,
    );
  }

  // ELECTRICITY PURCHASE
  async purchaseElectricity(data: ElectricityData): Promise<ProviderResponse> {
    return SentryHelper.trackCriticalOperation(
      "vtpass_electricity",
      async () => {
        try {
          const serviceID = this.getElectricityServiceId(data.productCode);
          const response = await this.client.post("/pay", {
            request_id: data.reference,
            serviceID: data.productCode,
            billersCode: data.meterNumber,
            variation_code: data.meterType,
            amount: data.amount,
            phone: data.phone,
          });

          const result = this.handleTransactionResponse(
            response.data,
            "Electricity payment",
          );

          return result;
        } catch (error: any) {
          return this.handleError(error, "Electricity payment");
        }
      },
      data.reference,
    );
  }

  // VERIFICATION METHODS
  async verifySmartCard(
    smartCardNumber: string,
    provider: string,
  ): Promise<any> {
    try {
      const response = await this.client.post("/merchant-verify", {
        billersCode: smartCardNumber,
        serviceID: provider,
      });

      return this.handleVerificationResponse(
        response.data,
        "Smart card verification",
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

    logger.error(
        "Smart card verification error",
        error.response?.data || error.message,
      );

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Smart card verification failed. Please try again later."
          : error.response?.data?.response_description ||
            error.message ||
            "Smart card verification failed";

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
      const response = await this.client.post("/merchant-verify", {
        billersCode: meterNumber,
        serviceID: provider,
        type: meterType,
      });

      const result = this.handleVerificationResponse(
        response.data,
        "Meter verification",
      );

      // Add meter-specific fields
      if (result.valid) {
        result.address = response.data.content?.Address;
        result.meterNumber = response.data.content?.MeterNumber;
        result.meterType = response.data.content?.Meter_Type;
      }

      return result;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

     logger.error(
        "Meter verification error",
        error.response?.data || error.message,
      );

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Meter verification failed. Please try again later."
          : error.response?.data?.response_description ||
            error.message ||
            "Meter verification failed";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  async verifyJambProfile(profileId: string, type: string): Promise<any> {
    try {
      const response = await this.client.post("/merchant-verify", {
        billersCode: profileId,
        serviceID: "jamb",
        type,
      });

      const result = this.handleVerificationResponse(
        response.data,
        "Profile verification",
      );

      // Add profile-specific fields
      if (result.valid) {
        result.registrationNumber = profileId;
      }

      return result;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

     logger.error(
        "JAMB profile verification error",
        error.response?.data || error.message,
      );

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Profile verification failed. Please try again later."
          : error.response?.data?.response_description ||
            error.message ||
            "Profile verification failed";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
  }

  //REquery
  async queryTransactionStatus(requestId: string): Promise<ProviderResponse> {
    try {
      const response = await this.client.post("/requery", {
        request_id: requestId,
      });

      return this.handleTransactionResponse(
        response.data,
        "Transaction requery",
      );
    } catch (error: any) {
      return this.handleError(error, "Transaction requery");
    }
  }

  private getElectricityServiceId(serviceCode: string): string {
    const electricityServiceMap: { [key: string]: string } = {
      kedco: "kano-electric", // DB code → VTPass code
      phed: "portharcourt-electric", // DB code → VTPass code
    };

    // If it's in the map, return the mapped value, otherwise return as-is
    return (
      electricityServiceMap[serviceCode.toLowerCase()] ??
      serviceCode.toLowerCase()
    );
  }

  //WEBHOOK HANDLER

  validatePayload(payload: any): boolean {
    try {
      // Check required fields
      if (!payload || typeof payload !== "object") {
        logger.error("VTPass webhook: Invalid payload structure", { payload });
        return false;
      }

      if (payload.type !== "transaction-update") {
        logger.error("VTPass webhook: Invalid webhook type", {
          type: payload.type,
        });
        return false;
      }

      if (
        !payload.data ||
        !payload.data.content ||
        !payload.data.content.transactions
      ) {
        logger.error("VTPass webhook: Missing required data fields", {
          payload,
        });
        return false;
      }

      if (!payload.data.requestId) {
        logger.error("VTPass webhook: Missing requestId", { payload });
        return false;
      }

      return true;
    } catch (error) {
      logger.error("VTPass webhook: Validation error", { error, payload });
      return false;
    }
  }

  // Process VTPass webhook and extract transaction data
  async process(payload: VTPassWebhookPayload): Promise<WebhookProcessResult> {
    try {
      logger.info("VTPass webhook: Processing payload", {
        requestId: payload.data.requestId,
        status: payload.data.content.transactions.status,
      });

      // Validate payload
      if (!this.validatePayload(payload)) {
        throw new AppError(
          "Invalid VTPass webhook payload",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const { data } = payload;
      const transaction = data.content.transactions;

      // Map VTPass status to our standard status
      const status = this.mapStatus(transaction.status, data.code);

      // Extract metadata
      const metadata = this.extractMetadata(data);

      // Extract token (for electricity, e-pins)
      const token = data.purchased_code || undefined;

      const result: WebhookProcessResult = {
        reference: data.requestId,
        providerReference: transaction.transactionId,
        status,
        metadata,
        token,
      };

      logger.info("VTPass webhook: Processing completed", {
        requestId: data.requestId,
        status,
      });

      return result;
    } catch (error) {
      logger.error("VTPass webhook: Processing error", { error, payload });
      throw error;
    }
  }

  //    Map VTPass status to our standard status
  private mapStatus(
    vtpassStatus: string,
    code: string,
  ): "success" | "pending" | "failed" | "reversed" {
    // Handle based on status
    if (vtpassStatus === "delivered") {
      return "success";
    }

    if (vtpassStatus === "reversed") {
      return "reversed";
    }

    if (vtpassStatus === "failed") {
      return "failed";
    }

    // Handle pending/initiated
    if (vtpassStatus === "pending" || vtpassStatus === "initiated") {
      return "pending";
    }

    // Fallback based on code
    if (code === "000") {
      return "success";
    }

    if (code === "099") {
      return "pending";
    }

    if (code === "040") {
      return "reversed";
    }

    // Default to pending for unknown statuses
    logger.warn("VTPass webhook: Unknown status, defaulting to pending", {
      vtpassStatus,
      code,
    });
    return "pending";
  }

  //    Extract metadata from VTPass webhook
  private extractMetadata(data: VTPassWebhookPayload["data"]): any {
    const transaction = data.content.transactions;

    return {
      // VTPass specific fields
      vtpassTransactionId: transaction.transactionId,
      productName: transaction.product_name,
      commission: transaction.commission,
      totalAmount: transaction.total_amount,
      unitPrice: transaction.unit_price,
      quantity: transaction.quantity,
      discount: transaction.discount,
      convenienceFee: transaction.convinience_fee,
      channel: transaction.channel,
      platform: transaction.platform,
      method: transaction.method,

      // Additional info
      responseCode: data.code,
      responseDescription: data.response_description,
      uniqueElement: transaction.unique_element,
      purchasedCode: data.purchased_code,

      // Reversal specific
      walletCreditId: transaction.wallet_credit_id,

      // Timestamps
      transactionDate: data.transaction_date,
      webhookReceivedAt: new Date(),
    };
  }

  // FILE: VTPassService.ts
  private handleTransactionResponse(
    responseData: any,
    operationType: string,
  ): ProviderResponse {
    const code = responseData.code;
    const transactionStatus = responseData?.content?.transactions?.status;

    // Handle code 099 - Transaction is processing
    if (code === "099") {
      logger.info(`VTPass ${operationType} transaction processing`, {
        code: code,
        requestId: responseData.requestId,
        description: responseData.response_description,
      });

      return {
        success: false,
        pending: true,
        providerReference: responseData.requestId || responseData.transactionId,
        message:
          responseData.response_description || "Transaction is processing",
        data: responseData.content,
      };
    }

    // Handle failed transactions (not code 000)
    if (code !== "000") {
      logger.error(`VTPass ${operationType} transaction failed`, {
        code: code,
        description: responseData.response_description,
        requestId: responseData.requestId,
      });

      const detailedErrorMessage =
        responseData.response_description || `${operationType} failed`;
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

    // Code is 000, check transaction status
    if (transactionStatus === "delivered") {
      // Extract commission and convenience fee for profit tracking
      const commission: number =
        responseData.content?.transactions?.commission ?? 0;
      const convenienceFee: number =
        responseData.content?.transactions?.convinience_fee ?? 0;

      const rawToken =
        responseData.token ||
        responseData.Token ||
        responseData.mainToken ||
        responseData.purchased_code ||
        "";
      const token = rawToken.replace(/^Token\s*:\s*/i, "").trim();

      logger.info(`VTPass ${operationType} delivered`, {
        requestId: responseData.requestId,
        commission,
        convenienceFee,
      });

      return {
        success: true,
        pending: false,
        status: transactionStatus,
        providerReference: responseData.requestId || responseData.transactionId,
        token,
        meta: {
          customerName:
            responseData.customerName ?? responseData.CustomerName ?? "",
          customerAddress:
            responseData.customerAddress ?? responseData.CustomerAddress ?? "",
          meterNumber:
            responseData.meterNumber ?? responseData.MeterNumber ?? "",
          tokenAmount: responseData.tokenAmount ?? undefined,
          units: responseData.units ?? responseData.PurchasedUnits ?? undefined,
          exchangeReference: responseData.exchangeReference ?? undefined,
        },
        message:
          responseData.response_description || `${operationType} successful`,
        data: responseData.content,
        commission,
        convenienceFee,
      };
    } else if (
      transactionStatus === "pending" ||
      transactionStatus === "initiated"
    ) {
      logger.info(`VTPass ${operationType} transaction pending`, {
        status: transactionStatus,
        requestId: responseData.requestId,
      });

      return {
        success: false,
        pending: true,
        status: transactionStatus,
        providerReference: responseData.requestId || responseData.transactionId,
        message: "Transaction is being processed",
        data: responseData.content,
        token: responseData.content?.token || "",
      };
    }

    logger.warn(`VTPass ${operationType} unexpected transaction status`, {
      code: code,
      status: transactionStatus,
      requestId: responseData.requestId,
    });

    return {
      success: false,
      pending: true,
      status: transactionStatus,
      providerReference: responseData.requestId || responseData.transactionId,
      message: "Transaction status unclear, please requery",
      data: responseData.content,
    };
  }

  private handleVerificationResponse(
    responseData: any,
    operationType: string,
  ): any {
    const code = responseData.code;

    if (code === "020" || code === "000") {
      if (responseData.content?.error) {
        // PRODUCTION ERROR HANDLING
        const finalErrorMessage =
          process.env.NODE_ENV === "production"
            ? "Verification failed. Please try again later."
            : responseData.content?.error;

        throw new AppError(
          finalErrorMessage,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      return {
        valid: true,
        customerName: responseData.content?.Customer_Name,
        status: responseData.content?.Status,
        smartCardNumber: responseData.content?.Customer_Number,
        dueDate: responseData.content?.Due_Date,
      };
    }

    // Handle specific error codes
    if (code === "011") {
      // PRODUCTION ERROR HANDLING
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Verification failed. Please try again later."
          : "Invalid arguments provided for verification";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (code === "012") {
      // PRODUCTION ERROR HANDLING
      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Verification failed. Please try again later."
          : "Service does not exist";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    if (code === "030") {
      // Service unavailable - can show in production as it's informational
      throw new AppError(
        "Service provider is currently unavailable",
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }

    // PRODUCTION ERROR HANDLING
    const detailedErrorMessage =
      responseData.response_description || `${operationType} failed`;
    const finalErrorMessage =
      process.env.NODE_ENV === "production"
        ? "Verification failed. Please try again later."
        : detailedErrorMessage;

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
      logger.error(`VTPass ${operationType} error`, {
        status: error.response.status,
        data: error.response.data,
      });
    } else {
      logger.error(`VTPass ${operationType} error`, error.message);
    }

    // PRODUCTION ERROR HANDLING
    const detailedErrorMessage =
      error.response?.data?.response_description ||
      error.message ||
      `${operationType} failed`;

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

  private getNetworkCode(network: string | undefined): string {
    if (!network) {
      throw new AppError(
        `Network is required`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }
    const networkMap: { [key: string]: string } = {
      "mtn-airtime": "mtn",
      "glo-airtime": "glo",
      "9mobile-airtime": "9mobile",
      "etisalat-airtime": "etisalat",
      "airtel-airtime": "airtel",

      "mtn-data": "mtn",
      "glo-data": "glo",
      "9mobile-data": "9mobile",
      "etisalat-data": "etisalat",
      "airtel-data": "airtel",
    };

    const code = networkMap[network.toLowerCase()];

    if (!code) {
      throw new AppError(
        `Unsupported network: ${network}`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    return code;
  }
}
