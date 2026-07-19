import ServiceContainer from "../client/container";

// Repositories
import { AdminRepository } from "@/repositories/admin/AdminRepository";
import { AlertRepository } from "@/repositories/admin/AlertRepository";
import { AppVersionRepository } from "@/repositories/admin/AppVersionRepository";
import { AuditLogRepository } from "@/repositories/admin/AuditLogRepository";
import { BannerRepository } from "@/repositories/admin/BannerRepository";
import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";
import { CryptoTransactionRepository } from "@/repositories/client/CryptoTransactionRepository";
import { DepositRequestRepository } from "@/repositories/client/DepositRepository";
import {
  FAQRepository,
  FaqCategoryRepository,
} from "@/repositories/shared/FAQRepository";
import { GiftCardCategoryRepository } from "@/repositories/shared/GiftCardCategoryRepository";
import { GiftCardRepository } from "@/repositories/shared/GiftCardRepository";
import { GiftCardTransactionRepository } from "@/repositories/client/GiftCardTransactionRepository";
import { ProductRepository } from "@/repositories/shared/ProductRepository";
import { ProviderRepository } from "@/repositories/shared/ProviderRepository";
import { ReferralRepository } from "@/repositories/client/ReferralRepository";
import { ReferralTermsRepository } from "@/repositories/admin/ReferralTermsRepository";
import { RoleRepository } from "@/repositories/admin/RoleRepository";
import { ServiceChargeRepository } from "@/repositories/admin/ServiceChargeRepository";

import { ServiceRepository } from "@/repositories/shared/ServiceRepository";
import { ServiceTypeRepository } from "@/repositories/shared/ServiceTypeRepository";
import { SystemBankAccountRepository } from "@/repositories/admin/SystemBankAccountRepository";
import { TradeBonusRepository } from "@/repositories/admin/TradeBonusRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { UserTradeMetricsRepository } from "@/repositories/shared/UserTradeMetricsRepository";
import { VirtualAccountRepository } from "@/repositories/client/VirtualAccountRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { BankAccountRepository } from "@/repositories/client/BankAccountRepository";
import { BankRepository } from "@/repositories/shared/BankRepository";

// Admin Services
import { AlertService } from "./content/AlertService";
import { AppVersionService } from "./system/AppVersionService";
import { AuditLogService } from "./system/AuditLogService";
import { BannerService } from "./content/BannerService";
import { CashbackRuleService } from "./finances/CashbackRuleService";
import { CryptoService } from "./crypto/CryptoService";
import { CryptoTransactionViewService } from "./crypto/CryptoTransactionViewService";
import { DashboardService } from "./system/DashboardService";
import { DepositManagementService } from "./transactions/DepositManagementService";
import { FAQManagementService } from "./content/FAQManagementService";
import { GiftCardCategoryService } from "./giftcards/GiftCardCategoryService";
import { GiftCardService } from "./giftcards/GiftCardService";
import { GiftCardTransactionViewService } from "./giftcards/GiftCardTransactionViewService";
import { NetworkService } from "./crypto/NetworkService";
import { ProductManagementService } from "./products/ProductManagementService";
import { ProviderManagementService } from "./products/ProviderManagementService";
import { ReferralBonusService } from "./finances/ReferralBonusService";
import { ReferralTermsService } from "./content/ReferralTermsService";
import { RoleService } from "./admins/RoleService";
import { ServiceChargeService } from "./finances/ServiceChargeService";
import { ServiceManagementService } from "./products/ServiceManagementService";
import { ServiceTypeService } from "./products/ServiceTypeService";
import { SystemBankAccountService } from "./finances/SystemBankAccountService";
import { TradeBonusService } from "./finances/TradeBonusService";
import { TransactionManagementService } from "./transactions/TransactionManagementService";
import { UserManagementService } from "./users/UserManagementService";
import { WithdrawalManagementService } from "./transactions/WithdrawalManagementService";
import { CashbackRuleRepository } from "@/repositories/shared/CashbackRuleRepository";
import { ReferralBonusRepository } from "@/repositories/admin/ReferralBonusRepository";
import { ProductSyncService } from "../sync/ProductSyncService";
import { AdminAuthService } from "../admin/auth/AdminAuthService";
import { AdminManagementService } from "./admins/AdminManagementService";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import { Service } from "@/models/reference/Service";
import { ManualWithdrawalRepository } from "@/repositories/client/Manualwithdrawalrepository";
import { ManualWithdrawalService } from "./finances/Manualwithdrawalservice";
import { AdminWalletService } from "./crypto/AdminWalletService";
import { PricingRuleService } from "./finances/PricingRuleService";

