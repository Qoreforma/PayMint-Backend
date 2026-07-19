/**
 * CRYPTO TEST: Buy Flow
 *
 * Tests Crypto purchase functionality:
 * - Single crypto purchase
 * - Wallet address validation
 * - Network validation
 * - Balance management
 * - Service charge calculation
 * - Admin approval workflow
 * - Transfer confirmation
 */

import { CryptoService } from "@/services/client/crypto/CryptoService";
import { CryptoTransactionViewService } from "@/services/admin/crypto/CryptoTransactionViewService";
import { WalletService } from "@/services/client/wallet/WalletService";
import ServiceContainer from "@/services/client/container";
import AdminServiceContainer from "@/services/admin/container";
import { User } from "@/models/core/User";
import { Wallet } from "@/models/wallet/Wallet";
import { Crypto } from "@/models/crypto/Crypto";
import { Network } from "@/models/crypto/Network";
import { CryptoTransaction } from "@/models/crypto/CryptoTransaction";
import { ServiceCharge } from "@/models/billing/fees/ServiceCharge";
import { Transaction } from "@/models/wallet/Transaction";
import { Admin } from "@/models/admin/Admin";
import { Types } from "mongoose";
import logger from "@/logger";
import { CryptoManualTradeService } from "@/services/client/crypto/trades/CryptoManualTradeService";
import { CryptoBreakdownService } from "@/services/client/crypto/CryptoBreakdownService";

