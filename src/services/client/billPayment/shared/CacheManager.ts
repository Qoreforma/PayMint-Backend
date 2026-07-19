import { CacheService } from "@/services/core/CacheService";
import { ServiceRepository } from "@/repositories/shared/ServiceRepository";
import { Product } from "@/models/reference/Product";
import { ServiceType } from "@/models/reference/ServiceType";
import { ServiceTypeProvider } from "@/models/reference/ServiceTypeProvider";
import { CACHE_KEYS, CACHE_TTL, TRANSACTION_TYPES } from "@/utils/constants";
import { ProviderService } from "../../ProviderService";
import { Types } from "mongoose";
import logger from "@/logger";
import { CashbackRuleRepository } from "@/repositories/shared/CashbackRuleRepository";

export class CacheManager {
  constructor(
    private cacheService: CacheService,
    private serviceRepository: ServiceRepository,
    private providerService: ProviderService,
    private cashbackRuleRepository: CashbackRuleRepository,
  ) {}

  // SERVICE CACHIN
  async getServiceByIdCached(serviceId: string): Promise<any> {
    const cacheKey = CACHE_KEYS.SERVICE_BY_ID(serviceId);

    const cached = await this.cacheService.get(cacheKey);
    if (cached) return cached;

    const service = await this.serviceRepository.findById(serviceId);
    if (service) {
      await this.cacheService.set(cacheKey, service, CACHE_TTL.SERVICE);
    }

    return service;
  }

  async getServiceByCodeCached(code: string): Promise<any> {
    const cacheKey = CACHE_KEYS.SERVICE_BY_CODE(code);

    const cached = await this.cacheService.get(cacheKey);
    if (cached) return cached;

    const service = await this.serviceRepository.findByCode(code);
    if (service) {
      await this.cacheService.set(cacheKey, service, CACHE_TTL.SERVICE);
    }

    return service;
  }

  async getServiceWithTypeCached(serviceId: string): Promise<any> {
    const cacheKey = CACHE_KEYS.SERVICE_WITH_TYPE(serviceId);

    const cached = await this.cacheService.get(cacheKey);
    if (cached) return cached;

    const service =
      await this.serviceRepository.findByIdAndPopulateType(serviceId);
    if (service) {
      await this.cacheService.set(cacheKey, service, CACHE_TTL.SERVICE);
    }

    return service;
  }

  // PRODUCT CACHIN
  async getProductWithServiceCached(productId: string): Promise<any> {
    const cacheKey = CACHE_KEYS.PRODUCT_WITH_SERVICE(productId);

    const cached = await this.cacheService.get(cacheKey);
    if (cached) return cached;

    const product = await Product.findById(productId)
      .select("name code amount isActive serviceId")
      .populate({
        path: "serviceId",
        select: "name code serviceTypeId isActive logo",
        populate: {
          path: "serviceTypeId",
          select: "code name status",
        },
      })
      .lean();

    if (product) {
      await this.cacheService.set(cacheKey, product, CACHE_TTL.PRODUCT);
    }

    return product;
  }

  async getProductsByServiceCached(
    serviceId: string,
    dataType?: string,
  ): Promise<any> {
    const cacheKey = CACHE_KEYS.PRODUCTS_BY_SERVICE(serviceId, dataType);

    const cached = await this.cacheService.get(cacheKey);
    if (cached) return cached;

    const products = await this.providerService.getProductsByService(
      serviceId,
      dataType,
    );

    if (products) {
      await this.cacheService.set(cacheKey, products, CACHE_TTL.PRODUCT_LIST);
    }

    return products;
  }

  // DATA — MULTI PROVIDER
  private async getActiveDataProviderIds(): Promise<Types.ObjectId[]> {
    const cacheKey = CACHE_KEYS.DATA_ACTIVE_PROVIDER_IDS;

    const cached = await this.cacheService.get<Types.ObjectId[]>(cacheKey);
    if (cached) return cached;

    const serviceType = await ServiceType.findOne({
      code: TRANSACTION_TYPES.DATA,
      deletedAt: null,
    }).lean();

    if (!serviceType) return [];

    const providerMappings = await ServiceTypeProvider.find({
      serviceTypeId: serviceType._id,
      isActive: true,
      deletedAt: null,
    })
      .populate({
        path: "providerId",
        match: { isActive: true, deletedAt: null },
        select: "_id",
      })
      .lean();

    const providerIds = providerMappings
      .map((m) => m.providerId as any)
      .filter(Boolean)
      .map((p) => p._id);

    if (providerIds.length) {
      await this.cacheService.set(
        cacheKey,
        providerIds,
        CACHE_TTL.DATA_ACTIVE_PROVIDERS,
      );
    }

    return providerIds;
  }

  async getDataProductsCached(
    serviceId: string,
    dataType?: string,
  ): Promise<any> {
    const cacheKey = CACHE_KEYS.DATA_PRODUCTS_ALL_ACTIVE(serviceId, dataType);

    const cached = await this.cacheService.get(cacheKey);
    if (cached) return cached;

    const activeProviderIds = await this.getActiveDataProviderIds();
    if (!activeProviderIds.length) return [];

    const query: any = {
      serviceId,
      providerId: { $in: activeProviderIds }, // ← only active providers
      isActive: true,
    };

    if (dataType) {
      query["attributes.dataType"] = dataType;
    }

    const products = await Product.find(query).sort({ amount: 1 }).lean();

    if (products.length) {
      await this.cacheService.set(cacheKey, products, CACHE_TTL.DATA_PRODUCTS);
    }

    return products;
  }

