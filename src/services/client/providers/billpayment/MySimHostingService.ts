import axios, { AxiosInstance } from "axios";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { PROVIDERS } from "@/config";
import https from "https";
import { DataDataDTO, ProviderResponse, AirtimeData } from "@/types";



export class MySimHostingService {
  private client: AxiosInstance;
  private provider = PROVIDERS.MYSIMHOSTING;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl,
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.provider.apiKey}`,
      },
    });
  }
  

  //  DATA PLANS 
  async getDataPlans(): Promise<any> {
    try {
      const agent = new https.Agent({ rejectUnauthorized: false });

      const response = await this.client.get("/v1/data/plans", {
        httpsAgent: agent,
      });


      if (response.data.status === "success") {
        return {
          success: true,
          plans: response.data.data || response.data.plans,
          message: "Data plans fetched successfully",
        };
      }

      throw new AppError(
        response.data?.message || "Failed to fetch data plans",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    } catch (error: any) {
      logger.error(
        "MySimHosting get data plans error",
        error.response?.data.message || error.message
      );
      throw new AppError(
        error.response?.data?.message || "Failed to fetch data plans",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }
  }

  //  DATA PURCHASE 
  async purchaseData(data: DataDataDTO): Promise<ProviderResponse> {
    try {
      const payload = {
        network: this.getNetworkId( data.serviceCode || ""),
        plan: parseInt(data.plan) || parseInt(data.variationCode || "1"),
        number: data.phone,
        senderID: "Mysimhosting",
      };

      logger.info("MySimHosting data purchase request", payload);

      const agent = new https.Agent({ rejectUnauthorized: false });

      const response = await this.client.post("/v1/data", payload, {
        httpsAgent: agent,
      });

      return this.handleTransactionResponse(
        response.data,
        data.reference,
        "Data purchase"
      );
    } catch (error: any) {
      return this.handleError(error, "Data purchase");
    }
  }

  //  AIRTIME PURCHASE 
  // Note: MySimHosting API documentation doesn't show airtime endpoint
  // This is a placeholder implementation - needs to be verified with actual API docs
  async purchaseAirtime(data: AirtimeData): Promise<ProviderResponse> {
    try {
      // Check if there's an airtime endpoint (not in current documentation)
      // You may need to update this based on actual MySimHosting airtime API
      logger.warn("MySimHosting airtime purchase not documented in API");

      throw new AppError(
        "Airtime purchase not supported by MySimHosting provider",
        HTTP_STATUS.NOT_IMPLEMENTED,
        ERROR_CODES.PROVIDER_ERROR
      );
    } catch (error: any) {
      return this.handleError(error, "Airtime purchase");
    }
  }

  //  USSD/SMS REQUEST 
  async sendUSSDRequest(data: {
    command: string;
    sim: number;
    device: string;
    to?: string;
  }): Promise<any> {
    try {
      const payload = {
        type: "USSD",
        command: data.command,
        sim: data.sim,
        device: data.device,
        ...(data.to && { to: data.to }),
      };

      const response = await this.client.post("/v1/device", payload);

      if (response.data.status === "success") {
        return {
          success: true,
          reference: response.data.data?.reference,
          message:
            response.data.data?.message || "USSD request sent successfully",
          response: response.data.data?.response,
          data: response.data.data,
        };
      }

      throw new AppError(
        response.data.message || "USSD request failed",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    } catch (error: any) {
      logger.error(
        "MySimHosting USSD request error",
        error.response?.data || error.message
      );
      throw new AppError(
        error.response?.data?.message || "USSD request failed",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }
  }

  async sendSMSRequest(data: {
    command: string;
    sim: number;
    device: string;
    to: string;
  }): Promise<any> {
    try {
      const payload = {
        type: "SMS",
        command: data.command,
        sim: data.sim,
        device: data.device,
        to: data.to,
      };

      const response = await this.client.post("/v1/device", payload);

      if (response.data.status === "success") {
        return {
          success: true,
          reference: response.data.data?.reference,
          message: response.data.data?.message || "SMS sent successfully",
          response: response.data.data?.response,
          data: response.data.data,
        };
      }

      throw new AppError(
        response.data.message || "SMS request failed",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    } catch (error: any) {
      logger.error(
        "MySimHosting SMS request error",
        error.response?.data || error.message
      );
      throw new AppError(
        error.response?.data?.message || "SMS request failed",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }
  }

  //  HELPER METHODS 
  private handleTransactionResponse(
    responseData: any,
    clientReference: string,
    operationType: string
  ): ProviderResponse {
    // Handle success response
    if (responseData.code === 100 && responseData.status === "success") {
      return {
        success: true,
        pending: false,
        reference: clientReference,
        providerReference: responseData.reference,
        message: responseData.message || `${operationType} successful`,
        data: responseData,
      };
    }

    // Handle failed response (code 100 with status "failed")
    if (responseData.code === 100 && responseData.status === "failed") {
      logger.error(`MySimHosting ${operationType} failed`, {
        code: responseData.code,
        status: responseData.status,
        message: responseData.message,
        reference: responseData.reference,
      });

      throw new AppError(
        responseData.message || `${operationType} failed`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }

    // Handle other status codes
    logger.warn(`MySimHosting ${operationType} unexpected response`, {
      code: responseData.code,
      status: responseData.status,
      message: responseData.message,
    });

    // Default to pending if status is unclear
    return {
      success: false,
      pending: true,
      reference: clientReference,
      providerReference: responseData.reference,
      message:
        responseData.message ||
        "Transaction status unclear, please check status",
      data: responseData,
    };
  }

  private handleError(error: any, operationType: string): never {
    if (error instanceof AppError) {
      throw error;
    }

    if (error.response) {
      logger.error(`MySimHosting ${operationType} error`, {
        status: error.response.status,
        data: error.response.data,
      });

      throw new AppError(
        error.response.data?.message ||
          error.response.data?.error ||
          `${operationType} failed`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }

    logger.error(`MySimHosting ${operationType} error`, error.message);

    throw new AppError(
      error.message || `${operationType} failed`,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.PROVIDER_ERROR
    );
  }

  private getNetworkId(network: string): number {
    const networkMap: { [key: string]: number } = {
      mtn: 1,
      "mtn-data": 1,
      glo: 2,
      "glo-data": 2,
      airtel: 3,
      "airtel-data": 3,
      "9mobile": 4,
      "9mobile-data": 4,
      etisalat: 4,
      "etisalat-data": 4,
    };

    return networkMap[network.toLowerCase()] || 1;
  }
}