class AdminServiceContainer {
  // SINGLETON INSTANCES

  // Base Level Services
  private static auditLogService?: AuditLogService;
  private static auditLoggingService: AuditLoggingService;
  private static bannerService?: BannerService;
  private static cashbackRuleService?: CashbackRuleService;
  private static networkService?: NetworkService;
  private static referralTermsService?: ReferralTermsService;
  private static appVersionService?: AppVersionService;

  // Level 1 Services
  private static authService?: AdminAuthService;
  private static serviceChargeService?: ServiceChargeService;
  private static tradeBonusService?: TradeBonusService;
  private static dashboardService?: DashboardService;
  private static faqManagementService?: FAQManagementService;
  private static giftCardCategoryService?: GiftCardCategoryService;
  private static giftCardService?: GiftCardService;
  private static adminManagementService?: AdminManagementService;
  private static roleService?: RoleService;

  // Level 2 Services
  private static cryptoService?: CryptoService;
  private static adminWalletService?: AdminWalletService;
  private static productManagementService?: ProductManagementService;
  private static systemBankAccountService?: SystemBankAccountService;
  private static alertService?: AlertService;
  private static depositManagementService?: DepositManagementService;
  private static withdrawalManagementService?: WithdrawalManagementService;
  private static transactionManagementService?: TransactionManagementService;
  private static userManagementService?: UserManagementService;

  // Level 3 Services
  private static serviceManagementService?: ServiceManagementService;
  private static serviceTypeService?: ServiceTypeService;
  private static providerManagementService?: ProviderManagementService;
  private static referralBonusService?: ReferralBonusService;
  private static pricingRuleService?: PricingRuleService;

  // Level 4 Services
  private static cryptoTransactionViewService?: CryptoTransactionViewService;
  private static giftCardTransactionViewService?: GiftCardTransactionViewService;
  private static manualWithdrawalService?: ManualWithdrawalService;
  // BASE LEVEL SERVICES

  static getAuditLogService(): AuditLogService {
    if (!this.auditLogService) {
      this.auditLogService = new AuditLogService(new AuditLogRepository());
    }
    return this.auditLogService;
  }
  static getAuditLoggingService(): AuditLoggingService {
    if (!this.auditLoggingService) {
      this.auditLoggingService = new AuditLoggingService(
        new AuditLogRepository(),
      );
    }
    return this.auditLoggingService;
  }


  static getBannerService(): BannerService {
    if (!this.bannerService) {
      this.bannerService = new BannerService(new BannerRepository());
    }
    return this.bannerService;
  }

  static getCashbackRuleService(): CashbackRuleService {
    if (!this.cashbackRuleService) {
      this.cashbackRuleService = new CashbackRuleService(
        new CashbackRuleRepository()
      );
    }
    return this.cashbackRuleService;
  }

  static getNetworkService(): NetworkService {
    if (!this.networkService) {
      this.networkService = new NetworkService(
        new NetworkRepository(),
        new CryptoRepository(),
      );
    }
    return this.networkService;
  }

  static getReferralTermsService(): ReferralTermsService {
    if (!this.referralTermsService) {
      this.referralTermsService = new ReferralTermsService(
        new ReferralTermsRepository(),
      );
    }
    return this.referralTermsService;
  }

  static getAppVersionService(): AppVersionService {
    if (!this.appVersionService) {
      this.appVersionService = new AppVersionService(
        new AppVersionRepository(),
      );
    }
    return this.appVersionService;
  }

  // LEVEL 1 SERVICES

  static getAdminAuthService(): AdminAuthService {
    if (!this.authService) {
      this.authService = new AdminAuthService(
        ServiceContainer.getOTPService(),
        ServiceContainer.getEmailService(),
        ServiceContainer.getCacheService(),
      );
    }
    return this.authService;
  }

  static getServiceChargeService(): ServiceChargeService {
    if (!this.serviceChargeService) {
      this.serviceChargeService = new ServiceChargeService(
        new ServiceChargeRepository(),
        ServiceContainer.getCacheService(),
      );
    }
    return this.serviceChargeService;
  }

