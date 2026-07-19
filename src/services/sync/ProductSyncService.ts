import { BaseSyncService } from "./BaseSyncService";
import { Product } from "@/models/reference/Product";
import { Provider } from "@/models/reference/Provider";
import { Service } from "@/models/reference/Service";
import { ServiceType } from "@/models/reference/ServiceType";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  TRANSACTION_TYPES,
  CACHE_KEYS,
} from "@/utils/constants";
import logger from "@/logger";
import axios, { AxiosInstance } from "axios";
import { ServiceTypeProvider } from "@/models/reference/ServiceTypeProvider";
import { Types } from "mongoose";
import { CacheService } from "../core/CacheService";
import { SaveHavenService } from "../client/providers/payments/SaveHavenService";
import { NowPaymentsService } from "../client/providers/crypto/Nowpaymentsservice";
import { GiftCardSyncService } from "./GiftCardSyncService";
import ServiceContainer from "../client/container";

interface ProductData {
  serviceId: string;
  providerId: string;
  name: string;
  code: string;
  logo: string;
  providerAmount: number;
  amount: number;
  validity?: string;
  description?: string;
  productType?: string;
  dataSize?: number;
  dataSizeDisplay?: string;
  attributes?: any;
  isActive: boolean;
}

interface SyncResult {
  success: boolean;
  provider: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  created: number;
  updated: number;
  deleted: number;
  total: number;
  failed: number;
  errors: string[];
}

export class ProductSyncService extends BaseSyncService {
  // Entry point
  private cacheService = new CacheService();
  private saveHaveService = new SaveHavenService();
  private nowPaymentsService = new NowPaymentsService();
  private giftCardSyncService = new GiftCardSyncService();
  private giftCardService = ServiceContainer.getGiftCardService();
  private coolsubService = ServiceContainer.getCoolsubService();