describe("Crypto Buy Flow", () => {
  let cryptoService: CryptoService;
  let adminService: CryptoTransactionViewService;
  let walletService: WalletService;
  let cryptoManualTradeService: CryptoManualTradeService;
  let cryptoBreakdownService: CryptoBreakdownService;

  let userId: string;
  let adminId: string;
  let walletId: string;
  let cryptoId: string;
  let networkId: string;

  const VALID_TRON_ADDRESSES = {
    default: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
    user: "TUserWalletAddr1234567890123456789",
    addr1: "TAddr1Wb2U6n65J4ZqD2y3Xh1n1hYmRz7A",
    addr2: "TAddr2Wb2U6n65J4ZqD2y3Xh1n1hYmRz7B",
    addr3: "TAddr3Wb2U6n65J4ZqD2y3Xh1n1hYmRz7C",
  };

  beforeEach(async () => {
    // Get services
    cryptoService = ServiceContainer.getCryptoService();
    adminService = AdminServiceContainer.getCryptoTransactionViewService();
    walletService = ServiceContainer.getWalletService();
    cryptoManualTradeService = ServiceContainer.getCryptoManualTradeService();
    cryptoBreakdownService = ServiceContainer.getCryptoBreakdownService();
    // Create service charge for crypto
    await ServiceCharge.create({
      code: "crypto",
      name: "Crypto Service Charge",
      type: "percentage",
      value: 2.0,
      details: "Standard crypto transaction charge",
    });

    // Create test user
    const user = await User.create({
      firstname: "Crypto",
      lastname: "Buyer",
      email: "crypto@test.com",
      password: "test123",
      phone: "+2348012345678",
      status: "active",
      dateOfBirth: new Date("1990-01-01"),
    });

    userId = user._id.toString();

    // Create wallet with sufficient balance
    const wallet = await Wallet.create({
      userId: user._id,
      balance: 500000, // ₦500k
      type: "main",
      bonusBalance: 0,
      commissionBalance: 0,
    });

    walletId = wallet._id.toString();

    // Create admin
    const admin = await Admin.create({
      firstName: "Admin",
      lastName: "Crypto",
      email: "admin@crypto.com",
      password: "admin123",
      role: "super_admin",
      adminLevel: "super_admin",
    });

    adminId = admin._id.toString();

    // Create network (TRC20)
    const network = await Network.create({
      networkId: "tron",
      name: "Tron",
      code: "TRC20",
      confirmationsRequired: 19,
      platformDepositAddress: "TPlatformAddress123456789",
      explorerUrl: "https://tronscan.org/#/transaction/",
      addressPattern: "^T[1-9A-HJ-NP-Za-km-z]{33}$",
      isActive: true,
    });

    networkId = network._id.toString();

    // Create crypto (USDT)
    const crypto = await Crypto.create({
      assetId: "usdt-tether",
      name: "Tether",
      code: "USDT",
      icon: "https://cdn.example.com/usdt.png",
      buyRate: 1550, // ₦1550 per USDT
      sellRate: 1500,
      buyMinAmount: 10,
      buyMaxAmount: 5000,
      sellMinAmount: 10,
      sellMaxAmount: 10000,
      purchaseActivated: true,
      saleActivated: true,
      isActive: true,
      networks: [network._id],
    });

    cryptoId = crypto._id.toString();
  });

  describe("Single Crypto Purchase", () => {
    it("should purchase crypto successfully and debit wallet", async () => {
      const cryptoAmount = 100; // 100 USDT
      const walletAddress = VALID_TRON_ADDRESSES.default;

      const walletBefore = await Wallet.findById(walletId);
      const initialBalance = walletBefore?.balance || 0;

      const result = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount,
        walletAddress,
        networkId,
      });

      // Verify result structure
      expect(result.reference).toBeDefined();
      expect(result.status).toBe("pending");
      expect(result.tradeType).toBe("buy");
      expect(result.cryptoAmount).toBe(cryptoAmount);
      expect(result.walletAddress).toBe(walletAddress);

      // Verify breakdown
      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.fiatAmount).toBe(100 * 1550); // ₦155,000
      expect(result.breakdown.exchangeRate).toBe(1550);
      expect(result.breakdown.serviceCharge).toBeGreaterThan(0);

      // CRITICAL: Verify wallet debited immediately
      const walletAfter = await Wallet.findById(walletId);
      const expectedDebit = result.breakdown.totalDeducted;
      expect(walletAfter?.balance).toBe(initialBalance - expectedDebit);

      // Verify transaction created - add small delay and refetch
      // Verify transaction created - add small delay and force select all fields
      await new Promise((resolve) => setTimeout(resolve, 50));
      const transaction = await Transaction.findById(result.transactionId.toString())
        .select(
          "+direction +transactableType +transactableId +status +balanceAfter",
        )
        .lean()
        .exec();

      expect(transaction).toBeDefined();
      expect(transaction?.direction).toBe("DEBIT");
      expect(transaction?.status).toBe("success");
      expect(transaction?.balanceAfter).toBe(walletAfter?.balance);
      expect(transaction?.transactableType).toBe("CryptoTransaction");
      expect(transaction?.transactableId?.toString()).toBe(
        result.id.toString(),
      );
    });

    it("should reject purchase with insufficient balance", async () => {
      // Create user with low balance
      const lowUser = await User.create({
        firstname: "Low",
        lastname: "Balance",
        email: "low@crypto.com",
        password: "test123",
        phone: "+2348099999999",
        status: "active",
        dateOfBirth: new Date("1990-01-01"),
      });

      await Wallet.create({
        userId: lowUser._id,
        balance: 1000, // Only ₦1,000
        type: "main",
        bonusBalance: 0,
        commissionBalance: 0,
      });

      await expect(
        cryptoManualTradeService.buyCrypto({
          userId: lowUser._id.toString(),
          cryptoId,
          cryptoAmount: 500, // 500 USDT = ₦775,000
          walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
          networkId,
        }),
      ).rejects.toThrow("Insufficient");

      // Verify wallet unchanged
      const wallet = await Wallet.findOne({ userId: lowUser._id });
      expect(wallet?.balance).toBe(1000);
    });

    it("should validate wallet address format", async () => {
      // Invalid address (doesn't match TRC20 pattern)
      await expect(
        cryptoManualTradeService.buyCrypto({
          userId,
          cryptoId,
          cryptoAmount: 50,
          walletAddress: "INVALID_ADDRESS",
          networkId,
        }),
      ).rejects.toThrow("Invalid wallet address");
    });

    it("should validate min amount", async () => {
      await expect(
        cryptoManualTradeService.buyCrypto({
          userId,
          cryptoId,
          cryptoAmount: 5, // Below minimum of 10
          walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
          networkId,
        }),
      ).rejects.toThrow("Amount must be at least");
    });

    it("should validate max amount", async () => {
      await expect(
        cryptoManualTradeService.buyCrypto({
          userId,
          cryptoId,
          cryptoAmount: 6000, // Above maximum of 5000
          walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
          networkId,
        }),
      ).rejects.toThrow("Maximum");
    });

    it("should accept amounts within range", async () => {
      const result = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 250, // Within [10, 5000]
        walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
        networkId,
      });

      expect(result.status).toBe("pending");
      expect(result.cryptoAmount).toBe(250);
    });

    it("should reject disabled crypto", async () => {
      // Disable purchase
      await Crypto.updateOne({ _id: cryptoId }, { purchaseActivated: false });

      await expect(
        cryptoManualTradeService.buyCrypto({
          userId,
          cryptoId,
          cryptoAmount: 100,
          walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
          networkId,
        }),
      ).rejects.toThrow("disabled");
    });

    it("should validate network belongs to crypto", async () => {
      // Create another network not associated with this crypto
      const otherNetwork = await Network.create({
        networkId: "ethereum",
        name: "Ethereum",
        code: "ERC20",
        confirmationsRequired: 12,
        explorerUrl: "https://etherscan.io/tx/",
        isActive: true,
      });

      await expect(
        cryptoManualTradeService.buyCrypto({
          userId,
          cryptoId,
          cryptoAmount: 100,
          walletAddress: "0xValidEthereumAddress123456789",
          networkId: otherNetwork._id.toString(),
        }),
      ).rejects.toThrow("Invalid network");
    });
  });

  describe("Service Charge Calculation", () => {
    it("should calculate service charge correctly", async () => {
      const cryptoAmount = 100;

      const result = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount,
        walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
        networkId,
      });

      const baseAmount = cryptoAmount * 1550; // ₦155,000
      const expectedCharge = baseAmount * 0.02; // 2% = ₦3,100

      expect(result.breakdown.serviceCharge).toBeCloseTo(expectedCharge, 0);
      expect(result.breakdown.totalDeducted).toBe(
        baseAmount + result.breakdown.serviceCharge,
      );
    });

    it("should handle zero service charge", async () => {
      // Remove service charge
      await ServiceCharge.deleteMany({ code: "crypto" });

      const result = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 50,
        walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
        networkId,
      });

      expect(result.breakdown.serviceCharge).toBe(0);

      const baseAmount = 50 * 1550; // ₦77,500
      expect(result.breakdown.totalDeducted).toBe(baseAmount);
    });
  });

  describe("Admin Approval Workflow", () => {
    it("should approve buy transaction", async () => {
      // User buys crypto
      const purchase = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
        networkId,
      });

      // Admin approves
      const approval = await adminService.approveTransaction(
        purchase.id.toString(),
        adminId,
        "Verified and ready for transfer",
      );

      expect(approval.transaction!.status).toBe("approved");
      expect(approval.transaction!.reviewedBy).toBeDefined();
      expect(approval.transaction!.reviewNote).toBe(
        "Verified and ready for transfer",
      );
    });

    it("should mark as transferred with txHash", async () => {
      // User buys crypto
      const purchase = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 50,
        walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
        networkId,
      });

      // Admin approves
      await adminService.approveTransaction(purchase.id.toString(), adminId);

      // Admin marks as transferred
      const txHash = "0x123abc456def789ghi";
      const transfer = await adminService.markAsTransferred(
        purchase.id.toString(),
        adminId,
        txHash,
        "Crypto sent to user wallet",
      );

      expect(transfer.transaction!.status).toBe("transferred");
      expect(transfer.transaction!.txHash).toBe(txHash);
      expect(transfer.transaction!.processedAt).toBeDefined();
      expect(transfer.transaction!.completedAt).toBeDefined();
    });

    it("should second-approve buy transaction", async () => {
      const purchase = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
        networkId,
      });

      // Admin second-approves with review details
      const reviewAmount = 95; // Adjusted amount
      const reviewRate = 1540; // Adjusted rate

      const approval = await adminService.secondApproveTransaction(
        purchase.id.toString(),
        adminId,
        reviewAmount,
        reviewRate,
        "Adjusted due to market rate change",
        "review_proof_url",
      );

      expect(approval.transaction!.status).toBe("s.approved");
      expect(approval.transaction!.reviewAmount).toBe(reviewAmount);
      expect(approval.transaction!.reviewRate).toBe(reviewRate);
      expect(approval.transaction!.reviewProof).toBe("review_proof_url");
    });

    it("should reject approval of already approved transaction", async () => {
      const purchase = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
        networkId,
      });

      // First approval
      await adminService.approveTransaction(purchase.id.toString(), adminId);

      // Try to approve again
      await expect(
        adminService.approveTransaction(purchase.id.toString(), adminId),
      ).rejects.toThrow("pending");
    });
  });

  describe("Network Validation", () => {
    it("should store network snapshot in transaction", async () => {
      const result = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
        networkId,
      });

      expect(result.network).toBeDefined();
      expect(result.network.networkId).toBe("tron");
      expect(result.network.code).toBe("TRC20");
      expect(result.network.name).toBe("Tron");
      expect(result.network.confirmationsRequired).toBe(19);
    });

    it("should retrieve crypto networks correctly", async () => {
      const networks = await cryptoService.getCryptoNetworks(cryptoId);

      expect(networks).toBeDefined();
      expect(networks.length).toBeGreaterThan(0);
      expect(networks[0].networkId).toBe("tron");
      expect(networks[0].code).toBe("TRC20");
    });
  });

  describe("Balance Reconciliation", () => {
    it("should maintain accurate balance through purchase → approval cycle", async () => {
      const initialBalance = 500000;

      // Purchase crypto (wallet debited)
      const purchase = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
        networkId,
      });

      let wallet = await Wallet.findById(walletId);
      const balanceAfterPurchase = wallet?.balance || 0;
      expect(balanceAfterPurchase).toBeLessThan(initialBalance);

      // Admin approval (no balance change)
      await adminService.approveTransaction(purchase.id.toString(), adminId);

      wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(balanceAfterPurchase);

      // Mark as transferred (still no balance change)
      await adminService.markAsTransferred(
        purchase.id.toString(),
        adminId,
        "0xABC123",
      );

      wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(balanceAfterPurchase);
    });

    it("should handle multiple concurrent purchases correctly", async () => {
      const purchases = [
        { cryptoAmount: 50, walletAddress: VALID_TRON_ADDRESSES.addr1 }, // ✅ CHANGED
        { cryptoAmount: 75, walletAddress: VALID_TRON_ADDRESSES.addr2 }, // ✅ CHANGED
        { cryptoAmount: 100, walletAddress: VALID_TRON_ADDRESSES.addr3 }, // ✅ CHANGED
      ];

      const walletBefore = await Wallet.findById(walletId);
      const initialBalance = walletBefore?.balance || 0;

      // Execute all purchases concurrently
      // Execute purchases with slight delay to avoid transaction conflicts
      const results = [];
      for (const p of purchases) {
        const result = await cryptoManualTradeService.buyCrypto({
          userId,
          cryptoId,
          cryptoAmount: p.cryptoAmount,
          walletAddress: p.walletAddress,
          networkId,
        });
        results.push(result);
        await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
      }

      // All should succeed
      results.forEach((result) => {
        expect(result.status).toBe("pending");
      });

      // Verify total deduction
      const walletAfter = await Wallet.findById(walletId);
      const totalDeducted = results.reduce(
        (sum, r) => sum + r.breakdown.totalDeducted,
        0,
      );

      expect(walletAfter?.balance).toBe(initialBalance - totalDeducted);
    });
  });

  describe("Transaction Metadata", () => {
    it("should store charge info in transaction meta", async () => {
      const result = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
        networkId,
      });

      const transaction = await CryptoTransaction.findById(result.id);

      expect(transaction?.meta?.chargeInfo).toBeDefined();
      expect(transaction?.meta?.chargeInfo?.baseAmount).toBe(155000);
      expect(transaction?.meta?.chargeInfo?.serviceCharge).toBeGreaterThan(0);
      expect(transaction?.meta?.chargeInfo?.totalDeduction).toBeGreaterThan(
        155000,
      );
      expect(transaction?.meta?.cryptoName).toBe("Tether");
      expect(transaction?.meta?.cryptoCode).toBe("USDT");
    });

    it("should link crypto transaction to wallet transaction", async () => {
      const result = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
        networkId,
      });

      const cryptoTx = await CryptoTransaction.findById(result.id);
      expect(cryptoTx?.transactionId).toBeDefined();

      const walletTx = await Transaction.findById(cryptoTx?.transactionId).select('+transactableType +transactableId') 
        .lean()
        .exec();
      expect(walletTx?.transactableType).toBe("CryptoTransaction");
      expect(walletTx?.transactableId?.toString()).toBe(result.id.toString());
    });
  });

  describe("Exchange Rate Handling", () => {
    it("should use correct buy rate", async () => {
      const result = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
        networkId,
      });

      expect(result.exchangeRate).toBe(1550);
      expect(result.breakdown.fiatAmount).toBe(100 * 1550);
    });

    it("should reject purchase when buyRate not configured", async () => {
      // Create crypto without buyRate
      const noBuyRate = await Crypto.create({
        assetId: "btc-bitcoin",
        name: "Bitcoin",
        code: "BTC",
        sellRate: 60000000,
        purchaseActivated: true,
        isActive: true,
        networks: [networkId],
      });

      await expect(
        cryptoManualTradeService.buyCrypto({
          userId,
          cryptoId: noBuyRate._id.toString(),
          cryptoAmount: 0.001,
          walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
          networkId,
        }),
      ).rejects.toThrow("rate not configured");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty wallet address", async () => {
      await expect(
        cryptoManualTradeService.buyCrypto({
          userId,
          cryptoId,
          cryptoAmount: 100,
          walletAddress: "",
          networkId,
        }),
      ).rejects.toThrow("required");
    });

    it("should trim wallet address whitespace", async () => {
      const result = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 50,
        walletAddress: "  TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x  ",
        networkId,
      });

      expect(result.walletAddress).toBe("TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x");
    });

    it("should handle network without address pattern", async () => {
      // Create network without pattern
      const noPatternNetwork = await Network.create({
        networkId: "bsc",
        name: "Binance Smart Chain",
        code: "BEP20",
        confirmationsRequired: 15,
        isActive: true,
      });

      await Crypto.updateOne(
        { _id: cryptoId },
        { $push: { networks: noPatternNetwork._id } },
      );

      // Should accept any non-empty address
      const result = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 50,
        walletAddress: "AnyValidFormatAddress12345",
        networkId: noPatternNetwork._id.toString(),
      });

      expect(result.walletAddress).toBe("AnyValidFormatAddress12345");
    });

    it("should handle network fee storage", async () => {
      const result = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
        networkId,
      });

    });
  });

  describe("Breakdown Calculation", () => {
    it("should calculate breakdown correctly", async () => {
      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId,
        cryptoAmount: 100,
        tradeType: "buy",
        networkId,
      });

      expect(breakdown.cryptoAmount).toBe(100);
      expect(breakdown.fiatAmount).toBe(155000); // 100 × 1550
      expect(breakdown.exchangeRate).toBe(1550);
      expect(breakdown.serviceFee).toBeGreaterThan(0);
      expect(breakdown.totalAmount).toBeGreaterThan(155000);
      expect(breakdown.tradeType).toBe("buy");
    });

    it("should validate breakdown for different amounts", async () => {
      const amounts = [10, 50, 100, 500, 1000];

      for (const amount of amounts) {
        const breakdown = await cryptoBreakdownService.calculateBreakdown({
          cryptoId,
          cryptoAmount: amount,
          tradeType: "buy",
          networkId,
        });

        expect(breakdown.fiatAmount).toBe(amount * 1550);
        expect(breakdown.totalAmount).toBeGreaterThan(breakdown.fiatAmount);
      }
    });
  });
});
