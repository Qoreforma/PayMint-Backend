import { Router } from "express";
import authRoutes from "./auth/auth";
import userRoutes from "./users/users";
import adminManageent from "./admins/admin-management";
import transactionRoutes from "./transactions/transactions";
import withdrawalRoutes from "./transactions/withdrawals";
import dashboardRoutes from "./system/dashboard";
import alertRoutes from "./content/alerts";
import profileRoutes from "./admins/profile";
import bannerRoutes from "./content/banners";
import providerRoutes from "./products/providers";
import productRoutes from "./products/products";
import roleRoutes from "./admins/roles";
import faqRoutes from "./content/faqs";
import auditLogRoutes from "./system/auditlogs";
import systemBankAccountRoutes from "./finances/system-bank-accounts";
import appVersionRoutes from "./system/app-versions";
import serviceChargeRoutes from "./finances/service-charges";
import cashbackRoutes from "./finances/cashbacks";
import cryptoTransactionRoutes from "./crypto/crypto-transactions";
import cryptoManagementRoutes from "./crypto/crypto-management";
import cryptoWalletRoutes from "./crypto/crypto-wallet";
import giftCardTransactionRoutes from "./giftcards/giftcard-transactions";
import giftCardCategoryRoutes from "./giftcards/giftcard-category";
import giftCardProductRoutes from "./giftcards/giftcard-products";
import serviceTypeRoutes from "./products/service-types";
import serviceRoutes from "./products/service";
import mediaRoutes from "./media";
import tradeBonusRoutes from "./finances/trade-bonus";
import referralBonusRoutes from "./finances/referral-bonus";
import referralTermsRoutes from "./content/referral-terms";
import supportContactRoutes from "./content/support-contact";
import partnersRoutes from "./partners/partner";
import providerRateConfigRoute from "./configs/providerRateConfigRoute";
import phonePrefixConfigRoute from "./configs/phonePrefixConfigRoutes";
import manualWithdrawal from "./finances/manual-withdrawal";
import manualDeposits from "./finances/manual-deposits";
import partnerCommissionRoutes from "./partners/commissions";
import pricingRuleRoutes from "./finances/pricing-rules";
import cacheRoutes from "./system/cache";

const router = Router();

// Admin routes
router.use("/auth", authRoutes);
router.use("/admins", adminManageent);
router.use("/profile", profileRoutes);
router.use("/users", userRoutes);
router.use("/transactions", transactionRoutes);
router.use("/withdrawals", withdrawalRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/alerts", alertRoutes);
router.use("/banners", bannerRoutes);
router.use("/providers", providerRoutes);
router.use("/products", productRoutes);
router.use("/roles", roleRoutes);
router.use("/faqs", faqRoutes);
router.use("/auditlogs", auditLogRoutes);
router.use("/bank-accounts", systemBankAccountRoutes);
router.use("/app-versions", appVersionRoutes);
router.use("/service-charges", serviceChargeRoutes);
router.use("/cashbacks", cashbackRoutes);
router.use("/crypto-transactions", cryptoTransactionRoutes);
router.use("/crypto", cryptoManagementRoutes);
router.use("/crypto/wallet", cryptoWalletRoutes);
router.use("/giftcard-transactions", giftCardTransactionRoutes);
router.use("/giftcard-categories", giftCardCategoryRoutes);
router.use("/giftcard-products", giftCardProductRoutes);
router.use("/service-types", serviceTypeRoutes);
router.use("/services", serviceRoutes);
router.use("/media", mediaRoutes);
router.use("/trade-bonuses", tradeBonusRoutes);
router.use("/referral-bonuses", referralBonusRoutes);
router.use("/referral-terms", referralTermsRoutes);
router.use("/support-contact", supportContactRoutes);
router.use("/configs/phone-prefix", phonePrefixConfigRoute);
router.use("/configs/provider-rate", providerRateConfigRoute);
router.use("/manual-withdrawals", manualWithdrawal);
router.use("/manual-deposits", manualDeposits);
router.use("/pricing-rules", pricingRuleRoutes);
router.use("/cache", cacheRoutes);

//Partner routes
router.use("/partner/commissions", partnerCommissionRoutes);
router.use("/partner", partnersRoutes);

// Health check
router.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "admin-api",
  });
});

export default router;