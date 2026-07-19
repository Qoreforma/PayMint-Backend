import axios, { AxiosInstance } from "axios";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { PROVIDERS } from "@/config";
import { AirtimeData, ProviderResponse, DataDataDTO, CableTvData, ElectricityData, EducationData, BettingData } from "@/types";


export class CoolsubService {
  private client: AxiosInstance;
  private provider = PROVIDERS.COOLSUB;

  constructor() {
    this.client = axios.create({
      baseURL: process.env.COOLSUB_BASE_URL || "https://subandgain.com/api",
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async purchaseAirtime(data: AirtimeData): Promise<ProviderResponse> {
    try {
      const response = await this.client.get("/airtime.php", {
        params: {
          username: this.provider.username,
          apiKey: this.provider.apiKey,
          network: data.network.toUpperCase(),
          phoneNumber: data.phone,
          amount: data.amount,
        },
      });

      return this.handleAirtimeResponse(response.data, data.reference);
    } catch (error: any) {
      return this.handleError(error, "Airtime purchase");
    }
  }

  async purchaseData(data: DataDataDTO): Promise<ProviderResponse> {
    try {
      // Extract network from provider or serviceCode
      const network = this.extractNetwork(
         data.serviceCode || ""
      );

      const response = await this.client.get("/data.php", {
        params: {
          username: this.provider.username,
          apiKey: this.provider.apiKey,
          network: network.toUpperCase(),
          dataPlan: data.variationCode || data.plan,
          phoneNumber: data.phone,
        },
      });

      return this.handleDataResponse(response.data, data.reference);
    } catch (error: any) {
      return this.handleError(error, "Data purchase");
    }
  }

  async purchaseCableTv(data: CableTvData): Promise<ProviderResponse> {
    try {
      const response = await this.client.get("/bills.php", {
        params: {
          username: this.provider.username,
          apiKey: this.provider.apiKey,
          service: this.extractCableProvider(data.provider),
          bills_code: data.package,
          smartNumber: data.smartCardNumber,
        },
      });

      return this.handleCableTvResponse(response.data, data.reference);
    } catch (error: any) {
      return this.handleError(error, "Cable TV purchase");
    }
  }

  async purchaseElectricity(data: ElectricityData): Promise<ProviderResponse> {
    try {
      // First, verify the meter to get accessToken
      const verificationResponse = await this.client.get(
        "/verify_electricity.php",
        {
          params: {
            username: this.provider.username,
            apiKey: this.provider.apiKey,
            service: this.extractElectricityProvider(data.provider),
            meterNumber: data.meterNumber,
            meterType: data.meterType.toUpperCase(),
          },
        }
      );

      if (verificationResponse.data.error) {
        throw new AppError(
          verificationResponse.data.description || "Meter verification failed",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR
        );
      }

      const accessToken = verificationResponse.data.accessToken;

      // Now purchase electricity
      const response = await this.client.get("/electricity.php", {
        params: {
          username: this.provider.username,
          apiKey: this.provider.apiKey,
          service: this.extractElectricityProvider(data.provider),
          meterNumber: data.meterNumber,
          meterType: data.meterType.toUpperCase(),
          accessToken: accessToken,
          amount: data.amount,
        },
      });

      return this.handleElectricityResponse(response.data, data.reference);
    } catch (error: any) {
      return this.handleError(error, "Electricity purchase");
    }
  }

  async purchaseEducation(data: EducationData): Promise<ProviderResponse> {
    try {
      const response = await this.client.get("/education.php", {
        params: {
          username: this.provider.username,
          apiKey: this.provider.apiKey,
          eduType: data.variationCode,
        },
      });

      return this.handleEducationResponse(response.data, data.reference);
    } catch (error: any) {
      return this.handleError(error, "Education purchase");
    }
  }

  async fundBetting(data: BettingData): Promise<ProviderResponse> {
    // Coolsub doesn't support Betting in the provided documentation
    throw new AppError(
      "Betting service not supported by Coolsub",
      HTTP_STATUS.NOT_IMPLEMENTED,
      ERROR_CODES.PROVIDER_ERROR
    );
  }

  async verifySmartCard(
    smartCardNumber: string,
    provider: string
  ): Promise<any> {
    try {
      const response = await this.client.get("/verify_bills.php", {
        params: {
          username: this.provider.username,
          apiKey: this.provider.apiKey,
          service: this.extractCableProvider(provider),
          smartNumber: smartCardNumber,
        },
      });

      if (response.data.error) {
        throw new AppError(
          response.data.description || "Smart card verification failed",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR
        );
      }

      return {
        valid: true,
        customerName: response.data.customerName,
        smartCardNumber: response.data.smartNumber,
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "Coolsub smart card verification error",
        error.response?.data || error.message
      );

      throw new AppError(
        error.response?.data?.description ||
          error.message ||
          "Smart card verification failed",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }
  }

  async verifyMeterNumber(
    meterNumber: string,
    provider: string,
    meterType: string
  ): Promise<any> {
    try {
      const response = await this.client.get("/verify_electricity.php", {
        params: {
          username: this.provider.username,
          apiKey: this.provider.apiKey,
          service: this.extractElectricityProvider(provider),
          meterNumber: meterNumber,
          meterType: meterType.toUpperCase(),
        },
      });

      if (response.data.error) {
        throw new AppError(
          response.data.description || "Meter verification failed",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR
        );
      }

      return {
        valid: true,
        customerName: response.data.customerName,
        meterNumber: meterNumber,
        accessToken: response.data.accessToken,
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        "Coolsub meter verification error",
        error.response?.data || error.message
      );

      throw new AppError(
        error.response?.data?.description ||
          error.message ||
          "Meter verification failed",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }
  }

  async queryAirtimeTransaction(transId: string): Promise<any> {
    try {
      const response = await this.client.get("/query_airtime.php", {
        params: {
          username: this.provider.username,
          apiKey: this.provider.apiKey,
          trans_id: transId,
        },
      });

      if (response.data.error) {
        throw new AppError(
          response.data.description || "Transaction not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND
        );
      }

      return {
        status: response.data.status,
        transactionId: response.data.trans_id,
        network: response.data.network,
        phoneNumber: response.data.phoneNumber,
        amount: response.data.amount,
      };
    } catch (error: any) {
      logger.error(
        "Coolsub airtime query error",
        error.response?.data || error.message
      );
      throw error;
    }
  }

  async queryDataTransaction(transId: string): Promise<any> {
    try {
      const response = await this.client.get("/query_data.php", {
        params: {
          username: this.provider.username,
          apiKey: this.provider.apiKey,
          trans_id: transId,
        },
      });

      if (response.data.error) {
        throw new AppError(
          response.data.description || "Transaction not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND
        );
      }

      return {
        status: response.data.status,
        transactionId: response.data.trans_id,
        network: response.data.network,
        phoneNumber: response.data.phoneNumber,
        amount: response.data.amount,
        dataPlan: response.data.dataPlan,
        apiResponse: response.data.api_response,
      };
    } catch (error: any) {
      logger.error(
        "Coolsub data query error",
        error.response?.data || error.message
      );
      throw error;
    }
  }

  async queryCableTvTransaction(transId: string): Promise<any> {
    try {
      const response = await this.client.get("/query_bills.php", {
        params: {
          username: this.provider.username,
          apiKey: this.provider.apiKey,
          trans_id: transId,
        },
      });

      if (response.data.error) {
        throw new AppError(
          response.data.description || "Transaction not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND
        );
      }

      return {
        status: response.data.status,
        transactionId: response.data.trans_id,
        package: response.data.package,
        smartNumber: response.data.smartNumber,
        amount: response.data.amount,
      };
    } catch (error: any) {
      logger.error(
        "Coolsub cable TV query error",
        error.response?.data || error.message
      );
      throw error;
    }
  }

  async queryElectricityTransaction(transId: string): Promise<any> {
    try {
      const response = await this.client.get("/query_electricity.php", {
        params: {
          username: this.provider.username,
          apiKey: this.provider.apiKey,
          trans_id: transId,
        },
      });

      if (response.data.error) {
        throw new AppError(
          response.data.description || "Transaction not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND
        );
      }

      return {
        status: response.data.status,
        transactionId: response.data.trans_id,
        service: response.data.service,
        meterNumber: response.data.MeterNo,
        token: response.data.MeterToken,
        amount: response.data.amount,
      };
    } catch (error: any) {
      logger.error(
        "Coolsub electricity query error",
        error.response?.data || error.message
      );
      throw error;
    }
  }

  async queryEducationTransaction(transId: string): Promise<any> {
    try {
      const response = await this.client.get("/query_education.php", {
        params: {
          username: this.provider.username,
          apiKey: this.provider.apiKey,
          trans_id: transId,
        },
      });

      if (response.data.error) {
        throw new AppError(
          response.data.description || "Transaction not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND
        );
      }

      return {
        status: response.data.status,
        transactionId: response.data.trans_id,
        network: response.data.network,
        token: response.data.token,
        amount: response.data.amount,
      };
    } catch (error: any) {
      logger.error(
        "Coolsub education query error",
        error.response?.data || error.message
      );
      throw error;
    }
  }

  private handleAirtimeResponse(
    responseData: any,
    reference: string
  ): ProviderResponse {
    // Check for errors
    if (responseData.error) {
      throw new AppError(
        this.getErrorMessage(responseData.error, responseData.description),
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }

    const status = responseData.status?.toLowerCase();

    if (status === "approved") {
      return {
        success: true,
        pending: false,
        reference: reference,
        status: "approved",
        providerReference: responseData.trans_id,
        message: "Airtime purchase successful",
        data: {
          network: responseData.network,
          phoneNumber: responseData.phoneNumber,
          amount: responseData.amount,
          balance: responseData.balance,
        },
      };
    } else if (status === "pending") {
      return {
        success: false,
        pending: true,
        reference: reference,
        status: "pending",
        providerReference: responseData.trans_id,
        message: "Airtime purchase is being processed",
        data: {
          network: responseData.network,
          phoneNumber: responseData.phoneNumber,
          amount: responseData.amount,
          balance: responseData.balance,
        },
      };
    } else if (status === "cancelled") {
      throw new AppError(
        "Airtime purchase was cancelled",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }

    // Unknown status
    return {
      success: false,
      pending: true,
      reference: reference,
      status: status,
      providerReference: responseData.trans_id,
      message: "Airtime purchase status unclear, please requery",
      data: responseData,
    };
  }

  private handleDataResponse(
    responseData: any,
    reference: string
  ): ProviderResponse {
    // Check for errors
    if (responseData.error) {
      throw new AppError(
        this.getErrorMessage(responseData.error, responseData.description),
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }

    const status = responseData.status?.toLowerCase();

    if (status === "approved") {
      return {
        success: true,
        pending: false,
        reference: reference,
        status: "approved",
        providerReference: responseData.trans_id,
        message: "Data purchase successful",
        data: {
          network: responseData.network,
          phoneNumber: responseData.phoneNumber,
          dataPlan: responseData.dataPlan,
          apiResponse: responseData.api_response,
          balance: responseData.balance,
        },
      };
    } else if (status === "pending") {
      return {
        success: false,
        pending: true,
        reference: reference,
        status: "pending",
        providerReference: responseData.trans_id,
        message: "Data purchase is being processed",
        data: {
          network: responseData.network,
          phoneNumber: responseData.phoneNumber,
          dataPlan: responseData.dataPlan,
          apiResponse: responseData.api_response,
          balance: responseData.balance,
        },
      };
    } else if (status === "cancelled") {
      throw new AppError(
        "Data purchase was cancelled",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }

    // Unknown status
    return {
      success: false,
      pending: true,
      reference: reference,
      status: status,
      providerReference: responseData.trans_id,
      message: "Data purchase status unclear, please requery",
      data: responseData,
    };
  }

  private handleCableTvResponse(
    responseData: any,
    reference: string
  ): ProviderResponse {
    // Check for errors
    if (responseData.error) {
      throw new AppError(
        this.getErrorMessage(responseData.error, responseData.description),
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }

    const status = responseData.status?.toLowerCase();

    if (status === "approved") {
      return {
        success: true,
        pending: false,
        reference: reference,
        status: "approved",
        providerReference: responseData.trans_id,
        message: "Cable TV subscription successful",
        data: {
          service: responseData.service,
          package: responseData.package,
          smartNumber: responseData.smartNumber,
          amount: responseData.amount,
          balance: responseData.balance,
        },
      };
    } else if (status === "pending") {
      return {
        success: false,
        pending: true,
        reference: reference,
        status: "pending",
        providerReference: responseData.trans_id,
        message: "Cable TV subscription is being processed",
        data: {
          service: responseData.service,
          package: responseData.package,
          smartNumber: responseData.smartNumber,
          amount: responseData.amount,
          balance: responseData.balance,
        },
      };
    } else if (status === "cancelled") {
      throw new AppError(
        "Cable TV subscription was cancelled",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }

    // Unknown status
    return {
      success: false,
      pending: true,
      reference: reference,
      status: status,
      providerReference: responseData.trans_id,
      message: "Cable TV subscription status unclear, please requery",
      data: responseData,
    };
  }

  private handleElectricityResponse(
    responseData: any,
    reference: string
  ): ProviderResponse {
    // Check for errors
    if (responseData.error) {
      throw new AppError(
        this.getErrorMessage(responseData.error, responseData.description),
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }

    const status = responseData.status?.toLowerCase();

    if (status === "approved") {
      return {
        success: true,
        pending: false,
        reference: reference,
        status: "approved",
        providerReference: responseData.trans_id,
        message: "Electricity purchase successful",
        token: responseData.MeterToken,
        data: {
          service: responseData.service,
          meterType: responseData.MeterType,
          meterNumber: responseData.MeterNo,
          token: responseData.MeterToken,
          amount: responseData.amount,
          balance: responseData.balance,
        },
      };
    } else if (status === "pending") {
      return {
        success: false,
        pending: true,
        reference: reference,
        status: "pending",
        providerReference: responseData.trans_id,
        message: "Electricity purchase is being processed",
        data: {
          service: responseData.service,
          meterType: responseData.MeterType,
          meterNumber: responseData.MeterNo,
          amount: responseData.amount,
          balance: responseData.balance,
        },
      };
    } else if (status === "cancelled") {
      throw new AppError(
        "Electricity purchase was cancelled",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }

    // Unknown status
    return {
      success: false,
      pending: true,
      reference: reference,
      status: status,
      providerReference: responseData.trans_id,
      message: "Electricity purchase status unclear, please requery",
      data: responseData,
    };
  }

  private handleEducationResponse(
    responseData: any,
    reference: string
  ): ProviderResponse {
    // Check for errors
    if (responseData.error) {
      throw new AppError(
        this.getErrorMessage(responseData.error, responseData.description),
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }

    const status = responseData.status?.toLowerCase();

    if (status === "approved") {
      return {
        success: true,
        pending: false,
        reference: reference,
        status: "approved",
        providerReference: responseData.trans_id,
        message: "E-Pin purchase successful",
        token: responseData.token,
        data: {
          eduType: responseData.EduType,
          package: responseData.package,
          token: responseData.token,
          balance: responseData.balance,
        },
      };
    } else if (status === "pending") {
      return {
        success: false,
        pending: true,
        reference: reference,
        status: "pending",
        providerReference: responseData.trans_id,
        message: "E-Pin purchase is being processed",
        data: {
          eduType: responseData.EduType,
          package: responseData.package,
          balance: responseData.balance,
        },
      };
    } else if (status === "cancelled") {
      throw new AppError(
        "E-Pin purchase was cancelled",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }

    // Unknown status
    return {
      success: false,
      pending: true,
      reference: reference,
      status: status,
      providerReference: responseData.trans_id,
      message: "E-Pin purchase status unclear, please requery",
      data: responseData,
    };
  }

  private extractNetwork(provider: string): string {
    const normalized = provider.toLowerCase();

    if (normalized.includes("mtn")) return "MTN";
    if (normalized.includes("glo")) return "GLO";
    if (normalized.includes("airtel")) return "AIRTEL";
    if (normalized.includes("9mobile") || normalized.includes("etisalat"))
      return "9MOBILE";

    return provider.toUpperCase();
  }

  private extractCableProvider(provider: string): string {
    const normalized = provider.toLowerCase();

    if (normalized.includes("dstv")) return "DSTV";
    if (normalized.includes("gotv")) return "GOTV";
    if (normalized.includes("startimes")) return "STARTIMES";

    return provider.toUpperCase();
  }

  private extractElectricityProvider(provider: string): string {
    const normalized = provider.toUpperCase();

    // Map common provider names to Coolsub codes
    const providerMap: { [key: string]: string } = {
      IKEDC: "IKEDC",
      "IKEJA ELECTRIC": "IKEDC",
      EKEDC: "EKEDC",
      "EKO ELECTRIC": "EKEDC",
      AEDC: "AEDC",
      "ABUJA ELECTRIC": "AEDC",
      KEDC: "KEDC",
      "KANO ELECTRIC": "KEDC",
      JEDC: "JEDC",
      "JOS ELECTRIC": "JEDC",
      IBEDC: "IBEDC",
      "IBADAN ELECTRIC": "IBEDC",
      KAEDC: "KAEDC",
      "KADUNA ELECTRIC": "KAEDC",
      EEDC: "EEDC",
      "ENUGU ELECTRIC": "EEDC",
      PHED: "PhED",
      "PORT HARCOURT ELECTRIC": "PhED",
      BEDC: "BEDC",
      "BENIN ELECTRIC": "BEDC",
      ABA: "ABA",
      "ABA POWER": "ABA",
      YEDC: "YEDC",
      "YOLA ELECTRIC": "YEDC",
    };

    // Check if provider exists in map
    for (const [key, value] of Object.entries(providerMap)) {
      if (normalized.includes(key)) {
        return value;
      }
    }

    return provider;
  }

  private getErrorMessage(errorCode: string, description?: string): string {
    const errorMessages: { [key: string]: string } = {
      ERR200: "Username field is empty",
      ERR201: "Invalid username or API key",
      ERR202: "Invalid recipient/meter/smartcard number",
      ERR203: "Insufficient balance",
      ERR204: "Invalid service/network code",
      ERR205: "Amount is less than minimum allowed",
      ERR206: "Order not processed",
      ERR207: "Data plan/bills code does not match network/service",
      ERR208: "Meter type does not match service",
      ERR209: "Quantity not available",
      ERR210: "Transaction not found or invalid customer",
    };

    return description || errorMessages[errorCode] || "Transaction failed";
  }

  private handleError(error: any, operationType: string): never {
    if (error instanceof AppError) {
      throw error;
    }

    if (error.response?.data?.error) {
      const errorData = error.response.data;
      throw new AppError(
        this.getErrorMessage(errorData.error, errorData.description),
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }

    logger.error(`Coolsub ${operationType} error`, {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message,
    });

    throw new AppError(
      error.message || `${operationType} failed`,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.PROVIDER_ERROR
    );
  }
}