  static getTradeBonusService(): TradeBonusService {
    if (!this.tradeBonusService) {
      this.tradeBonusService = new TradeBonusService(
        new TradeBonusRepository(),
        ServiceContainer.getCacheService(),
      );
    }
    return this.tradeBonusService;
  }

  static getDashboardService(): DashboardService {
    if (!this.dashboardService) {
      this.dashboardService = new DashboardService(
        new UserRepository(),
        new TransactionRepository(),
        new WalletRepository(),
        new GiftCardTransactionRepository(),
        new CryptoTransactionRepository(),
      );
    }
    return this.dashboardService;
  }

  static getFAQManagementService(): FAQManagementService {
    if (!this.faqManagementService) {
      this.faqManagementService = new FAQManagementService(
        new FAQRepository(),
        new FaqCategoryRepository(),
      );
    }
    return this.faqManagementService;
  }

  static getGiftCardCategoryService(): GiftCardCategoryService {
    if (!this.giftCardCategoryService) {
      this.giftCardCategoryService = new GiftCardCategoryService(
        new GiftCardCategoryRepository(),
        new GiftCardRepository(),
        ServiceContainer.getCacheService(),
      );
    }
    return this.giftCardCategoryService;
  }

  static getGiftCardService(): GiftCardService {
    if (!this.giftCardService) {
      this.giftCardService = new GiftCardService(
        new GiftCardRepository(),
        new GiftCardCategoryRepository(),
        new GiftCardTransactionRepository(),
        ServiceContainer.getCacheService(),
      );
    }
    return this.giftCardService;
  }

  static getAdminManagementService(): AdminManagementService {
    if (!this.adminManagementService) {
      this.adminManagementService = new AdminManagementService(
        ServiceContainer.getEmailService(),
        new AdminRepository(),
      );
    }
    return this.adminManagementService;
  }

  static getRoleService(): RoleService {
    if (!this.roleService) {
      this.roleService = new RoleService(
        new RoleRepository(),
        new AdminRepository(),
      );
    }
    return this.roleService;
  }

  // LEVEL 2 SERVICES

  static getCryptoService(): CryptoService {
    if (!this.cryptoService) {
      this.cryptoService = new CryptoService(
        new CryptoRepository(),
        new NetworkRepository(),
        new CryptoTransactionRepository(),
      );
    }
    return this.cryptoService;
  }

  static getAdminWalletService(): AdminWalletService {
    if (!this.adminWalletService) {
      this.adminWalletService = new AdminWalletService(
        new NetworkRepository(),
        ServiceContainer.getTatumService(),
        ServiceContainer.getOTPService(),
        ServiceContainer.getEmailService(),
        ServiceContainer.getCryptoUtilityService(),
      );
    }
    return this.adminWalletService;
  }

  static getProductManagementService(): ProductManagementService {
    if (!this.productManagementService) {
      this.productManagementService = new ProductManagementService(
        new ProductRepository(),
        ServiceContainer.getCacheService(),
      );
    }
    return this.productManagementService;
  }

  static getSystemBankAccountService(): SystemBankAccountService {
    if (!this.systemBankAccountService) {
      this.systemBankAccountService = new SystemBankAccountService(
        new SystemBankAccountRepository(),
        ServiceContainer.getSaveHavenService(),
        new BankRepository(),
      );
    }
    return this.systemBankAccountService;
  }

  static getAlertService(): AlertService {
    if (!this.alertService) {
      this.alertService = new AlertService(
        new AlertRepository(),
        ServiceContainer.getNotificationService(),
        new UserRepository(),
      );
    }
    return this.alertService;
  }

  static getDepositManagementService(): DepositManagementService {
    if (!this.depositManagementService) {
      this.depositManagementService = new DepositManagementService(
        new DepositRequestRepository(),
        new WalletRepository(),
        ServiceContainer.getNotificationService(),
        new TransactionRepository(),
        ServiceContainer.getHelperService(),
      );
    }
    return this.depositManagementService;
  }

  static getWithdrawalManagementService(): WithdrawalManagementService {
    if (!this.withdrawalManagementService) {
      this.withdrawalManagementService = new WithdrawalManagementService(
        new TransactionRepository(),
        new WalletRepository(),
        ServiceContainer.getNotificationService(),
      );
    }
    return this.withdrawalManagementService;
  }

