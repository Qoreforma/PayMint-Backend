import { BaseSyncService } from "./BaseSyncService";
import { GiftCardRepository } from "@/repositories/shared/GiftCardRepository";
import { GiftCardCategoryRepository } from "@/repositories/shared/GiftCardCategoryRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Types } from "mongoose";
import logger from "@/logger";
import { ProviderService } from "../client/ProviderService";
import ServiceContainer from "../client/container";
import { ReloadlyService } from "../client/providers/giftcard/ReloadlyService";

interface SyncResult {
  success: boolean;
  provider: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  created: number;
  updated: number;
  failed: number;
  deleted: number;
  total: number;
  errors: string[];
}

// Known country names and ISO2 codes used for stripping from product names
// to extract brand names when brand.brandName is not available
const COUNTRY_ISO2_CODES = new Set([
  "AF",
  "AL",
  "DZ",
  "AS",
  "AI",
  "AO",
  "AR",
  "AM",
  "AU",
  "AT",
  "AZ",
  "BS",
  "BH",
  "BD",
  "BB",
  "BY",
  "BE",
  "BZ",
  "BJ",
  "BT",
  "BO",
  "BA",
  "BW",
  "BR",
  "BN",
  "BG",
  "BF",
  "BI",
  "CV",
  "KH",
  "CM",
  "CA",
  "CF",
  "TD",
  "CL",
  "CN",
  "CO",
  "KM",
  "CG",
  "CD",
  "CR",
  "CI",
  "HR",
  "CU",
  "CY",
  "CZ",
  "DK",
  "DJ",
  "DM",
  "DO",
  "EC",
  "EG",
  "SV",
  "GQ",
  "ER",
  "EE",
  "SZ",
  "ET",
  "FJ",
  "FI",
  "FR",
  "GA",
  "GM",
  "GE",
  "DE",
  "GH",
  "GR",
  "GD",
  "GT",
  "GN",
  "GW",
  "GY",
  "HT",
  "HN",
  "HU",
  "IS",
  "IN",
  "ID",
  "IR",
  "IQ",
  "IE",
  "IL",
  "IT",
  "JM",
  "JP",
  "JO",
  "KZ",
  "KE",
  "KI",
  "KP",
  "KR",
  "KW",
  "KG",
  "LA",
  "LV",
  "LB",
  "LS",
  "LR",
  "LY",
  "LI",
  "LT",
  "LU",
  "MG",
  "MW",
  "MY",
  "MV",
  "ML",
  "MT",
  "MH",
  "MR",
  "MU",
  "MX",
  "FM",
  "MD",
  "MC",
  "MN",
  "ME",
  "MA",
  "MZ",
  "MM",
  "NA",
  "NR",
  "NP",
  "NL",
  "NZ",
  "NI",
  "NE",
  "NG",
  "MK",
  "NO",
  "OM",
  "PK",
  "PW",
  "PA",
  "PG",
  "PY",
  "PE",
  "PH",
  "PL",
  "PT",
  "QA",
  "RO",
  "RU",
  "RW",
  "KN",
  "LC",
  "VC",
  "WS",
  "SM",
  "ST",
  "SA",
  "SN",
  "RS",
  "SC",
  "SL",
  "SG",
  "SK",
  "SI",
  "SB",
  "SO",
  "ZA",
  "SS",
  "ES",
  "LK",
  "SD",
  "SR",
  "SE",
  "CH",
  "SY",
  "TW",
  "TJ",
  "TZ",
  "TH",
  "TL",
  "TG",
  "TO",
  "TT",
  "TN",
  "TR",
  "TM",
  "TV",
  "UG",
  "UA",
  "AE",
  "GB",
  "US",
  "UY",
  "UZ",
  "VU",
  "VE",
  "VN",
  "YE",
  "ZM",
  "ZW",
]);

