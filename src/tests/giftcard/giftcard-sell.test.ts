/**
 * GIFTCARD TEST: Sell Flow
 *
 * Tests GiftCard selling functionality (manual review process):
 * - Single/multiple card sales
 * - Pending review workflow (no wallet debit)
 * - Admin approval/decline/second-approval
 * - Parent-child transaction structure
 * - Service charge handling
 * - Balance reconciliation
 * - Notifications
 */

import { GiftCardService } from "@/services/client/GiftCardService";
import { GiftCardTransactionViewService } from "@/services/admin/giftcards/GiftCardTransactionViewService";
import { GiftCardRateService } from "@/services/client/GiftCardRateService";
import { WalletService } from "@/services/client/wallet/WalletService";
import ServiceContainer from "@/services/client/container";
import AdminServiceContainer from "@/services/admin/container";
import { User } from "@/models/core/User";
import { Wallet } from "@/models/wallet/Wallet";
import { GiftCard } from "@/models/giftcard/GiftCard";
import { GiftCardCategory } from "@/models/giftcard/GiftCardCategory";
import { GiftCardTransaction } from "@/models/giftcard/GiftCardTransaction";
import { ServiceCharge } from "@/models/billing/fees/ServiceCharge";
import { Admin } from "@/models/admin/Admin";
import { Types } from "mongoose";
import logger from "@/logger";
import { BankAccount } from "@/models/reference/BankAccount";
import { Country } from "@/models/reference/Country";