  static getTransactionManagementService(): TransactionManagementService {
    if (!this.transactionManagementService) {
      this.transactionManagementService = new TransactionManagementService(
        new TransactionRepository(),
        new WalletRepository(),
        ServiceContainer.getWalletService(),
        this.getDepositManagementService(),
        this.getManualWithdrawalService(),
        ServiceContainer.getTransactionPollingService(),
      );
    }
    return this.transactionManagementService;
  }

  static getUserManagementService(): UserManagementService {
    if (!this.userManagementService) {
      this.userManagementService = new UserManagementService(
        new UserRepository(),
        new WalletRepository(),
        new TransactionRepository(),
        new BankAccountRepository(),
        new VirtualAccountRepository(),
        new ReferralRepository(),
        new AdminRepository(),
        ServiceContainer.getCacheService(),
        this.getAuditLoggingService(),
        ServiceContainer.getNotificationService(),
      );
    }
    return this.userManagementService;
  }

  // LEVEL 3 SERVICES

  static getServiceManagementService(): ServiceManagementService {
    if (!this.serviceManagementService) {
      this.serviceManagementService = new ServiceManagementService(
        new ServiceRepository(),
        new ServiceTypeRepository(),
        this.getProductManagementService(),
        ServiceContainer.getCacheService(),
      );
    }
    return this.serviceManagementService;
  }

  static getServiceTypeService(): ServiceTypeService {
    if (!this.serviceTypeService) {
      this.serviceTypeService = new ServiceTypeService(
        new ServiceTypeRepository(),
        new ServiceRepository(),
        this.getProductManagementService(),
      );
    }
    return this.serviceTypeService;
  }

  static getProviderManagementService(): ProviderManagementService {
    if (!this.providerManagementService) {
      this.providerManagementService = new ProviderManagementService(
        new ProviderRepository(),
        new ProductRepository(),
        new ServiceTypeRepository(),
        new ProductSyncService(),
        ServiceContainer.getCacheService(),
      );
    }
    return this.providerManagementService;
  }

  static getReferralBonusService(): ReferralBonusService {
    if (!this.referralBonusService) {
      this.referralBonusService = new ReferralBonusService(
        new ReferralBonusRepository(),
        new ReferralRepository(),
        new UserTradeMetricsRepository(),
        new UserRepository(),
        ServiceContainer.getWalletService(),
      );
    }
    return this.referralBonusService;
  }

  static getPricingRuleService(): PricingRuleService {
    if (!this.pricingRuleService) {
      this.pricingRuleService = new PricingRuleService(
        this.getCashbackRuleService(),
        ServiceContainer.getPartnerCommissionService(),
      );
    }
    return this.pricingRuleService;
  }

  // LEVEL 4 SERVICES

  static getCryptoTransactionViewService(): CryptoTransactionViewService {
    if (!this.cryptoTransactionViewService) {
      this.cryptoTransactionViewService = new CryptoTransactionViewService(
        new CryptoRepository(),
        new CryptoTransactionRepository(),
        ServiceContainer.getWalletService(),
        new TransactionRepository(),
        ServiceContainer.getNotificationService(),
        ServiceContainer.getTradeBonusProcessorService(),
        ServiceContainer.getHelperService(),
      );
    }
    return this.cryptoTransactionViewService;
  }

  static getManualWithdrawalService(): ManualWithdrawalService {
    if (!this.manualWithdrawalService) {
      this.manualWithdrawalService = new ManualWithdrawalService(
        new ManualWithdrawalRepository(),
        new TransactionRepository(),
        ServiceContainer.getWalletService(),
        ServiceContainer.getNotificationService(),
      );
    }
    return this.manualWithdrawalService;
  }

  static getGiftCardTransactionViewService(): GiftCardTransactionViewService {
    if (!this.giftCardTransactionViewService) {
      this.giftCardTransactionViewService = new GiftCardTransactionViewService(
        new GiftCardRepository(),
        new GiftCardTransactionRepository(),
        ServiceContainer.getWalletService(),
        new TransactionRepository(),
        ServiceContainer.getNotificationService(),
        ServiceContainer.getTradeBonusProcessorService(),
        ServiceContainer.getHelperService(),
        ServiceContainer.getUserRepository(),
        ServiceContainer.getPartnerWebHookService(),
      );
    }
    return this.giftCardTransactionViewService;
  }
}

export default AdminServiceContainer;
