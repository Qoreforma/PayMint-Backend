import { AirtimeService } from "./billPayment/AirtimeService";
import { BettingService } from "./billPayment/BettingService";
import { CableTvService } from "./billPayment/CableTvService";
import { DataService } from "./billPayment/DataService";
import { EducationService } from "./billPayment/EducationService";
import { ElectricityService } from "./billPayment/ElectricityService";
import { InternationalService } from "./billPayment/InternationalService";
import { CacheManager } from "./billPayment/shared/CacheManager";
import { IUser } from "@/models/core/User";
import { ProviderDTO } from "@/middlewares/shared/checkServiceAvailability";
import { IProvider } from "@/models/reference/Provider";
import { AirtimeEpinService } from "./billPayment/AirtimeEpinService";
import { DataEpinService } from "./billPayment/DataEpinService";

// BillPaymentService - Main facade for bill payment operations
// This service acts as a single entry point for all bill payment operations,
// delegating to specialized services for each transaction type.

export class BillPaymentService {
  constructor(
    private airtimeService: AirtimeService,
    private dataService: DataService,
    private cableTvService: CableTvService,
    private electricityService: ElectricityService,
    private bettingService: BettingService,
    private educationService: EducationService,
    private internationalService: InternationalService,
    private cacheManager: CacheManager,
    private airtimeEpinService: AirtimeEpinService,
    private dataEpinService: DataEpinService,
  ) {}

  // AIRTIME METHODS

  async purchaseAirtime(data: {
    userId: string;
    phone: string;
    amount: number;
    network: string;
    provider: ProviderDTO;
    discountCode?: string;
  }) {
    return this.airtimeService.purchase(data);
  }

  async purchaseAirtimeEPIN(data: {
    userId: string;
    network: string;
    denomination: number;
    quantity: number;
    provider: ProviderDTO;
  }) {
    return this.airtimeEpinService.purchase(data);
  }

  async getAirtimeEPIN(reference: string, userId: string) {
    return this.airtimeEpinService.getByReference(reference, userId);
  }

  async getDataEPINProducts(serviceId: string, providerId: string) {
  return this.dataEpinService.getProducts(serviceId, providerId);
}

  async purchaseDataEPIN(data: {
    userId: string;
    productId: string;
    quantity: number;
    provider: ProviderDTO;
  }) {
    return this.dataEpinService.purchase(data);
  }

  async getDataEPIN(reference: string, userId: string) {
    return this.dataEpinService.getByReference(reference, userId);
  }

  async verifyPhone(phone: string) {
    return this.airtimeService.verifyPhone(phone);
  }

  async verifyPhoneWithNetwork(
    phone: string,
    network: string,
  ): Promise<boolean> {
    return this.airtimeService.verifyPhoneWithNetwork(phone, network);
  }

  async getAirtimeProviders() {
    return this.airtimeService.getProviders();
  }

  // DATA METHODS

  async purchaseData(data: {
    userId: string;
    phone: string;
    productId: string;
    serviceProvider: ProviderDTO;
    discountCode?: string;
  }) {
    return this.dataService.purchase(data);
  }

  async getData() {
    return this.dataService.getAllData();
  }

  async getDataProviders() {
    return this.dataService.getProviders();
  }

  async getDataTypesByServiceCode(serviceCode: string) {
    return this.dataService.getDataTypesByServiceCode(serviceCode);
  }

  async getDataProducts(serviceId: string, dataType?: string) {
    return this.dataService.getProducts(serviceId, dataType);
  }

  // INTERNATIONAL AIRTIME METHODS
  async getInternationalAirtimeCountries() {
    return this.internationalService.getAirtimeCountries();
  }

  async getInternationalAirtimeProviders(countryCode: string) {
    return this.internationalService.getAirtimeProviders(countryCode);
  }

  async getInternationalAirtimeProducts(
    providerId: string,
    productTypeId: number,
  ) {
    return this.internationalService.getAirtimeProducts(
      providerId,
      productTypeId,
    );
  }

  async purchaseInternationalAirtime(data: {
    userId: string;
    phone: string;
    amount: number;
    countryCode: string;
    operatorId: string;
    email: string;
    productCode: string;
    provider: ProviderDTO;
    discountCode?: string;
    countryName?: string;
    variationCode?: string;
    flag?: string;
    phoneCode?: string;
  }) {
    return this.internationalService.purchaseAirtime(data);
  }

