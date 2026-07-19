import axios, { AxiosInstance } from "axios";
import { Product } from "@/models/reference/Product";
import { Service } from "@/models/reference/Service";
import { ServiceType } from "@/models/reference/ServiceType";
import { ServiceTypeProvider } from "@/models/reference/ServiceTypeProvider";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  CACHE_TTL,
  CACHE_KEYS,
  TRANSACTION_TYPES,
} from "@/utils/constants";
import logger from "@/logger";
import { VTPassService } from "./providers/billpayment/VtpassService";
import { ClubKonnectService } from "./providers/billpayment/ClubkonnectService";
import { MySimHostingService } from "./providers/billpayment/MySimHostingService";
import { CoolsubService } from "./providers/billpayment/CoolsubService";
import { VtuNgService } from "./providers/billpayment/VtuNgService";
import { BilalsadasubService } from "./providers/billpayment/BilalsadasubService";
import { ReloadlyService } from "./providers/giftcard/ReloadlyService";
import { GiftBillsService } from "./providers/billpayment/GiftBillsService";
import { IProvider, Provider } from "@/models/reference/Provider";
import { AmadeusService } from "./providers/billpayment/AmadeusService";
import {
  AirtimeData,
  AirtimeEPINData,
  BettingData,
  BettingDtoWithProvider,
  CableTvData,
  DataDataDTO,
  DataEPINData,
  EducationData,
  EducationEPINData,
  ElectricityData,
  FlightBookingData,
  HotelBookingData,
  IntDataWithProvider,
  InternationalAirtimeData,
  InternationalDataData,
  ProviderResponse,
  UtilityPaymentData,
} from "@/types";
import { CacheService } from "../core/CacheService";
import { SaveHavenService } from "./providers/payments/SaveHavenService";
import { ProviderDTO } from "@/middlewares/shared/checkServiceAvailability";
import { getEnviroment } from "@/utils/helpers";

export class ProviderService {
  constructor(
    private vtpassService: VTPassService,
    private clubKonnectService: ClubKonnectService,
    private coolsubService: CoolsubService,
    private mySimHostingService: MySimHostingService,
    private vtuNgService: VtuNgService,
    private bilalsadasubService: BilalsadasubService,
    private reloadlyService: ReloadlyService,
    private amadeusService: AmadeusService,
    private giftBillsService: GiftBillsService,
    private cacheService: CacheService,
    private saveHavenService: SaveHavenService,
  ) {}