// Suffixes that indicate a country-specific variant — strip these from brand name extraction
const COUNTRY_NAME_SUFFIXES = [
  "united states",
  "united kingdom",
  "united arab emirates",
  "saudi arabia",
  "south africa",
  "new zealand",
  "netherlands",
  "germany",
  "france",
  "italy",
  "spain",
  "portugal",
  "austria",
  "belgium",
  "finland",
  "poland",
  "greece",
  "ireland",
  "cyprus",
  "romania",
  "hungary",
  "czech",
  "sweden",
  "norway",
  "denmark",
  "switzerland",
  "australia",
  "canada",
  "brazil",
  "mexico",
  "argentina",
  "colombia",
  "chile",
  "peru",
  "nigeria",
  "ghana",
  "kenya",
  "egypt",
  "philippines",
  "indonesia",
  "malaysia",
  "singapore",
  "thailand",
  "vietnam",
  "india",
  "pakistan",
  "bangladesh",
  "afghanistan",
  "albania",
  "algeria",
  "angola",
  "anguilla",
  "american samoa",
];

// Words that are part of the brand but look like they could be stripped — keep them
const BRAND_PRESERVE_WORDS = new Set([
  "store",
  "live",
  "online",
  "plus",
  "pass",
  "card",
  "now",
  "go",
  "one",
  "max",
  "pro",
  "ultimate",
  "premium",
  "gold",
  "platinum",
  "standard",
  "basic",
  "mini",
  "lite",
  "mobile",
  "global",
  "digital",
  "prepaid",
  "eshop",
  "play",
  "game",
  "games",
]);

export class GiftCardSyncService extends BaseSyncService {
  private giftCardRepository: GiftCardRepository;
  private giftCardCategoryRepository: GiftCardCategoryRepository;
  private providerService: ProviderService;
  private reloadlyService: ReloadlyService;

  constructor() {
    super();
    this.giftCardRepository = new GiftCardRepository();
    this.giftCardCategoryRepository = new GiftCardCategoryRepository();
    this.providerService = ServiceContainer.getProviderService();
    this.reloadlyService = ServiceContainer.getReloadlyService();
  }

  async syncAllProviders(): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    try {
      const Provider = require("@/models/reference/Provider").Provider;
      const providers = await Provider.find({
        isActive: true,
        code: "reloadly",
      });

      for (const provider of providers) {
        try {
          logger.info(
            `🔄 Starting sync for provider: ${provider.name} (${provider._id})`,
          );
          const result = await this.syncGiftCardsFromProvider(
            provider._id.toString(),
          );
          results.push(result);
          logger.info(` Sync completed for ${provider.name}`);
        } catch (error: any) {
          logger.error(
            `❌ Sync failed for provider ${provider.name}: ${error.message}`,
          );
          results.push({
            success: false,
            provider: provider.name,
            startTime: new Date(),
            endTime: new Date(),
            duration: 0,
            created: 0,
            updated: 0,
            failed: 0,
            deleted: 0,
            total: 0,
            errors: [error.message],
          });
        }
      }
    } catch (error: any) {
      logger.error(`❌ Critical error in syncAllProviders: ${error.message}`);
    }

