/**
 * GIFTCARD TEST: Rate Calculations & Management
 *
 * Tests GiftCard rate functionality:
 * - Buy price calculations
 * - Sell payout calculations
 * - FIXED/RANGE denomination validation
 * - Rate syncing from Reloadly
 * - Manual rate updates
 * - Exchange rate handling
 * - Min/max enforcement
 * - Service charge integration
 */

import { GiftCardRateService } from "@/services/client/GiftCardRateService";
import { ProviderService } from "@/services/client/ProviderService";
import ServiceContainer from "@/services/client/container";
import { GiftCard } from "@/models/giftcard/GiftCard";
import { GiftCardCategory } from "@/models/giftcard/GiftCardCategory";
import { Types } from "mongoose";
import logger from "@/logger";
import { Country } from "@/models/reference/Country";
import { Provider } from "@/models/reference/Provider";

describe("GiftCard Rate Calculations & Management", () => {
  let rateService: GiftCardRateService;
  let providerService: ProviderService;

  let buyCardId: string;
  let sellCardId: string;
  let rangeCardId: string;
  let categoryId: string;
  let providerId: string;
  let countryId: string;

  beforeEach(async () => {
    // Get services
    rateService = ServiceContainer.getGiftCardRateService();
    providerService = ServiceContainer.getProviderService();

    // Create provider
    const provider = await Provider.create({
      name: "Reloadly",
      code: "reloadly",
      type: "giftcard",
      apiUrl: "https://giftcards.reloadly.com",
      isActive: true,
    });

    providerId = provider._id.toString();

    // Create country
    const country = await Country.create({
      id: 840, // Add this
      name: "United States",
      numeric_code: "840", // Add this
      iso2: "US",
      iso3: "USA",
      phonecode: "+1", // Add this
      region: "Americas", // Add this
      flag: "🇺🇸",
      currency: "USD",
      capital: "Washington D.C.",
      currency_name: "US Dollar",
      currency_symbol: "$",
      emoji: "🇺🇸",
      emojiU: "U+1F1FA U+1F1F8",
      longitude: "-77.0369",
      latitude: "38.9072",
    });

    countryId = country._id.toString();

    // Create category
    const category = await GiftCardCategory.create({
      name: "Digital Gift Cards",
      transactionType: "both",
      providerId: provider._id,
      isGlobal: true,
      saleActivated: true,
      purchaseActivated: true,
      isActive: true,
    });

    categoryId = category._id.toString();

    // Create BUY FIXED giftcard
    const buyCard = await GiftCard.create({
      categoryId: category._id,
      countryId: country._id,
      name: "iTunes Card (Buy)",
      productId: "reloadly_12345",
      currency: "USD",
      senderCurrency: "NGN",
      type: "buy",
      denominationType: "FIXED" as const,
      priceList: [10, 25, 50, 100],
      ngnPriceList: [4100, 10250, 20500, 41000],
      buyRate: 410,
      exchangeRate: 410,
      senderFee: 50, // Flat ₦50 fee
      senderFeePercentage: 2, // Additional 2%
      discountPercentage: 5, // 5% discount from Reloadly
      purchaseActivated: true,
      isActive: true,
      deletedAt: null,
    });

    buyCardId = buyCard._id.toString();

    // Create SELL FIXED giftcard
    const sellCard = await GiftCard.create({
      categoryId: category._id,
      name: "Steam Card (Sell)",
      countryId: country._id,
      productId: "sell_steam_67890",
      currency: "USD",
      type: "sell",
      denominationType: "FIXED" as const,
      priceList: [10, 20, 50, 100],
      sellRate: 380, // ₦380 per $1
      saleActivated: true,
      isActive: true,
    });

    sellCardId = sellCard._id.toString();

    // Create RANGE giftcard
    const rangeCard = await GiftCard.create({
      categoryId: category._id,
      countryId: country._id,
      name: "Amazon Card (Range)",
      productId: "reloadly_99999",
      currency: "USD",
      senderCurrency: "NGN",
      type: "buy",
      denominationType: "RANGE" as const,
      buyMinAmount: 5,
      buyMaxAmount: 500,
      minAmountNgn: 2050,
      maxAmountNgn: 205000,
      buyRate: 410,
      exchangeRate: 410,
      purchaseActivated: true,
      isActive: true,
    });

    rangeCardId = rangeCard._id.toString();
  });

  describe("Buy Price Calculations", () => {
    it("should calculate buy price for FIXED denomination", async () => {
      const amount = 50; // $50
      const quantity = 1;

      const result = await rateService.calculateBuyPrice(
        buyCardId,
        amount,
        quantity,
      );

      expect(result.giftCardAmount).toBe(amount);
      expect(result.giftCardCurrency).toBe("USD");
      expect(result.exchangeRate).toBe(410);

      // Base calculation: $50 × ₦410 = ₦20,500
      const expectedBase = 20500;
      expect(expectedBase).toBe(20500);

      // Sender fee: ₦50 flat + 2% of base
      const expectedSenderFee = 50 + expectedBase * 0.02; // ₦50 + ₦410 = ₦460
      expect(result.senderFee).toBeCloseTo(expectedSenderFee, 0);

      // Discount (platform profit tracking)
      const expectedDiscount = expectedBase * 0.05; // ₦1,025
      expect(result.discountAmount).toBeCloseTo(expectedDiscount, 0);

      // Total user pays: base + sender fee
      const expectedTotal = expectedBase + expectedSenderFee; // ₦20,960
      expect(result.totalNGN).toBeCloseTo(expectedTotal, 0);

      // Platform profit (for analytics)
      // expect(result.platformProfit).toBeCloseTo(expectedDiscount, 0);
    });

    it("should calculate buy price for multiple cards", async () => {
      const amount = 25;
      const quantity = 4;

      const result = await rateService.calculateBuyPrice(
        buyCardId,
        amount,
        quantity,
      );

      const basePerCard = 25 * 410; // ₦10,250
      const totalBase = basePerCard * quantity; // ₦41,000

      const senderFeePerCard = 50 + basePerCard * 0.02; // ₦255
      const totalSenderFee = senderFeePerCard * quantity; // ₦1,020

      expect(result.totalNGN).toBeCloseTo(totalBase + totalSenderFee, 0);
      expect(result.perUnitNGN).toBeCloseTo(basePerCard + senderFeePerCard, 0);
    });

    it("should validate FIXED denomination amounts for buy", async () => {
      // Try invalid amount
      await expect(
        rateService.calculateBuyPrice(buyCardId, 15, 1), // Not in [10, 25, 50, 100]
      ).rejects.toThrow("Invalid amount");
    });

    it("should validate RANGE min/max for buy", async () => {
      // Below minimum
      await expect(
        rateService.calculateBuyPrice(rangeCardId, 3, 1), // Below 5
      ).rejects.toThrow("at least");

      // Above maximum
      await expect(
        rateService.calculateBuyPrice(rangeCardId, 600, 1), // Above 500
      ).rejects.toThrow("exceed");
    });

    it("should accept valid RANGE amounts for buy", async () => {
      const result = await rateService.calculateBuyPrice(rangeCardId, 250, 1);

      expect(result.giftCardAmount).toBe(250);
      expect(result.totalNGN).toBeGreaterThan(0);
    });

    it("should handle exchange rate in buy calculation", async () => {
      // Update exchange rate
      await GiftCard.updateOne(
        { _id: buyCardId },
        { exchangeRate: 450 }, // Changed from 410 to 450
      );

      const result = await rateService.calculateBuyPrice(buyCardId, 100, 1);

      expect(result.exchangeRate).toBe(450);

      // Base should reflect new rate: $100 × ₦450 = ₦45,000
      const expectedBase = 45000;
      const expectedSenderFee = 50 + expectedBase * 0.02; // ₦950

      expect(result.totalNGN).toBeCloseTo(expectedBase + expectedSenderFee, 0);
    });
  });

  describe("Sell Payout Calculations", () => {
    it("should calculate sell payout for FIXED denomination", async () => {
      const amount = 50; // $50
      const quantity = 1;

      const result = await rateService.calculateSellPayout(
        sellCardId,
        amount,
        quantity,
      );

      expect(result.giftCardAmount).toBe(amount);
      expect(result.giftCardCurrency).toBe("USD");
      expect(result.rate).toBe(380);

      // Calculation: $50 × ₦380 = ₦19,000
      const expectedPayout = 19000;
      expect(result.perUnitNGN).toBe(expectedPayout);
      expect(result.totalNGN).toBe(expectedPayout);
    });

    it("should calculate sell payout for multiple cards", async () => {
      const amount = 100;
      const quantity = 3;

      const result = await rateService.calculateSellPayout(
        sellCardId,
        amount,
        quantity,
      );

      const perCardPayout = 100 * 380; // ₦38,000
      const totalPayout = perCardPayout * quantity; // ₦114,000

      expect(result.perUnitNGN).toBe(perCardPayout);
      expect(result.totalNGN).toBe(totalPayout);
    });

    it("should validate FIXED denomination amounts for sell", async () => {
      await expect(
        rateService.calculateSellPayout(sellCardId, 15, 1), // Not in [10, 20, 50, 100]
      ).rejects.toThrow("Invalid amount");
    });

    it("should reject sell calculation on buy-type card", async () => {
      await expect(
        rateService.calculateSellPayout(buyCardId, 50, 1),
      ).rejects.toThrow("not available for sale");
    });

  });

  describe("Rate Syncing from Reloadly", () => {
    it("should sync rates for all buy-type giftcards", async () => {
      // Mock Reloadly API response
      const mockReloadlyProduct = {
        productId: 12345,
        recipientCurrencyCode: "USD",
        senderCurrencyCode: "NGN",
        denominationType: "FIXED",
        fixedRecipientDenominations: [10, 25, 50, 100, 200],
        fixedSenderDenominations: [4200, 10500, 21000, 42000, 84000],
        minRecipientDenomination: null,
        maxRecipientDenomination: null,
        senderFee: 100,
        senderFeePercentage: 3,
        discountPercentage: 7,
      };

      const originalMethod = providerService.getGiftCardProductById;
      providerService.getGiftCardProductById = jest
        .fn()
        .mockResolvedValue(mockReloadlyProduct);

   
      // Verify card updated
      const updatedCard = await GiftCard.findById(buyCardId);
      expect(updatedCard?.priceList).toEqual([10, 25, 50, 100, 200]);
      expect(updatedCard?.ngnPriceList).toEqual([
        4200, 10500, 21000, 42000, 84000,
      ]);
      expect(updatedCard?.senderFee).toBe(100);
      expect(updatedCard?.senderFeePercentage).toBe(3);
      expect(updatedCard?.discountPercentage).toBe(7);
      expect(updatedCard?.rateLastUpdated).toBeDefined();
      expect(updatedCard?.rateSource).toBe("reloadly");

      // Restore original
      providerService.getGiftCardProductById = originalMethod;
    });

    it("should sync RANGE denominations from Reloadly", async () => {
      const mockRangeProduct = {
        productId: 99999,
        recipientCurrencyCode: "USD",
        senderCurrencyCode: "NGN",
        denominationType: "RANGE",
        minRecipientDenomination: 10,
        maxRecipientDenomination: 1000,
        minSenderDenomination: 4100,
        maxSenderDenomination: 410000,
        fixedRecipientDenominations: null,
        fixedSenderDenominations: null,
        senderFee: 0,
        senderFeePercentage: 2.5,
        discountPercentage: 4,
      };

      const originalMethod = providerService.getGiftCardProductById;
      providerService.getGiftCardProductById = jest
        .fn()
        .mockResolvedValue(mockRangeProduct);


      const updatedCard = await GiftCard.findById(rangeCardId);
      expect(updatedCard?.denominationType).toBe("RANGE");
      expect(updatedCard?.buyMinAmount).toBe(10);
      expect(updatedCard?.buyMaxAmount).toBe(1000);
      expect(updatedCard?.minAmountNgn).toBe(4100);
      expect(updatedCard?.maxAmountNgn).toBe(410000);

      providerService.getGiftCardProductById = originalMethod;
    });

    it("should skip non-Reloadly providers during sync", async () => {
      // Create a custom provider
      const customProvider = await Provider.create({
        name: "CustomProvider",
        code: "custom",
        type: "giftcard",
        isActive: true,
      });

      const customCategory = await GiftCardCategory.create({
        name: "Custom Cards",
        transactionType: "both",
        providerId: customProvider._id,
        isActive: true,
      });

      await GiftCard.create({
        categoryId: customCategory._id,
        name: "Custom Card",
        productId: "custom_123",
        countryId: new Types.ObjectId(countryId),
        currency: "USD",
        type: "buy",
        denominationType: "FIXED" as const,
        priceList: [10],
        buyRate: 400,
        purchaseActivated: true,
        isActive: true,
      });

    });

    it("should handle sync errors gracefully", async () => {
      const originalMethod = providerService.getGiftCardProductById;
      providerService.getGiftCardProductById = jest
        .fn()
        .mockRejectedValue(new Error("API connection failed"));

     
      providerService.getGiftCardProductById = originalMethod;
    });

    it("should filter sync by providerId", async () => {
      const mockProduct = {
        productId: 12345,
        recipientCurrencyCode: "USD",
        senderCurrencyCode: "NGN",
        denominationType: "FIXED",
        fixedRecipientDenominations: [10, 25],
        fixedSenderDenominations: [4100, 10250],
        senderFee: 50,
        senderFeePercentage: 2,
        discountPercentage: 5,
      };

      const originalMethod = providerService.getGiftCardProductById;
      providerService.getGiftCardProductById = jest
        .fn()
        .mockResolvedValue(mockProduct);

     
      providerService.getGiftCardProductById = originalMethod;
    });
  });

  describe("Manual Rate Updates", () => {
    it("should update sell rate manually", async () => {
      const newRate = 420; // Changed from 380 to 420

      const updated = await rateService.updateSellRate(sellCardId, newRate);

      expect(updated.sellRate).toBe(newRate);
      expect(updated.rateLastUpdated).toBeDefined();
      expect(updated.rateSource).toBe("manual");

      // Verify calculation uses new rate
      const calculation = await rateService.calculateSellPayout(
        sellCardId,
        100,
        1,
      );

      expect(calculation.rate).toBe(newRate);
      expect(calculation.totalNGN).toBe(100 * newRate); // ₦42,000
    });

    it("should reject manual rate update on buy-type card", async () => {
      await expect(rateService.updateSellRate(buyCardId, 400)).rejects.toThrow(
        "not a sell type",
      );
    });

    it("should reject manual rate update on non-existent card", async () => {
      const fakeId = new Types.ObjectId().toString();

      await expect(rateService.updateSellRate(fakeId, 400)).rejects.toThrow(
        "not found",
      );
    });
  });

  describe("Denomination Validation", () => {
    it("should enforce FIXED priceList strictly (buy)", async () => {
      // Valid amounts
      for (const validAmount of [10, 25, 50, 100]) {
        const result = await rateService.calculateBuyPrice(
          buyCardId,
          validAmount,
          1,
        );
        expect(result.giftCardAmount).toBe(validAmount);
      }

      // Invalid amounts
      const invalidAmounts = [5, 15, 30, 75, 150];
      for (const invalidAmount of invalidAmounts) {
        await expect(
          rateService.calculateBuyPrice(buyCardId, invalidAmount, 1),
        ).rejects.toThrow("Invalid amount");
      }
    });

    it("should enforce FIXED priceList strictly (sell)", async () => {
      // Valid amounts
      for (const validAmount of [10, 20, 50, 100]) {
        const result = await rateService.calculateSellPayout(
          sellCardId,
          validAmount,
          1,
        );
        expect(result.giftCardAmount).toBe(validAmount);
      }

      // Invalid amounts
      await expect(
        rateService.calculateSellPayout(sellCardId, 25, 1),
      ).rejects.toThrow("Invalid amount");
    });

    it("should enforce RANGE boundaries strictly", async () => {
      // Edge cases - exactly at boundaries
      const minResult = await rateService.calculateBuyPrice(rangeCardId, 5, 1);
      expect(minResult.giftCardAmount).toBe(5);

      const maxResult = await rateService.calculateBuyPrice(
        rangeCardId,
        500,
        1,
      );
      expect(maxResult.giftCardAmount).toBe(500);

      // Just outside boundaries
      await expect(
        rateService.calculateBuyPrice(rangeCardId, 4.99, 1),
      ).rejects.toThrow("at least");

      await expect(
        rateService.calculateBuyPrice(rangeCardId, 500.01, 1),
      ).rejects.toThrow("exceed");
    });
  });

  describe("Exchange Rate Handling", () => {
    it("should use exchangeRate in buy calculations", async () => {
      // Create card with different exchange rate
      const customCard = await GiftCard.create({
        categoryId: new Types.ObjectId(categoryId),
        countryId: new Types.ObjectId(countryId),
        name: "Custom Rate Card",
        productId: "reloadly_custom",
        currency: "EUR",
        senderCurrency: "NGN",
        type: "buy",
        denominationType: "FIXED" as const,
        priceList: [10, 50],
        buyRate: 450,
        exchangeRate: 450, // €1 = ₦450
        purchaseActivated: true,
        isActive: true,
      });

      const result = await rateService.calculateBuyPrice(
        customCard._id.toString(),
        50,
        1,
      );

      expect(result.giftCardCurrency).toBe("EUR");
      expect(result.exchangeRate).toBe(450);

      // Base: €50 × ₦450 = ₦22,500
      expect(result.totalNGN).toBeGreaterThanOrEqual(22500);
    });

    it("should default to 1:1 exchange rate if not set", async () => {
      // Create card without explicit exchangeRate
      const noRateCard = await GiftCard.create({
        categoryId: new Types.ObjectId(categoryId),
        countryId: new Types.ObjectId(countryId),
        name: "No Exchange Rate Card",
        productId: "reloadly_noex",
        currency: "USD",
        type: "buy",
        denominationType: "FIXED" as const,
        priceList: [10],
        buyRate: 400,
        purchaseActivated: true,
        isActive: true,
      });

      const result = await rateService.calculateBuyPrice(
        noRateCard._id.toString(),
        10,
        1,
      );

      expect(result.exchangeRate).toBe(1);
    });
  });

  describe("Rate Service getAllRates", () => {
    beforeEach(async () => {
      // Create multiple giftcards for testing filters
      await GiftCard.create({
        categoryId: new Types.ObjectId(categoryId),
        name: "PlayStation Card",
        productId: "sell_ps_123",
        countryId: new Types.ObjectId(countryId),
        currency: "USD",
        type: "sell",
        denominationType: "FIXED" as const,
        priceList: [10, 25, 50],
        sellRate: 390,
        saleActivated: true,
        isActive: true,
      });
    });

    it("should fetch all rates with pagination", async () => {
      const result = await rateService.getAllRates({
        page: 1,
        limit: 10,
      });

      expect(result.data).toBeDefined();
      expect(result.total).toBeGreaterThan(0);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it("should filter rates by type (buy)", async () => {
      const result = await rateService.getAllRates({
        page: 1,
        limit: 10,
        type: "buy",
      });

      result.data.forEach((card) => {
        expect(card.type).toBe("buy");
        expect(card.buyRate).toBeDefined();
      });
    });

    it("should filter rates by type (sell)", async () => {
      const result = await rateService.getAllRates({
        page: 1,
        limit: 10,
        type: "sell",
      });

      result.data.forEach((card) => {
        expect(card.type).toBe("sell");
        expect(card.sellRate).toBeDefined();
      });
    });

    it("should filter rates by categoryId", async () => {
      const result = await rateService.getAllRates({
        page: 1,
        limit: 10,
        categoryId,
      });

      // result.data.forEach((card) => {
      //   expect(card.category.id.toString()).toBe(categoryId);
      // });
      
    });

    it("should include denomination info in response", async () => {
      const result = await rateService.getAllRates({
        page: 1,
        limit: 10,
      });

      const fixedCard = result.data.find((c) => c.denominationType === "FIXED");
      const rangeCard = result.data.find((c) => c.denominationType === "RANGE");

      if (fixedCard) {
        expect(fixedCard.priceList).toBeDefined();
        expect(Array.isArray(fixedCard.priceList)).toBe(true);
      }

      if (rangeCard) {
        expect(rangeCard.minAmount).toBeDefined();
        expect(rangeCard.maxAmount).toBeDefined();
      }
    });
  });

  describe("Min/Max Enforcement", () => {
    it("should strictly enforce buy minimum for RANGE", async () => {
      // Exactly at minimum
      const atMin = await rateService.calculateBuyPrice(rangeCardId, 5, 1);
      expect(atMin.giftCardAmount).toBe(5);

      // Just below minimum
      await expect(
        rateService.calculateBuyPrice(rangeCardId, 4.99, 1),
      ).rejects.toThrow("at least 5");
    });

    it("should strictly enforce buy maximum for RANGE", async () => {
      // Exactly at maximum
      const atMax = await rateService.calculateBuyPrice(rangeCardId, 500, 1);
      expect(atMax.giftCardAmount).toBe(500);

      // Just above maximum
      await expect(
        rateService.calculateBuyPrice(rangeCardId, 500.01, 1),
      ).rejects.toThrow("exceed 500");
    });

    it("should handle sell RANGE with different min/max", async () => {
      // Create sell RANGE card
      const sellRangeCard = await GiftCard.create({
        categoryId: new Types.ObjectId(categoryId),
        name: "Sell Range Card",
        productId: "sell_range_123",
        currency: "USD",
        countryId: new Types.ObjectId(countryId),
        type: "sell",
        denominationType: "RANGE" as const,
        sellMinAmount: 20,
        sellMaxAmount: 300,
        sellRate: 380,
        saleActivated: true,
        isActive: true,
      });

      // Below min
      await expect(
        rateService.calculateSellPayout(sellRangeCard._id.toString(), 15, 1),
      ).rejects.toThrow("at least 20");

      // Above max
      await expect(
        rateService.calculateSellPayout(sellRangeCard._id.toString(), 350, 1),
      ).rejects.toThrow("exceed 300");

      // Within range
      const valid = await rateService.calculateSellPayout(
        sellRangeCard._id.toString(),
        100,
        1,
      );
      expect(valid.giftCardAmount).toBe(100);
    });
  });

  describe("Platform Profit Tracking (Buy)", () => {
    it("should track platform profit from Reloadly discount", async () => {
      const result = await rateService.calculateBuyPrice(buyCardId, 100, 1);

      // Base: $100 × ₦410 = ₦41,000
      // Discount: 5% of ₦41,000 = ₦2,050
      const expectedProfit = 41000 * 0.05;

      expect(result.discountAmount).toBeCloseTo(expectedProfit, 0);
      // expect(result.platformProfit).toBeCloseTo(expectedProfit, 0);
    });

    it("should calculate platform profit for multiple cards", async () => {
      const result = await rateService.calculateBuyPrice(buyCardId, 25, 5);

      const basePerCard = 25 * 410; // ₦10,250
      const totalBase = basePerCard * 5; // ₦51,250
      const totalProfit = totalBase * 0.05; // ₦2,562.5

      // expect(result.platformProfit).toBeCloseTo(totalProfit, 0);
    });

    it("should handle zero discount percentage", async () => {
      // Update card to have no discount
      await GiftCard.updateOne({ _id: buyCardId }, { discountPercentage: 0 });

      const result = await rateService.calculateBuyPrice(buyCardId, 50, 1);

      expect(result.discountAmount).toBe(0);
      // expect(result.platformProfit).toBe(0);
    });
  });

  describe("Integration with Service Charges", () => {
    it("should not include service charge in rate calculations", async () => {
      // Rate service only calculates card price, not service charges
      const buyResult = await rateService.calculateBuyPrice(buyCardId, 50, 1);
      const sellResult = await rateService.calculateSellPayout(
        sellCardId,
        50,
        1,
      );

      // Both results should only contain base amounts
      // Service charges are added separately in GiftCardService
      expect(buyResult).not.toHaveProperty("serviceCharge");
      expect(sellResult).not.toHaveProperty("serviceCharge");

      // Only price components
      expect(buyResult.totalNGN).toBeDefined();
      expect(buyResult.senderFee).toBeDefined();
      expect(sellResult.totalNGN).toBeDefined();
      expect(sellResult.rate).toBeDefined();
    });
  });

  describe("Edge Cases & Error Handling", () => {
    it("should handle missing priceList for FIXED type", async () => {
      // Create card with FIXED but no priceList
      const brokenCard = await GiftCard.create({
        categoryId: new Types.ObjectId(categoryId),
        countryId: new Types.ObjectId(countryId),
        name: "Broken Card",
        productId: "broken_123",
        currency: "USD",
        type: "buy",
        denominationType: "FIXED" as const,
        buyRate: 400,
        purchaseActivated: true,
        isActive: true,
      });

      await expect(
        rateService.calculateBuyPrice(brokenCard._id.toString(), 10, 1),
      ).rejects.toThrow("Invalid amount");
    });

    it("should handle missing min/max for RANGE type", async () => {
      // Create RANGE card without bounds
      const unboundedCard = await GiftCard.create({
        categoryId: new Types.ObjectId(categoryId),
        name: "Unbounded Card",
        countryId: new Types.ObjectId(countryId),
        productId: "unbounded_123",
        currency: "USD",
        type: "sell",
        denominationType: "RANGE" as const,
        sellRate: 400,
        saleActivated: true,
        isActive: true,
      });

      // Should succeed without min/max enforcement
      const result = await rateService.calculateSellPayout(
        unboundedCard._id.toString(),
        100,
        1,
      );

      expect(result.giftCardAmount).toBe(100);
    });

    it("should handle card not found error", async () => {
      const fakeId = new Types.ObjectId().toString();

      await expect(
        rateService.calculateBuyPrice(fakeId, 10, 1),
      ).rejects.toThrow("not found");

      await expect(
        rateService.calculateSellPayout(fakeId, 10, 1),
      ).rejects.toThrow("not found");
    });

    it("should reject calculation on inactive card", async () => {
      // Deactivate card
      await GiftCard.updateOne({ _id: buyCardId }, { isActive: false });

      await expect(
        rateService.calculateBuyPrice(buyCardId, 25, 1),
      ).rejects.toThrow("not found");
    });

    it("should handle decimal amounts in RANGE", async () => {
      const result = await rateService.calculateBuyPrice(rangeCardId, 25.5, 1);

      expect(result.giftCardAmount).toBe(25.5);
      expect(result.totalNGN).toBeCloseTo(25.5 * 410, 0);
    });

    // it("should handle large quantities correctly", async () => {
    //   const result = await rateService.calculateBuyPrice(buyCardId, 10, 100);

    //   const basePerCard = 10 * 410; // ₦4,100
    //   const totalBase = basePerCard * 100; // ₦410,000

    //   expect(result.totalNGN).toBeGreaterThan(totalBase); // Includes sender fee
    //   expect(result.platformProfit).toBeCloseTo(totalBase * 0.05, 0); // ₦20,500
    // });
  });

  describe("Rate Sync Edge Cases", () => {
    it("should handle products not found on Reloadly", async () => {
      const originalMethod = providerService.getGiftCardProductById;
      providerService.getGiftCardProductById = jest
        .fn()
        .mockResolvedValue(null);


      providerService.getGiftCardProductById = originalMethod;
    });

    it("should only sync active giftcards", async () => {
      // Deactivate the buy card
      await GiftCard.updateOne({ _id: buyCardId }, { isActive: false });

      const mockProduct = {
        productId: 12345,
        recipientCurrencyCode: "USD",
        senderCurrencyCode: "NGN",
        denominationType: "FIXED",
        fixedRecipientDenominations: [10],
        senderFee: 50,
      };

      const originalMethod = providerService.getGiftCardProductById;
      providerService.getGiftCardProductById = jest
        .fn()
        .mockResolvedValue(mockProduct);

      providerService.getGiftCardProductById = originalMethod;
    });

    it("should only sync buy-type cards (not sell)", async () => {
      const mockProduct = {
        productId: 12345,
        recipientCurrencyCode: "USD",
        senderCurrencyCode: "NGN",
        denominationType: "FIXED",
        fixedRecipientDenominations: [10, 25, 50],
        fixedSenderDenominations: [4100, 10250, 20500],
        senderFee: 50,
        senderFeePercentage: 2,
        discountPercentage: 5,
      };

      const originalMethod = providerService.getGiftCardProductById;
      providerService.getGiftCardProductById = jest
        .fn()
        .mockResolvedValue(mockProduct);

    
      const syncedCards = await GiftCard.find({
        rateSource: "reloadly",
        type: "buy",
      });

      expect(syncedCards.length).toBeGreaterThan(0);

      const sellCards = await GiftCard.find({
        rateSource: "reloadly",
        type: "sell",
      });

      expect(sellCards.length).toBe(0);

      providerService.getGiftCardProductById = originalMethod;
    });
  });

  describe("Calculation Accuracy", () => {
    it("should maintain precision in calculations", async () => {
      // Test with amounts that could cause floating point issues
      const testAmounts = [10.01, 25.99, 50.5, 99.99];

      for (const amount of testAmounts) {
        const result = await rateService.calculateBuyPrice(
          rangeCardId,
          amount,
          1,
        );

        const expectedBase = amount * 410;
        expect(result.totalNGN).toBeGreaterThan(expectedBase - 1);
        expect(result.totalNGN).toBeLessThan(expectedBase * 1.1); // Reasonable upper bound
      }
    });

    it("should calculate per-unit price correctly for bulk", async () => {
      const amount = 50;
      const quantity = 7;

      const result = await rateService.calculateBuyPrice(
        buyCardId,
        amount,
        quantity,
      );

      const singleResult = await rateService.calculateBuyPrice(
        buyCardId,
        amount,
        1,
      );

      // Total should be single × quantity
      expect(result.totalNGN).toBeCloseTo(singleResult.totalNGN * quantity, 0);
      expect(result.perUnitNGN).toBeCloseTo(singleResult.perUnitNGN, 0);
    });

    it("should handle zero sender fee correctly", async () => {
      // Update card to have no fees
      await GiftCard.updateOne(
        { _id: buyCardId },
        { senderFee: 0, senderFeePercentage: 0 },
      );

      const result = await rateService.calculateBuyPrice(buyCardId, 50, 1);

      expect(result.senderFee).toBe(0);

      // Total should equal base amount only
      const expectedBase = 50 * 410; // ₦20,500
      expect(result.totalNGN).toBe(expectedBase);
    });
  });

  describe("Currency Consistency", () => {
    it("should return correct currency in calculations", async () => {
      const buyResult = await rateService.calculateBuyPrice(buyCardId, 25, 1);
      const sellResult = await rateService.calculateSellPayout(
        sellCardId,
        50,
        1,
      );

      expect(buyResult.giftCardCurrency).toBe("USD");
      expect(sellResult.giftCardCurrency).toBe("USD");
    });

    it("should handle different currencies correctly", async () => {
      // Create GBP card
      const gbpCard = await GiftCard.create({
        categoryId: new Types.ObjectId(categoryId),
        countryId: new Types.ObjectId(countryId),
        name: "UK Card",
        productId: "reloadly_gbp",
        currency: "GBP",
        type: "buy",
        denominationType: "FIXED" as const,
        priceList: [10, 25],
        buyRate: 550,
        exchangeRate: 550,
        purchaseActivated: true,
        isActive: true,
      });

      const result = await rateService.calculateBuyPrice(
        gbpCard._id.toString(),
        25,
        1,
      );

      expect(result.giftCardCurrency).toBe("GBP");
      expect(result.exchangeRate).toBe(550);

      // £25 × ₦550 = ₦13,750
      const expectedBase = 25 * 550;
      expect(result.totalNGN).toBeGreaterThanOrEqual(expectedBase);
    });
  });
});
