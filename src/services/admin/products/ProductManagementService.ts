import { ProductRepository } from "@/repositories/shared/ProductRepository";
import { Service } from "@/models/reference/Service";
import { AppError } from "@/middlewares/shared/errorHandler";
import { CACHE_KEYS, HTTP_STATUS } from "@/utils/constants";
import { Types } from "mongoose";
import logger from "@/logger";
import { CacheService } from "@/services/core/CacheService";

export class ProductManagementService {
  constructor(
    private productRepository: ProductRepository,
    private cacheService: CacheService,
  ) {}

  // Invalidates cache for a specific product

  private async invalidateProductCache(productId: string): Promise<void> {
    try {
      const cacheKeys = [
        CACHE_KEYS.PRODUCT_BY_ID(productId),
        CACHE_KEYS.PRODUCT_WITH_SERVICE(productId),
      ];

      await Promise.all(cacheKeys.map((key) => this.cacheService.delete(key)));

      logger.debug(`Product cache invalidated for ID: ${productId}`, {
        keys: cacheKeys,
      });
    } catch (error) {
      logger.warn(`Error invalidating product cache for ${productId}:`, error);
      // Don't throw - cache invalidation shouldn't break the request
    }
  }

  // Invalidates all products related to a service

  private async invalidateProductsByServiceCache(
    serviceId: string,
  ): Promise<void> {
    try {
      const cacheKeys = [
        CACHE_KEYS.PRODUCTS_BY_SERVICE(serviceId),
        // Include data type variant if applicable
        CACHE_KEYS.DATA_PRODUCTS_ALL_ACTIVE(serviceId),
      ];

      // Also invalidate pattern-based caches
      await Promise.all([
        ...cacheKeys.map((key) => this.cacheService.delete(key)),
        // Delete all data type variants for this service
        this.cacheService.deletePattern(`products:service:${serviceId}:*`),
        this.cacheService.deletePattern(
          `products:data:all-active:${serviceId}:*`,
        ),
        this.cacheService.deletePattern(`data:types:by-service-code:*`),
      ]);

      logger.debug(`Products cache invalidated for service: ${serviceId}`, {
        keys: cacheKeys,
      });
    } catch (error) {
      logger.warn(
        `Error invalidating products cache for service ${serviceId}:`,
        error,
      );
    }
  }

  // Invalidates all products related to a service type

  private async invalidateProductsByServiceTypeCache(
    serviceTypeCode: string,
  ): Promise<void> {
    try {
      const cacheKeys = [
        CACHE_KEYS.PRODUCTS_BY_TYPE(serviceTypeCode),
        CACHE_KEYS.DATA_TYPES,
      ];

      await Promise.all([
        ...cacheKeys.map((key) => this.cacheService.delete(key)),
        this.cacheService.deletePattern(`data:types:by-service-code:*`),
      ]);

      logger.debug(
        `Products cache invalidated for service type: ${serviceTypeCode}`,
        {
          keys: cacheKeys,
        },
      );
    } catch (error) {
      logger.warn(
        `Error invalidating products cache for service type ${serviceTypeCode}:`,
        error,
      );
    }
  }

  // Invalidates all products related to a provider

  private async invalidateProductsByProviderCache(
    providerId: string,
  ): Promise<void> {
    try {
      // Invalidate all products associated with this provider using pattern matching
      await this.cacheService.deletePattern(
        `products:provider:${providerId}:*`,
      );

      logger.debug(`Products cache invalidated for provider: ${providerId}`);
    } catch (error) {
      logger.warn(
        `Error invalidating products cache for provider ${providerId}:`,
        error,
      );
    }
  }

  // Invalidates general product lists and related data

  private async invalidateGeneralProductCaches(): Promise<void> {
    try {
      const cacheKeys = [
        CACHE_KEYS.PRODUCTS,
        CACHE_KEYS.DATA_TYPES,
        CACHE_KEYS.DATA_ACTIVE_PROVIDER_IDS,
      ];

      await Promise.all([
        ...cacheKeys.map((key) => this.cacheService.delete(key)),
        this.cacheService.deletePattern(`data:types:by-service-code:*`),
      ]);

      logger.debug("General product caches invalidated");
    } catch (error) {
      logger.warn("Error invalidating general product caches:", error);
    }
  }

  // Comprehensive cache invalidation for product updates

