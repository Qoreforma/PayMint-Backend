import axios, { AxiosInstance } from "axios";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { PROVIDERS } from "@/config";
import {
  AirtimeData,
  CableTvData,
  DataDataDTO,
  ProviderResponse,
} from "@/types";

export class BilalsadasubService {
  private client: AxiosInstance;
  private provider = PROVIDERS.BILALSADASUB;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl || "https://bilalsadasub.com/api",
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${this.provider.apiKey}`,
      },
    });
  }

  // AIRTIME PURCHASE
  async purchaseAirtime(data: AirtimeData): Promise<ProviderResponse> {
    try {
      const payload = {
        network: this.getNetworkId(data.network),
        phone: this.formatPhoneNumber(data.phone),
        plan_type: "VTU",
        amount: data.amount,
        bypass: false,
        "request-id": data.reference,
      };

      const response = await this.client.post("/topup", payload);

      return this.handleTransactionResponse(response.data, "Airtime purchase");
    } catch (error: any) {
      return this.handleError(error, "Airtime purchase");
    }
  }

  // DATA PURCHASE
  async purchaseData(data: DataDataDTO): Promise<ProviderResponse> {
    try {
      const payload = {
        network: this.getNetworkId(data.serviceCode || ""),
        phone: this.formatPhoneNumber(data.phone),
        data_plan: parseInt(data.productCode || "1"),
        bypass: false,
        "request-id": data.reference,
      };

      const response = await this.client.post("/data", payload);

      return this.handleTransactionResponse(response.data, "Data purchase");
    } catch (error: any) {
      return this.handleError(error, "Data purchase");
    }
  }

  // CABLE TV PURCHASE
  async purchaseCableTv(data: CableTvData): Promise<ProviderResponse> {
    try {
      const payload = {
        cable: this.getCableId(data.provider),
        iuc: data.smartCardNumber,
        cable_plan: parseInt(data.package),
        bypass: false,
        "request-id": data.reference,
      };

      const response = await this.client.post("/cable", payload);

      return this.handleTransactionResponse(
        response.data,
        "Cable TV subscription"
      );
    } catch (error: any) {
      return this.handleError(error, "Cable TV subscription");
    }
  }

  // METER NUMBER VERIFICATION
  async verifyMeterNumber(
    meterNumber: string,
    provider: string,
    meterType: string
  ): Promise<any> {
    try {
      const response = await this.client.get(
        `/bill/bill-validation?meter_number=${meterNumber}&disco=${this.getDiscoId(
          provider
        )}&meter_type=${meterType.toLowerCase()}`
      );

      return this.handleVerificationResponse(
        response.data,
        "Meter verification"
      );
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "Meter verification error",
        error.response?.data || error.message
      );

      const finalErrorMessage =
        process.env.NODE_ENV === "production"
          ? "Meter verification failed. Please try again later."
          : error.response?.data?.message || "Meter verification failed";

      throw new AppError(
        finalErrorMessage,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }
  }

  // HELPER METHODS
  private handleTransactionResponse(
    responseData: any,
    operationType: string
  ): ProviderResponse {
    const status = responseData.status?.toLowerCase();

    // Handle successful transactions
    if (status === "success" || status === "successful") {
      logger.info(`Bilalsadasub ${operationType} successful`, {
        requestId: responseData["request-id"],
        message: responseData.message,
      });

      return {
        success: true,
        pending: false,
        status: "delivered",
        reference: responseData["request-id"],
        providerReference: responseData["request-id"],
        message: responseData.message || `${operationType} successful`,
        data: responseData,
      };
    }

    // Handle pending transactions
    if (status === "pending" || status === "processing") {
      logger.info(`Bilalsadasub ${operationType} pending`, {
        requestId: responseData["request-id"],
        message: responseData.message,
      });

      return {
        success: false,
        pending: true,
        status: "pending",
        reference: responseData["request-id"],
        providerReference: responseData["request-id"],
        message: responseData.message || "Transaction is processing",
        data: responseData,
      };
    }

    // Handle failed transactions
  // Handle failed transactions
    logger.error(`Bilalsadasub ${operationType} failed`, {
      status: status,
      message: responseData.message,
      requestId: responseData["request-id"],
    });

    const finalErrorMessage =
      process.env.NODE_ENV === "production"
        ? `${operationType} failed. Please try again later.`
        : responseData.message || `${operationType} failed`;

    throw new AppError(
      finalErrorMessage,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.PROVIDER_ERROR
    );
  }

  private handleVerificationResponse(
    responseData: any,
    operationType: string
  ): any {
    const status = responseData.status?.toLowerCase();

    if (status === "success" || status === "successful") {
      return {
        valid: true,
        customerName: responseData.name || responseData.customer_name,
        status: "active",
        data: responseData,
      };
    }

   throw new AppError(
      process.env.NODE_ENV === "production"
        ? `${operationType} failed. Please try again later.`
        : responseData.message || `${operationType} failed`,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  private handleError(error: any, operationType: string): never {
    if (error instanceof AppError) {
      throw error;
    }

    if (error.response) {
      logger.error(`Bilalsadasub ${operationType} error`, {
        status: error.response.status,
        data: error.response.data,
      });
    } else {
      logger.error(`Bilalsadasub ${operationType} error`, error.message);
    }

  const finalErrorMessage =
      process.env.NODE_ENV === "production"
        ? `${operationType} failed. Please try again later.`
        : error.response?.data?.message ||
          error.message ||
          `${operationType} failed`;

    throw new AppError(
      finalErrorMessage,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.PROVIDER_ERROR
    );
  }

  // MAPPING METHODS - Based on documentation
  private getNetworkId(network: string): number {
    // From documentation: MTN=1, AIRTEL=2, GLO=3, 9MOBILE=4
    const networkMap: { [key: string]: number } = {
      mtn: 1,
      "mtn-ng": 1,
      airtel: 2,
      "airtel-ng": 2,
      glo: 3,
      "glo-ng": 3,
      "9mobile": 4,
      etisalat: 4,
      "etisalat-ng": 4,
    };
    return networkMap[network.toLowerCase()] || 1;
  }

  private getCableId(provider: string): number {
    // From documentation: GOTV=1, DSTV=2, STARTIME=3
    const cableMap: { [key: string]: number } = {
      gotv: 1,
      dstv: 2,
      startime: 3,
      startimes: 3,
    };
    return cableMap[provider.toLowerCase()] || 1;
  }

  private getDiscoId(provider: string): number {
    // From documentation: Ikeja=1, Eko=2, Kano=3, Port Harcourt=4, Jos=5
    const discoMap: { [key: string]: number } = {
      "ikeja-electric": 1,
      ikeja: 1,
      "eko-electric": 2,
      eko: 2,
      "kano-electric": 3,
      kano: 3,
      "portharcourt-electric": 4,
      "port-harcourt-electric": 4,
      portharcourt: 4,
      "jos-electric": 5,
      jos: 5,
    };
    return discoMap[provider.toLowerCase()] || 1;
  }

  private formatPhoneNumber(phone: string): string {
    // Remove any non-digit characters
    let cleaned = phone.replace(/\D/g, "");

    // If it starts with country code, remove it
    if (cleaned.startsWith("234")) {
      cleaned = "0" + cleaned.slice(3);
    }

    // Ensure it starts with 0
    if (!cleaned.startsWith("0")) {
      cleaned = "0" + cleaned;
    }

    return cleaned;
  }
}