  // INTERNATIONAL DATA METHODS

  async getInternationalDataCountries() {
    return this.internationalService.getDataCountries();
  }

  async getInternationalDataProviders(countryCode: string) {
    return this.internationalService.getDataProviders(countryCode);
  }

  async getInternationalDataProducts(operator: string) {
    return this.internationalService.getDataProducts(operator);
  }

  async purchaseInternationalData(data: {
    userId: string;
    phone: string;
    productCode: string;
    operatorId: string;
    countryCode: string;
    countryName: string;
    amount: number;
    email: string;
    provider: ProviderDTO;
    discountCode?: string;
    flag?: string;
    phoneCode?: string;
  }) {
    return this.internationalService.purchaseData(data);
  }

  // CABLE TV METHODS

  async purchaseCableTv(data: {
    userId: string;
    user: IUser;
    provider: string;
    smartCardNumber: string;
    productId: string;
    type: "renew" | "change";
    serviceProvider: ProviderDTO;
    discountCode?: string;
  }) {
    return this.cableTvService.purchase(data);
  }

  async verifyCableSmartCard(
    smartCardNumber: string,
    serviceCode: string,
    serviceProvider: ProviderDTO,
  ) {
    return this.cableTvService.verifySmartCard(
      smartCardNumber,
      serviceCode,
      serviceProvider,
    );
  }

  async getCableTvProviders() {
    return this.cableTvService.getProviders();
  }

  async getCableTvProducts(serviceId: string) {
    return this.cableTvService.getProducts(serviceId);
  }

  // ELECTRICITY METHODS

  async purchaseElectricity(data: {
    userId: string;
    meterNumber: string;
    providerId: string;
    amount: number;
    meterType: string;
    phone: string;
    serviceProvider: ProviderDTO;
    discountCode?: string;
  }) {
    return this.electricityService.purchase(data);
  }

  async verifyMeterNumber(data: {
    meterNumber: string;
    serviceCode: string;
    meterType: string;
    serviceProvider: ProviderDTO;
  }) {
    return this.electricityService.verifyMeterNumber(data);
  }

  async getElectricityProviders(provider: IProvider) {
    return this.electricityService.getProviders(provider);
  }

  async getElectricityProducts(serviceId: string) {
    return this.electricityService.getProducts(serviceId);
  }

  // BETTING METHODS

  async fundBetting(data: {
    userId: string;
    customerId: string;
    amount: number;
    providerId: string;
    reference?: string;
    serviceProvider: ProviderDTO;
    discountCode?: string;
  }) {
    return this.bettingService.fundAccount(data);
  }

  async verifyBettingAccount(data: {
    customerId: string;
    providerId: string;
    serviceProvider: ProviderDTO;
  }) {
    return this.bettingService.verifyAccount(data);
  }

  async getBettingProviders(provider: IProvider) {
    return this.bettingService.getProviders(provider);
  }

  // EDUCATION (E-PIN) METHODS

  async purchaseEducation(data: {
    userId: string;
    user: IUser;
    productId: string;
    profileId: string;
    provider: ProviderDTO;
    discountCode?: string;
  }) {
    return this.educationService.purchase(data);
  }

  async verifyEducationProfile(data: { number: string; type: string }) {
    return this.educationService.verifyProfile(data);
  }

  async getEducationServices() {
    return this.educationService.getServices();
  }

  async getEducationProducts(serviceId: string) {
    return this.educationService.getProducts(serviceId);
  }

  // CACHE INVALIDATION METHODS
  // These are admin methods for cache management

  async invalidateServiceCache(
    serviceId: string,
    serviceCode?: string,
  ): Promise<void> {
    await this.cacheManager.invalidateServiceCache(serviceId, serviceCode);
  }

  async invalidateProductCache(productId: string): Promise<void> {
    await this.cacheManager.invalidateProductCache(productId);
  }

  async invalidateServiceTypeCache(serviceTypeCode: string): Promise<void> {
    await this.cacheManager.invalidateServiceTypeCache(serviceTypeCode);
  }

  async invalidateProductsByServiceCache(serviceId: string): Promise<void> {
    await this.cacheManager.invalidateProductsByServiceCache(serviceId);
  }
}