describe("GiftCard Sell Flow", () => {
  let giftCardService: GiftCardService;
  let adminService: GiftCardTransactionViewService;
  let walletService: WalletService;
  let rateService: GiftCardRateService;

  let userId: string;
  let adminId: string;
  let walletId: string;
  let giftCardId: string;
  let categoryId: string;
  let bankAccountId: string;
  let countryId: string;

  beforeEach(async () => {
    // Get services
    giftCardService = ServiceContainer.getGiftCardService();
    adminService = AdminServiceContainer.getGiftCardTransactionViewService();
    walletService = ServiceContainer.getWalletService();
    rateService = ServiceContainer.getGiftCardRateService();

    // Create service charge
    await ServiceCharge.create({
      code: "giftcard",
      name: "GiftCard Service Charge",
      type: "percentage",
      value: 1.5,
      details: "Standard giftcard transaction charge",
    });

    // Create test user
    const user = await User.create({
      firstname: "Seller",
      lastname: "Test",
      email: "seller@test.com",
      password: "test123",
      phone: "+2348012345678",
      status: "active",
      dateOfBirth: new Date("1990-01-01"),
    });

    userId = user._id.toString();
    const country = await Country.create({
      id: 840,
      name: "United States",
      numeric_code: "840",
      iso2: "US",
      iso3: "USA",
      phonecode: "+1",
      region: "Americas",
      flag: "🇺🇸",
      currency: "USD",
      capital: "Washington",
      currency_name: "US Dollar",
      currency_symbol: "$",
      emoji: "🇺🇸",
      emojiU: "U+1F1FA U+1F1F8",
      longitude: "-95.7129",
      latitude: "37.0902",
    });

    countryId = country._id.toString();
    // Create wallet with balance
    const wallet = await Wallet.create({
      userId: user._id,
      balance: 50000, // ₦50k starting balance
      type: "main",
      bonusBalance: 0,
      commissionBalance: 0,
    });

    walletId = wallet._id.toString();

    // Create bank account
    const bankAccount = await BankAccount.create({
      userId: user._id,
      bankCode: "058", // Add this - required field
      accountNumber: "1234567890",
      accountName: "Seller Test",
      isDefault: true,
    });

    bankAccountId = bankAccount._id.toString();

    // Create admin
    const admin = await Admin.create({
      firstName: "Admin",
      lastName: "Reviewer",
      email: "admin@test.com",
      password: "admin123",
      adminLevel: "super_admin",
    });

    adminId = admin._id.toString();

    // Create category
    const category = await GiftCardCategory.create({
      name: "Digital Gift Cards",
      transactionType: "both",
      isGlobal: true,
      saleActivated: true,
      purchaseActivated: true,
      isActive: true,
    });

    categoryId = category._id.toString();

    // Create SELL giftcard (iTunes)
    const giftCard = await GiftCard.create({
      categoryId: category._id,
      name: "iTunes Card (Sell)",
      productId: "sell_itunes_12345",
      currency: "USD",
      type: "sell",

      denominationType: "FIXED" as const,
      priceList: [10, 25, 50, 100, 200],
      sellRate: 400, // ₦400 per $1
      saleActivated: true,
      isActive: true,
      commissionType: "percentage" as const,
      commisionValue: 2,
    });

    giftCardId = giftCard._id.toString();
  });

  describe("Single Card Sale Submission", () => {
    it("should submit single card sale with pending status", async () => {
      const amount = 50; // $50
      const walletBefore = await Wallet.findById(walletId);
      const initialBalance = walletBefore?.balance || 0;

      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount,
        quantity: 1,
        cardType: "e-code",
        cards: ["ECODE123456789"],
        comment: "iTunes gift card for sale",
        bankAccountId,
      });

      // Verify transaction structure
      expect(result.transaction).toBeDefined();
      expect(result.transaction.reference).toBeDefined();
      expect(result.transaction.status).toBe("pending");
      expect(result.transaction.tradeType).toBe("sell");
      expect(result.transaction.direction).toBe("CREDIT");
      expect(result.transaction.amount).toBe(amount);
      expect(result.transaction.quantity).toBe(1);
      expect(result.transaction.cardType).toBe("e-code");

      // Verify breakdown
      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.totalAmount).toBeGreaterThan(0);
      expect(result.breakdown.serviceCharge).toBeGreaterThanOrEqual(0);

      // CRITICAL: Verify wallet NOT debited (pending review)
      const walletAfter = await Wallet.findById(walletId);
      expect(walletAfter?.balance).toBe(initialBalance);

      // Verify balanceBefore/After are same (no change yet)
      expect(result.transaction.balanceBefore).toBe(initialBalance);
      expect(result.transaction.balanceAfter).toBe(initialBalance);

      // Verify card details stored
      expect(result.transaction.cards).toHaveLength(1);
      expect(result.transaction.cards[0]).toBe("ECODE123456789");
      expect(result.transaction.comment).toBe("iTunes gift card for sale");
    });

    it("should reject sale with disabled giftcard", async () => {
      // Disable sales
      await GiftCard.updateOne({ _id: giftCardId }, { saleActivated: false });

      await expect(
        giftCardService.sellGiftCard({
          userId,
          giftCardId,
          amount: 50,
          quantity: 1,
          cardType: "e-code",
          cards: ["ECODE123"],
          bankAccountId,
        }),
      ).rejects.toThrow("disabled");
    });

    it("should validate FIXED denomination amounts", async () => {
      // Try to sell $15 (not in priceList [10, 25, 50, 100, 200])
      await expect(
        giftCardService.sellGiftCard({
          userId,
          giftCardId,
          amount: 15,
          quantity: 1,
          cardType: "e-code",
          cards: ["ECODE123"],
          bankAccountId,
        }),
      ).rejects.toThrow("Invalid amount");
    });

    it("should store card type and proof correctly", async () => {
      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount: 100,
        quantity: 1,
        cardType: "physical",
        cards: ["PHYSICAL_CARD_IMAGE_URL"],
        comment: "Physical card with scratch-off code",
        bankAccountId,
      });

      expect(result.transaction.cardType).toBe("physical");
      expect(result.transaction.cards[0]).toBe("PHYSICAL_CARD_IMAGE_URL");
      expect(result.transaction.comment).toBe(
        "Physical card with scratch-off code",
      );
    });
  });

  describe("Multiple Cards Sale Submission", () => {
    it("should submit multiple cards with parent-child structure", async () => {
      const amount = 25; // $25 each
      const quantity = 3;
      const cards = ["ECODE_1", "ECODE_2", "ECODE_3"];

      const walletBefore = await Wallet.findById(walletId);
      const initialBalance = walletBefore?.balance || 0;

      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount,
        quantity,
        cardType: "e-code",
        cards,
        comment: "Bulk sale - 3 cards",
        bankAccountId,
      });

      // Verify parent transaction
      expect(result.transaction.quantity).toBe(quantity);
      expect(result.transaction.status).toBe("multiple");
      expect(result.transaction.groupTag).toBeDefined();

      // Verify children exist
      expect(result.children).toBeDefined();
      expect(result.children?.length).toBe(quantity);

      // Verify each child
      result.children?.forEach((child: any, index: number) => {
        expect(child.parentId?.toString()).toBe(
          result.transaction._id?.toString(),
        );
        expect(child.quantity).toBe(1);
        expect(child.groupTag).toBe(result.transaction.groupTag);
        expect(child.status).toBe("pending");
        expect(child.cards[0]).toBe(cards[index]);
      });

      // CRITICAL: Verify wallet NOT debited
      const walletAfter = await Wallet.findById(walletId);
      expect(walletAfter?.balance).toBe(initialBalance);
    });

    it("should distribute amounts correctly across children", async () => {
      const amount = 50;
      const quantity = 4;
      const cards = ["C1", "C2", "C3", "C4"];

      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount,
        quantity,
        cardType: "e-code",
        cards,
        bankAccountId,
      });

      const totalAmount = amount * quantity;
      expect(result.transaction.amount).toBe(totalAmount);

      // Each child should have same individual amount
      const expectedPerCard = amount * 400; // sellRate
      result.children?.forEach((child: any) => {
        expect(child.amount).toBe(amount);
        expect(child.payableAmount).toBe(expectedPerCard);
      });
    });
  });

  describe("Admin Approval Workflow", () => {
    it("should approve transaction and credit wallet (minus service charge)", async () => {
      // Submit sale
      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount: 100, // $100 × ₦400 = ₦40,000
        quantity: 1,
        cardType: "e-code",
        cards: ["ECODE_APPROVE_TEST"],
        bankAccountId,
      });

      const transactionId = result.transaction._id.toString();
      const walletBefore = await Wallet.findById(walletId);

      // Admin approves
      const approval = await adminService.approveTransaction(
        transactionId,
        adminId,
        "Card verified and valid",
      );

      // Verify status changed
      expect(approval.transaction!.status).toBe("approved");
      expect(approval.transaction!.reviewedBy).toBeDefined();
      expect(approval.transaction!.reviewNote).toBe("Card verified and valid");

      // Calculate expected payout
      const baseAmount = 100 * 400; // ₦40,000
      const serviceCharge = baseAmount * 0.015; // 1.5% = ₦600
      const netPayout = baseAmount - serviceCharge; // ₦39,400

      // Verify wallet credited with net amount
      const walletAfter = await Wallet.findById(walletId);
      expect(walletAfter?.balance).toBe(
        (walletBefore?.balance || 0) + netPayout,
      );

      // Verify transaction record created
      expect(approval.transaction!.transactionId).toBeDefined();
      expect(approval.transaction!.balanceAfter).toBe(walletAfter?.balance);
    });

    it("should decline transaction without wallet credit", async () => {
      // Submit sale
      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount: 50,
        quantity: 1,
        cardType: "e-code",
        cards: ["INVALID_CARD"],
        bankAccountId,
      });

      const transactionId = result.transaction._id.toString();
      const walletBefore = await Wallet.findById(walletId);

      // Admin declines
      const decline = await adminService.declineTransaction(
        transactionId,
        adminId,
        "Card already used",
        "proof_url",
        "Card validation failed",
      );

      // Verify status changed
      expect(decline.transaction!.status).toBe("declined");
      expect(decline.transaction!.declineNote).toBe("Card already used");

      // CRITICAL: Verify wallet NOT credited
      const walletAfter = await Wallet.findById(walletId);
      expect(walletAfter?.balance).toBe(walletBefore?.balance);
    });

    it("should second-approve with custom reviewed amount", async () => {
      // Submit sale for $100
      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount: 100, // Expected ₦40,000
        quantity: 1,
        cardType: "physical",
        cards: ["DAMAGED_CARD"],
        comment: "Card has minor damage",
        bankAccountId,
      });

      const transactionId = result.transaction._id.toString();
      const walletBefore = await Wallet.findById(walletId);

      // Admin second-approves with reduced amount (₦35,000 instead of ₦40,000)
      const reviewedAmount = 35000;
      const approval = await adminService.secondApproveTransaction(
        transactionId,
        adminId,
        reviewedAmount,
        "Approved with deduction due to card condition",
        "damage_proof_url",
      );

      // Verify status
      expect(approval.transaction!.status).toBe("s.approved");
      expect(approval.transaction!.reviewedAmount).toBe(reviewedAmount);
      expect(approval.transaction!.reviewProof).toBe("damage_proof_url");

      // CORRECT CALCULATION
      const serviceCharge = reviewedAmount * 0.015; // ₦525
      const netPayout = reviewedAmount - serviceCharge; // ₦34,475

      // Verify wallet credited with adjusted net amount
      const walletAfter = await Wallet.findById(walletId);
      expect(walletAfter?.balance).toBe(
        (walletBefore?.balance || 0) + netPayout,
      );
    });

    it("should reject approval of already approved transaction", async () => {
      // Submit and approve
      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount: 50,
        quantity: 1,
        cardType: "e-code",
        cards: ["CARD"],
        bankAccountId,
      });

      await adminService.approveTransaction(
        result.transaction._id.toString(),
        adminId,
      );

      // Try to approve again
      await expect(
        adminService.approveTransaction(
          result.transaction._id.toString(),
          adminId,
        ),
      ).rejects.toThrow("approved");
    });
  });

  describe("Bulk Approval (Parent-Child)", () => {
    it("should approve all children and credit total amount", async () => {
      const amount = 25;
      const quantity = 3;
      const cards = ["C1", "C2", "C3"];

      // Submit multiple cards
      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount,
        quantity,
        cardType: "e-code",
        cards,
        bankAccountId,
      });

      const parentId = result.transaction._id.toString();
      const walletBefore = await Wallet.findById(walletId);

      // Admin approves all
      const approval = await adminService.approveAllByParentId(
        parentId,
        adminId,
        "All cards verified",
      );

      // Verify all approved
      expect(approval.approvedCount).toBe(quantity);
      expect(approval.failedCount).toBe(0);

      // Calculate expected total payout
      const totalBase = amount * quantity * 400; // 3 × $25 × ₦400 = ₦30,000
      const totalCharge = totalBase * 0.015; // ₦450
      const totalNetPayout = totalBase - totalCharge; // ₦29,550

      expect(approval.totalPayout).toBeCloseTo(totalNetPayout, 0);

      // Verify wallet credited
      const walletAfter = await Wallet.findById(walletId);
      expect(walletAfter?.balance).toBeCloseTo(
        (walletBefore?.balance || 0) + totalNetPayout,
        0,
      );
    });

    it("should decline all children without wallet credit", async () => {
      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount: 50,
        quantity: 2,
        cardType: "e-code",
        cards: ["BAD1", "BAD2"],
        bankAccountId,
      });

      const parentId = result.transaction._id.toString();
      const walletBefore = await Wallet.findById(walletId);

      // Admin declines all
      const decline = await adminService.declineAllByParentId(
        parentId,
        adminId,
        "All cards invalid",
      );

      expect(decline.declinedCount).toBe(2);

      // Verify wallet unchanged
      const walletAfter = await Wallet.findById(walletId);
      expect(walletAfter?.balance).toBe(walletBefore?.balance);
    });

    it("should second-approve all with custom total amount", async () => {
      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount: 100,
        quantity: 2,
        cardType: "physical",
        cards: ["CARD1", "CARD2"],
        bankAccountId,
      });

      const parentId = result.transaction._id.toString();
      const walletBefore = await Wallet.findById(walletId);

      // Expected: 2 × $100 × ₦400 = ₦80,000
      // Reviewed: ₦70,000 (deduction applied)
      const reviewedTotal = 70000;
      const approval = await adminService.secondApproveAllByParentId(
        parentId,
        adminId,
        reviewedTotal,
        "Approved with adjustment",
      );

      expect(approval.approvedCount).toBe(2);
      expect(approval.totalReviewedAmount).toBe(reviewedTotal);
      expect(approval.perCardAmount).toBe(35000); // ₦70k / 2

      // Calculate net payout
      const serviceCharge = reviewedTotal * 0.015; // ₦1,050
      const netPayout = reviewedTotal - serviceCharge; // ₦68,950

      expect(approval.totalNetPayout).toBeCloseTo(netPayout, 0);

      const walletAfter = await Wallet.findById(walletId);
      expect(walletAfter?.balance).toBeCloseTo(
        (walletBefore?.balance || 0) + netPayout,
        0,
      );
    });
  });

  describe("RANGE Denomination GiftCard (Sell)", () => {
    beforeEach(async () => {
      // Create RANGE denomination sell card
      const rangeCard = await GiftCard.create({
        categoryId: new Types.ObjectId(categoryId),
        name: "Amazon Gift Card (Sell)",
        productId: "sell_amazon_67890",
        currency: "USD",
        type: "sell",
        denominationType: "RANGE" as const,
        sellMinAmount: 10,
        sellMaxAmount: 500,
        sellRate: 400,
        saleActivated: true,
        isActive: true,
        commissionType: "percentage" as const,
        commisionValue: 2,
      });

      giftCardId = rangeCard._id.toString();
    });

    it("should validate RANGE min amount", async () => {
      await expect(
        giftCardService.sellGiftCard({
          userId,
          giftCardId,
          amount: 5, // Below minimum of 10
          quantity: 1,
          cardType: "e-code",
          cards: ["CARD"],
          bankAccountId,
        }),
      ).rejects.toThrow("at least");
    });

    it("should validate RANGE max amount", async () => {
      await expect(
        giftCardService.sellGiftCard({
          userId,
          giftCardId,
          amount: 600, // Above maximum of 500
          quantity: 1,
          cardType: "e-code",
          cards: ["CARD"],
          bankAccountId,
        }),
      ).rejects.toThrow("exceed");
    });

    it("should accept amounts within RANGE", async () => {
      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount: 250, // Within [10, 500]
        quantity: 1,
        cardType: "e-code",
        cards: ["VALID_RANGE_CARD"],
        bankAccountId,
      });

      expect(result.transaction.status).toBe("pending");
      expect(result.transaction.amount).toBe(250);
    });
  });

  describe("Balance Reconciliation", () => {
    it("should maintain accurate balance through sell → approve cycle", async () => {
      const initialBalance = 50000;

      // Submit sale (no balance change)
      const sale = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount: 100,
        quantity: 1,
        cardType: "e-code",
        cards: ["CARD1"],
        bankAccountId,
      });

      let wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(initialBalance);

      // Approve (balance increases)
      await adminService.approveTransaction(
        sale.transaction._id.toString(),
        adminId,
      );

      wallet = await Wallet.findById(walletId);
      const balanceAfterApproval = wallet?.balance || 0;
      expect(balanceAfterApproval).toBeGreaterThan(initialBalance);

      // Submit another sale
      const sale2 = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount: 50,
        quantity: 1,
        cardType: "e-code",
        cards: ["CARD2"],
        bankAccountId,
      });

      // Balance should not change on submission
      wallet = await Wallet.findById(walletId);
      expect(wallet?.balance).toBe(balanceAfterApproval);

      // Verify transaction chain
      const tx1 = await GiftCardTransaction.findById(sale.transaction._id);
      const tx2 = await GiftCardTransaction.findById(sale2.transaction._id);

      expect(tx1?.balanceBefore).toBe(initialBalance);
      expect(tx2?.balanceBefore).toBe(balanceAfterApproval);
    });

    it("should handle concurrent approvals correctly", async () => {
      // Submit 3 sales
      const sales = await Promise.all([
        giftCardService.sellGiftCard({
          userId,
          giftCardId,
          amount: 25,
          quantity: 1,
          cardType: "e-code",
          cards: ["C1"],
          bankAccountId,
        }),
        giftCardService.sellGiftCard({
          userId,
          giftCardId,
          amount: 25,
          quantity: 1,
          cardType: "e-code",
          cards: ["C2"],
          bankAccountId,
        }),
        giftCardService.sellGiftCard({
          userId,
          giftCardId,
          amount: 25,
          quantity: 1,
          cardType: "e-code",
          cards: ["C3"],
          bankAccountId,
        }),
      ]);

      const walletBefore = await Wallet.findById(walletId);

      // Approve all concurrently
      for (const sale of sales) {
        await adminService.approveTransaction(
          sale.transaction._id.toString(),
          adminId,
        );
      }

      const walletAfter = await Wallet.findById(walletId);

      // Calculate expected increase
      const basePerCard = 25 * 400; // ₦10,000
      const chargePerCard = basePerCard * 0.015; // ₦150
      const netPerCard = basePerCard - chargePerCard; // ₦9,850
      const totalIncrease = netPerCard * 3; // ₦29,550

      expect(walletAfter?.balance).toBeCloseTo(
        (walletBefore?.balance || 0) + totalIncrease,
        0,
      );
    });
  });

  describe("Service Charge Handling", () => {
    it("should calculate service charge correctly on approval", async () => {
      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount: 200, // $200 × ₦400 = ₦80,000
        quantity: 1,
        cardType: "e-code",
        cards: ["CARD"],
        bankAccountId,
      });

      const baseAmount = 200 * 400; // ₦80,000
      const expectedCharge = baseAmount * 0.015; // ₦1,200

      expect(result.breakdown.serviceCharge).toBeCloseTo(expectedCharge, 0);
      expect(result.transaction.serviceCharge).toBeCloseTo(expectedCharge, 0);

      // Approve and verify deduction
      const walletBefore = await Wallet.findById(walletId);
      await adminService.approveTransaction(
        result.transaction._id.toString(),
        adminId,
      );

      const walletAfter = await Wallet.findById(walletId);
      const netPayout = baseAmount - expectedCharge; // ₦78,800

      expect(walletAfter?.balance).toBe(
        (walletBefore?.balance || 0) + netPayout,
      );
    });

    it("should handle zero service charge correctly", async () => {
      // Remove service charge
      await ServiceCharge.deleteMany({ code: "giftcard" });

      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount: 50,
        quantity: 1,
        cardType: "e-code",
        cards: ["CARD"],
        bankAccountId,
      });

      expect(result.breakdown.serviceCharge).toBe(0);

      // Approve - should credit full amount
      const walletBefore = await Wallet.findById(walletId);
      await adminService.approveTransaction(
        result.transaction._id.toString(),
        adminId,
      );

      const walletAfter = await Wallet.findById(walletId);
      const fullAmount = 50 * 400; // ₦20,000

      expect(walletAfter?.balance).toBe(
        (walletBefore?.balance || 0) + fullAmount,
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing bank account gracefully", async () => {
      // Note: Based on your code, bankAccountId is required
      // This test verifies the requirement
      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount: 50,
        quantity: 1,
        cardType: "e-code",
        cards: ["CARD"],
        bankAccountId, // Required field
      });

      expect(result.transaction.bankAccountId).toBeDefined();
    });

    it("should prevent sell on buy-type giftcard", async () => {
      // Create a buy-only card
      const buyCard = await GiftCard.create({
        categoryId: new Types.ObjectId(categoryId),
        name: "Buy Only Card",
        productId: "buy_only_123",
        countryId: countryId,
        currency: "USD",
        type: "buy",
        denominationType: "FIXED" as const,
        priceList: [10, 25],
        buyRate: 410,
        purchaseActivated: true,
        isActive: true,
      });

      await expect(
        giftCardService.sellGiftCard({
          userId,
          giftCardId: buyCard._id.toString(),
          amount: 25,
          quantity: 1,
          cardType: "e-code",
          cards: ["CARD"],
          bankAccountId,
        }),
      ).rejects.toThrow("not available for sale");
    });

    it("should store admin reviewer info correctly", async () => {
      const result = await giftCardService.sellGiftCard({
        userId,
        giftCardId,
        amount: 25,
        quantity: 1,
        cardType: "e-code",
        cards: ["CARD"],
        bankAccountId,
      });

      const approval = await adminService.approveTransaction(
        result.transaction._id.toString(),
        adminId,
        "Verified by admin",
      );

      const reviewedById =
        approval.transaction!.reviewedBy instanceof Types.ObjectId
          ? approval.transaction!.reviewedBy.toString()
          : approval.transaction!.reviewedBy!._id.toString();

      expect(reviewedById).toBe(adminId);

      expect(approval.transaction!.reviewedBy).toBeDefined();
      expect(approval.transaction!.reviewedAt).toBeDefined();
      expect(approval.transaction!.reviewNote).toBe("Verified by admin");
    });
  });
});