  private async invalidateProductRelatedCaches(
    productId: string,
    serviceId: string,
    providerId: string,
    serviceTypeCode?: string,
  ): Promise<void> {
    try {
      await Promise.all([
        this.invalidateProductCache(productId),
        this.invalidateProductsByServiceCache(serviceId),
        this.invalidateProductsByProviderCache(providerId),
        ...(serviceTypeCode
          ? [this.invalidateProductsByServiceTypeCache(serviceTypeCode)]
          : []),
      ]);

      logger.info(
        `Comprehensive cache invalidation completed for product ${productId}`,
        {
          serviceId,
          providerId,
          serviceTypeCode,
        },
      );
    } catch (error) {
      logger.error("Error in comprehensive cache invalidation:", error);
    }
  }

  async listProducts(page: number = 1, limit: number = 20, filters: any = {}) {
    const query: any = {};

    if (filters.status !== undefined) {
      query.isActive = filters.status === "true";
    }

    if (filters.serviceId) {
      query.serviceId = filters.serviceId;
    }

    if (filters.providerId) {
      query.providerId = filters.providerId;
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: "i" } },
        { code: { $regex: filters.search, $options: "i" } },
      ];
    }

    const populate = [
      { path: "serviceId", select: "name code logo" },
      { path: "providerId", select: "name code logo" },
    ];

    const result = await this.productRepository.findWithPagination(
      query,
      page,
      limit,
      { createdAt: -1 },
      populate,
    );

    return {
      products: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async createProduct(data: any) {
    const service = await Service.findById(data.serviceId);
    if (!service) {
      throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
    }

    const product = await this.productRepository.create(data);

    await product.populate([
      { path: "serviceId", select: "name code logo serviceTypeId" },
      { path: "providerId", select: "name code logo" },
    ]);

    // Invalidate caches after creation
    const serviceTypeCode = (service as any).serviceTypeId?.code;
    await this.invalidateProductRelatedCaches(
      product._id.toString(),
      data.serviceId,
      data.providerId,
      serviceTypeCode,
    );

    // Also invalidate general product list
    await this.invalidateGeneralProductCaches();

    return { message: "Product created successfully", product };
  }

  async getProductDetails(productId: string) {
    const product = await this.productRepository.findById(productId);

    if (!product) {
      throw new AppError("Product not found", HTTP_STATUS.NOT_FOUND);
    }

    await product.populate([
      { path: "serviceId", select: "name code logo serviceTypeId" },
      { path: "providerId", select: "name code logo" },
    ]);

    return product;
  }

  async updateProduct(productId: string, data: any) {
    const product = await this.productRepository.findById(productId);

    if (!product) {
      throw new AppError("Product not found", HTTP_STATUS.NOT_FOUND);
    }

    const oldServiceId = product.serviceId.toString();
    const oldProviderId = product.providerId.toString();

    if (data.serviceId && data.serviceId !== oldServiceId) {
      const service = await Service.findById(data.serviceId);
      if (!service) {
        throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
      }
    }

    Object.assign(product, data);
    await product.save();

    await product.populate([
      { path: "serviceId", select: "name code logo serviceTypeId" },
      { path: "providerId", select: "name code logo" },
    ]);

    // Invalidate caches after update
    const newServiceId = data.serviceId || oldServiceId;
    const newProviderId = data.providerId || oldProviderId;

    await Promise.all([
      this.invalidateProductCache(productId),
      this.invalidateProductsByServiceCache(oldServiceId),
      ...(data.serviceId !== oldServiceId
        ? [this.invalidateProductsByServiceCache(newServiceId)]
        : []),
      this.invalidateProductsByProviderCache(oldProviderId),
      ...(data.providerId !== oldProviderId
        ? [this.invalidateProductsByProviderCache(newProviderId)]
        : []),
    ]);

    return { message: "Product updated successfully", product };
  }

  async updateProductStatus(productId: string, isActive: boolean) {
    const product = await this.productRepository.findById(productId);

    if (!product) {
      throw new AppError("Product not found", HTTP_STATUS.NOT_FOUND);
    }

    const oldStatus = product.isActive;
    product.isActive = isActive;
    await product.save();

    // Only invalidate if status actually changed
    if (oldStatus !== isActive) {
      await this.invalidateProductCache(productId);
      await this.invalidateProductsByServiceCache(product.serviceId.toString());
    }

    return {
      message: "Product status updated successfully",
      isActive: product.isActive,
    };
  }

  async deleteProduct(productId: string) {
    const product = await this.productRepository.findById(productId);

    if (!product) {
      throw new AppError("Product not found", HTTP_STATUS.NOT_FOUND);
    }

    const serviceId = product.serviceId.toString();
    const providerId = product.providerId.toString();

    await this.productRepository.delete(productId);

    // Invalidate caches after deletion
    await this.invalidateProductRelatedCaches(productId, serviceId, providerId);

    return { message: "Product deleted successfully" };
  }

  async getProductsByServiceType(
    serviceTypeId: string,
    page: number = 1,
    limit: number = 20,
    filters: any = {},
  ) {
    const services = await Service.find({
      serviceTypeId: new Types.ObjectId(serviceTypeId),
    }).select("_id");

    if (services.length === 0) {
      return {
        products: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      };
    }

    const serviceIds = services.map((s) => s._id);

    const query: any = {
      serviceId: { $in: serviceIds },
    };

    if (filters.status !== undefined) {
      query.isActive = filters.status === "true";
    }

    if (filters.providerId) {
      query.providerId = filters.providerId;
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: "i" } },
        { code: { $regex: filters.search, $options: "i" } },
      ];
    }

    const populate = [
      { path: "serviceId", select: "name code logo serviceTypeId" },
      { path: "providerId", select: "name code logo" },
    ];

    const result = await this.productRepository.findWithPagination(
      query,
      page,
      limit,
      { createdAt: -1 },
      populate,
    );

    return {
      products: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async getProductsByService(
    serviceId: string,
    page: number = 1,
    limit: number = 20,
    filters: any = {},
  ) {
    const service = await Service.findById(serviceId);
    if (!service) {
      throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
    }

    const query: any = {
      serviceId: new Types.ObjectId(serviceId),
    };

    if (filters.status !== undefined) {
      query.isActive = filters.status === "true";
    }

    if (filters.providerId) {
      query.providerId = filters.providerId;
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: "i" } },
        { code: { $regex: filters.search, $options: "i" } },
      ];
    }

    const populate = [
      { path: "serviceId", select: "name code logo serviceTypeId" },
      { path: "providerId", select: "name code logo" },
    ];

    const result = await this.productRepository.findWithPagination(
      query,
      page,
      limit,
      { createdAt: -1 },
      populate,
    );

    return {
      service: {
        id: service._id,
        name: service.name,
        code: service.code,
        logo: service.logo,
      },
      products: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async getProductsByProvider(
    providerId: string,
    page: number = 1,
    limit: number = 20,
    filters: any = {},
  ) {
    const query: any = {
      providerId: new Types.ObjectId(providerId),
    };

    if (filters.status !== undefined) {
      query.isActive = filters.status === "true";
    }

    if (filters.serviceId) {
      query.serviceId = filters.serviceId;
    }

    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: "i" } },
        { code: { $regex: filters.search, $options: "i" } },
      ];
    }

    const populate = [
      { path: "serviceId", select: "name code logo serviceTypeId" },
      { path: "providerId", select: "name code logo" },
    ];

    const result = await this.productRepository.findWithPagination(
      query,
      page,
      limit,
      { createdAt: -1 },
      populate,
    );

    return {
      products: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  async fetchProviderProducts(providerId: string, serviceId: string) {
    const service = await Service.findById(serviceId);
    if (!service) {
      throw new AppError("Service not found", HTTP_STATUS.NOT_FOUND);
    }

    // TODO: Implement provider-specific product fetching logic
    throw new AppError(
      "Product fetching from provider is not yet implemented",
      HTTP_STATUS.NOT_IMPLEMENTED,
    );
  }

  // Toggle products by service (used for cascading)
  async toggleProductsByService(
    serviceId: string,
    isActive: boolean,
  ): Promise<number> {
    const products = await this.productRepository.find({
      serviceId: new Types.ObjectId(serviceId),
    });

    let toggledCount = 0;
    for (const product of products) {
      if (product.isActive !== isActive) {
        product.isActive = isActive;
        await product.save();
        toggledCount++;
      }
    }

    // Invalidate all products for this service after bulk toggle
    if (toggledCount > 0) {
      await this.invalidateProductsByServiceCache(serviceId);
    }

    return toggledCount;
  }
}