  async getDataTypesByServiceCodeCached(
    serviceCode: string,
  ): Promise<string[]> {
    const cacheKey = CACHE_KEYS.DATA_TYPES_BY_SERVICE_CODE(serviceCode);

    const cached = await this.cacheService.get<string[]>(cacheKey);
    if (cached) return cached;

    // Resolve service code → service document
    const service = await this.serviceRepository.findByCode(serviceCode);
    if (!service || !service.isActive) return [];

    // Reuse same active-provider scoping as getDataProductsCached
    const activeProviderIds = await this.getActiveDataProviderIds();
    if (!activeProviderIds.length) return [];

    const types = (await Product.distinct("attributes.dataType", {
      serviceId: service._id,
      providerId: { $in: activeProviderIds },
      isActive: true,
      "attributes.dataType": { $exists: true, $nin: [null, ""] },
    })) as string[];

    // Filter out any nulls/empty strings that slipped through, deduplicate
    const cleaned = [...new Set(types.filter(Boolean))];

    if (cleaned.length) {
      await this.cacheService.set(cacheKey, cleaned, CACHE_TTL.DATA_PRODUCTS);
    }

    return cleaned;
  }

  // SERVICE TYPE CACHING

  async getServicesByTypeCodeCached(serviceTypeCode: string): Promise<any> {
    const cacheKey = CACHE_KEYS.SERVICES_BY_TYPE(serviceTypeCode);

    const cached = await this.cacheService.get(cacheKey);
    if (cached) return cached;

    const services =
      await this.providerService.getServicesByServiceTypeCode(serviceTypeCode);

    if (services) {
      await this.cacheService.set(cacheKey, services, CACHE_TTL.SERVICE_LIST);
    }

    return services;
  }

  async getProviderServices(providerId: string, serviceTypeCode: string) {
    return this.providerService.getServicesByTypeAndProvider(
      serviceTypeCode,
      providerId,
    );
  }

  // CASHBACK AUTO-RESOLUTION

  async getActiveProviderIdByServiceTypeIdCached(
    serviceTypeId: string | Types.ObjectId,
  ): Promise<Types.ObjectId | null> {
    try {
      const key = serviceTypeId.toString();
      const cacheKey = `provider:active:${key}`;

      const cached = await this.cacheService.get<Types.ObjectId>(cacheKey);
      if (cached) return cached;

      const mapping = await ServiceTypeProvider.findOne({
        serviceTypeId: new Types.ObjectId(key),
        isActive: true,
        deletedAt: null,
      })
        .sort({ priority: 1 })
        .lean();

      if (!mapping) return null;

      const providerId = mapping.providerId as Types.ObjectId;

      this.cacheService
        .set(cacheKey, providerId, CACHE_TTL.ONE_HOUR)
        .catch((err) =>
          logger.error("Failed to cache active providerId:", err),
        );

      return providerId;
    } catch (err) {
      logger.error("getActiveProviderIdByServiceTypeIdCached failed", err);
      return null;
    }
  }

  async getApplicableCashbackRuleCached(serviceId: string | Types.ObjectId): Promise<any | null> {
    try {
      const cacheKey = `cashback:rule:${serviceId.toString()}`;

      const cached = await this.cacheService.get<any>(cacheKey);
      if (cached) return cached;

      // Find all active rules
      const activeRules = await this.cashbackRuleRepository.findActiveRules();

      // Match rules from most specific to least specific
      const rules = activeRules.filter((r) => {
        let isMatch = true;
        if (r.serviceId && r.serviceId.toString() !== serviceId.toString()) isMatch = false;
        return isMatch;
      });

      let rule = null;
      if (rules.length > 0) {
        rule = rules[0];
      }

      if (rule) {
        this.cacheService
          .set(cacheKey, rule, CACHE_TTL.SERVICE_CHARGE)
          .catch((err) => logger.error("Failed to cache cashback rule:", err));
      }

      return rule ?? null;
    } catch (err) {
      logger.error("getApplicableCashbackRuleCached failed", err);
      return null;
    }
  }

  async invalidateCashbackRuleCache(): Promise<void> {
    await this.cacheService
      .deletePattern(`cashback:rule:*`)
      .catch((err) =>
        logger.error("Failed to invalidate cashback rule cache:", err),
      );
  }

  // CACHE INVALIDATION

  async invalidateServiceCache(
    serviceId: string,
    serviceCode?: string,
  ): Promise<void> {
    const keysToDelete = [
      CACHE_KEYS.SERVICE_BY_ID(serviceId),
      CACHE_KEYS.SERVICE_WITH_TYPE(serviceId),
    ];

    if (serviceCode) {
      keysToDelete.push(CACHE_KEYS.SERVICE_BY_CODE(serviceCode));
    }

    await Promise.all(keysToDelete.map((key) => this.cacheService.delete(key)));
  }

  async invalidateProductCache(productId: string): Promise<void> {
    await this.cacheService.delete(CACHE_KEYS.PRODUCT_WITH_SERVICE(productId));
  }

  async invalidateServiceTypeCache(serviceTypeCode: string): Promise<void> {
    await this.cacheService.delete(
      CACHE_KEYS.SERVICES_BY_TYPE(serviceTypeCode),
    );
  }

  async invalidateProductsByServiceCache(serviceId: string): Promise<void> {
    await this.cacheService.deletePattern(`products:service:${serviceId}*`);
  }

  // Call this from admin when toggling provider or product changes for data
  async invalidateDataProductsCache(): Promise<void> {
    await Promise.all([
      this.cacheService.delete(CACHE_KEYS.DATA_ACTIVE_PROVIDER_IDS),
      this.cacheService.deletePattern(`products:data:all-active:*`),
      this.cacheService.deletePattern(`data:types:by-service-code:*`),
    ]);
  }
}