  // Get the active API provider for a specific service type code
  public async getActiveApiProvider(serviceTypeCode: string): Promise<any> {
    try {
      const environment = getEnviroment();
      // Try cache first
      const cacheKey = `provider:active:${serviceTypeCode}`;
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(`Using cached provider for ${serviceTypeCode}`);
        return cached;
      }

      const serviceType = await ServiceType.findOne({
        code: serviceTypeCode,
        status: "active",
      });

      if (!serviceType) {
        throw new AppError(
          `Service type '${serviceTypeCode}' not found or inactive`,
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      const providerMapping = await ServiceTypeProvider.findOne({
        serviceTypeId: serviceType._id,
        isActive: true,
        deletedAt: null,
      })
        .sort({ priority: 1 })
        .populate({
          path: "providerId",
          match: { isActive: true, deletedAt: null },
        });

      if (!providerMapping || !providerMapping.providerId) {
        throw new AppError(
          environment === "production"
            ? "Service is currently unavailable"
            : `No active provider configured for '${serviceTypeCode}'`,
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          ERROR_CODES.PROVIDER_ERROR,
        );
      }

      // Cache for 1 hour
      this.cacheService
        .set(cacheKey, providerMapping.providerId, CACHE_TTL.ONE_HOUR)
        .catch((err) => {
          logger.error("Failed to cache provider:", err);
        });

      return providerMapping.providerId;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      logger.error(
        `Error getting active provider for ${serviceTypeCode}`,
        error,
      );
      throw new AppError(
        `Failed to get provider for ${serviceTypeCode}`,
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  // Get all active services for a specific service type code
  async getServicesByServiceTypeCode(serviceTypeCode: string): Promise<any[]> {
    try {
      const cacheKey = `services:type:${serviceTypeCode}`;
      const cached = await this.cacheService.get<any[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const serviceType = await ServiceType.findOne({
        code: serviceTypeCode,
        status: "active",
        deletedAt: null,
      });
      if (!serviceType) {
        return [];
      }

      const services = await Service.find({
        serviceTypeId: serviceType._id,
        isActive: true,
        deletedAt: null,
      })
        .sort({ displayOrder: 1, name: 1 })
        .lean();

      const result = services.map((service) => ({
        id: service._id,
        name: service.name,
        code: service.code,
        logo: service.logo,
        serviceTypeCode: serviceTypeCode,
      }));

      // Cache for 30 minutes
      this.cacheService
        .set(cacheKey, result, CACHE_TTL.THIRTY_MINUTES)
        .catch((err) => {
          logger.error("Failed to cache services:", err);
        });

      return result;
    } catch (error: any) {
      logger.error(`Error fetching services for ${serviceTypeCode}`, error);
      throw new AppError(
        "Failed to fetch services",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  async getProvidersByServiceTypeCode(serviceTypeCode: string): Promise<any[]> {
    try {
      const cacheKey = CACHE_KEYS.PROVIDERS_BY_TYPE(serviceTypeCode);
      const cached = await this.cacheService.get<any[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const serviceType = await ServiceType.findOne({
        code: serviceTypeCode,
        status: "active",
        deletedAt: { $in: [null] },
      });
      if (!serviceType) {
        return [];
      }

      const providers = await Provider.find({
        serviceType: serviceType._id,
        isActive: true,
        deletedAt: { $in: [null] },
      }).lean();

      const result = providers.map((provider) => ({
        id: provider._id,
        name: provider.name,
        code: provider.code,
        logo: provider.logo,
        serviceTypeCode: serviceTypeCode,
        paymentOptions: provider.paymentOptions,
      }));

      // Cache for 30 minutes
      this.cacheService
        .set(cacheKey, result, CACHE_TTL.THIRTY_MINUTES)
        .catch((err) => {
          logger.error("Failed to cache providers:", err);
        });

      return result;
    } catch (error: any) {
      logger.error(`Error fetching providers for ${serviceTypeCode}`, error);
      throw new AppError(
        "Failed to fetch providers",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  async getActiveProvidersByServiceTypeCode(
    serviceTypeCode: string,
  ): Promise<any[]> {
    try {
      const cacheKey =
        CACHE_KEYS.ACTIVE_PROVIDERS_BY_SERVICE_TYPE(serviceTypeCode);

      const cached = await this.cacheService.get<any[]>(cacheKey);
      if (cached) {
        logger.debug(`Using cached active providers for ${serviceTypeCode}`);
        return cached;
      }

      const serviceType = await ServiceType.findOne({
        code: serviceTypeCode,
        status: "active",
        deletedAt: { $in: [null] },
      });

      if (!serviceType) {
        return [];
      }

      // Get ONLY active provider mappings
      // isActive: true means the provider IS configured as active for this service type
      const providerMappings = await ServiceTypeProvider.find({
        serviceTypeId: serviceType._id,
        isActive: true, // Provider is active for THIS service type
        deletedAt: { $in: [null] },
      })
        .populate({
          path: "providerId",
          match: { isActive: true, deletedAt: null },
          select: "_id name code logo paymentOptions",
        })
        .sort({ priority: 1 })
        .lean();

      // Filter out null provider references and map to result
      const result = providerMappings
        .filter((mapping: any) => mapping.providerId !== null)
        .map((mapping: any) => ({
          id: mapping.providerId._id,
          name: mapping.providerId.name,
          code: mapping.providerId.code,
          logo: mapping.providerId.logo,
          serviceTypeCode: serviceTypeCode,
          paymentOptions: mapping.providerId.paymentOptions,
          isActive: true, // We know this is true because we filtered by isActive: true
          priority: mapping.priority,
        }));

      // Cache for 30 minutes
      this.cacheService
        .set(cacheKey, result, CACHE_TTL.THIRTY_MINUTES)
        .catch((err) => {
          logger.error("Failed to cache active providers:", err);
        });

      return result;
    } catch (error: any) {
      logger.error(
        `Error fetching active providers for ${serviceTypeCode}`,
        error,
      );
      throw new AppError(
        "Failed to fetch active providers",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  async getServicesByTypeAndProvider(
    serviceTypeCode: string,
    providerId: string,
  ): Promise<any[]> {
    try {
      const cacheKey = CACHE_KEYS.SERVICES_BY_TYPE_PROVIDER(
        serviceTypeCode,
        providerId,
      );
      const cached = await this.cacheService.get<any[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const serviceType = await ServiceType.findOne({
        code: serviceTypeCode,
        status: "active",
        deletedAt: { $in: [null] },
      });

      if (!serviceType) {
        return [];
      }

      // Filter by serviceTypeId AND supportedProviders
      const services = await Service.find({
        serviceTypeId: serviceType._id,
        supportedProviders: providerId,
        isActive: true,
        deletedAt: { $in: [null] },
      })
        .sort({ name: 1 })
        .lean();

      const result = services.map((service) => ({
        id: service._id,
        name: service.name,
        code: service.code,
        logo: service.logo,
        serviceTypeCode: serviceTypeCode,
        supportedProviders: service.supportedProviders, // Include if needed
      }));

      // Cache for 5 minutes (betting data changes more frequently)
      this.cacheService
        .set(cacheKey, result, CACHE_TTL.SERVICE_LIST)
        .catch((err) => {
          console.error("Failed to cache services:", err);
        });

      return result;
    } catch (error: any) {
      console.error(
        `Error fetching services for ${serviceTypeCode} and provider ${providerId}`,
        error,
      );
      throw new Error("Failed to fetch services");
    }
  }

  // Get all products for a specific service type
  async getProductsByServiceTypeCode(serviceTypeCode: string): Promise<any[]> {
    try {
      const serviceType = await ServiceType.findOne({
        code: serviceTypeCode,
        isActive: true,
        deletedAt: null,
      });

      if (!serviceType) {
        return [];
      }

      const services = await Service.find({
        serviceTypeId: serviceType._id,
        isActive: true,
        deletedAt: null,
      }).select("_id");

      const serviceIds = services.map((s) => s._id);

      const products = await Product.find({
        serviceId: { $in: serviceIds },
        isActive: true,
      })
        .populate({
          path: "providerId",
          match: { isActive: true, deletedAt: null },
        })
        .populate({
          path: "serviceId",
          select: "name code logo serviceTypeId",
        })
        .sort({ amount: 1 })
        .lean();

      return products
        .filter((p) => p.providerId !== null)
        .map((product) => {
          const provider = product.providerId as IProvider;
          return {
            id: product._id,
            name: product.name,
            code: product.code,
            dataType: product.attributes?.dataType,
            amount: product.amount,
            providerAmount: product.providerAmount,
            validity: product.validity,
            description: product.description,
            service: product.serviceId,
            provider: {
              id: provider.id,
              name: provider.name,
              code: provider.code,
            },
          };
        });
    } catch (error: any) {
      logger.error(`Error fetching products for ${serviceTypeCode}`, error);
      throw new AppError(
        "Failed to fetch products",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  // Get products for a specific service (from active provider only)
  async getProductsByService(
    serviceId: string,
    dataType?: string,
  ): Promise<any[]> {
    try {
      const service = await Service.findById(serviceId).lean();
      if (!service) {
        throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
      }

      // Get the active provider for this service type
      const activeProviderRelationship = await ServiceTypeProvider.findOne({
        serviceTypeId: service.serviceTypeId,
        isActive: true,
      }).lean();

      if (!activeProviderRelationship) {
        logger.info("No active provider found for service type");

        return [];
      }

      const query: any = {
        serviceId: serviceId,
        providerId: activeProviderRelationship.providerId,
        isActive: true,
      };

      if (dataType) {
        query["attributes.dataType"] = dataType;
      }

      const products = await Product.find(query).sort({ amount: 1 }).lean();

      return products.map((product) => ({
        id: product._id,
        name: product.name,
        code: product.code,
        dataType: product.attributes?.dataType,
        amount: product.amount,
        validity: product.validity,
        description: product.description,
        service: product.serviceId,
        providerId: product.providerId,
      }));
    } catch (error: any) {
      logger.error("Error fetching products by service", error);
      throw new AppError(
        "Failed to fetch products",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  //Get all available data types from products
  async getDataTypes(): Promise<string[]> {
    try {
      const dataTypes = await Product.distinct("attributes.dataType", {
        isActive: true,
        dataType: { $exists: true, $ne: null },
      });

      return dataTypes;
    } catch (error: any) {
      logger.error("Error fetching data types", error);
      return ["SME", "GIFTING", "DIRECT", "CORPORATE GIFTING", "PACKAGE"];
    }
  }

  // DOMESTIC SERVICES

  async purchaseAirtime(data: AirtimeData): Promise<ProviderResponse> {
    try {
      const provider = data.provider;
      logger.info(`Processing airtime purchase with ${provider.code}`, data);

      let response: ProviderResponse;

      switch (provider.code.toLowerCase()) {
        case "vtpass":
          response = await this.vtpassService.purchaseAirtime(data);
          break;
        case "clubkonnect":
          response = await this.clubKonnectService.purchaseAirtime(data);
          break;
        case "coolsub":
          response = await this.coolsubService.purchaseAirtime(data);
          break;
        case "mysimhosting":
          response = await this.mySimHostingService.purchaseAirtime(data);
          break;
        case "vtung":
          response = await this.vtuNgService.purchaseAirtime(data);
          break;
        case "bilalsadasub":
          response = await this.bilalsadasubService.purchaseAirtime(data);
          break;
        case "giftbills":
          response = await this.giftBillsService.purchaseAirtime(data);
          break;
        case "savehaven":
          response = await this.saveHavenService.purchaseAirtime(data);
          break;
        default:
          throw new AppError(
            `Unsupported airtime provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      response.providerCode = provider.code;

      return response;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Airtime purchase");
    }
  }

  async purchaseData(data: DataDataDTO): Promise<ProviderResponse> {
    try {
      const provider = data.provider;
      logger.info(`Processing data purchase with ${provider.code}`, data);

      let response: ProviderResponse;

      switch (provider.code.toLowerCase()) {
        case "vtpass":
          response = await this.vtpassService.purchaseData(data);
          break;
        case "clubkonnect":
          response = await this.clubKonnectService.purchaseData(data);
          break;
        case "coolsub":
          response = await this.coolsubService.purchaseData(data);
          break;
        case "mysimhosting":
          response = await this.mySimHostingService.purchaseData(data);
          break;

        case "vtung":
          response = await this.vtuNgService.purchaseData(data);
          break;
        case "bilalsadasub":
          response = await this.bilalsadasubService.purchaseData(data);
          break;
        case "giftbills":
          response = await this.giftBillsService.purchaseData(data);
          break;
        case "savehaven":
          response = await this.saveHavenService.purchaseData(data);
          break;
        default:
          throw new AppError(
            `Unsupported data provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      response.providerCode = provider.code;

      return response;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Data purchase");
    }
  }

  async purchaseCableTv(data: CableTvData): Promise<ProviderResponse> {
    try {
      const provider = data.serviceProvider;
      logger.info(`Processing cable TV purchase with ${provider.code}`, data);

      let response: ProviderResponse;

      switch (provider.code.toLowerCase()) {
        case "vtpass":
          response = await this.vtpassService.purchaseCableTv(data);
          break;
        case "clubkonnect":
          response = await this.clubKonnectService.purchaseCableTv(data);
          break;
        case "coolsub":
          response = await this.coolsubService.purchaseCableTv(data);
          break;
        case "vtung":
          response = await this.vtuNgService.purchaseCableTv(data);
          break;
        case "bilalsadasub":
          response = await this.bilalsadasubService.purchaseCableTv(data);
          break;
        case "savehaven":
          response = await this.saveHavenService.purchaseCableTv(data);
          break;
        default:
          throw new AppError(
            `Unsupported cable TV provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      response.providerCode = provider.code;

      return response;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Cable TV purchase");
    }
  }

  async purchaseElectricity(data: ElectricityData): Promise<ProviderResponse> {
    try {
      const provider = data.serviceProvider;
      logger.info(
        `Processing electricity purchase with ${provider.code}`,
        data,
      );

      let response: ProviderResponse;

      switch (provider.code.toLowerCase()) {
        case "vtpass":
          response = await this.vtpassService.purchaseElectricity(data);
          break;
        case "clubkonnect":
          response = await this.clubKonnectService.purchaseElectricity(data);
          break;
        case "vtung":
          response = await this.vtuNgService.purchaseElectricity(data);
          break;
        case "coolsub":
          response = await this.coolsubService.purchaseElectricity(data);
          break;
        case "savehaven":
          response = await this.saveHavenService.purchaseUtility(data);
          break;
        default:
          throw new AppError(
            `Unsupported electricity provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      response.providerCode = provider.code;

      return response;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Electricity purchase");
    }
  }

  async fundBetting(data: BettingDtoWithProvider): Promise<ProviderResponse> {
    try {
      const provider = data.serviceProvider;
      logger.info(`Processing betting funding with ${provider.code}`, data);

      let response: ProviderResponse;

      switch (provider.code.toLowerCase()) {
        case "clubkonnect":
          response = await this.clubKonnectService.fundBetting(data);
          break;
        case "coolsub":
          response = await this.coolsubService.fundBetting(data);
          break;
        case "vtung":
          response = await this.vtuNgService.fundBetting(data);
          break;
        case "giftbills":
          response = await this.giftBillsService.fundBetting(data);
          break;
        default:
          throw new AppError(
            `Unsupported betting provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      response.providerCode = provider.code;

      return response;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Betting funding");
    }
  }

  async validateBettingCustomer(data: {
    customerId: string;
    providerId: string;
    serviceProvider: ProviderDTO;
  }): Promise<ProviderResponse> {
    try {
      const provider = data.serviceProvider;
      logger.info(`Validating Betting Customer with ${provider.code}`, data);

      let response: ProviderResponse;

      switch (provider.code.toLowerCase()) {
        case "clubkonnect":
          response = await this.clubKonnectService.verifyBettingCustomer(
            data.customerId,
            data.providerId,
          );
          break;
        // case "coolsub":
        //   response = await this.coolsubService.fundBetting(data);
        //   break;
        // case "vtung":
        //   response = await this.vtuNgService.fundBetting(data);
        //   break;
        case "giftbills":
          response = await this.giftBillsService.validateBettingCustomer(
            data.customerId,
            data.providerId,
          );
          break;
        default:
          throw new AppError(
            `Unsupported betting provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      response.providerCode = provider.code;

      return response;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Betting Account Validation");
    }
  }

  async purchaseEducation(data: EducationData): Promise<ProviderResponse> {
    try {
      const provider = data.provider;
      logger.info(`Processing education purchase with ${provider.code}`, data);

      let response: ProviderResponse;

      switch (provider.code.toLowerCase()) {
        case "vtpass":
          response = await this.vtpassService.purchaseEducation(data);
          break;
        case "clubkonnect":
          response = await this.clubKonnectService.purchaseEducation(data);
          break;
        default:
          throw new AppError(
            `Unsupported education provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      response.providerCode = provider.code;

      return response;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Education purchase");
    }
  }

  // E-PIN SERVICES
  async purchaseAirtimeEPIN(data: AirtimeEPINData): Promise<ProviderResponse> {
    try {
      const provider = await this.getActiveApiProvider("airtime_epin");
      logger.info(
        `Processing airtime E-PIN purchase with ${provider.code}`,
        data,
      );

      switch (provider.code.toLowerCase()) {
        case "clubkonnect":
          return await this.clubKonnectService.purchaseAirtimeEPIN(data);
        case "vtung":
          return await this.vtuNgService.purchaseEPINs(data);
        default:
          throw new AppError(
            `Unsupported airtime E-PIN provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Airtime E-PIN purchase");
    }
  }

  async purchaseDataEPIN(data: DataEPINData): Promise<ProviderResponse> {
    try {
      const provider = await this.getActiveApiProvider("data_epin");
      logger.info(`Processing data E-PIN purchase with ${provider.code}`, data);

      switch (provider.code.toLowerCase()) {
        case "clubkonnect":
          return await this.clubKonnectService.purchaseDataEPIN(data);
        default:
          throw new AppError(
            `Unsupported data E-PIN provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Data E-PIN purchase");
    }
  }

  // Search for cities/airports for flight booking
  async searchFlightCities(keyword: string): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("flight");
      logger.info(`Searching cities with ${provider.code}`, { keyword });

      switch (provider.code.toLowerCase()) {
        case "amadeus":
          return await this.amadeusService.searchCities(keyword);
        default:
          throw new AppError(
            `Unsupported flight provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      this.handleProviderDispatchError(error, "City search failed");
    }
  }

  // Search for available flights

  async searchFlights(params: {
    originLocationCode: string;
    destinationLocationCode: string;
    departureDate: string;
    returnDate?: string;
    adults: number;
    children?: number;
    infants?: number;
    travelClass?: "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";
    nonStop?: boolean;
    max?: number;
  }): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("flight");
      logger.info(`Searching flights with ${provider.code}`, params);

      switch (provider.code.toLowerCase()) {
        case "amadeus":
          return await this.amadeusService.searchFlights(params);
        default:
          throw new AppError(
            `Unsupported flight provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Flight search failed");
    }
  }

  // Validate flight offer price before booking

  async validateFlightPrice(flightOffer: any): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("flight");
      logger.info(`Validating flight price with ${provider.code}`);

      switch (provider.code.toLowerCase()) {
        case "amadeus":
          return await this.amadeusService.validateFlightPrice(flightOffer);
        default:
          throw new AppError(
            `Unsupported flight provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Flight price validation failed");
    }
  }

  // Book a flight

  async bookFlight(data: FlightBookingData): Promise<ProviderResponse> {
    try {
      const provider = await this.getActiveApiProvider("flight");
      logger.info(`Booking flight with ${provider.code}`, {
        reference: data.reference,
      });

      switch (provider.code.toLowerCase()) {
        case "amadeus":
          return await this.amadeusService.bookFlight({
            flightOffer: data.flightOffer,
            travelers: data.travelers,
            reference: data.reference,
          });
        default:
          throw new AppError(
            `Unsupported flight provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Flight booking failed");
    }
  }

  // Get flight order details

  async getFlightOrder(orderId: string): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("flight");
      logger.info(`Getting flight order with ${provider.code}`, { orderId });

      switch (provider.code.toLowerCase()) {
        case "amadeus":
          return await this.amadeusService.getFlightOrder(orderId);
        default:
          throw new AppError(
            `Unsupported flight provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Get flight order failed");
    }
  }

  // Cancel a flight order

  async cancelFlightOrder(orderId: string): Promise<ProviderResponse> {
    try {
      const provider = await this.getActiveApiProvider("flight");
      logger.info(`Cancelling flight order with ${provider.code}`, { orderId });

      switch (provider.code.toLowerCase()) {
        case "amadeus":
          return await this.amadeusService.cancelFlightOrder(orderId);
        default:
          throw new AppError(
            `Unsupported flight provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Cancel flight order failed");
    }
  }

  // Get all airlines

  async getAirlines(): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("flight");
      logger.info(`Getting airlines with ${provider.code}`);

      switch (provider.code.toLowerCase()) {
        case "amadeus":
          return await this.amadeusService.getAirlines();
        default:
          throw new AppError(
            `Unsupported flight provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Get airlines failed");
    }
  }

  // INTERNATIONAL AIRTIME DISPATCH

  // Purchase international airtime with provider dispatch
  // Supports multiple providers: VTPass, Reloadly

  async purchaseInternationalAirtime(
    data: IntDataWithProvider,
  ): Promise<ProviderResponse> {
    try {
      const provider = data.provider;
      logger.info(
        `Processing international airtime with ${provider.code}`,
        data,
      );

      switch (provider.code.toLowerCase()) {
        case "vtpass":
          return await this.vtpassService.purchaseInternationalAirtime({
            phone: data.phone,
            amount: data.amount,
            countryCode: data.countryCode,
            operatorId: data.operatorId,
            variationCode: data.variationCode || "",
            reference: data.reference,
            email: data.email || "",
          });
        case "reloadly":
          return await this.reloadlyService.purchaseInternationalAirtime({
            phone: data.phone,
            amount: data.amount,
            countryCode: data.countryCode,
            operatorId: data.operatorId,
            reference: data.reference,
          });
        default:
          throw new AppError(
            `Unsupported international airtime provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      this.handleProviderDispatchError(error, "International Airtime purchase");
    }
  }

  // INTERNATIONAL DATA DISPATCH

  // Purchase international data with provider dispatch
  // Supports multiple providers: VTPass, Reloadly
  // NOTE: Reloadly uses the same airtime API for data bundles

  async purchaseInternationalData(
    data: IntDataWithProvider,
  ): Promise<ProviderResponse> {
    try {
      // Otherwise, use database configured provider
      const provider = data.provider;
      logger.info(`Processing international data with ${provider.code}`, data);

      switch (provider.code.toLowerCase()) {
        case "vtpass":
          return await this.vtpassService.purchaseInternationalData({
            phone: data.phone,
            amount: data.amount,
            countryCode: data.countryCode,
            operatorId: data.operatorId,
            variationCode: data.variationCode,
            reference: data.reference,
            email: data.email || "",
          });
        case "reloadly":
          // Reloadly uses the same airtime endpoint for data bundles
          return await this.reloadlyService.purchaseInternationalData({
            phone: data.phone,
            amount: data.amount,
            countryCode: data.countryCode,
            operatorId: data.operatorId,
            reference: data.reference,
          });
        default:
          throw new AppError(
            `Unsupported international data provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      this.handleProviderDispatchError(error, "International Data purchase");
    }
  }

  // INTERNATIONAL AIRTIME QUERY METHODS
  async getInternationalAirtimeCountries(): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("internationalairtime");
      const cacheKey = CACHE_KEYS.INTL_AIRTIME_COUNTRIES(provider.code);

      // Try cache first
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(
          `Using cached international airtime countries for ${provider.code}`,
        );
        return cached;
      }

      logger.info(
        `Fetching international airtime countries from ${provider.code}`,
      );

      let result: any;
      switch (provider.code.toLowerCase()) {
        case "vtpass":
          result = await this.vtpassService.getInternationalAirtimeCountries();
          break;
        case "reloadly":
          result =
            await this.reloadlyService.getInternationalAirtimeCountries();
          break;
        default:
          throw new AppError(
            `Unsupported international airtime provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      // Cache for 24 hours (countries rarely change)
      await this.cacheService.set(cacheKey, result, CACHE_TTL.INTL_COUNTRIES);

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(
        error,
        "International Airtime Countries",
      );
    }
  }

  async getInternationalAirtimeProductTypes(countryCode: string): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("internationalairtime");
      const cacheKey = CACHE_KEYS.INTL_AIRTIME_PRODUCT_TYPES(
        provider.code,
        countryCode,
      );

      // Try cache first
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(`Using cached product types for ${countryCode}`);
        return cached;
      }

      const result =
        await this.vtpassService.getInternationalAirtimeProductTypes(
          countryCode,
        );

      // Cache for 24 hours
      await this.cacheService.set(cacheKey, result, CACHE_TTL.INTL_COUNTRIES);

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(
        error,
        "International Airtime Product Types",
      );
    }
  }

  async getInternationalAirtimeProviders(countryCode: string): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("internationalairtime");
      const cacheKey = CACHE_KEYS.INTL_AIRTIME_PROVIDERS(
        provider.code,
        countryCode,
      );

      // Try cache first
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(`Using cached airtime providers for ${countryCode}`);
        return cached;
      }

      logger.info(
        `Fetching airtime providers for ${countryCode} from ${provider.code}`,
      );

      let result: any;
      switch (provider.code.toLowerCase()) {
        case "vtpass":
          result =
            await this.vtpassService.getInternationalAirtimeProviders(
              countryCode,
            );
          break;
        case "reloadly":
          result =
            await this.reloadlyService.getOperatorsByCountry(countryCode);
          break;
        default:
          throw new AppError(
            `Unsupported international airtime provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      // Cache for 1 hour (operators rarely change)
      await this.cacheService.set(cacheKey, result, CACHE_TTL.INTL_PROVIDERS);

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(
        error,
        "International Airtime Providers",
      );
    }
  }

  async getInternationalAirtimeVariations(
    operatorId: string,
    productTypeId: number = 1,
  ): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("internationalairtime");
      const cacheKey = CACHE_KEYS.INTL_AIRTIME_VARIATIONS(
        provider.code,
        operatorId,
        productTypeId,
      );

      // Try cache first
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(`Using cached variations for operator ${operatorId}`);
        return cached;
      }

      const result = await this.vtpassService.getInternationalAirtimeVariations(
        operatorId,
        productTypeId,
      );

      // Cache for 30 minutes (prices may change)
      await this.cacheService.set(cacheKey, result, CACHE_TTL.INTL_VARIATIONS);

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(
        error,
        "International Airtime Variations",
      );
    }
  }

  // INTERNATIONAL DATA QUERY METHODS

  async getInternationalDataCountries(): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("internationaldata");
      const cacheKey = CACHE_KEYS.INTL_DATA_COUNTRIES(provider.code);

      // Try cache first
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(
          `Using cached international data countries for ${provider.code}`,
        );
        return cached;
      }

      logger.info(
        `Fetching international data countries from ${provider.code}`,
      );

      let result: any;
      switch (provider.code.toLowerCase()) {
        case "vtpass":
          result = await this.vtpassService.getInternationalDataCountries();
          break;
        case "reloadly":
          result =
            await this.reloadlyService.getInternationalAirtimeCountries();
          break;
        default:
          throw new AppError(
            `Unsupported international data provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      // Cache for 24 hours
      await this.cacheService.set(cacheKey, result, CACHE_TTL.INTL_COUNTRIES);

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "International Data Countries");
    }
  }

  async getInternationalDataProviders(countryCode: string): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("internationaldata");
      const cacheKey = CACHE_KEYS.INTL_DATA_PROVIDERS(
        provider.code,
        countryCode,
      );

      // Try cache first
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(`Using cached data providers for ${countryCode}`);
        return cached;
      }

      logger.info(
        `Fetching data providers for ${countryCode} from ${provider.code}`,
      );

      let result: any;
      switch (provider.code.toLowerCase()) {
        case "vtpass":
          result =
            await this.vtpassService.getInternationalDataProviders(countryCode);
          break;
        case "reloadly":
          result =
            await this.reloadlyService.getOperatorsByCountry(countryCode);
          break;
        default:
          throw new AppError(
            `Unsupported international data provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      // Cache for 1 hour
      await this.cacheService.set(cacheKey, result, CACHE_TTL.INTL_PROVIDERS);

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "International Data Providers");
    }
  }

  async getInternationalDataProducts(operator: string): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("internationaldata");
      const cacheKey = CACHE_KEYS.INTL_DATA_PRODUCTS(provider.code, operator);

      // Try cache first
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(`Using cached data products for operator ${operator}`);
        return cached;
      }

      logger.info(
        `Fetching data products for operator ${operator} from ${provider.code}`,
      );

      let result: any;
      switch (provider.code.toLowerCase()) {
        case "vtpass":
          result =
            await this.vtpassService.getInternationalDataProducts(operator);
          break;
        case "reloadly":
          result = await this.reloadlyService.getOperatorById(operator);
          break;
        default:
          throw new AppError(
            `Unsupported international data provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      // Cache for 30 minutes
      await this.cacheService.set(cacheKey, result, CACHE_TTL.INTL_PRODUCTS);

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "International Data Products");
    }
  }

  async getInternationalDataProductDetails(
    variationCode: string,
    operatorId: string,
  ): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("internationaldata");
      const cacheKey = CACHE_KEYS.INTL_DATA_PRODUCT_DETAILS(
        provider.code,
        variationCode,
        operatorId,
      );

      // Try cache first
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(`Using cached product details for ${variationCode}`);
        return cached;
      }

      const result =
        await this.vtpassService.getInternationalDataProductDetails(
          variationCode,
          operatorId,
        );

      // Cache for 30 minutes
      await this.cacheService.set(cacheKey, result, CACHE_TTL.INTL_PRODUCTS);

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(
        error,
        "International Data Product Details",
      );
    }
  }

  // RELOADLY SPECIFIC METHODS

  async detectReloadlyOperator(
    phone: string,
    countryCode: string,
  ): Promise<any> {
    // Don't cache operator detection as it's phone-number specific
    return await this.reloadlyService.detectOperator(phone, countryCode);
  }

  async getReloadlyOperatorById(operatorId: string): Promise<any> {
    try {
      const cacheKey = CACHE_KEYS.RELOADLY_OPERATOR_BY_ID(operatorId);

      // Try cache first
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(`Using cached operator details for ${operatorId}`);
        return cached;
      }

      const result = await this.reloadlyService.getOperatorById(operatorId);

      // Cache for 1 hour
      await this.cacheService.set(cacheKey, result, CACHE_TTL.INTL_PROVIDERS);

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Reloadly Operator by ID");
    }
  }

  // GIFT CARD METHODS
  async getGiftCardProducts(filters?: {
    countryCode?: string;
    productName?: string;
    categoryId?: number;
    page?: number;
    size?: number;
  }): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("gift_card_purchase");

      // Create a stable cache key from filters
      const filterString = JSON.stringify(filters || {});
      // const cacheKey = CACHE_KEYS.GIFTCARD_PRODUCTS(
      //   provider.code,
      //   filterString,
      // );

      // Try cache first
      // const cached = await this.cacheService.get<any>(cacheKey);
      // if (cached) {
      //   logger.debug(`Using cached gift card products`);
      //   return cached;
      // }

      logger.info(`Fetching gift card products from ${provider.code}`, filters);

      let result: any;
      switch (provider.code.toLowerCase()) {
        case "reloadly":
          result = await this.reloadlyService.getGiftCardProducts(filters);
          break;
        default:
          throw new AppError(
            `Unsupported gift card provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      // Cache for 1 hour
      // await this.cacheService.set(
      //   cacheKey,
      //   result,
      //   CACHE_TTL.GIFTCARD_PRODUCTS,
      // );

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Gift Card Products");
    }
  }

  async getGiftCardProductById(productId: number): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("giftcard");
      const cacheKey = CACHE_KEYS.GIFTCARD_PRODUCT_BY_ID(
        provider.code,
        productId,
      );

      // Try cache first
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(`Using cached gift card product ${productId}`);
        return cached;
      }

      let result: any;
      switch (provider.code.toLowerCase()) {
        case "reloadly":
          result = await this.reloadlyService.getGiftCardProductById(productId);
          break;
        default:
          throw new AppError(
            `Unsupported gift card provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      if (!result) {
        throw new AppError(
          "Product not found on provider",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      // Cache for 1 hour
      await this.cacheService.set(
        cacheKey,
        result,
        CACHE_TTL.GIFTCARD_PRODUCT_DETAILS,
      );

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Gift Card Product by ID");
    }
  }

  async getGiftCardCountries(): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("giftcard");
      const cacheKey = CACHE_KEYS.GIFTCARD_COUNTRIES(provider.code);

      // Try cache first
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(`Using cached gift card countries`);
        return cached;
      }

      let result: any;
      switch (provider.code.toLowerCase()) {
        case "reloadly":
          result = await this.reloadlyService.getGiftCardCountries();
          break;
        default:
          throw new AppError(
            `Unsupported gift card provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      // Cache for 24 hours
      await this.cacheService.set(
        cacheKey,
        result,
        CACHE_TTL.GIFTCARD_COUNTRIES,
      );

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Gift Card Countries");
    }
  }

  async getGiftCardCategories(): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("giftcard");
      const cacheKey = CACHE_KEYS.GIFTCARD_CATEGORIES(provider.code);

      // Try cache first
      // const cached = await this.cacheService.get<any>(cacheKey);
      // if (cached) {
      //   logger.debug(`Using cached gift card categories`);
      //   return cached;
      // }

      let result: any;
      switch (provider.code.toLowerCase()) {
        case "reloadly":
          result = await this.reloadlyService.getGiftCardCategories();
          break;
        default:
          throw new AppError(
            `Unsupported gift card provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      // Cache for 24 hours
      await this.cacheService.set(
        cacheKey,
        result,
        CACHE_TTL.GIFTCARD_CATEGORIES,
      );

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Gift Card Categories");
    }
  }

  async orderGiftCard(data: {
    productId: number;
    quantity: number;
    unitPrice: number;
    customIdentifier: string;
    senderName: string;
    recipientEmail?: string;
    recipientPhoneDetails?: {
      countryCode: string;
      phoneNumber: string;
    };
    userId?: string;
    provider: any;
  }): Promise<ProviderResponse> {
    const provider = data.provider;
    logger.info(`Processing gift card order with ${provider.code}`, data);

    switch (provider.code.toLowerCase()) {
      case "reloadly":
        return await this.reloadlyService.orderGiftCard(data);
      default:
        throw new AppError(
          `Unsupported gift card provider: ${provider.code}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.PROVIDER_ERROR,
        );
    }
  }

  async getGiftCardRedeemCode(transactionId: string): Promise<any> {
    const provider = await this.getActiveApiProvider("giftcard");

    switch (provider.code.toLowerCase()) {
      case "reloadly":
        return await this.reloadlyService.getGiftCardRedeemCode(transactionId);
      default:
        throw new AppError(
          `Unsupported gift card provider: ${provider.code}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.PROVIDER_ERROR,
        );
    }
  }

  // UTILITY PAYMENT METHODS

  async getUtilityBillers(filters?: {
    type?: string;
    serviceType?: string;
    countryCode?: string;
    page?: number;
    size?: number;
  }): Promise<any> {
    try {
      // Create a stable cache key from filters
      const filterString = JSON.stringify(filters || {});
      const cacheKey = CACHE_KEYS.UTILITY_BILLERS("reloadly", filterString);

      // Try cache first
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(`Using cached utility billers`);
        return cached;
      }

      logger.info("Fetching utility billers from Reloadly", filters);
      const result = await this.reloadlyService.getUtilityBillers(filters);

      // Cache for 1 hour
      await this.cacheService.set(cacheKey, result, CACHE_TTL.UTILITY_BILLERS);

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Utility Billers");
    }
  }

  async getBillerById(billerId: number): Promise<any> {
    try {
      const cacheKey = CACHE_KEYS.UTILITY_BILLER_BY_ID("reloadly", billerId);

      // Try cache first
      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) {
        logger.debug(`Using cached biller details for ${billerId}`);
        return cached;
      }

      logger.info(`Fetching biller details for ID: ${billerId}`);
      const result = await this.reloadlyService.getBillerById(billerId);

      // Cache for 1 hour
      await this.cacheService.set(
        cacheKey,
        result,
        CACHE_TTL.UTILITY_BILLER_DETAILS,
      );

      return result;
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Utility Biller Details");
    }
  }

  // Pay utility bill
  // Currently only supported by Reloadly

  async payUtilityBill(data: UtilityPaymentData): Promise<ProviderResponse> {
    try {
      logger.info("Processing utility payment with Reloadly", data);
      return await this.reloadlyService.payUtilityBill(data);
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Utility Payment");
    }
  }

  // Get utility transaction status

  async getUtilityTransaction(transactionId: string): Promise<any> {
    try {
      logger.info(`Fetching utility transaction: ${transactionId}`);
      return await this.reloadlyService.getUtilityTransaction(transactionId);
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Utility Transaction");
    }
  }

  // VERIFICATION METHODS

  async verifySmartCard(
    smartCardNumber: string,
    serviceCode: string,
    serviceProvider: ProviderDTO,
  ): Promise<any> {
    try {
      const provider = serviceProvider;
      logger.info(`Verifying smart card with ${provider.code}`, {
        smartCardNumber,
        serviceCode,
      });

      let result: any;

      switch (provider.code.toLowerCase()) {
        case "vtpass":
          result = await this.vtpassService.verifySmartCard(
            smartCardNumber,
            serviceCode,
          );
          break;
        case "clubkonnect":
          result = await this.clubKonnectService.verifySmartCard(
            smartCardNumber,
            serviceCode,
          );
          break;
        case "coolsub":
          result = await this.coolsubService.verifySmartCard(
            smartCardNumber,
            serviceCode,
          );
          break;
        case "vtung":
          result = await this.vtuNgService.verifySmartCard(
            smartCardNumber,
            serviceCode,
          );
          break;
        case "savehaven":
          result = await this.saveHavenService.verifySmartCard(
            smartCardNumber,
            serviceCode,
          );
          break;
        default:
          throw new AppError(
            `Unsupported provider for smart card verification: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      // Normalize response across all providers
      return {
        valid: result.valid ?? true,
        customerName: result.customerName ?? result.name ?? "",
        smartCardNumber: result.smartCardNumber ?? smartCardNumber,
        dueDate: result.dueDate ?? undefined,
      };
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Smart Card Verification");
    }
  }

  async verifyMeterNumber(
    meterNumber: string,
    serviceCode: string,
    meterType: string,
    serviceProvider: ProviderDTO,
  ): Promise<any> {
    try {
      const provider = serviceProvider;
      logger.info(`Verifying meter number with ${provider.code}`, {
        meterNumber,
        serviceCode,
        meterType,
      });

      let result: any;

      switch (provider.code.toLowerCase()) {
        case "vtpass":
          result = await this.vtpassService.verifyMeterNumber(
            meterNumber,
            serviceCode,
            meterType,
          );
          break;
        case "clubkonnect":
          result = await this.clubKonnectService.verifyMeterNumber(
            meterNumber,
            serviceCode,
          );
          break;
        case "coolsub":
          result = await this.coolsubService.verifyMeterNumber(
            meterNumber,
            serviceCode,
            meterType,
          );
          break;
        case "vtung":
          result = await this.vtuNgService.verifyMeterNumber(
            meterNumber,
            serviceCode,
            meterType,
          );
          break;
        case "bilalsadasub":
          result = await this.bilalsadasubService.verifyMeterNumber(
            meterNumber,
            serviceCode,
            meterType,
          );
          break;
        case "savehaven":
          result = await this.saveHavenService.verifyMeterNumber(
            meterNumber,
            serviceCode,
          );
          break;
        default:
          throw new AppError(
            `Unsupported provider for meter verification: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }

      // Normalize response across all providers
      return {
        valid: result.valid ?? true,
        customerName: result.customerName ?? result.name ?? "",
        address: result.address ?? "",
        meterType: result.meterType ?? meterType,
      };
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Meter Verification");
    }
  }

  async verifyJambProfile(profileId: string, type: string): Promise<any> {
    return await this.vtpassService.verifyJambProfile(profileId, type);
  }

  // CLUBKONNECT SPECIFIC METHODS

  async queryClubKonnectTransaction(
    orderIdOrReference: string,
    isOrderId: boolean = true,
  ): Promise<any> {
    return await this.clubKonnectService.queryTransaction(
      orderIdOrReference,
      isOrderId,
    );
  }

  async cancelClubKonnectTransaction(orderId: string): Promise<any> {
    return await this.clubKonnectService.cancelTransaction(orderId);
  }

  async verifyClubKonnectSmartCard(
    smartCardNumber: string,
    provider: string,
  ): Promise<any> {
    return await this.clubKonnectService.verifySmartCard(
      smartCardNumber,
      provider,
    );
  }

  async verifyClubKonnectMeterNumber(
    meterNumber: string,
    provider: string,
  ): Promise<any> {
    return await this.clubKonnectService.verifyMeterNumber(
      meterNumber,
      provider,
    );
  }

  async verifyClubKonnectBettingCustomer(
    customerId: string,
    provider: string,
  ): Promise<any> {
    return await this.clubKonnectService.verifyBettingCustomer(
      customerId,
      provider,
    );
  }

  async giftbillsValidateBettingCustomer(
    customerId: string,
    provider: string,
  ): Promise<any> {
    return await this.giftBillsService.validateBettingCustomer(
      customerId,
      provider,
    );
  }

  // COOLSUB SPECIFIC METHODS

  async queryCoolsubAirtimeTransaction(transId: string): Promise<any> {
    return await this.coolsubService.queryAirtimeTransaction(transId);
  }

  async queryCoolsubDataTransaction(transId: string): Promise<any> {
    return await this.coolsubService.queryDataTransaction(transId);
  }

  async queryCoolsubCableTvTransaction(transId: string): Promise<any> {
    return await this.coolsubService.queryCableTvTransaction(transId);
  }

  async queryCoolsubElectricityTransaction(transId: string): Promise<any> {
    return await this.coolsubService.queryElectricityTransaction(transId);
  }

  async queryCoolsubEducationTransaction(transId: string): Promise<any> {
    return await this.coolsubService.queryEducationTransaction(transId);
  }

  async verifyCoolsubSmartCard(
    smartCardNumber: string,
    provider: string,
  ): Promise<any> {
    return await this.coolsubService.verifySmartCard(smartCardNumber, provider);
  }

  async verifyCoolsubMeterNumber(
    meterNumber: string,
    provider: string,
    meterType: string,
  ): Promise<any> {
    return await this.coolsubService.verifyMeterNumber(
      meterNumber,
      provider,
      meterType,
    );
  }

  // MYSIMHOSTING SPECIFIC METHODS

  async getMySimHostingDataPlans(): Promise<any> {
    return await this.mySimHostingService.getDataPlans();
  }

  async sendMySimHostingUSSD(data: {
    command: string;
    sim: number;
    device: string;
    to?: string;
  }): Promise<any> {
    return await this.mySimHostingService.sendUSSDRequest(data);
  }

  async sendMySimHostingSMS(data: {
    command: string;
    sim: number;
    device: string;
    to: string;
  }): Promise<any> {
    return await this.mySimHostingService.sendSMSRequest(data);
  }

  // VTUNG SPECIFIC METHODS

  async queryVtuNgTransaction(requestId: string): Promise<any> {
    return await this.vtuNgService.requeryTransaction(requestId);
  }

  async checkVtuNgBalance(): Promise<any> {
    return await this.vtuNgService.checkBalance();
  }

  async verifyVtuNgSmartCard(
    smartCardNumber: string,
    provider: string,
  ): Promise<any> {
    return await this.vtuNgService.verifySmartCard(smartCardNumber, provider);
  }

  async verifyVtuNgMeterNumber(
    meterNumber: string,
    provider: string,
    meterType: string,
  ): Promise<any> {
    return await this.vtuNgService.verifyMeterNumber(
      meterNumber,
      provider,
      meterType,
    );
  }

  async verifyVtuNgBettingCustomer(
    customerId: string,
    provider: string,
  ): Promise<any> {
    return await this.vtuNgService.verifyBettingCustomer(customerId, provider);
  }

  // BILALSADASUB SPECIFIC METHODS

  async verifyBilalsadasubMeterNumber(
    meterNumber: string,
    provider: string,
    meterType: string,
  ): Promise<any> {
    return await this.bilalsadasubService.verifyMeterNumber(
      meterNumber,
      provider,
      meterType,
    );
  }

  // HOTEL BOOKING METHODS

  // Search for available hotels

  async searchHotels(params: {
    cityCode?: string;
    latitude?: number;
    longitude?: number;
    radius?: number;
    checkInDate: string;
    checkOutDate: string;
    adults: number;
    roomQuantity?: number;
    currency?: string;
  }): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("hotel");
      logger.info(`Searching hotels with ${provider.code}`, params);

      switch (provider.code.toLowerCase()) {
        case "amadeus":
          return await this.amadeusService.searchHotels(params);
        default:
          throw new AppError(
            `Unsupported hotel provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Hotel search failed");
    }
  }

  // Book a hotel

  async bookHotel(data: HotelBookingData): Promise<ProviderResponse> {
    try {
      const provider = await this.getActiveApiProvider("hotel");
      logger.info(`Booking hotel with ${provider.code}`, {
        reference: data.reference,
      });

      switch (provider.code.toLowerCase()) {
        case "amadeus":
          return await this.amadeusService.bookHotel({
            offerId: data.offerId,
            guests: data.guests,
            payments: data.payments,
            reference: data.reference,
          });
        default:
          throw new AppError(
            `Unsupported hotel provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Hotel booking failed");
    }
  }

  // Get hotels by city code

  async getHotelsByCity(cityCode: string): Promise<any> {
    try {
      const provider = await this.getActiveApiProvider("hotel");
      logger.info(`Getting hotels by city with ${provider.code}`, { cityCode });

      switch (provider.code.toLowerCase()) {
        case "amadeus":
          return await this.amadeusService.getHotelsByCity(cityCode);
        default:
          throw new AppError(
            `Unsupported hotel provider: ${provider.code}`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.PROVIDER_ERROR,
          );
      }
    } catch (error: any) {
      this.handleProviderDispatchError(error, "Get hotels by city failed");
    }
  }
  async clearServiceTypeCache(serviceTypeCode: string): Promise<void> {
    const cacheKey = CACHE_KEYS.SERVICES_BY_TYPE(serviceTypeCode);
    await this.cacheService.delete(cacheKey);
  }

  async clearServiceTypeProviderCache(
    serviceTypeCode: string,
    providerId: string,
  ): Promise<void> {
    const cacheKey = CACHE_KEYS.SERVICES_BY_TYPE_PROVIDER(
      serviceTypeCode,
      providerId,
    );
    await this.cacheService.delete(cacheKey);
  }

  //  DISPATCH ERROR HANDLING
  // Shared gate for every provider-dispatch method in this file. If the
  // underlying provider already threw a safe, gated AppError, it passes
  // through unchanged. Anything else (unexpected/non-AppError errors, or a
  // provider not yet gated at its own source) gets a generic, NODE_ENV-gated
  // fallback message instead of leaking raw provider text.
  private handleProviderDispatchError(
    error: any,
    operationType: string,
  ): never {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error(`${operationType} failed`, error);

    const finalErrorMessage =
      process.env.NODE_ENV === "production"
        ? `${operationType} failed. Please try again later.`
        : error?.message || `${operationType} failed`;

    throw new AppError(
      finalErrorMessage,
      HTTP_STATUS.BAD_GATEWAY,
      ERROR_CODES.PROVIDER_ERROR,
    );
  }
}