    return results;
  }

  // Main product sync — now also handles category/group creation internally
  async syncGiftCardsFromProvider(
    providerId: string,
    filters?: {
      countryCode?: string;
      categoryId?: number;
    },
  ): Promise<SyncResult> {
    const startTime = new Date();

    return await this.executeSyncOperation(
      "Gift Card Product Sync",
      async () => {
        const provider = await this.getProviderById(providerId);

        if (provider.code.toLowerCase() !== "reloadly") {
          throw new AppError(
            `Provider ${provider.code} not supported for sync`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.UNSUPPORTED_OPERATION,
          );
        }

        logger.info(`📦 Fetching products from ${provider.name}...`);

        const products =
          await this.providerService.getGiftCardProducts(filters);
        const totalProducts = products.content?.length || 0;
        logger.log(totalProducts, "total reloadly products");

        if (totalProducts === 0) {
          logger.warn(`⚠️  No products returned from ${provider.name}`);
          return this.buildSyncResult(provider.name, startTime, {
            created: 0,
            updated: 0,
            failed: 0,
            total: 0,
          });
        }

        logger.info(`📥 Processing ${totalProducts} products...`);

        const result = await this.processBatch(
          products.content || [],
          50,
          async (product) => await this.syncSingleProduct(product, providerId),
          (processed, total) => {
            const percent = Math.round((processed / total) * 100);
            logger.info(
              `📊 Sync progress: ${processed}/${total} (${percent}%)`,
            );
          },
        );

        let created = 0;
        let updated = 0;
        for (const syncedProduct of result.successful) {
          if (syncedProduct.isNew) {
            created++;
          } else {
            updated++;
          }
        }

        await this.updateProviderSyncTime(providerId);

        const errors = result.failed.map((f) => ({
          id: (f.item as any).productId,
          error: f.error,
        }));

        if (errors.length > 0) {
          logger.warn(`⚠️  ${errors.length} products failed to sync`);
          errors.slice(0, 5).forEach((err) => {
            logger.warn(`  - Product ${err.id}: ${err.error}`);
          });
        }

        return this.buildSyncResult(
          provider.name,
          startTime,
          {
            created,
            updated,
            failed: result.failed.length,
            total: totalProducts,
          },
          errors,
        );
      },
      { providerId, filters },
    );
  }

  private async syncSingleProduct(
    product: any,
    providerId: string,
  ): Promise<{ product: any; isNew: boolean }> {
    try {
      if (!product.senderCurrencyCode || product.senderCurrencyCode !== "USD") {
        const errorMsg = `Product ${product.productName} has invalid sender currency: ${product.senderCurrencyCode}. Only USD is supported.`;
        logger.warn(`⚠️  SKIPPING PRODUCT: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      if (!product.recipientCurrencyCode) {
        const errorMsg = `Product ${product.productName} has no recipient currency code.`;
        logger.warn(`⚠️  SKIPPING PRODUCT: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      if (
        !product.recipientCurrencyToSenderCurrencyExchangeRate ||
        product.recipientCurrencyToSenderCurrencyExchangeRate <= 0
      ) {
        const errorMsg = `Product ${product.productName} has invalid exchange rate: ${product.recipientCurrencyToSenderCurrencyExchangeRate}`;
        logger.warn(`⚠️  SKIPPING PRODUCT: ${errorMsg}`);
        throw new Error(errorMsg);
      }
      // Brand group mapping (replaces old mapProviderCategory)
      const category = await this.mapOrCreateBrandGroup(product, providerId);

      if (!category) {
        throw new Error(
          `Could not resolve brand group for product: ${product.productName}`,
        );
      }

      // Country mapping with fallback
      let countryId = null;

      if (product.country?.isoName) {
        countryId = await this.mapProviderCountry(product.country.isoName);
      }

      if (!countryId && product.recipientCurrencyCode) {
        const country = await this.mapCountryByCurrency(
          product.recipientCurrencyCode,
        );
        if (country) countryId = country._id;
      }

      if (!countryId && product.senderCurrencyCode) {
        const country = await this.mapCountryByCurrency(
          product.senderCurrencyCode,
        );
        if (country) countryId = country._id;
      }

      const productId = product.productId.toString();

      const existingProduct = await this.giftCardRepository.findOne({
        productId,
        countryId: countryId ? new Types.ObjectId(countryId) : null,
      });

      const productData: any = {
        categoryId: category._id,
        productId,
        name: product.productName,
        logo:
          product.logoUrls?.[0] ||
          product.brand?.brandLogoUrls?.[0] ||
          product.brand?.brandName,
        countryId: countryId ? new Types.ObjectId(countryId) : null,
        type: "buy" as const,
        cardType: "e-code",

        currency: product.recipientCurrencyCode,
        senderCurrency: product.senderCurrencyCode || "NGN",
        exchangeRate: await this.calculateInitialNgnRate(product),
        buyRate: await this.calculateInitialNgnRate(product),

        sellRate: null,
        senderFee: product.senderFee,
        senderFeePercentage: product.senderFeePercentage,
        discountPercentage: product.discountPercentage,

        denominationType: product.denominationType as "RANGE" | "FIXED",

        buyMinAmount: product.minRecipientDenomination,
        buyMaxAmount: product.maxRecipientDenomination,
        minAmountNgn: product.minSenderDenomination,
        maxAmountNgn: product.maxSenderDenomination,
        sellMinAmount: null,
        sellMaxAmount: null,

        priceList: product.fixedRecipientDenominations,
        ngnPriceList: product.fixedSenderDenominations,
        mappedPriceList: product.fixedRecipientToSenderDenominationsMap,

        redeemInstructions: product.redeemInstruction
          ? {
              concise: product.redeemInstruction.concise,
              verbose: product.redeemInstruction.verbose,
            }
          : undefined,

        purchaseActivated: true,
        saleActivated: false,
        isActive: true,

        rateLastUpdated: new Date(),
        rateSource: "reloadly",
      };

      let savedProduct;
      let isNew = false;

      if (existingProduct) {
        savedProduct = await this.giftCardRepository.update(
          existingProduct.id.toString(),
          productData,
        );
      } else {
        savedProduct = await this.giftCardRepository.create(productData);
        isNew = true;
      }

      return { product: savedProduct, isNew };
    } catch (error: any) {
      throw new Error(
        `Failed to sync product ${product.productId}: ${error.message}`,
      );
    }
  }

  private async calculateInitialNgnRate(product: any): Promise<number> {
    try {
      // Get Reloadly's USD-based rate
      const reloadlyUsdRate =
        product.recipientCurrencyToSenderCurrencyExchangeRate;

      if (!reloadlyUsdRate || reloadlyUsdRate <= 0) {
        throw new Error(`Invalid Reloadly rate: ${reloadlyUsdRate}`);
      }

      // Get a sample amount to calculate rate
      // Use first denomination if available
      let sampleAmount = 1;
      if (product.fixedRecipientDenominations?.length > 0) {
        sampleAmount = product.fixedRecipientDenominations[0];
      } else if (product.minRecipientDenomination) {
        sampleAmount = product.minRecipientDenomination;
      }

      // Call FX to get current rate
      const fxData = await this.reloadlyService.getGiftCardFxRate(
        product.recipientCurrencyCode,
        sampleAmount,
      );

      // Get USD→NGN rate

      const usdToNgnFx = await this.reloadlyService.getGiftCardFxRate(
        "NGN",
        100,
      );

      // fxData.senderAmount = 0.07148 USD (cost of 100 NGN)
      const usdToNgnRate = 100 / usdToNgnFx.senderAmount;

      // Calculate: sampleAmount currency = X USD = X*usdToNgnRate NGN
      const ngnCost = fxData.senderAmount * usdToNgnRate;
      const exchangeRate = ngnCost / sampleAmount;

      logger.info(`Initial rate calculated for ${product.productName}:`, {
        currency: product.recipientCurrencyCode,
        reloadlyUsdRate,
        sampleAmount,
        usdCost: fxData.senderAmount,
        usdToNgnRate,
        ngnCost,
        exchangeRate,
      });

      return exchangeRate;
    } catch (error: any) {
      logger.error(
        `Failed to calculate initial NGN rate for ${product.productName} — no rate available, skipping sync for this product`,
        error.message,
      );

      // No hardcoded FX fallback. If we can't get a real rate, this
      // product should NOT go live priced off a guessed number.
      throw new Error(
        `Cannot set initial rate for ${product.productName}: ${error.message}`,
      );
    }
  }

  // Resolves or creates a GiftCardCategory acting as a brand group.
  // Priority:
  //  1. product.brand.brandName  (Reloadly's own brand classification — most reliable)
  //  2. Extracted brand from product name (strip ISO2 suffix / country name suffix)
  private async mapOrCreateBrandGroup(
    product: any,
    providerId: string,
  ): Promise<any> {
    const brandName = this.extractBrandName(product);
    const logo =
      product.brand?.brandLogoUrls?.[0] || product.logoUrls?.[0] || null;
    const productName: string = product.productName;

    // Try to find existing group by brandName + providerId
    let category = await this.giftCardCategoryRepository.findOne({
      brandName: {
        $regex: new RegExp(`^${this.escapeRegex(brandName)}$`, "i"),
      },
      isAutoGroup: true,
      providerId: new Types.ObjectId(providerId),
      deletedAt: null,
    });

    if (category) {
      // Update: add keyword if new, fill logo if missing
      const needsKeywordUpdate = !category.keywords.includes(productName);
      const needsLogoUpdate = !category.groupLogo && logo;

      if (needsKeywordUpdate || needsLogoUpdate) {
        const updateData: any = {};
        if (needsKeywordUpdate) {
          updateData.keywords = [...category.keywords, productName];
        }
        if (needsLogoUpdate) {
          updateData.groupLogo = logo;
        }
        category = await this.giftCardCategoryRepository.update(
          category.id,
          updateData,
        );
      }

      return category;
    }

    logger.info(`🆕 Creating new brand group: "${brandName}"`);
    category = await this.giftCardCategoryRepository.create({
      providerId: new Types.ObjectId(providerId),
      name: brandName,
      brandName: brandName,
      isAutoGroup: true,
      groupLogo: logo || undefined,
      icon: logo || undefined,
      keywords: [productName],
      transactionType: "buy" as const,
      purchaseActivated: true,
      saleActivated: false,
      isGlobal: false,
      countries: [],
      isActive: true,
    });

    return category;
  }

  // Extracts a canonical brand name from the Reloadly product object.
  // Priority:
  //  1. product.brand.brandName  → use as-is
  //  2. Strip known country ISO2 suffix (e.g. "Jawaker AL" → "Jawaker")
  //  3. Strip known country name suffix (e.g. "Smartbox Italy" → "Smartbox")
  //  4. Fallback: return productName as-is (cleaned up)
  // Examples:
  //  "PlayStation Spain"        → "PlayStation"
  //  "PlayStation Store IT"     → "PlayStation Store"
  //  "PUBG Mobile UC AF"        → "PUBG Mobile UC"
  //  "World of Warcraft 60 days"→ "World of Warcraft 60 days"  (no country suffix)
  //  "Nintendo eShop Card UK"   → "Nintendo eShop Card"
  //  "Xbox US"                  → "Xbox"
  //  "Xbox Live"                → "Xbox Live"  (Live is a brand word, not a country)
  //  "Jawaker AL"               → "Jawaker"
  private extractBrandName(product: any): string {
    // Priority 1: Reloadly's own brand classification
    if (product.brand?.brandName && product.brand.brandName.trim()) {
      return product.brand.brandName.trim();
    }

    const rawName: string = (product.productName || "").trim();

    // Priority 2: Strip trailing ISO2 code (e.g. "Jawaker AL", "Xbox US", "PlayStation FI")
    // Pattern: ends with space + 2 uppercase letters that are a known ISO2
    const iso2Match = rawName.match(/^(.+?)\s+([A-Z]{2})$/);
    if (iso2Match) {
      const potentialIso2 = iso2Match[2];
      if (COUNTRY_ISO2_CODES.has(potentialIso2)) {
        return iso2Match[1].trim();
      }
    }

    // Priority 3: Strip trailing country name (e.g. "Smartbox Italy", "Smartbox Spain")
    const lowerName = rawName.toLowerCase();
    for (const countryName of COUNTRY_NAME_SUFFIXES) {
      if (lowerName.endsWith(` ${countryName}`)) {
        const stripped = rawName
          .slice(0, rawName.length - countryName.length - 1)
          .trim();
        if (stripped.length > 0) {
          return stripped;
        }
      }
    }

    // Priority 4: No match — return name as-is
    return rawName;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async cleanupOrphanedProducts(providerId: string): Promise<SyncResult> {
    const startTime = new Date();

    return await this.executeSyncOperation(
      "Gift Card Cleanup",
      async () => {
        const provider = await this.getProviderById(providerId);

        logger.info(
          `🧹 Checking for orphaned products from ${provider.name}...`,
        );

        const providerProducts =
          await this.providerService.getGiftCardProducts();
        const providerProductIds = (providerProducts.content || []).map(
          (p: any) => p.productId.toString(),
        );

        const categories = await this.giftCardCategoryRepository.find({
          providerId: new Types.ObjectId(providerId),
        });
        const categoryIds = categories.map((c) => c._id);

        const orphanedProducts = await this.giftCardRepository.find({
          categoryId: { $in: categoryIds },
          productId: { $nin: providerProductIds },
          deletedAt: null,
        });

        logger.info(
          `Found ${orphanedProducts.length} orphaned products to delete`,
        );

        let deleted = 0;
        for (const product of orphanedProducts) {
          await this.giftCardRepository.softDelete(product.id.toString());
          deleted++;
        }

        if (deleted > 0) {
          logger.info(` Soft deleted ${deleted} orphaned products`);
        }

        return this.buildSyncResult(provider.name, startTime, {
          deleted,
          total: orphanedProducts.length,
        });
      },
      { providerId },
    );
  }

  // syncCategoriesFromProvider is intentionally not removed so existing
  // code that references it (e.g. syncImmediately) compiles.
  // It is simply not scheduled anymore.
  async syncCategoriesFromProvider(providerId: string): Promise<SyncResult> {
    logger.info(
      "⚠️  syncCategoriesFromProvider called — categories are now managed by product sync (brand grouping). Skipping.",
    );
    const provider = await this.getProviderById(providerId);
    return this.buildSyncResult(provider.name, new Date(), {
      created: 0,
      updated: 0,
      failed: 0,
      total: 0,
    });
  }

  private async mapProviderCountry(isoCode: string): Promise<string | null> {
    try {
      const Country = require("@/models/reference/Country").Country;
      const country = await Country.findOne({
        $or: [{ iso2: isoCode.toUpperCase() }, { iso3: isoCode.toUpperCase() }],
      });
      return country?._id.toString() || null;
    } catch (error: any) {
      logger.debug(`Country not found for ISO: ${isoCode}`);
      return null;
    }
  }

  private async mapCountryByCurrency(
    currencyCode: string,
  ): Promise<any | null> {
    try {
      const Country = require("@/models/reference/Country").Country;
      const country = await Country.findOne({
        currency: currencyCode.toUpperCase(),
      });
      return country || null;
    } catch (error: any) {
      logger.debug(`Country not found for currency: ${currencyCode}`);
      return null;
    }
  }

  private async getProviderById(providerId: string): Promise<any> {
    const Provider = require("@/models/reference/Provider").Provider;
    const provider = await Provider.findById(providerId);

    if (!provider) {
      throw new AppError(
        "Provider not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (!provider.isActive) {
      throw new AppError(
        "Provider is not active",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    return provider;
  }

  private async updateProviderSyncTime(providerId: string): Promise<void> {
    try {
      const Provider = require("@/models/reference/Provider").Provider;
      await Provider.findByIdAndUpdate(providerId, {
        lastSyncedAt: new Date(),
      });
    } catch (error: any) {
      logger.warn(`Failed to update provider sync time: ${error.message}`);
    }
  }
}