  async syncProviderProducts(
    providerId: string,
    options?: {
      serviceTypeId?: string;
      forceUpdate?: boolean;
    },
  ): Promise<SyncResult> {
    const startTime = new Date();

    return await this.executeSyncOperation(
      "Provider Product Sync",
      async () => {
        const provider = await Provider.findById(providerId);
        if (!provider) {
          throw new AppError(
            "Provider not found",
            HTTP_STATUS.NOT_FOUND,
            ERROR_CODES.RESOURCE_NOT_FOUND,
          );
        }

        if (!provider.isActive) {
          throw new AppError(
            "Cannot sync inactive provider",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        if (!provider.hasSync) {
          throw new AppError(
            `Provider ${provider.name} does not support automatic syncing`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        let products: ProductData[] = [];

        switch (provider.code.toLowerCase()) {
          case "vtpass":
            products = await this.syncVTPassProducts(
              providerId,
              options?.serviceTypeId,
            );
            break;

          case "clubkonnect":
            products = await this.syncClubKonnectProducts(
              providerId,
              options?.serviceTypeId,
            );
            break;

          // case "coolsub":
          //   products = await this.syncCoolsubProducts(
          //     providerId,
          //     options?.serviceTypeId,
          //   );
          //   break;

          case "vtung":
            products = await this.syncVtuNgProducts(
              providerId,
              options?.serviceTypeId,
            );
            break;

          case "giftbills":
            products = await this.syncGiftBillsProducts(
              providerId,
              options?.serviceTypeId,
            );
            break;

          case "savehaven":
            products = await this.syncSaveHavenProducts(
              providerId,
              options?.serviceTypeId,
            );
            break;
          case "nowpayment":
            logger.info(
              `Provider "${provider.name}" uses crypto sync instead of product sync. Syncing cryptos...`,
            );

            try {
              const cryptoSyncResult =
                await this.nowPaymentsService.syncNowPaymentsCryptos();

              logger.info(
                "NowPayments crypto sync completed",
                cryptoSyncResult,
              );

              // Update provider's lastSyncedAt
              await Provider.findByIdAndUpdate(providerId, {
                lastSyncedAt: new Date(),
              });

              // Invalidate crypto-related caches
              await this.invalidateCryptoCachesAfterSync(providerId);

              return this.buildSyncResult(provider.name, startTime, {
                created: cryptoSyncResult.cryptosCount || 0,
                updated: 0,
                deleted: 0,
                total: cryptoSyncResult.cryptosCount || 0,
                failed: 0,
              });
            } catch (cryptoSyncErr: any) {
              logger.error(
                "NowPayments crypto sync failed in ProductSyncService",
                {
                  error: cryptoSyncErr.message,
                  providerId,
                },
              );
              throw cryptoSyncErr;
            }
          case "reloadly":
            logger.info(
              `Provider "${provider.name}" is a gift card provider. Running gift card sync...`,
            );

            try {
              const giftCardSyncResult =
                await this.giftCardSyncService.syncGiftCardsFromProvider(
                  providerId,
                );

              const cleanupResult =
                await this.giftCardSyncService.cleanupOrphanedProducts(
                  providerId,
                );

              await Provider.findByIdAndUpdate(providerId, {
                lastSyncedAt: new Date(),
              });

              this.giftCardService.invalidateCategoriesCache();
              this.giftCardService.invalidateCountriesCache();

              return this.buildSyncResult(provider.name, startTime, {
                created: giftCardSyncResult.created,
                updated: giftCardSyncResult.updated,
                deleted: cleanupResult.deleted,
                total: giftCardSyncResult.total,
                failed: giftCardSyncResult.failed,
              });
            } catch (err: any) {
              logger.error(
                "Reloadly gift card sync failed in ProductSyncService",
                {
                  error: err.message,
                  providerId,
                },
              );
              throw err;
            }

          default:
            throw new AppError(
              `Sync not implemented for provider: ${provider.name}`,
              HTTP_STATUS.BAD_REQUEST,
              ERROR_CODES.VALIDATION_ERROR,
            );
        }

        const processResult = await this.processProducts(
          products,
          providerId,
          options?.forceUpdate || false,
        );

        await Provider.findByIdAndUpdate(providerId, {
          lastSyncedAt: new Date(),
        });

        await this.invalidateProductCachesAfterSync(providerId);

        return this.buildSyncResult(provider.name, startTime, {
          created: processResult.added,
          updated: processResult.updated,
          deleted: processResult.deactivated,
          total: products.length,
          failed: 0,
        });
      },
      { providerId, options },
    );
  }

  // Product processing
  private async processProducts(
    products: ProductData[],
    providerId: string,
    forceUpdate: boolean,
  ): Promise<{ added: number; updated: number; deactivated: number }> {
    let added = 0;
    let updated = 0;

    const existingProducts = await Product.find({ providerId }).select("code");
    const existingCodes = new Set(existingProducts.map((p) => p.code));
    const syncedCodes = new Set(products.map((p) => p.code));

    const result = await this.processBatch(
      products,
      100,
      async (productData) => {
        const existingProduct = await Product.findOne({
          code: productData.code,
          providerId: productData.providerId,
        });

        if (existingProduct) {
          if (forceUpdate) {
            // forceUpdate: overwrite everything except amount (preserve markup)
            Object.assign(existingProduct, {
              // Dont need to udpate admin might have changed the name
              // name: productData.name,
              providerAmount: productData.providerAmount,
              validity: productData.validity,
              description: productData.description,
              productType: productData.productType,
              dataSize: productData.dataSize,
              dataSizeDisplay: productData.dataSizeDisplay,
              attributes: productData.attributes,
              isActive: true,
            });
            await existingProduct.save();
            return { type: "updated" };
          }

          // Non-force: only update providerAmount and name if they changed
          const hasChanged =
            existingProduct.providerAmount !== productData.providerAmount ||
            existingProduct.validity !== productData.validity ||
            existingProduct.attributes?.validityPeriod !==
              productData.attributes?.validityPeriod ||
            existingProduct.dataSize !== productData.dataSize ||
            existingProduct.dataSizeDisplay !== productData.dataSizeDisplay;
          //  || existingProduct.name !== productData.name;

          if (hasChanged) {
            existingProduct.providerAmount = productData.providerAmount;
            // Dont need to udpate admin might have changed the name
            existingProduct.validity = productData.validity;
            existingProduct.dataSize = productData.dataSize;
            existingProduct.dataSizeDisplay = productData.dataSizeDisplay;
            existingProduct.attributes = {
              ...existingProduct.attributes,
              ...productData.attributes,
            };
            // existingProduct.name = productData.name;
            await existingProduct.save();
            return { type: "updated" };
          }

          return { type: "skipped" };
        }

        // New product — amount defaults to providerAmount, admin sets markup later
        await Product.create(productData);
        return { type: "added" };
      },
    );

    added = result.successful.filter((r) => r.type === "added").length;
    updated = result.successful.filter((r) => r.type === "updated").length;

    // Deactivate products that no longer exist at the provider
    const codesToDeactivate = [...existingCodes].filter(
      (code) => !syncedCodes.has(code),
    );

    let deactivated = 0;
    if (codesToDeactivate.length > 0) {
      const deactivateResult = await Product.updateMany(
        { code: { $in: codesToDeactivate }, providerId, isActive: true },
        { $set: { isActive: false } },
      );
      deactivated = deactivateResult.modifiedCount || 0;
    }

    return { added, updated, deactivated };
  }

  // VTPass sync
  private async syncVTPassProducts(
    providerId: string,
    serviceTypeId?: string,
  ): Promise<ProductData[]> {
    return await this.executeSyncOperation(
      "VTPass Product Fetch",
      async () => {
        const vtpassClient = this.createVTPassClient();
        const products: ProductData[] = [];

        const serviceQuery: any = { isActive: true };
        if (serviceTypeId) {
          serviceQuery.serviceTypeId = serviceTypeId;
        }

        const services = await Service.find(serviceQuery);
        const serviceTypes = await ServiceType.find({});
        const serviceTypeMap = new Map(
          serviceTypes.map((st) => [st.id.toString(), st]),
        );

        for (const service of services) {
          try {
            const vtpassServiceCode = this.getVTPassServiceCode(service.code);
            if (!vtpassServiceCode) {
              // Service exists in DB but has no VTPass mapping — skip silently
              continue;
            }

            const response = await this.retryOperation(async () =>
              vtpassClient.get(
                `/service-variations?serviceID=${vtpassServiceCode}`,
              ),
            );

            // VTPass uses a typo in their API: "varations" — handle both
            const variations =
              response.data?.content?.variations ??
              response.data?.content?.varations ??
              [];

            if (
              response.data.response_description !== "000" ||
              !variations.length
            ) {
              continue;
            }

            for (const variation of variations) {
              const productData = this.mapVTPassProduct(
                variation,
                service,
                providerId,
                serviceTypeMap,
              );
              products.push(productData);
            }
          } catch (error: any) {
            logger.warn(
              `VTPass: error fetching ${service.name}: ${error.message}`,
            );
          }
        }

        return products;
      },
      { providerId, serviceTypeId },
    );
  }

  // Maps our DB service code → VTPass serviceID.
  // Returns null for services that VTPass doesn't have a variations endpoint for
  // (airtime, electricity, betting — those are free-form amount transactions).
  private getVTPassServiceCode(serviceCode: string): string | null {
    const mapping: Record<string, string> = {
      // Data
      "mtn-data": "mtn-data",
      "glo-data": "glo-data",
      "airtel-data": "airtel-data",
      "9mobile-data": "etisalat-data",

      // Cable TV
      dstv: "dstv",
      gotv: "gotv",
      startimes: "startimes",
      showmax: "showmax",

      // Electricity — note: Kano = "kedco", Port Harcourt = "phed" on VTPass
      "ikeja-electric": "ikeja-electric",
      "eko-electric": "eko-electric",
      kedco: "kedco",
      phed: "phed",
      "jos-electric": "jos-electric",
      "ibadan-electric": "ibadan-electric",
      "kaduna-electric": "kaduna-electric",
      "abuja-electric": "abuja-electric",
      "enugu-electric": "enugu-electric",
      "aba-electric": "aba-electric",
      "benin-electric": "benin-electric",
      "yola-electric": "yola-electric",

      // Education
      waec: "waec",
      "waec-registration": "waec-registration",
      jamb: "jamb",
      neco: "neco",

      // Smile & Spectranet via VTPass
      "smile-data": "smile-direct",
      spectranet: "spectranet",

      // Airtime, betting — no variations endpoint on VTPass, return null
    };

    return mapping[serviceCode.toLowerCase()] ?? null;
  }

  private mapVTPassProduct(
    variation: any,
    service: any,
    providerId: string,
    serviceTypeMap: Map<string, any>,
  ): ProductData {
    const providerAmount = parseFloat(variation.variation_amount) || 0;

    const productData: ProductData = {
      serviceId: service.id.toString(),
      providerId,
      name: variation.name,
      code: variation.variation_code,
      logo: service.logo || "",
      providerAmount,
      amount: providerAmount, // default, admin adjusts markup
      description: variation.name,
      isActive: true,
      attributes: {},
    };

    const serviceType = serviceTypeMap.get(service.serviceTypeId.toString());
    const serviceTypeCode = serviceType?.code;

    if (serviceTypeCode === TRANSACTION_TYPES.DATA) {
      const { sizeInMB, displaySize } = this.parseDataSize(variation.name);
      // Data products must always carry dataSize/dataSizeDisplay so the UI
      // field is present even when we can't parse a size from the name.
      productData.dataSize = sizeInMB > 0 ? sizeInMB : 0;
      productData.dataSizeDisplay = displaySize || "";
      productData.productType = this.detectDataType(variation.name);
      productData.attributes.dataType = productData.productType;
    }

    const { validity, validityPeriod } = this.extractValidityFromText(
      variation.name,
    );
    if (validity) {
      productData.validity = validity;
      productData.attributes.validityPeriod = validityPeriod;
    } else if (serviceTypeCode === TRANSACTION_TYPES.DATA) {
      // Same reasoning: always present for data products, empty if unknown.
      productData.validity = "";
      productData.attributes.validityPeriod = "";
    }

    if (serviceTypeCode === TRANSACTION_TYPES.ELECTRICITY) {
      productData.attributes.discoName = service.name;
      // VTPass variation names contain "prepaid"/"postpaid"
      productData.attributes.meterType = variation.name
        .toLowerCase()
        .includes("prepaid")
        ? "prepaid"
        : "postpaid";
    }

    if (serviceTypeCode === TRANSACTION_TYPES.CABLE) {
      productData.attributes.bouquetType = variation.name;
    }

    if (serviceTypeCode === TRANSACTION_TYPES.EDUCATION) {
      productData.attributes.examType = service.code;
    }

    return productData;
  }

  // ClubKonnect sync
  public async syncClubKonnectProducts(
    providerId: string,
    serviceTypeId?: string,
  ): Promise<ProductData[]> {
    return await this.executeSyncOperation(
      "ClubKonnect Product Fetch",
      async () => {
        const userId = process.env.CLUBKONNECT_USER_ID;
        if (!userId) {
          throw new AppError(
            "CLUBKONNECT_USER_ID not found in environment",
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            ERROR_CODES.CONFIGURATION_ERROR,
          );
        }

        const products: ProductData[] = [];

        // Run each category independently so one failure doesn't kill the whole sync
        const syncs = [
          () => this.syncClubKonnectData(userId, providerId),
          () => this.syncClubKonnectCableTV(userId, providerId),
          () => this.syncClubKonnectSmile(userId, providerId),
          () => this.syncClubKonnectSpectranet(userId, providerId),
          () => this.syncClubKonnectWAEC(userId, providerId),
          () => this.syncClubKonnectJAMB(userId, providerId),
        ];

        for (const sync of syncs) {
          try {
            const result = await sync();
            products.push(...result);
            logger.info("products pushed successfully");
          } catch (error: any) {
            logger.warn(`ClubKonnect partial sync error: ${error.message}`);
          }
        }

        return products;
      },
      { providerId, serviceTypeId },
    );
  }

  private async syncClubKonnectData(
    userId: string,
    providerId: string,
  ): Promise<ProductData[]> {
    const products: ProductData[] = [];

    const response = await this.retryOperation(async () =>
      axios.get(
        `https://www.nellobytesystems.com/APIDatabundlePlansV2.asp?UserID=${userId}`,
      ),
    );

    if (!response.data?.MOBILE_NETWORK) {
      return products;
    }

    // ClubKonnect network name → our DB service code
    const networkMapping: Record<string, string> = {
      MTN: "mtn-data",
      Glo: "glo-data",
      Airtel: "airtel-data",
      m_9mobile: "9mobile-data",
    };

    for (const [networkName, serviceCode] of Object.entries(networkMapping)) {
      const networkData = response.data.MOBILE_NETWORK[networkName];
      if (!networkData || !Array.isArray(networkData)) {
        continue;
      }

      const service = await Service.findOne({
        code: serviceCode,
        isActive: true,
      });
      if (!service) {
        logger.warn(
          `ClubKonnect data sync: service "${serviceCode}" not found in DB`,
        );
        continue;
      }

      for (const networkEntry of networkData) {
        if (!networkEntry.PRODUCT || !Array.isArray(networkEntry.PRODUCT))
          continue;

        for (const product of networkEntry.PRODUCT) {
          const name = product.PRODUCT_NAME || "";
          const productCode = product.PRODUCT_CODE || "";
          const code = product.PRODUCT_ID || "";
          const providerAmount = parseFloat(product.PRODUCT_AMOUNT) || 0;

          if (!name || !code) continue;

          const { sizeInMB, displaySize } = this.parseDataSize(name);
          const { validity, validityPeriod } =
            this.extractValidityFromText(name);
          const dataType = this.detectDataType(name);

          products.push({
            serviceId: service.id.toString(),
            providerId,
            name,
            code,
            logo: service.logo || "",
            providerAmount,
            amount: providerAmount,
            validity: validity || "",
            description: name,
            isActive: true,
            dataSize: sizeInMB > 0 ? sizeInMB : 0,
            dataSizeDisplay: displaySize || "",
            productType: dataType,
            attributes: {
              dataType,
              validityPeriod: validityPeriod || "",
              networkId: networkEntry.ID,
              productCode: productCode,
            },
          });
        }
      }
    }

    logger.info(`ClubKonnect: fetched ${products.length} data products`);
    return products;
  }

  private async syncClubKonnectCableTV(
    userId: string,
    providerId: string,
  ): Promise<ProductData[]> {
    const products: ProductData[] = [];

    const response = await this.retryOperation(async () =>
      axios.get(
        `https://www.nellobytesystems.com/APICableTVPackagesV2.asp?UserID=${userId}`,
      ),
    );

    if (!response.data?.TV_ID) return products;

    // ClubKonnect TV name → our DB service code
    // Note: Showmax is not supported by ClubKonnect
    const tvMapping: Record<string, string> = {
      DStv: "dstv",
      GOtv: "gotv",
      Startimes: "startimes",
    };

    for (const [tvName, serviceCode] of Object.entries(tvMapping)) {
      const tvData = response.data.TV_ID[tvName];
      if (!tvData || !Array.isArray(tvData)) continue;

      const service = await Service.findOne({
        code: serviceCode,
        isActive: true,
      });
      if (!service) {
        logger.warn(
          `ClubKonnect cable sync: service "${serviceCode}" not found in DB`,
        );
        continue;
      }

      for (const tvEntry of tvData) {
        if (!tvEntry.PRODUCT || !Array.isArray(tvEntry.PRODUCT)) continue;

        for (const product of tvEntry.PRODUCT) {
          const name = product.PACKAGE_NAME || "";
          const code = product.PACKAGE_ID || "";
          const providerAmount = parseFloat(product.PACKAGE_AMOUNT) || 0;

          if (!name || !code) continue;

          const { validity, validityPeriod } =
            this.extractValidityFromText(name);

          products.push({
            serviceId: service.id.toString(),
            providerId,
            name,
            code,
            logo: service.logo || "",
            providerAmount,
            amount: providerAmount,
            validity: validity || "1 month",
            description: name,
            isActive: true,
            attributes: {
              bouquetType: name,
              tvId: tvEntry.ID,
              validityPeriod: validityPeriod || "monthly",
            },
          });
        }
      }
    }

    logger.info(`ClubKonnect: fetched ${products.length} cable TV products`);
    return products;
  }

  private async syncClubKonnectSmile(
    userId: string,
    providerId: string,
  ): Promise<ProductData[]> {
    const products: ProductData[] = [];

    const response = await this.retryOperation(async () =>
      axios.get(
        `https://www.nellobytesystems.com/APISmilePackagesV2.asp?UserID=${userId}`,
      ),
    );

    const smileData = response.data?.MOBILE_NETWORK?.["smile-direct"];
    if (!smileData || !Array.isArray(smileData)) return products;

    const service = await Service.findOne({
      code: "smile",
      isActive: true,
    });
    if (!service) {
      logger.warn(
        `ClubKonnect smile sync: service "smile-data" not found in DB`,
      );
      return products;
    }

    for (const smileEntry of smileData) {
      if (!smileEntry.PRODUCT || !Array.isArray(smileEntry.PRODUCT)) continue;

      for (const product of smileEntry.PRODUCT) {
        const name = product.PACKAGE_NAME || "";
        const code = product.PACKAGE_ID || "";
        const providerAmount = parseFloat(product.PACKAGE_AMOUNT) || 0;

        if (!name || !code) continue;
        // Skip airtime entries that appear in the Smile product list
        if (code === "airtime" || name.toLowerCase().includes("airtime"))
          continue;

        const { sizeInMB, displaySize } = this.parseDataSize(name);
        const { validity, validityPeriod } = this.extractValidityFromText(name);

        products.push({
          serviceId: service.id.toString(),
          providerId,
          name,
          code,
          logo: service.logo || "",
          providerAmount,
          amount: providerAmount,
          validity: validity || "",
          description: name,
          isActive: true,
          dataSize: sizeInMB > 0 ? sizeInMB : 0,
          dataSizeDisplay: displaySize || "",
          attributes: {
            networkId: smileEntry.ID,
            validityPeriod: validityPeriod || "",
          },
        });
      }
    }

    logger.info(`ClubKonnect: fetched ${products.length} Smile products`);
    return products;
  }

  private async syncClubKonnectSpectranet(
    userId: string,
    providerId: string,
  ): Promise<ProductData[]> {
    const products: ProductData[] = [];

    const response = await this.retryOperation(async () =>
      axios.get(
        `https://www.nellobytesystems.com/APISpectranetPackagesV2.asp?UserID=${userId}`,
      ),
    );

    const spectranetData = response.data?.MOBILE_NETWORK?.["spectranet"];
    if (!spectranetData || !Array.isArray(spectranetData)) return products;

    const service = await Service.findOne({
      code: "spectranet",
      isActive: true,
    });
    if (!service) {
      logger.warn(
        `ClubKonnect spectranet sync: service "spectranet" not found in DB`,
      );
      return products;
    }

    for (const entry of spectranetData) {
      if (!entry.PRODUCT || !Array.isArray(entry.PRODUCT)) continue;

      for (const product of entry.PRODUCT) {
        const name = product.PACKAGE_NAME || "";
        const code = product.PACKAGE_ID || "";
        const providerAmount = parseFloat(product.PACKAGE_AMOUNT) || 0;

        if (!name || !code) continue;

        const { sizeInMB, displaySize } = this.parseDataSize(name);
        const { validity, validityPeriod } = this.extractValidityFromText(name);

        products.push({
          serviceId: service.id.toString(),
          providerId,
          name,
          code,
          logo: service.logo || "",
          providerAmount,
          amount: providerAmount,
          validity: validity || "",
          description: name,
          isActive: true,
          dataSize: sizeInMB > 0 ? sizeInMB : 0,
          dataSizeDisplay: displaySize || "",
          attributes: {
            networkId: entry.ID,
            validityPeriod: validityPeriod || "",
          },
        });
      }
    }

    logger.info(`ClubKonnect: fetched ${products.length} Spectranet products`);
    return products;
  }

  public async syncClubKonnectWAEC(
    userId: string,
    providerId: string,
  ): Promise<ProductData[]> {
    const products: ProductData[] = [];

    const response = await this.retryOperation(async () =>
      axios.get(
        `https://www.nellobytesystems.com/APIWAECPackagesV2.asp?UserID=${userId}`,
      ),
    );

    if (!response.data?.EXAM_TYPE || !Array.isArray(response.data.EXAM_TYPE)) {
      return products;
    }

    const service = await Service.findOne({ code: "waec", isActive: true });
    if (!service) {
      logger.warn(`ClubKonnect WAEC sync: service "waec" not found in DB`);
      return products;
    }

    for (const exam of response.data.EXAM_TYPE) {
      const code = exam.PRODUCT_CODE || "";
      const name = exam.PRODUCT_DESCRIPTION || "";
      const providerAmount = parseFloat(exam.PRODUCT_AMOUNT) || 0;

      if (!code) continue;

      products.push({
        serviceId: service.id.toString(),
        providerId,
        name,
        code,
        logo: service.logo || "",
        providerAmount,
        amount: providerAmount,
        description: name,
        isActive: true,
        attributes: { examType: code },
      });
    }

    logger.info(`ClubKonnect: fetched ${products.length} WAEC products`);
    return products;
  }

  private async syncClubKonnectJAMB(
    userId: string,
    providerId: string,
  ): Promise<ProductData[]> {
    const products: ProductData[] = [];

    const response = await this.retryOperation(async () =>
      axios.get(
        `https://www.nellobytesystems.com/APIJAMBPackagesV2.asp?UserID=${userId}`,
      ),
    );

    if (
      !response.data?.EXAM_TYPE ||
      !Array.isArray(response.data.EXAM_TYPE) ||
      response.data.EXAM_TYPE.length === 0
    ) {
      return products;
    }

    const service = await Service.findOne({ code: "jamb", isActive: true });
    if (!service) {
      logger.warn(`ClubKonnect JAMB sync: service "jamb" not found in DB`);
      return products;
    }

    for (const exam of response.data.EXAM_TYPE) {
      const code = exam.PRODUCT_CODE || "";
      const name = exam.PRODUCT_DESCRIPTION || "";
      const providerAmount = parseFloat(exam.PRODUCT_AMOUNT) || 0;

      if (!code) continue;

      products.push({
        serviceId: service.id.toString(),
        providerId,
        name,
        code,
        logo: service.logo || "",
        providerAmount,
        amount: providerAmount,
        description: name,
        isActive: true,
        attributes: { examType: code },
      });
    }

    logger.info(`ClubKonnect: fetched ${products.length} JAMB products`);
    return products;
  }

  //   private async syncCoolsubProducts(
  //   providerId: string,
  //   serviceTypeId?: string,
  // ): Promise<ProductData[]> {
  //   return await this.executeSyncOperation(
  //     "Coolsub Product Fetch",
  //     async () => {
  //       const products: ProductData[] = [];
  //       const serviceQuery: any = { isActive: true };
  //       if (serviceTypeId) serviceQuery.serviceTypeId = serviceTypeId;

  //       const services = await Service.find(serviceQuery);
  //       const serviceTypes = await ServiceType.find({});
  //       const serviceTypeMap = new Map(serviceTypes.map((st) => [st.id.toString(), st]));

  //       for (const service of services) {
  //         // TODO: replace with the real Coolsub "list plans" call once we
  //         // add getDataPlans() (or equivalent) to CoolsubService.
  //         const variations = await this.coolsubService.getDataPlans(service.code);

  //         for (const variation of variations) {
  //           products.push({
  //             serviceId: service.id.toString(),
  //             providerId,
  //             name: variation.name,
  //             code: variation.code,
  //             logo: service.logo || "",
  //             providerAmount: variation.amount,
  //             amount: variation.amount,
  //             productType: this.detectDataType(variation.name), // reuses the SME/Awoof/Gifting/Corporate logic already built for VTPass
  //             isActive: true,
  //             attributes: {},
  //           });
  //         }
  //       }
  //       return products;
  //     },
  //     { providerId, serviceTypeId },
  //   );
  // }

  public async syncGiftBillsProducts(
    providerId: string,
    serviceTypeId?: string,
  ): Promise<ProductData[]> {
    return await this.executeSyncOperation(
      "GiftBills Product Fetch",
      async () => {
        const apiKey = process.env.GIFTBILLS_API_KEY;
        const merchantId = process.env.GIFTBILLS_MERCHANT_ID;
        const baseUrl =
          process.env.GIFTBILLS_BASE_URL || "https://api.giftbills.com";

        if (!apiKey || !merchantId) {
          throw new AppError(
            "GiftBills credentials not found in environment",
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
            ERROR_CODES.CONFIGURATION_ERROR,
          );
        }

        const client = axios.create({
          baseURL: baseUrl,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            MerchantId: merchantId,
          },
        });

        const products: ProductData[] = [];
        const dataProducts = await this.syncGiftBillsData(client, providerId);
        products.push(...dataProducts);

        return products;
      },
      { providerId, serviceTypeId },
    );
  }

  private async syncGiftBillsData(
    client: AxiosInstance,
    providerId: string,
  ): Promise<ProductData[]> {
    const products: ProductData[] = [];

    // GiftBills provider name → our DB service code
    const networkMapping: Record<string, string> = {
      MTN: "mtn-data",
      GLO: "glo-data",
      AIRTEL: "airtel-data",
      "9MOBILE": "9mobile-data",
    };

    for (const [networkName, serviceCode] of Object.entries(networkMapping)) {
      try {
        const response = await this.retryOperation(async () =>
          client.get(`/internet/plans/${networkName}`),
        );

        if (!response.data.success || response.data.code !== "00000") {
          logger.warn(`GiftBills: failed to fetch plans for ${networkName}`);
          continue;
        }

        const service = await Service.findOne({
          code: serviceCode,
          isActive: true,
        });
        if (!service) {
          logger.warn(
            `GiftBills data sync: service "${serviceCode}" not found in DB`,
          );
          continue;
        }

        const plans: any[] = response.data.data || [];

        for (const plan of plans) {
          // plan.id is what gets passed as plan_id on purchase
          const code = plan.id;
          const providerAmount = parseFloat(plan.amount) || 0;

          const { sizeInMB, displaySize } = this.parseDataSize(plan.name);
          const { validity, validityPeriod } = this.extractValidityFromText(
            plan.name,
          );
          const dataType = this.detectDataType(plan.name);

          products.push({
            serviceId: service.id.toString(),
            providerId,
            name: plan.name,
            code,
            logo: service.logo || "",
            providerAmount,
            amount: providerAmount,
            validity: validity || "",
            description: plan.name,
            isActive: true,
            dataSize: sizeInMB > 0 ? sizeInMB : 0,
            dataSizeDisplay: displaySize || "",
            productType: dataType,
            attributes: {
              dataType,
              validityPeriod: validityPeriod || "",
              planId: plan.id, // the actual ID used when calling purchase
              dataTypeId: plan.dataTypeId,
            },
          });
        }
      } catch (error: any) {
        logger.warn(
          `GiftBills: error fetching plans for ${networkName}: ${error.message}`,
        );
      }
    }

    logger.info(`GiftBills: fetched ${products.length} data products`);
    return products;
  }

  public async syncSaveHavenProducts(
    providerId: string,
    serviceTypeId?: string,
  ): Promise<ProductData[]> {
    return await this.executeSyncOperation(
      "SaveHaven Product Fetch",
      async () => {
        const products: ProductData[] = [];

        // Map of our DB service code → SafeHaven category ID
        // Only syncable categories (ones with fixed bundle products)
        const categoryMap: Record<
          string,
          { categoryId: string; serviceCode: string }
        > = {
          // DATA
          "mtn-data": {
            categoryId: "6502eb6e65463b201bf8065f",
            serviceCode: "mtn-data",
          },
          "glo-data": {
            categoryId: "61efad06da92348f9dde5fa1",
            serviceCode: "glo-data",
          },
          "airtel-data": {
            categoryId: "61efad12da92348f9dde5fa4",
            serviceCode: "airtel-data",
          },
          "9mobile-data": {
            categoryId: "61efad1dda92348f9dde5fa7",
            serviceCode: "9mobile-data",
          },

          // CABLE TV
          dstv: { categoryId: "61efad38da92348f9dde5faa", serviceCode: "dstv" },
          gotv: { categoryId: "61efad45da92348f9dde5fad", serviceCode: "gotv" },
          startimes: {
            categoryId: "61efad50da92348f9dde5fb0",
            serviceCode: "startimes",
          },
        };

        for (const [key, { categoryId, serviceCode }] of Object.entries(
          categoryMap,
        )) {
          try {
            const service = await Service.findOne({
              code: serviceCode,
              isActive: true,
            });
            if (!service) {
              logger.warn(
                `SaveHaven sync: service "${serviceCode}" not found in DB, skipping`,
              );
              continue;
            }

            // Filter by serviceTypeId if provided
            if (
              serviceTypeId &&
              service.serviceTypeId.toString() !== serviceTypeId
            ) {
              continue;
            }

            const categoryProducts =
              await this.saveHaveService.getVASCategoryProducts(categoryId);

            if (serviceCode.includes("-data")) {
              logger.info(`🔍 RAW ${key} PRODUCTS FROM SAFEHAVEN:`, {
                totalProducts: categoryProducts?.length || 0,
                products:
                  categoryProducts?.map((p: any) => ({
                    bundleCode: p.bundleCode,
                    name: p.name,
                    amount: p.amount,
                    isAmountFixed: p.isAmountFixed,
                    validity: p.validity,
                    duration: p.duration,
                  })) || [],
              });

              logger.info(`\n === ${key} BUNDLE CODES ===`);
              categoryProducts?.forEach((p: any) => {
                logger.info(
                  `  - Code: "${p.bundleCode}" | Name: "${p.name}" | Amount: ₦${p.amount}`,
                );
              });
              logger.info(` === END ${key} ===\n`);
            }
            for (const product of categoryProducts) {
              // Skip products with no fixed amount (e.g. Top Up)
              if (!product.isAmountFixed || product.amount === null) continue;

              const providerAmount = Number(product.amount) || 0;
              const productName = product.name || product.validity || "";

              const { validity, validityPeriod } = this.extractValidityFromText(
                product.duration || product.name || "",
              );

              const productData: ProductData = {
                serviceId: service.id.toString(),
                providerId,
                name: productName,
                code: product.bundleCode,
                logo: service.logo || "",
                providerAmount,
                amount: providerAmount,
                validity: validity || product.duration || "",
                description: product.name,
                isActive: true,
                attributes: {
                  bundleCode: product.bundleCode,
                  duration: product.duration,
                  isAmountFixed: product.isAmountFixed,
                  validityPeriod: validityPeriod || "",
                },
              };

              // Enrich data products
              if (serviceCode.includes("-data")) {
                const { sizeInMB, displaySize } =
                  this.parseDataSize(productName);
                // Data products must always carry dataSize/dataSizeDisplay
                // so the UI field is present even when we can't parse a size.
                productData.dataSize = sizeInMB > 0 ? sizeInMB : 0;
                productData.dataSizeDisplay = displaySize || "";
                productData.productType = this.detectDataType(productName);
                productData.attributes.dataType = productData.productType;
              }

              // Enrich cable TV products
              if (["dstv", "gotv", "startimes"].includes(serviceCode)) {
                productData.attributes.bouquetType = productName;
              }

              products.push(productData);
            }

            logger.info(
              `SaveHaven: fetched ${categoryProducts.length} products for ${key}`,
            );
          } catch (error: any) {
            logger.warn(
              `SaveHaven: failed to fetch products for ${key}: ${error.message}`,
            );
          }
        }

        logger.info(`SaveHaven: total ${products.length} products fetched`);
        return products;
      },
      { providerId, serviceTypeId },
    );
  }

  private async syncVtuNgProducts(
    providerId: string,
    serviceTypeId?: string,
  ): Promise<ProductData[]> {
    return await this.executeSyncOperation(
      "VTU.ng Product Fetch",
      async () => {
        const vtuNgClient = this.createVtuNgClient();
        const products: ProductData[] = [];

        const serviceQuery: any = { isActive: true };
        if (serviceTypeId) {
          serviceQuery.serviceTypeId = serviceTypeId;
        }

        const services = await Service.find(serviceQuery);

        const response = await this.retryOperation(async () =>
          vtuNgClient.get("/api/v2/variations/data"),
        );

        const variations = response.data?.data ?? [];

        if (response.data?.code !== "success" || !variations.length) {
          return products;
        }

        for (const service of services) {
          const serviceVariations = variations.filter(
            (v: any) =>
              v.service_id?.toLowerCase() === service.code?.toLowerCase(),
          );

          for (const variation of serviceVariations) {
            // VTU.ng marks some plans "Unavailable" — don't sync something
            // we can't actually sell right now
            if (variation.availability !== "Available") continue;

            products.push(this.mapVtuNgProduct(variation, service, providerId));
          }
        }

        return products;
      },
      { providerId, serviceTypeId },
    );
  }

  private mapVtuNgProduct(
    variation: any,
    service: any,
    providerId: string,
  ): ProductData {
    const providerAmount = Number(variation.price) || 0;

    const productData: ProductData = {
      serviceId: service.id.toString(),
      providerId,
      name: variation.data_plan,
      code: String(variation.variation_id),
      logo: service.logo || "",
      providerAmount,
      amount: providerAmount, // default, admin adjusts markup
      description: variation.data_plan,
      isActive: true,
      attributes: {},
    };

    const { sizeInMB, displaySize } = this.parseDataSize(variation.data_plan);
    productData.dataSize = sizeInMB > 0 ? sizeInMB : 0;
    productData.dataSizeDisplay = displaySize || "";
    productData.productType = this.detectDataType(variation.data_plan);
    productData.attributes.dataType = productData.productType;

    const { validity, validityPeriod } = this.extractValidityFromText(
      variation.data_plan,
    );
    productData.validity = validity || "";
    productData.attributes.validityPeriod = validityPeriod || "";

    return productData;
  }

  private createVtuNgClient(): AxiosInstance {
    return axios.create({
      baseURL: process.env.VTUNG_BASE_URL || "https://vtu.ng/wp-json",
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
  // Shared helpers

  private createVTPassClient(): AxiosInstance {
    const apiKey = process.env.VTPASS_API_KEY;
    const secretKey = process.env.VTPASS_SECRET_KEY;

    if (!apiKey || !secretKey) {
      throw new AppError(
        "VTPass credentials not found in environment",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.CONFIGURATION_ERROR,
      );
    }

    return axios.create({
      baseURL:
        process.env.VTPASS_BASE_URL || "https://api-service.vtpass.com/api",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
        "secret-key": secretKey,
      },
    });
  }

  private parseDataSize(text: string): {
    sizeInMB: number;
    displaySize: string;
  } {
    const gbMatch = text.match(/(\d+(?:\.\d+)?)\s*GB/i);
    const mbMatch = text.match(/(\d+(?:\.\d+)?)\s*MB/i);

    if (gbMatch) {
      const gb = parseFloat(gbMatch[1]);
      return { sizeInMB: gb * 1024, displaySize: `${gb}GB` };
    }

    if (mbMatch) {
      const mb = parseFloat(mbMatch[1]);
      return { sizeInMB: mb, displaySize: `${mb}MB` };
    }

    return { sizeInMB: 0, displaySize: "" };
  }

  private extractValidityFromText(text: string): {
    validity: string;
    validityPeriod: string;
  } {
    // 1. Numeric + unit (e.g. "30 Days", "1Day", "3Days", "24 Hours", "1 month")
    const numericMatch = text.match(
      /(\d+)\s*(hour|hours|day|days|week|weeks|month|months|year|years)/i,
    );

    if (numericMatch) {
      const value = parseInt(numericMatch[1]);
      const unit = numericMatch[2].toLowerCase();

      if (unit.startsWith("hour")) {
        // All hour-based plans (e.g. GiftBills "24 Hours") are daily
        return { validity: "1 day", validityPeriod: "daily" };
      }
      if (unit.startsWith("day")) {
        return {
          validity: `${value} day${value > 1 ? "s" : ""}`,
          validityPeriod:
            value <= 1 ? "daily" : value <= 7 ? "weekly" : "monthly",
        };
      }
      if (unit.startsWith("week")) {
        return {
          validity: `${value} week${value > 1 ? "s" : ""}`,
          validityPeriod: "weekly",
        };
      }
      if (unit.startsWith("month")) {
        return {
          validity: `${value} month${value > 1 ? "s" : ""}`,
          validityPeriod: "monthly",
        };
      }
      if (unit.startsWith("year")) {
        return {
          validity: `${value} year${value > 1 ? "s" : ""}`,
          validityPeriod: "yearly",
        };
      }
    }

    // 2. Word-only pattern (e.g. VTPass "Monthly Bundle", "Weekly Plan")
    const wordMatch = text.match(/\b(daily|weekly|monthly|yearly)\b/i);
    if (wordMatch) {
      const period = wordMatch[1].toLowerCase() as string;
      const wordMap: Record<
        string,
        { validity: string; validityPeriod: string }
      > = {
        daily: { validity: "1 day", validityPeriod: "daily" },
        weekly: { validity: "1 week", validityPeriod: "weekly" },
        monthly: { validity: "1 month", validityPeriod: "monthly" },
        yearly: { validity: "1 year", validityPeriod: "yearly" },
      };
      return wordMap[period];
    }

    return { validity: "", validityPeriod: "" };
  }

  private detectDataType(text: string): string {
    const t = text.toLowerCase();
    if (t.includes("sme")) return "SME";
    if (t.includes("corporate")) return "CORPORATE GIFTING";
    if (t.includes("gifting")) return "GIFTING";
    if (t.includes("coupon")) return "DIRECT COUPON";
    if (t.includes("awoof")) return "AWOOF DATA";
    if (t.includes("direct")) return "DIRECT";
    return "DIRECT";
  }

  private async invalidateProductCachesAfterSync(
    providerId: string,
  ): Promise<void> {
    try {
      // Get all service types this provider is linked to
      const serviceTypeProviders = await ServiceTypeProvider.find({
        providerId: new Types.ObjectId(providerId),
      }).populate<{ serviceTypeId: { code: string } }>("serviceTypeId");

      const serviceTypeCodes = serviceTypeProviders
        .map((stp) => (stp.serviceTypeId as any)?.code)
        .filter(Boolean);

      const uniqueCodes = [...new Set(serviceTypeCodes)];

      await Promise.all([
        // Pattern deletes — catch-all for any serviceId or dataType combination
        this.cacheService.deletePattern(`products:service:*`),
        this.cacheService.deletePattern(`products:data:all-active:*`),
        this.cacheService.deletePattern(`data:types:by-service-code:*`),

        // Delete per service type code
        ...uniqueCodes.flatMap((code) => [
          this.cacheService.delete(CACHE_KEYS.PRODUCTS_BY_TYPE(code)),
          this.cacheService.delete(CACHE_KEYS.SERVICES_BY_TYPE(code)),
        ]),

        // Global product/data caches
        this.cacheService.delete(CACHE_KEYS.PRODUCTS),
        this.cacheService.delete(CACHE_KEYS.DATA_TYPES),
        this.cacheService.delete(CACHE_KEYS.DATA_ACTIVE_PROVIDER_IDS),
      ]);

      logger.info(
        `Product caches invalidated after sync for provider ${providerId}`,
        {
          serviceTypeCodes: uniqueCodes,
        },
      );
    } catch (error: any) {
      logger.error(`Failed to invalidate product caches after sync`, {
        error: error.message,
        providerId,
      });
    }
  }

  private async invalidateCryptoCachesAfterSync(
    providerId: string,
  ): Promise<void> {
    try {
      await Promise.all([
        // Invalidate crypto-specific caches
        this.cacheService.deletePattern(`crypto:*`),
        this.cacheService.deletePattern(`cryptos:*`),
        this.cacheService.delete(CACHE_KEYS.NOWPAYMENTS_AVAILABLE_CURRENCIES),
      ]);

      logger.info(`Crypto caches invalidated after NowPayments sync`, {
        providerId,
      });
    } catch (error: any) {
      logger.error(
        `Failed to invalidate crypto caches after NowPayments sync`,
        {
          error: error.message,
          providerId,
        },
      );
    }
  }
}
