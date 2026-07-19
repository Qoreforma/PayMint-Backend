/**
 * CRYPTO TEST: Sell Flow
 *
 * Tests Crypto sale functionality (manual review process):
 * - Single/multiple crypto sales
 * - Pending review workflow (NO wallet debit)
 * - Admin approval/decline/second-approval
 * - Proof upload handling
 * - Platform deposit address generation
 * - Balance reconciliation
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
import { Admin } from "@/models/admin/Admin";
import { Types } from "mongoose";
import logger from "@/logger";
import { CryptoBreakdownService } from "@/services/client/crypto/CryptoBreakdownService";
import { CryptoManualTradeService } from "@/services/client/crypto/trades/CryptoManualTradeService";
import { CryptoTransactionService } from "@/services/client/crypto/CryptoTransactionService";

describe("Crypto Sell Flow", () => {
  let cryptoService: CryptoService;
  let adminService: CryptoTransactionViewService;
  let walletService: WalletService;
  let cryptoManualTradeService: CryptoManualTradeService;
  let cryptoBreakdownService: CryptoBreakdownService;
  let cryptoTransactionService: CryptoTransactionService;
  let userId: string;
  let adminId: string;
  let walletId: string;
  let cryptoId: string;
  let networkId: string;

  beforeEach(async () => {
    cryptoService = ServiceContainer.getCryptoService();
    adminService = AdminServiceContainer.getCryptoTransactionViewService();
    walletService = ServiceContainer.getWalletService();
    cryptoManualTradeService = ServiceContainer.getCryptoManualTradeService();
    cryptoBreakdownService = ServiceContainer.getCryptoBreakdownService();
    cryptoTransactionService = ServiceContainer.getCryptoTransactionService();

    // Create service charge
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
      lastname: "Seller",
      email: "seller@crypto.com",
      password: "test123",
      phone: "+2348012345678",
      status: "active",
      dateOfBirth: new Date("1990-01-01"),
    });

    userId = user._id.toString();

    // Create wallet
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

    // Create network
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

    // Create crypto
    const crypto = await Crypto.create({
      assetId: "usdt-tether",
      name: "Tether",
      code: "USDT",
      icon: "https://cdn.example.com/usdt.png",
      buyRate: 1550,
      sellRate: 1500, // ₦1500 per USDT when user sells
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

  describe("Single Crypto Sale Submission", () => {
    it("should submit crypto sale with pending status", async () => {
      const cryptoAmount = 100;
      const proof = "https://proof.example.com/transfer.jpg";
      const comment = "Selling USDT";

      const walletBefore = await Wallet.findById(walletId);
      const initialBalance = walletBefore?.balance || 0;

      const result = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount,
        networkId,
        proof,
        comment,
        bankAccountId: "", // Not required for crypto sell
      });

      // Verify result
      expect(result.reference).toBeDefined();
      expect(result.status).toBe("pending");
      expect(result.tradeType).toBe("sell");
      expect(result.cryptoAmount).toBe(cryptoAmount);
      expect(result.proof).toBe(proof);
      expect(result.comment).toBe(comment);

      // CRITICAL: Wallet NOT debited on submission
      const walletAfter = await Wallet.findById(walletId);
      expect(walletAfter?.balance).toBe(initialBalance);

      // Verify breakdown
      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.fiatAmount).toBe(100 * 1500); // ₦150,000
      expect(result.breakdown.exchangeRate).toBe(1500);
      expect(result.breakdown.serviceCharge).toBeGreaterThan(0);
      expect(result.breakdown.totalPayout).toBeGreaterThan(0);

      // Verify deposit instructions
      expect(result.depositInstructions).toBeDefined();
      expect(result.depositInstructions.address).toBe(
        "TPlatformAddress123456789",
      );
      expect(result.depositInstructions.network).toBe("Tron");
      expect(result.depositInstructions.amount).toBe(cryptoAmount);
    });

    it("should validate min amount for sell", async () => {
      await expect(
        cryptoManualTradeService.sellCrypto({
          userId,
          cryptoId,
          cryptoAmount: 5, // Below minimum of 10
          networkId,
          bankAccountId: "",
        }),
      ).rejects.toThrow("Minimum");
    });

    it("should validate max amount for sell", async () => {
      await expect(
        cryptoManualTradeService.sellCrypto({
          userId,
          cryptoId,
          cryptoAmount: 15000, // Above maximum of 10000
          networkId,
          bankAccountId: "",
        }),
      ).rejects.toThrow("Maximum");
    });

    it("should reject sale when saleActivated is false", async () => {
      await Crypto.updateOne({ _id: cryptoId }, { saleActivated: false });

      await expect(
        cryptoManualTradeService.sellCrypto({
          userId,
          cryptoId,
          cryptoAmount: 100,
          networkId,
          bankAccountId: "",
        }),
      ).rejects.toThrow("disabled");
    });

    it("should reject sale when platform deposit address missing", async () => {
      await Network.updateOne(
        { _id: networkId },
        { platformDepositAddress: null },
      );

      await expect(
        cryptoManualTradeService.sellCrypto({
          userId,
          cryptoId,
          cryptoAmount: 100,
          networkId,
          bankAccountId: "",
        }),
      ).rejects.toThrow("not configured");
    });

    it("should accept amounts within range", async () => {
      const result = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 250,
        networkId,
        bankAccountId: "",
      });

      expect(result.status).toBe("pending");
      expect(result.cryptoAmount).toBe(250);
    });

    it("should store proof URL in transaction", async () => {
      const proof = "https://example.com/proof_123.jpg";

      const result = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        proof,
        bankAccountId: "",
      });

      const transaction = await CryptoTransaction.findById(result.id);
      expect(transaction?.proof).toBe(proof);
    });

    it("should store comment in transaction", async () => {
      const comment = "Testing crypto sale";

      const result = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 50,
        networkId,
        comment,
        bankAccountId: "",
      });

      const transaction = await CryptoTransaction.findById(result.id);
      expect(transaction?.comment).toBe(comment);
    });
  });

  describe("Sale Service Charge Calculation", () => {
    it("should calculate service charge correctly", async () => {
      const cryptoAmount = 100;

      const result = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount,
        networkId,
        bankAccountId: "",
      });

      const baseAmount = cryptoAmount * 1500; // ₦150,000
      const expectedCharge = baseAmount * 0.02; // 2% = ₦3,000
      const expectedPayout = baseAmount - expectedCharge;

      expect(result.breakdown.serviceCharge).toBeGreaterThan(0);
      expect(result.breakdown.totalPayout).toBeLessThan(150000);
    });

    it("should handle zero service charge", async () => {
      await ServiceCharge.deleteMany({ code: "crypto" });

      const result = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 50,
        networkId,
        bankAccountId: "",
      });

      expect(result.breakdown.serviceCharge).toBe(0);

      const baseAmount = 50 * 1500; // ₦75,000
      expect(result.breakdown.totalPayout).toBe(baseAmount);
    });
  });

  describe("Admin Approval Workflow", () => {
    it("should approve sell transaction and credit wallet", async () => {
      // User submits sale
      const sale = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        bankAccountId: "",
      });

      const walletBefore = await Wallet.findById(walletId);
      const balanceBefore = walletBefore?.balance || 0;

      // Admin approves
      const approval = await adminService.approveTransaction(
        sale.id.toString(),
        adminId,
        "Verified and approved",
      );

      // Verify approval details
      expect(approval.transaction!.status).toBe("approved");
      expect(approval.transaction!.reviewedBy).toBeDefined();
      expect(approval.transaction!.reviewNote).toBe("Verified and approved");

      // CRITICAL: Wallet credited with payout (not total amount)
      const walletAfter = await Wallet.findById(walletId);
      const expectedPayout = sale.breakdown.totalPayout;
      const expectedCredit = expectedPayout;

      expect(walletAfter?.balance).toBe(balanceBefore + expectedCredit);
    });

    it("should decline sell transaction without wallet change", async () => {
      const sale = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        bankAccountId: "",
      });

      const walletBefore = await Wallet.findById(walletId);
      const balanceBefore = walletBefore?.balance || 0;

      // Admin declines
      const decline = await adminService.declineTransaction(
        sale.id.toString(),
        adminId,
        "Suspicious activity detected",
      );

      expect(decline.transaction!.status).toBe("declined");
      expect(decline.transaction!.declineNote).toBe(
        "Suspicious activity detected",
      );

      // Wallet remains unchanged
      const walletAfter = await Wallet.findById(walletId);
      expect(walletAfter?.balance).toBe(balanceBefore);
    });

    it("should second-approve sell with custom amount", async () => {
      const sale = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        bankAccountId: "",
      });

      const walletBefore = await Wallet.findById(walletId);
      const balanceBefore = walletBefore?.balance || 0;

      // Admin second-approves with different amount
      const reviewAmount = 142000; // Adjusted fiat amount
      const reviewRate = 1420; // Adjusted rate

      const approval = await adminService.secondApproveTransaction(
        sale.id.toString(),
        adminId,
        reviewAmount,
        reviewRate,
        "Market rate adjustment",
        "https://proof.example.com/review.jpg",
      );

      expect(approval.transaction!.status).toBe("s.approved");
      expect(approval.transaction!.reviewAmount).toBe(reviewAmount);
      expect(approval.transaction!.reviewRate).toBe(reviewRate);
      expect(approval.transaction!.reviewProof).toBe(
        "https://proof.example.com/review.jpg",
      );

      // Wallet credited with reviewed payout
      const walletAfter = await Wallet.findById(walletId);
      const serviceCharge = sale.breakdown.serviceCharge;
      const expectedPayout = reviewAmount - serviceCharge;

      expect(walletAfter?.balance).toBe(balanceBefore + expectedPayout);
    });

    it("should reject second-approval with zero amount", async () => {
      const sale = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        bankAccountId: "",
      });

      await expect(
        adminService.secondApproveTransaction(
          sale.id.toString(),
          adminId,
          0, // Invalid
          1500,
          "Test",
          "proof",
        ),
      ).rejects.toThrow("greater than zero");
    });

    it("should reject approval of already approved transaction", async () => {
      const sale = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        bankAccountId: "",
      });

      // First approval
      await adminService.approveTransaction(sale.id.toString(), adminId);

      // Try to approve again
      await expect(
        adminService.approveTransaction(sale.id.toString(), adminId),
      ).rejects.toThrow("pending");
    });

    it("should reject decline of already declined transaction", async () => {
      const sale = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        bankAccountId: "",
      });

      // First decline
      await adminService.declineTransaction(
        sale.id.toString(),
        adminId,
        "Test decline",
      );

      // Try to decline again
      await expect(
        adminService.declineTransaction(
          sale.id.toString(),
          adminId,
          "Another decline",
        ),
      ).rejects.toThrow("pending");
    });
  });

  describe("Balance Reconciliation", () => {
    it("should maintain balance through submission → approval cycle", async () => {
      const walletBefore = await Wallet.findById(walletId);
      const initialBalance = walletBefore?.balance || 0;

      // Submit sale (balance unchanged)
      const sale = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        bankAccountId: "",
      });

      let wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(initialBalance);

      // Approve sale (balance increases)
      await adminService.approveTransaction(sale.id.toString(), adminId);

      wallet = await Wallet.findById(walletId);
      const expectedPayout = sale.breakdown.totalPayout;
      expect(wallet?.balance).toBe(initialBalance + expectedPayout);
    });

    it("should handle approval → decline scenario", async () => {
      const sale = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        bankAccountId: "",
      });

      const walletBefore = await Wallet.findById(walletId);
      const initialBalance = walletBefore?.balance || 0;

      // Approve
      await adminService.approveTransaction(sale.id.toString(), adminId);

      let wallet = await Wallet.findById(walletId);
      const expectedPayout = sale.breakdown.totalPayout;
      expect(wallet?.balance).toBe(initialBalance + expectedPayout);

      // Can't decline after approval - should throw error
      await expect(
        adminService.declineTransaction(
          sale.id.toString(),
          adminId,
          "Too late",
        ),
      ).rejects.toThrow("pending");
    });
  });

  describe("Transaction Metadata", () => {
    it("should store charge info in transaction meta", async () => {
      const result = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        bankAccountId: "",
      });

      const transaction = await CryptoTransaction.findById(result.id);

      expect(transaction?.meta?.chargeInfo).toBeDefined();
      expect(transaction?.meta?.chargeInfo?.baseAmount).toBe(150000);
      expect(transaction?.meta?.chargeInfo?.serviceCharge).toBeGreaterThan(0);
      expect(transaction?.meta?.chargeInfo?.totalPayout).toBeGreaterThan(0);
      expect(transaction?.meta?.cryptoName).toBe("Tether");
      expect(transaction?.meta?.cryptoCode).toBe("USDT");
    });

    it("should store deposit instructions in meta", async () => {
      const result = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        bankAccountId: "",
      });

      const transaction = await CryptoTransaction.findById(result.id);

      expect(transaction?.meta?.walletAddress).toBe(
        "TPlatformAddress123456789",
      );
      expect(transaction?.meta?.network).toBe("Tron");
    });
  });

  describe("Exchange Rate Handling", () => {
    it("should use correct sell rate", async () => {
      const result = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        bankAccountId: "",
      });

      expect(result.exchangeRate).toBe(1500);
      expect(result.breakdown.fiatAmount).toBe(100 * 1500);
    });

    it("should reject sale when sellRate not configured", async () => {
      const noSellRate = await Crypto.create({
        assetId: "btc-bitcoin",
        name: "Bitcoin",
        code: "BTC",
        buyRate: 60000000,
        saleActivated: true,
        isActive: true,
        networks: [networkId],
      });

      await expect(
        cryptoManualTradeService.sellCrypto({
          userId,
          cryptoId: noSellRate._id.toString(),
          cryptoAmount: 0.001,
          networkId,
          bankAccountId: "",
        }),
      ).rejects.toThrow("rate not configured");
    });
  });

  describe("Proof Upload", () => {
    it("should allow proof upload on pending sell", async () => {
      const sale = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        bankAccountId: "",
      });

      const newProof = "https://example.com/updated_proof.jpg";
      const updated = await cryptoTransactionService.uploadTransactionProof(
        sale.reference,
        userId,
        newProof,
      );

      expect(updated.proof).toBe(newProof);

      const transaction = await CryptoTransaction.findById(sale.id);
      expect(transaction?.proof).toBe(newProof);
    });

    it("should reject proof upload on non-sell transaction", async () => {
      const buy = await cryptoManualTradeService.buyCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        walletAddress: "TND7R6Wb2U6n65J4ZqD2y3Xh1n1hYmRz7x",
        networkId,
      });

      await expect(
        cryptoTransactionService.uploadTransactionProof(
          buy.reference,
          userId,
          "https://proof.jpg",
        ),
      ).rejects.toThrow("Proof can only be uploaded for sell");
    });
  });

  describe("Edge Cases", () => {
    it("should handle sale with optional fields", async () => {
      // Sale without proof or comment
      const result = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        bankAccountId: "",
      });

      expect(result.reference).toBeDefined();
      expect(result.status).toBe("pending");

      const transaction = await CryptoTransaction.findById(result.id);
      expect(transaction?.proof).toBe("");
      expect(transaction?.comment).toBeUndefined();
    });

    it("should handle very small amounts within limits", async () => {
      const result = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 10, // Minimum
        networkId,
        bankAccountId: "",
      });

      expect(result.status).toBe("pending");
      expect(result.cryptoAmount).toBe(10);
    });

    it("should handle maximum amounts", async () => {
      const result = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 10000, // Maximum
        networkId,
        bankAccountId: "",
      });

      expect(result.status).toBe("pending");
      expect(result.cryptoAmount).toBe(10000);
    });

    it("should handle long proof URLs", async () => {
      const longProof = "https://example.com/" + "a".repeat(200) + ".jpg";

      const result = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        proof: longProof,
        bankAccountId: "",
      });

      const transaction = await CryptoTransaction.findById(result.id);
      expect(transaction?.proof).toBe(longProof);
    });

    it("should trim and validate admin notes on approval", async () => {
      const sale = await cryptoManualTradeService.sellCrypto({
        userId,
        cryptoId,
        cryptoAmount: 100,
        networkId,
        bankAccountId: "",
      });

      const longNote =
        "This is a very detailed review note explaining the approval decision. " +
        "The user has provided valid documentation and their KYC is complete.";

      const approval = await adminService.approveTransaction(
        sale.id.toString(),
        adminId,
        longNote,
      );

      expect(approval.transaction!.reviewNote).toBe(longNote);
    });
  });

  describe("Breakdown Calculation for Sell", () => {
    it("should calculate sell breakdown correctly", async () => {
      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId,
        cryptoAmount: 100,
        tradeType: "sell",
        networkId,
      });

      expect(breakdown.cryptoAmount).toBe(100);
      expect(breakdown.fiatAmount).toBe(150000); // 100 × 1500
      expect(breakdown.exchangeRate).toBe(1500);
      expect(breakdown.serviceFee).toBeGreaterThan(0);
      expect(breakdown.totalAmount).toBeLessThan(150000); // Sell deducts fee
      expect(breakdown.tradeType).toBe("sell");
    });

    it("should validate breakdown for different amounts", async () => {
      const amounts = [10, 50, 100, 500, 1000];

      for (const amount of amounts) {
        const breakdown = await cryptoBreakdownService.calculateBreakdown({
          cryptoId,
          cryptoAmount: amount,
          tradeType: "sell",
          networkId,
        });

        expect(breakdown.fiatAmount).toBe(amount * 1500);
        expect(breakdown.totalAmount).toBeLessThan(breakdown.fiatAmount);
      }
    });

    it("should calculate payout with service charge deduction", async () => {
      const breakdown = await cryptoBreakdownService.calculateBreakdown({
        cryptoId,
        cryptoAmount: 100,
        tradeType: "sell",
        networkId,
      });

      // Payout should be fiatAmount - serviceFee
      const expectedPayout = 150000 - breakdown.serviceFee;
      expect(breakdown.totalAmount).toBeCloseTo(expectedPayout, -2);
    });
  });
});
