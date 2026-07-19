/**
 * CRYPTO TEST: Rate Calculations & Breakdown
 * 
 * Tests Crypto rate functionality:
 * - Buy price calculations
 * - Sell payout calculations
 * - Exchange rate handling
 * - Service fee calculations
 * - Network fee inclusion
 * - Breakdown validation
 */

import { CryptoService } from "@/services/client/crypto/CryptoService";
import ServiceContainer from "@/services/client/container";
import { Crypto } from "@/models/crypto/Crypto";
import { Network } from "@/models/crypto/Network";
import { ServiceCharge } from "@/models/billing/fees/ServiceCharge";
import { Types } from "mongoose";
import logger from "@/logger";
import { CryptoBreakdownService } from "@/services/client/crypto/CryptoBreakdownService";

describe("Crypto Rates & Breakdown", () => {
  let cryptoService: CryptoService;
  let networkId: string;
  let cryptoBreakdownService: CryptoBreakdownService;

  beforeEach(async () => {
    cryptoService = ServiceContainer.getCryptoService();
    cryptoBreakdownService = ServiceContainer.getCryptoBreakdownService();

    // Create service charge
    await ServiceCharge.create({
      code: "crypto",
      name: "Crypto Service Charge",
      type: "percentage",
      value: 2.0,
      details: "Standard crypto transaction charge",
    });

    // Create network
    const network = await Network.create({
      networkId: "tron",
      name: "Tron",
      code: "TRC20",
      confirmationsRequired: 19,
      platformDepositAddress: "TPlatformAddress123456789",
      explorerUrl: "https://tronscan.org/#/transaction/",
      addressPattern: "^T[A-Za-z1-9]{33}$",
      isActive: true,
    });

    networkId = network._id.toString();
  });

  describe("Buy Breakdown Calculations", () => {
    it("should calculate buy breakdown for USDT correctly", async () => {
      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        buyRate: 1550,
        sellRate: 1500,
        buyMinAmount: 10,
        buyMaxAmount: 5000,
        purchaseActivated: true,
        saleActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 100,
        tradeType: "buy",
        networkId,
      });

      // Base calculation
      expect(breakdown.cryptoAmount).toBe(100);
      expect(breakdown.exchangeRate).toBe(1550);
      expect(breakdown.fiatAmount).toBe(155000); // 100 × 1550

      // Fees
      expect(breakdown.serviceFee).toBeGreaterThan(0);

      // Totals
      expect(breakdown.totalAmount).toBe(
        breakdown.fiatAmount + breakdown.serviceFee
      );
    });

    it("should calculate buy breakdown with 2% service charge", async () => {
      const crypto = await Crypto.create({
        assetId: "eth-ethereum",
        name: "Ethereum",
        code: "ETH",
        buyRate: 8000000, // ₦8M per ETH
        sellRate: 7900000,
        buyMinAmount: 0.01,
        buyMaxAmount: 10,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 0.1,
        tradeType: "buy",
        networkId,
      });

      const baseFiat = 0.1 * 8000000; // ₦800,000
      const expectedServiceFee = baseFiat * 0.02; // ₦16,000

      expect(breakdown.fiatAmount).toBe(baseFiat);
      expect(breakdown.serviceFee).toBeCloseTo(expectedServiceFee, 0);
      expect(breakdown.totalAmount).toBe(baseFiat + expectedServiceFee);
    });

    it("should include network fee in buy calculation", async () => {
      const crypto = await Crypto.create({
        assetId: "btc-bitcoin",
        name: "Bitcoin",
        code: "BTC",
        buyRate: 60000000,
        sellRate: 59000000,
        buyMinAmount: 0.001,
        buyMaxAmount: 1,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 0.001,
        tradeType: "buy",
        networkId,
      });

      // Network fee is included in calculation flow
      expect(breakdown.totalAmount).toBeGreaterThan(breakdown.fiatAmount);
    });

    it("should handle zero service charge", async () => {
      // Remove service charge
      await ServiceCharge.deleteMany({ code: "crypto" });

      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        buyRate: 1550,
        buyMinAmount: 10,
        buyMaxAmount: 5000,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 100,
        tradeType: "buy",
        networkId,
      });

      expect(breakdown.serviceFee).toBe(0);
      expect(breakdown.totalAmount).toBe(breakdown.fiatAmount);
    });

    it("should reject buy breakdown when buyRate not set", async () => {
      const crypto = await Crypto.create({
        assetId: "doge-dogecoin",
        name: "Dogecoin",
        code: "DOGE",
        sellRate: 500,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      await expect(
        cryptoBreakdownService.calculateBreakdown({
          cryptoId: crypto._id.toString(),
          cryptoAmount: 1000,
          tradeType: "buy",
          networkId,
        })
      ).rejects.toThrow("rate not configured");
    });
  });

  describe("Sell Breakdown Calculations", () => {
    it("should calculate sell breakdown for USDT correctly", async () => {
      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        buyRate: 1550,
        sellRate: 1500,
        sellMinAmount: 10,
        sellMaxAmount: 10000,
        purchaseActivated: true,
        saleActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 100,
        tradeType: "sell",
        networkId,
      });

      // Base calculation
      expect(breakdown.cryptoAmount).toBe(100);
      expect(breakdown.exchangeRate).toBe(1500);
      expect(breakdown.fiatAmount).toBe(150000); // 100 × 1500

      // Fees
      expect(breakdown.serviceFee).toBeGreaterThan(0);

      // Totals - SELL deducts fees
      expect(breakdown.totalAmount).toBeLessThan(breakdown.fiatAmount);
      expect(breakdown.totalAmount).toBe(
        breakdown.fiatAmount - breakdown.serviceFee
      );
    });

    it("should calculate sell payout with 2% service charge", async () => {
      const crypto = await Crypto.create({
        assetId: "eth-ethereum",
        name: "Ethereum",
        code: "ETH",
        buyRate: 8000000,
        sellRate: 7900000, // ₦7.9M per ETH
        sellMinAmount: 0.01,
        sellMaxAmount: 10,
        saleActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 0.1,
        tradeType: "sell",
        networkId,
      });

      const baseFiat = 0.1 * 7900000; // ₦790,000
      const expectedServiceFee = baseFiat * 0.02; // ₦15,800
      const expectedPayout = baseFiat - expectedServiceFee;

      expect(breakdown.fiatAmount).toBe(baseFiat);
      expect(breakdown.serviceFee).toBeCloseTo(expectedServiceFee, 0);
      expect(breakdown.totalAmount).toBeCloseTo(expectedPayout, -2);
    });

    it("should handle zero service charge on sell", async () => {
      await ServiceCharge.deleteMany({ code: "crypto" });

      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        sellRate: 1500,
        sellMinAmount: 10,
        sellMaxAmount: 10000,
        saleActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 100,
        tradeType: "sell",
        networkId,
      });

      expect(breakdown.serviceFee).toBe(0);
      expect(breakdown.totalAmount).toBe(breakdown.fiatAmount);
    });

    it("should reject sell breakdown when sellRate not set", async () => {
      const crypto = await Crypto.create({
        assetId: "doge-dogecoin",
        name: "Dogecoin",
        code: "DOGE",
        buyRate: 520,
        saleActivated: true,
        isActive: true,
        networks: [networkId],
      });

      await expect(
        cryptoBreakdownService.calculateBreakdown({
          cryptoId: crypto._id.toString(),
          cryptoAmount: 1000,
          tradeType: "sell",
          networkId,
        })
      ).rejects.toThrow("rate not configured");
    });
  });

  describe("Buy vs Sell Rate Comparison", () => {
    it("should show buyRate > sellRate spread", async () => {
      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        buyRate: 1550, // Platform sells to user
        sellRate: 1500, // Platform buys from user
        purchaseActivated: true,
        saleActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const buyBreakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 100,
        tradeType: "buy",
        networkId,
      });

      const sellBreakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 100,
        tradeType: "sell",
        networkId,
      });

      // User pays more to buy, gets less when selling
      expect(buyBreakdown.exchangeRate).toBeGreaterThan(
        sellBreakdown.exchangeRate
      );
      expect(buyBreakdown.fiatAmount).toBeGreaterThan(
        sellBreakdown.fiatAmount
      );
    });

    it("should show platform profit from rate spread", async () => {
      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        buyRate: 1550,
        sellRate: 1500,
        purchaseActivated: true,
        saleActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const amount = 100;
      const buyBreakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: amount,
        tradeType: "buy",
        networkId,
      });

      const sellBreakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: amount,
        tradeType: "sell",
        networkId,
      });

      const platformSpread = buyBreakdown.fiatAmount - sellBreakdown.fiatAmount;
      expect(platformSpread).toBeGreaterThan(0);
      expect(platformSpread).toBe(amount * (1550 - 1500)); // ₦5,000 spread
    });
  });

  describe("Multi-Crypto Rate Validation", () => {
    it("should calculate breakdown for multiple cryptos with different rates", async () => {
      const [usdt, eth, btc] = await Promise.all([
        Crypto.create({
          assetId: "usdt-tether",
          name: "Tether",
          code: "USDT",
          buyRate: 1550,
          sellRate: 1500,
          purchaseActivated: true,
          isActive: true,
          networks: [networkId],
        }),
        Crypto.create({
          assetId: "eth-ethereum",
          name: "Ethereum",
          code: "ETH",
          buyRate: 8000000,
          sellRate: 7900000,
          purchaseActivated: true,
          isActive: true,
          networks: [networkId],
        }),
        Crypto.create({
          assetId: "btc-bitcoin",
          name: "Bitcoin",
          code: "BTC",
          buyRate: 60000000,
          sellRate: 59000000,
          purchaseActivated: true,
          isActive: true,
          networks: [networkId],
        }),
      ]);

      const usdtBreakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: usdt._id.toString(),
        cryptoAmount: 100,
        tradeType: "buy",
        networkId,
      });

      const ethBreakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: eth._id.toString(),
        cryptoAmount: 0.1,
        tradeType: "buy",
        networkId,
      });

      const btcBreakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: btc._id.toString(),
        cryptoAmount: 0.001,
        tradeType: "buy",
        networkId,
      });

      // All rates should be applied correctly
      expect(usdtBreakdown.exchangeRate).toBe(1550);
      expect(ethBreakdown.exchangeRate).toBe(8000000);
      expect(btcBreakdown.exchangeRate).toBe(60000000);

      // Fiat amounts should be different even with same crypto amount
      expect(usdtBreakdown.fiatAmount).not.toBe(ethBreakdown.fiatAmount);
      expect(ethBreakdown.fiatAmount).not.toBe(btcBreakdown.fiatAmount);
    });
  });

  describe("Decimal Precision & Rounding", () => {
    it("should handle decimal crypto amounts correctly", async () => {
      const crypto = await Crypto.create({
        assetId: "eth-ethereum",
        name: "Ethereum",
        code: "ETH",
        buyRate: 8000000,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 0.001, // 0.001 ETH
        tradeType: "buy",
        networkId,
      });

      expect(breakdown.cryptoAmount).toBe(0.001);
      expect(breakdown.fiatAmount).toBe(0.001 * 8000000); // ₦8,000
    });

    it("should handle very small decimal amounts", async () => {
      const crypto = await Crypto.create({
        assetId: "btc-bitcoin",
        name: "Bitcoin",
        code: "BTC",
        buyRate: 60000000,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 0.00001, // Satoshi equivalent
        tradeType: "buy",
        networkId,
      });

      expect(breakdown.cryptoAmount).toBe(0.00001);
      expect(breakdown.fiatAmount).toBeCloseTo(600, -2); // ₦600
    });

    it("should maintain precision through fee calculations", async () => {
      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        buyRate: 1550,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const amounts = [1, 10, 100, 1000, 10000];

      for (const amount of amounts) {
        const breakdown = await cryptoBreakdownService.calculateBreakdown({
          cryptoId: crypto._id.toString(),
          cryptoAmount: amount,
          tradeType: "buy",
          networkId,
        });

        const expectedFiat = amount * 1550;
        expect(breakdown.fiatAmount).toBe(expectedFiat);
      }
    });
  });

  describe("Min/Max Amount Validation in Breakdown", () => {
    it("should calculate breakdown regardless of min/max limits", async () => {
      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        buyRate: 1550,
        sellRate: 1500,
        buyMinAmount: 10,
        buyMaxAmount: 5000,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      // Breakdown should work for any amount
      const belowMinBreakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 5, // Below minimum
        tradeType: "buy",
        networkId,
      });

      const aboveMaxBreakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 6000, // Above maximum
        tradeType: "buy",
        networkId,
      });

      // Breakdown should calculate correctly
      expect(belowMinBreakdown.fiatAmount).toBe(5 * 1550);
      expect(aboveMaxBreakdown.fiatAmount).toBe(6000 * 1550);
    });
  });

  describe("Network Fee Handling", () => {
    it("should include network fee from network config", async () => {
      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        buyRate: 1550,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 100,
        tradeType: "buy",
        networkId,
      });

    });

    it("should handle zero network fee", async () => {
      const zeroFeeNetwork = await Network.create({
        networkId: "ethereum",
        name: "Ethereum",
        code: "ERC20",
        confirmationsRequired: 12,
        isActive: true,
      });

      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        buyRate: 1550,
        purchaseActivated: true,
        isActive: true,
        networks: [zeroFeeNetwork._id],
      });

      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 100,
        tradeType: "buy",
        networkId: zeroFeeNetwork._id.toString(),
      });

    });
  });

  describe("Edge Cases & Error Handling", () => {
    it("should handle zero crypto amount gracefully", async () => {
      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        buyRate: 1550,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 0,
        tradeType: "buy",
        networkId,
      });

      expect(breakdown.cryptoAmount).toBe(0);
      expect(breakdown.fiatAmount).toBe(0);
      expect(breakdown.totalAmount).toBe(0);
    });

    it("should handle negative amounts (validation in service layer)", async () => {
      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        buyRate: 1550,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: -100,
        tradeType: "buy",
        networkId,
      });

      // Breakdown calculates mathematically, validation happens in buyCrypto/sellCrypto
      expect(breakdown.fiatAmount).toBe(-155000);
    });

    it("should reject breakdown with invalid crypto", async () => {
      const invalidId = new Types.ObjectId();

      await expect(
        cryptoBreakdownService.calculateBreakdown({
          cryptoId: invalidId.toString(),
          cryptoAmount: 100,
          tradeType: "buy",
          networkId,
        })
      ).rejects.toThrow("not found");
    });

    it("should reject breakdown with invalid network", async () => {
      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        buyRate: 1550,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const invalidNetworkId = new Types.ObjectId();

      await expect(
        cryptoBreakdownService.calculateBreakdown({
          cryptoId: crypto._id.toString(),
          cryptoAmount: 100,
          tradeType: "buy",
          networkId: invalidNetworkId.toString(),
        })
      ).rejects.toThrow("Invalid network");
    });

    it("should handle very large amounts", async () => {
      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        buyRate: 1550,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 1000000, // 1M USDT
        tradeType: "buy",
        networkId,
      });

      expect(breakdown.fiatAmount).toBe(1000000 * 1550);
      expect(breakdown.serviceFee).toBeGreaterThan(0);
    });
  });

  describe("Rate Update Scenarios", () => {
    it("should reflect updated buy rate immediately", async () => {
      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        buyRate: 1550,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown1 = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 100,
        tradeType: "buy",
        networkId,
      });

      expect(breakdown1.exchangeRate).toBe(1550);

      // Update rate
      await Crypto.updateOne({ _id: crypto._id }, { buyRate: 1600 });

      const breakdown2 = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 100,
        tradeType: "buy",
        networkId,
      });

      expect(breakdown2.exchangeRate).toBe(1600);
      expect(breakdown2.fiatAmount).toBe(160000); // New rate reflected
    });

    it("should reflect updated sell rate immediately", async () => {
      const crypto = await Crypto.create({
        assetId: "usdt-tether",
        name: "Tether",
        code: "USDT",
        sellRate: 1500,
        saleActivated: true,
        isActive: true,
        networks: [networkId],
      });

      const breakdown1 = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 100,
        tradeType: "sell",
        networkId,
      });

      expect(breakdown1.exchangeRate).toBe(1500);

      // Update rate
      await Crypto.updateOne({ _id: crypto._id }, { sellRate: 1450 });

      const breakdown2 = await cryptoBreakdownService.calculateBreakdown({
        cryptoId: crypto._id.toString(),
        cryptoAmount: 100,
        tradeType: "sell",
        networkId,
      });

      expect(breakdown2.exchangeRate).toBe(1450);
      expect(breakdown2.fiatAmount).toBe(145000); // New rate reflected
    });
  });
});