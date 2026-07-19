import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { CryptoTransactionRepository } from "@/repositories/client/CryptoTransactionRepository";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { BankAccountRepository } from "@/repositories/client/BankAccountRepository";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { NotificationRepository } from "@/repositories/client/NotificationRepository";
import { ServiceChargeRepository } from "@/repositories/admin/ServiceChargeRepository";
import { LeaderboardRepository } from "@/repositories/client/LeaderboardRepository";
import { UserTradeMetricsRepository } from "@/repositories/shared/UserTradeMetricsRepository";
import { TradeBonusRepository } from "@/repositories/admin/TradeBonusRepository";
import { BankRepository } from "@/repositories/shared/BankRepository";
import { VirtualAccountRepository } from "@/repositories/client/VirtualAccountRepository";
import { ReferralRepository } from "@/repositories/client/ReferralRepository";
import { CountryRepository } from "@/repositories/shared/CountryRepository";
import { StateRepository } from "@/repositories/shared/StateRepository";
import { CityRepository } from "@/repositories/shared/CityRepository";
import { ProviderRepository } from "@/repositories/shared/ProviderRepository";
import { ServiceRepository } from "@/repositories/shared/ServiceRepository";
import { ProductRepository } from "@/repositories/shared/ProductRepository";
import { BannerRepository } from "@/repositories/admin/BannerRepository";
import { SystemBankAccountRepository } from "@/repositories/admin/SystemBankAccountRepository";
import { ServiceTypeRepository } from "@/repositories/shared/ServiceTypeRepository";
import { AppVersionRepository } from "@/repositories/admin/AppVersionRepository";
import { CashbackRuleRepository } from "@/repositories/shared/CashbackRuleRepository";
import { ReferralTermsRepository } from "@/repositories/admin/ReferralTermsRepository";
import { GiftCardRepository } from "@/repositories/shared/GiftCardRepository";
import { GiftCardCategoryRepository } from "@/repositories/shared/GiftCardCategoryRepository";
import {
  FAQRepository,
  FaqCategoryRepository,
} from "@/repositories/shared/FAQRepository";

import { CacheService } from "@/services/core/CacheService";
import { EmailService } from "@/services/core/EmailService";
import { SMSService } from "@/services/core/SMSService";
import { OTPService } from "@/services/core/OTPService";
import { SaveHavenService } from "@/services/client/providers/payments/SaveHavenService";
import { MonnifyService } from "@/services/client/providers/payments/MonnifyService";
import { FlutterwaveService } from "@/services/client/providers/payments/FlutterwaveService";
import { PushNotificationService } from "@/services/client/notifications/PushNotificationService";
import { LeaderboardService } from "@/services/client/LeaderboardService";
import { NotificationService } from "@/services/client/notifications/NotificationService";
import { WalletService } from "@/services/client/wallet/WalletService";
import { TradeBonusProcessorService } from "@/services/client/utility/TradeBonusProcessorService";
import { CryptoService } from "@/services/client/crypto/CryptoService";
import { AuthService } from "@/services/client/core/AuthService";
import { BankAccountService } from "@/services/client/wallet/BankAccountService";
import { FAQService } from "@/services/client/FAQService";
import { GiftCardRateService } from "@/services/client/GiftCardRateService";
import { PaymentService } from "@/services/client/PaymentService";
import { ProfileService } from "@/services/client/core/ProfileService";
import { ReferenceDataService } from "@/services/client/ReferenceDataService";
import { ReferralService } from "@/services/client/ReferralService";
import { TravelBookingService } from "@/services/client/TravelBookingService";
import { VirtualAccountService } from "@/services/client/wallet/VirtualAccountService";
import { WithdrawalService } from "@/services/client/wallet/WithdrawalService";
import { TransactionPollingService } from "@/services/polling/TransactionPollingService";
import { SocialAuthService } from "./core/SocialAuthService";

// Provider API Services
import { VTPassService } from "@/services/client/providers/billpayment/VtpassService";
import { ClubKonnectService } from "@/services/client/providers/billpayment/ClubkonnectService";
import { CoolsubService } from "@/services/client/providers/billpayment/CoolsubService";
import { MySimHostingService } from "@/services/client/providers/billpayment/MySimHostingService";
import { VtuNgService } from "@/services/client/providers/billpayment/VtuNgService";
import { BilalsadasubService } from "@/services/client/providers/billpayment/BilalsadasubService";
import { ReloadlyService } from "@/services/client/providers/giftcard/ReloadlyService";
import { GiftBillsService } from "@/services/client/providers/billpayment/GiftBillsService";
import { AmadeusService } from "@/services/client/providers/billpayment/AmadeusService";
import { ProviderService } from "@/services/client/ProviderService";

// Bill Payment Services
import { TransactionProcessor } from "@/services/client/billPayment/shared/TransactionProcessor";
import { CacheManager } from "@/services/client/billPayment/shared/CacheManager";
import { AirtimeService } from "@/services/client/billPayment/AirtimeService";
import { BettingService } from "@/services/client/billPayment/BettingService";
import { CableTvService } from "@/services/client/billPayment/CableTvService";
import { DataService } from "@/services/client/billPayment/DataService";
import { EducationService } from "@/services/client/billPayment/EducationService";
import { ElectricityService } from "@/services/client/billPayment/ElectricityService";
import { InternationalService } from "@/services/client/billPayment/InternationalService";
import { BillPaymentService } from "@/services/client/BillPaymentService";
import {
  DepositRepository,
  DepositRequestRepository,
} from "@/repositories/client/DepositRepository";
import { GiftCardService } from "./GiftCardService";
import { GiftCardTransactionRepository } from "@/repositories/client/GiftCardTransactionRepository";
import { SystemConfigService } from "../core/SystemConfigService";
import { PaymentReconciliationService } from "../admin/finances/PaymentReconciliationService";
import { withProviderMonitoring } from "@/utils/monitoring/providerMonitoring";
import { PartnerService } from "../partner/PartnerService";
import { ApiKeyService } from "../partner/ApiKeyService";
import { ApiKeyRepository } from "@/repositories/partner/ApiKeyRepository";
import { PartnerGiftCardService } from "../partner/PartnerGiftCardService";
import { PartnerAirtimeService } from "../partner/PartnerAirtimeService";
import { PartnerDataService } from "../partner/PartnerDataService";
import { PartnerElectricityService } from "../partner/PartnerElectricityService";
import { PartnerBettingService } from "../partner/PartnerBettingService";
import { PartnerEducationService } from "../partner/PartnerEducationService";
import { PartnerInternationalService } from "../partner/PartnerInternationalService";
import { PartnerWebhookService } from "../partner/PartnerWebhookService";
import { WebhookLogRepository } from "@/repositories/partner/WebhookLogRepository";
import { PartnerDashboardService } from "../partner/PartnerDashboardService";
import { NowPaymentsService } from "./providers/crypto/Nowpaymentsservice";
import {
  getTransactionStateValidator,
  TransactionStateValidator,
} from "./utility/TransactionStateValidator";
import { AuditLoggingService } from "@/controllers/admin/system/AuditLoggingService";
import { AuditLogRepository } from "@/repositories/admin/AuditLogRepository";
import { WebhookDeliveryService } from "./webhooks/WebhookDeliveryService";
import { ProviderReconciliationService } from "../ProviderReconciliationService";
import { BiometricService } from "./core/BiometricService";
import { ProviderRateConfigRepository } from "@/repositories/admin/Providerrateconfigrepository";
import { ManualWithdrawalRepository } from "@/repositories/client/Manualwithdrawalrepository";
import { AdminRepository } from "@/repositories/admin/AdminRepository";
import { TatumService } from "./providers/crypto/TatumService";
import { IdentityVerificationService } from "./core/IdentityVerificationService";
import { HelperService } from "./utility/HelperService";
import { DepositService } from "./wallet/DepositService";
import { TransactionService } from "./wallet/TransactionService";
import { CryptoBreakdownService } from "./crypto/CryptoBreakdownService";
import { CryptoTransactionService } from "./crypto/CryptoTransactionService";
import { CryptoUtilityService } from "./crypto/CryptoUtilityService";
import { NowPaymentCryptoTradeService } from "./crypto/trades/automated/NowPaymentsCryptoTradeService";
import { TatumCryptoTradeService } from "./crypto/trades/automated/TatumCryptoTradeService";
import { CryptoManualTradeService } from "./crypto/trades/CryptoManualTradeService";
import { BreetCryptoTradeService } from "./crypto/trades/automated/BreetCryptoTradeService";
import { TatumSeedService } from "./providers/crypto/TatumSeedService";
import { BreetService } from "./providers/crypto/BreetService";
import { XixapayService } from "./providers/payments/XixapayService";
import { AirtimeEpinService } from "./billPayment/AirtimeEpinService";
import { DataEpinService } from "./billPayment/DataEpinService";
import { PartnerCableTvService } from "../partner/PartnerCableTvService";
import { PartnerCommissionRepository } from "@/repositories/partner/PartnerCommissionRepository";
import { PartnerCommissionService } from "../partner/PartnerCommissionService";

// Chat Services
import { ChannelIdentityRepository } from "@/repositories/client/ChannelIdentityRepository";
import { ChatSessionService } from "@/services/client/chat/ChatSessionService";
import { ChannelLinkService } from "@/services/client/chat/ChannelLinkService";
import { ChatGatewayService } from "@/services/client/chat/ChatGatewayService";
import { TelegramMessengerService } from "@/services/client/chat/TelegramMessengerService";
import { WhatsAppMessengerService } from "@/services/client/chat/WhatsAppMessengerService";
class ServiceContainer {
  // SINGLETON INSTANCES

  private static cacheService?: CacheService;
  private static emailService?: EmailService;
  private static smsService?: SMSService;
  private static otpService?: OTPService;
  private static saveHavenService?: SaveHavenService;
  private static xixapayService?: XixapayService;
  private static monnifyService?: MonnifyService;
  private static biometricService?: BiometricService;
  private static flutterwaveService?: FlutterwaveService;
  private static vtpassService?: VTPassService;
  private static clubKonnectService?: ClubKonnectService;
  private static coolsubService?: CoolsubService;
  private static mySimHostingService?: MySimHostingService;
  private static vtuNgService?: VtuNgService;
  private static bilalsadasubService?: BilalsadasubService;
  private static reloadlyService?: ReloadlyService;
  private static giftBillsService?: GiftBillsService;
  private static amadeusService?: AmadeusService;
  private static auditLoggingService?: AuditLoggingService;
  private static webhookdeliveryService?: WebhookDeliveryService;
  private static providerReconciliationService?: ProviderReconciliationService;
  private static cryptoUtilityService?: CryptoUtilityService;
  private static cryptoBreakdownService?: CryptoBreakdownService;
  private static cryptoTransactionService?: CryptoTransactionService;
  private static breetCryptoTradeService?: BreetCryptoTradeService;
  private static nowPaymentCryptoTradeService?: NowPaymentCryptoTradeService;
  private static tatumCryptoTradeService?: TatumCryptoTradeService;
  private static cryptoManualTradeService?: CryptoManualTradeService;

  // Repositories
  private static cryptoRepository?: CryptoRepository;
  private static cryptoTransactionRepository?: CryptoTransactionRepository;
  private static networkRepository?: NetworkRepository;
  private static transactionRepository?: TransactionRepository;
  private static manualWithdrawalRepository?: ManualWithdrawalRepository;
  private static bankAccountRepository?: BankAccountRepository;
  private static walletRepository?: WalletRepository;
  private static userRepository?: UserRepository;
  private static adminRepository?: AdminRepository;
  private static notificationRepository?: NotificationRepository;
  private static serviceChargeRepository?: ServiceChargeRepository;
  private static leaderboardRepository?: LeaderboardRepository;
  private static userTradeMetricsRepository?: UserTradeMetricsRepository;
  private static tradeBonusRepository?: TradeBonusRepository;
  private static bankRepository?: BankRepository;
  private static virtualAccountRepository?: VirtualAccountRepository;
  private static referralRepository?: ReferralRepository;
  private static countryRepository?: CountryRepository;
  private static stateRepository?: StateRepository;
  private static cityRepository?: CityRepository;
  private static providerRepository?: ProviderRepository;
  private static serviceRepository?: ServiceRepository;
  private static productRepository?: ProductRepository;
  private static bannerRepository?: BannerRepository;
  private static systemBankAccountRepository?: SystemBankAccountRepository;
  private static serviceTypeRepository?: ServiceTypeRepository;
  private static appVersionRepository?: AppVersionRepository;
  private static cashbackRuleRepository?: CashbackRuleRepository;
  private static referralTermsRepository?: ReferralTermsRepository;
  private static giftCardRepository?: GiftCardRepository;
  private static giftCardTransactionRepository?: GiftCardTransactionRepository;
  private static giftCardCategoryRepository?: GiftCardCategoryRepository;
  private static faqRepository?: FAQRepository;
  private static faqCategoryRepository?: FaqCategoryRepository;
  private static depositRequestRepository?: DepositRequestRepository;
  private static depositRepository?: DepositRepository;
  private static apiKeyRepository?: ApiKeyRepository;
  private static webhooklogRepository?: WebhookLogRepository;
  private static providerRateConfigRepository?: ProviderRateConfigRepository;

  // Business Logic Services
  private static pushNotificationService?: PushNotificationService;
  private static leaderboardService?: LeaderboardService;
  private static notificationService?: NotificationService;
  private static helperService?: HelperService;
  private static systemConfigService?: SystemConfigService;
  private static walletService?: WalletService;
  private static tradeBonusProcessorService?: TradeBonusProcessorService;
  private static nowPaymentsService?: NowPaymentsService;
  private static breetService?: BreetService;
  private static providerService?: ProviderService;
  private static transactionProcessor?: TransactionProcessor;
  private static cacheManager?: CacheManager;
  private static depositService?: DepositService;
  private static paymentReconciliationService?: PaymentReconciliationService;
  private static socialAuthService?: SocialAuthService;
  private static tatumService?: TatumService;
  private static tatumSeedService?: TatumSeedService;

  // Bill Payment Services
  private static airtimeService?: AirtimeService;
  private static airtimeEpinService?: AirtimeEpinService;
  private static dataEpinService?: DataEpinService;
  private static bettingService?: BettingService;
  private static cableTvService?: CableTvService;
  private static dataService?: DataService;
  private static educationService?: EducationService;
  private static electricityService?: ElectricityService;
  private static internationalService?: InternationalService;
  private static billPaymentService?: BillPaymentService;

  // Chat Services
  private static channelIdentityRepository?: ChannelIdentityRepository;
  private static chatSessionService?: ChatSessionService;
  private static channelLinkService?: ChannelLinkService;
  private static chatGatewayService?: ChatGatewayService;
  private static telegramMessengerService?: TelegramMessengerService;
  private static whatsappMessengerService?: WhatsAppMessengerService;

  // BASE SERVICES
  static getTransactionStateValidator(): TransactionStateValidator {
    return getTransactionStateValidator();
  }
  static getCacheService(): CacheService {
    if (!this.cacheService) {
      this.cacheService = new CacheService();
    }
    return this.cacheService;
  }

  static getBiometricService(): BiometricService {
    if (!this.biometricService) {
      this.biometricService = new BiometricService();
    }
    return new BiometricService();
  }

  static getTatumService(): TatumService {
    if (!this.tatumService) {
      this.tatumService = new TatumService();
    }
    return new TatumService();
  }

  static getTatumSeedService(): TatumSeedService {
    if (!this.tatumSeedService) {
      this.tatumSeedService = new TatumSeedService(
        this.getCryptoRepository(),
        this.getNetworkRepository(),
        this.getTatumService(),
      );
    }
    return this.tatumSeedService;
  }

  static getEmailService(): EmailService {
    if (!this.emailService) {
      this.emailService = new EmailService();
    }
    return this.emailService;
  }

  static getSMSService(): SMSService {
    if (!this.smsService) {
      this.smsService = new SMSService();
    }
    return this.smsService;
  }

  static getOTPService(): OTPService {
    if (!this.otpService) {
      this.otpService = new OTPService(this.getCacheService());
    }
    return this.otpService;
  }

  // PAYMENT GATEWAY SERVICES
  static getSaveHavenService(): SaveHavenService {
    if (!this.saveHavenService) {
      this.saveHavenService = withProviderMonitoring(
        new SaveHavenService(),
        "savehaven",
        "payment_gateway",
      );
    }
    return this.saveHavenService;
  }

  static getXixapayService(): XixapayService {
    if (!this.xixapayService) {
      this.xixapayService = withProviderMonitoring(
        new XixapayService(),
        "xixapay",
        "payment_gateway",
      );
    }
    return this.xixapayService;
  }

  static getMonnifyService(): MonnifyService {
    if (!this.monnifyService) {
      this.monnifyService = withProviderMonitoring(
        new MonnifyService(),
        "monnify",
        "payment_gateway",
      );
    }
    return this.monnifyService;
  }

  static getFlutterwaveService(): FlutterwaveService {
    if (!this.flutterwaveService) {
      this.flutterwaveService = withProviderMonitoring(
        new FlutterwaveService(),
        "flutterwave",
        "payment_gateway",
      );
    }
    return this.flutterwaveService;
  }

  // PROVIDER API SERVICES
  static getVTPassService(): VTPassService {
    if (!this.vtpassService) {
      this.vtpassService = withProviderMonitoring(
        new VTPassService(),
        "vtpass",
        "bill_provider",
      );
    }
    return this.vtpassService;
  }

  static getClubKonnectService(): ClubKonnectService {
    if (!this.clubKonnectService) {
      this.clubKonnectService = withProviderMonitoring(
        new ClubKonnectService(),
        "clubkonnect",
        "bill_provider",
      );
    }
    return this.clubKonnectService;
  }

  static getCoolsubService(): CoolsubService {
    if (!this.coolsubService) {
      this.coolsubService = withProviderMonitoring(
        new CoolsubService(),
        "coolsub",
        "bill_provider",
      );
    }
    return this.coolsubService;
  }

  static getMySimHostingService(): MySimHostingService {
    if (!this.mySimHostingService) {
      this.mySimHostingService = withProviderMonitoring(
        new MySimHostingService(),
        "mysimhosting",
        "bill_provider",
      );
    }
    return this.mySimHostingService;
  }

  static getVtuNgService(): VtuNgService {
    if (!this.vtuNgService) {
      this.vtuNgService = withProviderMonitoring(
        new VtuNgService(),
        "vtung",
        "bill_provider",
      );
    }
    return this.vtuNgService;
  }

  static getBilalsadasubService(): BilalsadasubService {
    if (!this.bilalsadasubService) {
      this.bilalsadasubService = withProviderMonitoring(
        new BilalsadasubService(),
        "bilalsadasub",
        "bill_provider",
      );
    }
    return this.bilalsadasubService;
  }

  static getReloadlyService(): ReloadlyService {
    if (!this.reloadlyService) {
      this.reloadlyService = withProviderMonitoring(
        new ReloadlyService(),
        "reloadly",
        "bill_provider",
      );
    }
    return this.reloadlyService;
  }

  static getProviderReconciliationService(): ProviderReconciliationService {
    if (!this.providerReconciliationService) {
      this.providerReconciliationService = new ProviderReconciliationService(
        this.getSaveHavenService(),
        this.getMonnifyService(),
        this.getFlutterwaveService(),
        this.getAuditLoggingService(),
        this.getEmailService(),
      );
    }
    return this.providerReconciliationService;
  }

  static getGiftBillsService(): GiftBillsService {
    if (!this.giftBillsService) {
      this.giftBillsService = withProviderMonitoring(
        new GiftBillsService(),
        "giftbills",
        "bill_provider",
      );
    }
    return this.giftBillsService;
  }
  static getAmadeusService(): AmadeusService {
    if (!this.amadeusService) {
      this.amadeusService = withProviderMonitoring(
        new AmadeusService(),
        "amadeus",
        "bill_provider",
      );
    }
    return this.amadeusService;
  }
  static getAuditLoggingService(): AuditLoggingService {
    if (!this.auditLoggingService) {
      this.auditLoggingService = new AuditLoggingService(
        new AuditLogRepository(),
      );
    }
    return this.auditLoggingService;
  }

  static getWebhookDeliveryService(): WebhookDeliveryService {
    if (!this.webhookdeliveryService) {
      this.webhookdeliveryService = new WebhookDeliveryService(
        this.getWalletService(),
        this.getAuditLoggingService(),
        this.getNotificationService(),
      );
    }
    return this.webhookdeliveryService;
  }
  // REPOSITORIES

  static getCryptoRepository(): CryptoRepository {
    if (!this.cryptoRepository) {
      this.cryptoRepository = new CryptoRepository();
    }
    return this.cryptoRepository;
  }

  static getCryptoTransactionRepository(): CryptoTransactionRepository {
    if (!this.cryptoTransactionRepository) {
      this.cryptoTransactionRepository = new CryptoTransactionRepository();
    }
    return this.cryptoTransactionRepository;
  }

  static getNetworkRepository(): NetworkRepository {
    if (!this.networkRepository) {
      this.networkRepository = new NetworkRepository();
    }
    return this.networkRepository;
  }

  static getTransactionRepository(): TransactionRepository {
    if (!this.transactionRepository) {
      this.transactionRepository = new TransactionRepository();
    }
    return this.transactionRepository;
  }

  static getManualWithdrawalRepository(): ManualWithdrawalRepository {
    if (!this.manualWithdrawalRepository) {
      this.manualWithdrawalRepository = new ManualWithdrawalRepository();
    }
    return this.manualWithdrawalRepository;
  }

  static getBankAccountRepository(): BankAccountRepository {
    if (!this.bankAccountRepository) {
      this.bankAccountRepository = new BankAccountRepository();
    }
    return this.bankAccountRepository;
  }

  static getWalletRepository(): WalletRepository {
    if (!this.walletRepository) {
      this.walletRepository = new WalletRepository();
    }
    return this.walletRepository;
  }

  static getUserRepository(): UserRepository {
    if (!this.userRepository) {
      this.userRepository = new UserRepository();
    }
    return this.userRepository;
  }

  static getAdminRepository(): AdminRepository {
    if (!this.adminRepository) {
      this.adminRepository = new AdminRepository();
    }
    return this.adminRepository;
  }

  static getNotificationRepository(): NotificationRepository {
    if (!this.notificationRepository) {
      this.notificationRepository = new NotificationRepository();
    }
    return this.notificationRepository;
  }

  static getServiceChargeRepository(): ServiceChargeRepository {
    if (!this.serviceChargeRepository) {
      this.serviceChargeRepository = new ServiceChargeRepository();
    }
    return this.serviceChargeRepository;
  }

  static getLeaderboardRepository(): LeaderboardRepository {
    if (!this.leaderboardRepository) {
      this.leaderboardRepository = new LeaderboardRepository();
    }
    return this.leaderboardRepository;
  }

  static getUserTradeMetricsRepository(): UserTradeMetricsRepository {
    if (!this.userTradeMetricsRepository) {
      this.userTradeMetricsRepository = new UserTradeMetricsRepository();
    }
    return this.userTradeMetricsRepository;
  }

  static getTradeBonusRepository(): TradeBonusRepository {
    if (!this.tradeBonusRepository) {
      this.tradeBonusRepository = new TradeBonusRepository();
    }
    return this.tradeBonusRepository;
  }

  static getBankRepository(): BankRepository {
    if (!this.bankRepository) {
      this.bankRepository = new BankRepository();
    }
    return this.bankRepository;
  }

  static getVirtualAccountRepository(): VirtualAccountRepository {
    if (!this.virtualAccountRepository) {
      this.virtualAccountRepository = new VirtualAccountRepository();
    }
    return this.virtualAccountRepository;
  }

  static getReferralRepository(): ReferralRepository {
    if (!this.referralRepository) {
      this.referralRepository = new ReferralRepository();
    }
    return this.referralRepository;
  }

  static getCountryRepository(): CountryRepository {
    if (!this.countryRepository) {
      this.countryRepository = new CountryRepository();
    }
    return this.countryRepository;
  }

  static getStateRepository(): StateRepository {
    if (!this.stateRepository) {
      this.stateRepository = new StateRepository();
    }
    return this.stateRepository;
  }

  static getCityRepository(): CityRepository {
    if (!this.cityRepository) {
      this.cityRepository = new CityRepository();
    }
    return this.cityRepository;
  }

  static getProviderRepository(): ProviderRepository {
    if (!this.providerRepository) {
      this.providerRepository = new ProviderRepository();
    }
    return this.providerRepository;
  }

  static getServiceRepository(): ServiceRepository {
    if (!this.serviceRepository) {
      this.serviceRepository = new ServiceRepository();
    }
    return this.serviceRepository;
  }

  static getProductRepository(): ProductRepository {
    if (!this.productRepository) {
      this.productRepository = new ProductRepository();
    }
    return this.productRepository;
  }

  static getBannerRepository(): BannerRepository {
    if (!this.bannerRepository) {
      this.bannerRepository = new BannerRepository();
    }
    return this.bannerRepository;
  }

  static getSystemBankAccountRepository(): SystemBankAccountRepository {
    if (!this.systemBankAccountRepository) {
      this.systemBankAccountRepository = new SystemBankAccountRepository();
    }
    return this.systemBankAccountRepository;
  }

  static getServiceTypeRepository(): ServiceTypeRepository {
    if (!this.serviceTypeRepository) {
      this.serviceTypeRepository = new ServiceTypeRepository();
    }
    return this.serviceTypeRepository;
  }

  static getAppVersionRepository(): AppVersionRepository {
    if (!this.appVersionRepository) {
      this.appVersionRepository = new AppVersionRepository();
    }
    return this.appVersionRepository;
  }

  static getCashbackRuleRepository(): CashbackRuleRepository {
    if (!this.cashbackRuleRepository) {
      this.cashbackRuleRepository = new CashbackRuleRepository();
    }
    return this.cashbackRuleRepository;
  }

  static getReferralTermsRepository(): ReferralTermsRepository {
    if (!this.referralTermsRepository) {
      this.referralTermsRepository = new ReferralTermsRepository();
    }
    return this.referralTermsRepository;
  }

  static getGiftCardRepository(): GiftCardRepository {
    if (!this.giftCardRepository) {
      this.giftCardRepository = new GiftCardRepository();
    }
    return this.giftCardRepository;
  }

  static getGiftCardCategoryRepository(): GiftCardCategoryRepository {
    if (!this.giftCardCategoryRepository) {
      this.giftCardCategoryRepository = new GiftCardCategoryRepository();
    }
    return this.giftCardCategoryRepository;
  }

  static getGiftCardTransactionRepository(): GiftCardTransactionRepository {
    if (!this.giftCardTransactionRepository) {
      this.giftCardTransactionRepository = new GiftCardTransactionRepository();
    }
    return this.giftCardTransactionRepository;
  }

  static getFAQRepository(): FAQRepository {
    if (!this.faqRepository) {
      this.faqRepository = new FAQRepository();
    }
    return this.faqRepository;
  }

  static getFaqCategoryRepository(): FaqCategoryRepository {
    if (!this.faqCategoryRepository) {
      this.faqCategoryRepository = new FaqCategoryRepository();
    }
    return this.faqCategoryRepository;
  }

  static getDepositRequestRepository(): DepositRequestRepository {
    if (!this.depositRequestRepository) {
      this.depositRequestRepository = new DepositRequestRepository();
    }
    return this.depositRequestRepository;
  }

  static getDepositRepository(): DepositRepository {
    if (!this.depositRepository) {
      this.depositRepository = new DepositRepository();
    }
    return this.depositRepository;
  }

  static getApiKeyRepository(): ApiKeyRepository {
    if (!this.apiKeyRepository) {
      this.apiKeyRepository = new ApiKeyRepository();
    }
    return this.apiKeyRepository;
  }

  static getWebHookLogRepository(): WebhookLogRepository {
    if (!this.webhooklogRepository) {
      this.webhooklogRepository = new WebhookLogRepository();
    }

    return this.webhooklogRepository;
  }

  static getProviderRateConfigRepository(): ProviderRateConfigRepository {
    if (!this.providerRateConfigRepository) {
      this.providerRateConfigRepository = new ProviderRateConfigRepository();
    }
    return this.providerRateConfigRepository;
  }

  // LEVEL 1 SERVICES

  static getPushNotificationService(): PushNotificationService {
    if (!this.pushNotificationService) {
      this.pushNotificationService = new PushNotificationService(
        this.getUserRepository(),
      );
    }
    return this.pushNotificationService;
  }

  static getLeaderboardService(): LeaderboardService {
    if (!this.leaderboardService) {
      this.leaderboardService = new LeaderboardService(
        this.getLeaderboardRepository(),
        this.getTransactionRepository(),
        this.getUserRepository(),
        this.getCacheService(),
        this.getCryptoTransactionRepository(),
        this.getGiftCardTransactionRepository(),
      );
    }
    return this.leaderboardService;
  }

  static getProviderService(): ProviderService {
    if (!this.providerService) {
      this.providerService = new ProviderService(
        this.getVTPassService(),
        this.getClubKonnectService(),
        this.getCoolsubService(),
        this.getMySimHostingService(),
        this.getVtuNgService(),
        this.getBilalsadasubService(),
        this.getReloadlyService(),
        this.getAmadeusService(),
        this.getGiftBillsService(),
        this.getCacheService(),
        this.getSaveHavenService(),
      );
    }
    return this.providerService;
  }

  // LEVEL 2 SERVICES

  static getNotificationService(): NotificationService {
    if (!this.notificationService) {
      this.notificationService = new NotificationService(
        this.getEmailService(),
        this.getSMSService(),
        this.getPushNotificationService(),
        this.getNotificationRepository(),
        this.getUserRepository(),
        this.getAdminRepository(),
      );
    }
    return this.notificationService;
  }

  static getHelperService(): HelperService {
    if (!this.helperService) {
      this.helperService = new HelperService(
        this.getCacheService(),
        this.getServiceChargeRepository(),
        this.getLeaderboardService(),
      );
    }
    return this.helperService;
  }

  static getSystemConfigService(): SystemConfigService {
    if (!this.systemConfigService) {
      this.systemConfigService = new SystemConfigService(
        this.getCacheService(),
      );
    }
    return this.systemConfigService;
  }

  static getCacheManager(): CacheManager {
    if (!this.cacheManager) {
      this.cacheManager = new CacheManager(
        this.getCacheService(),
        this.getServiceRepository(),
        this.getProviderService(),
        this.getCashbackRuleRepository(),
      );
    }
    return this.cacheManager;
  }

  // LEVEL 3 SERVICES

  static getWalletService(): WalletService {
    if (!this.walletService) {
      this.walletService = new WalletService(
        this.getWalletRepository(),
        this.getCacheService(),
        this.getTransactionRepository(),
        this.getUserRepository(),
        this.getNotificationService(),
        this.getHelperService(),
        this.getSystemConfigService(),
        this.getAuditLoggingService(),
      );
    }
    return this.walletService;
  }

  static getDepositService(): DepositService {
    if (!this.depositService) {
      this.depositService = new DepositService(
        this.getDepositRepository(),
        this.getDepositRequestRepository(),
        this.getVirtualAccountRepository(),
        this.getTransactionRepository(),
        this.getWalletService(),
        this.getNotificationService(),
        this.getEmailService(),
        this.getHelperService(),
      );
    }
    return this.depositService;
  }

  static getPaymentReconciliationService(): PaymentReconciliationService {
    if (!this.paymentReconciliationService) {
      this.paymentReconciliationService = new PaymentReconciliationService(
        this.getFlutterwaveService(),
        this.getMonnifyService(),
        this.getSaveHavenService(),
        this.getEmailService(),
        this.getAuditLoggingService(),
        this.getWalletService(),
      );
    }
    return this.paymentReconciliationService;
  }

  static getTransactionProcessor(): TransactionProcessor {
    if (!this.transactionProcessor) {
      this.transactionProcessor = new TransactionProcessor(
        this.getTransactionRepository(),
        this.getWalletService(),
        this.getNotificationService(),
        this.getHelperService(),
      );
    }
    return this.transactionProcessor;
  }

  // LEVEL 4 SERVICES

  static getTradeBonusProcessorService(): TradeBonusProcessorService {
    if (!this.tradeBonusProcessorService) {
      this.tradeBonusProcessorService = new TradeBonusProcessorService(
        this.getUserTradeMetricsRepository(),
        this.getTradeBonusRepository(),
        this.getWalletService(),
        this.getCacheService(),
        this.getUserRepository(),
        this.getEmailService(),
      );
    }
    return this.tradeBonusProcessorService;
  }

  static getNowPaymentsService(): NowPaymentsService {
    if (!this.nowPaymentsService) {
      this.nowPaymentsService = new NowPaymentsService();
    }
    return this.nowPaymentsService;
  }

  // BILL PAYMENT SERVICES

  static getAirtimeService(): AirtimeService {
    if (!this.airtimeService) {
      this.airtimeService = new AirtimeService(
        this.getTransactionRepository(),
        this.getWalletService(),
        this.getProviderService(),
        this.getHelperService(),
        this.getTransactionProcessor(),
        this.getTradeBonusProcessorService(),
        this.getCacheManager(),
        this.getPartnerCommissionService(),
      );
    }
    return this.airtimeService;
  }

  static getAirtimeEpinService(): AirtimeEpinService {
    if (!this.airtimeEpinService) {
      this.airtimeEpinService = new AirtimeEpinService(
        this.getTransactionRepository(),
        this.getWalletService(),
        this.getProviderService(),
        this.getHelperService(),
        this.getTransactionProcessor(),
        this.getCacheManager(),
      );
    }
    return this.airtimeEpinService;
  }

  static getDataEpinService(): DataEpinService {
    if (!this.dataEpinService) {
      this.dataEpinService = new DataEpinService(
        this.getTransactionRepository(),
        this.getWalletService(),
        this.getProviderService(),
        this.getHelperService(),
        this.getTransactionProcessor(),
        this.getCacheManager(),
        this.getProductRepository(),
      );
    }
    return this.dataEpinService;
  }

  static getBettingService(): BettingService {
    if (!this.bettingService) {
      this.bettingService = new BettingService(
        this.getTransactionRepository(),
        this.getWalletService(),
        this.getProviderService(),
        this.getHelperService(),
        this.getTransactionProcessor(),
        this.getCacheManager(),
        this.getTradeBonusProcessorService(),
        this.getPartnerCommissionService(),
      );
    }
    return this.bettingService;
  }

  static getCableTvService(): CableTvService {
    if (!this.cableTvService) {
      this.cableTvService = new CableTvService(
        this.getTransactionRepository(),
        this.getWalletService(),
        this.getProviderService(),
        this.getHelperService(),
        this.getTransactionProcessor(),
        this.getCacheManager(),
        this.getTradeBonusProcessorService(),
        this.getProductRepository(),
        this.getPartnerCommissionService(),
      );
    }
    return this.cableTvService;
  }

  static getSocialAuthService(): SocialAuthService {
    if (!this.socialAuthService) {
      this.socialAuthService = new SocialAuthService(
        this.getUserRepository(),
        this.getWalletRepository(),
        this.getCacheService(),
        this.getEmailService(),
      );
    }
    return this.socialAuthService;
  }

  static getDataService(): DataService {
    if (!this.dataService) {
      this.dataService = new DataService(
        this.getProviderRepository(),
        this.getWalletService(),
        this.getProviderService(),
        this.getHelperService(),
        this.getTransactionProcessor(),
        this.getCacheManager(),
        this.getTradeBonusProcessorService(),
        this.getProductRepository(),
        this.getTransactionRepository(),
        this.getPartnerCommissionService(),
      );
    }
    return this.dataService;
  }

  static getEducationService(): EducationService {
    if (!this.educationService) {
      this.educationService = new EducationService(
        this.getTransactionRepository(),
        this.getWalletService(),
        this.getProviderService(),
        this.getHelperService(),
        this.getTransactionProcessor(),
        this.getCacheManager(),
        this.getTradeBonusProcessorService(),
        this.getPartnerCommissionService(),
      );
    }
    return this.educationService;
  }

  static getElectricityService(): ElectricityService {
    if (!this.electricityService) {
      this.electricityService = new ElectricityService(
        this.getTransactionRepository(),
        this.getWalletService(),
        this.getProviderService(),
        this.getHelperService(),
        this.getTransactionProcessor(),
        this.getCacheManager(),
        this.getTradeBonusProcessorService(),
        this.getPartnerCommissionService(),
      );
    }
    return this.electricityService;
  }

  static getInternationalService(): InternationalService {
    if (!this.internationalService) {
      this.internationalService = new InternationalService(
        this.getCacheManager(),
        this.getWalletService(),
        this.getProviderService(),
        this.getHelperService(),
        this.getTransactionProcessor(),
        this.getTradeBonusProcessorService(),
        this.getPartnerCommissionService(),
      );
    }
    return this.internationalService;
  }

  static getBillPaymentService(): BillPaymentService {
    if (!this.billPaymentService) {
      this.billPaymentService = new BillPaymentService(
        this.getAirtimeService(),
        this.getDataService(),
        this.getCableTvService(),
        this.getElectricityService(),
        this.getBettingService(),
        this.getEducationService(),
        this.getInternationalService(),
        this.getCacheManager(),
        this.getAirtimeEpinService(),
        this.getDataEpinService()
      );
    }
    return this.billPaymentService;
  }

  // HIGH-LEVEL BUSINESS SERVICES
  static getCryptoService(): CryptoService {
    return new CryptoService(
      this.getCryptoRepository(),
      this.getNetworkRepository(),
      this.getProviderService(),
      this.getCryptoBreakdownService(),
      this.getNowPaymentCryptoTradeService(),
      this.getTatumCryptoTradeService(),
      this.getCryptoUtilityService(),
      this.getBreetCryptoTradeService(),
    );
  }
  static getBreetService(): BreetService {
    if (!this.breetService) {
      this.breetService = new BreetService();
    }
    return this.breetService;
  }
  // CRYPTO UTILITY SERVICES
  static getCryptoUtilityService(): CryptoUtilityService {
    if (!this.cryptoUtilityService) {
      this.cryptoUtilityService = new CryptoUtilityService(
        this.getCryptoRepository(),
        this.getNetworkRepository(),
      );
    }
    return this.cryptoUtilityService;
  }

  static getCryptoBreakdownService(): CryptoBreakdownService {
    if (!this.cryptoBreakdownService) {
      this.cryptoBreakdownService = new CryptoBreakdownService(
        this.getCryptoUtilityService(),
        this.getHelperService(),
        this.getProviderRateConfigRepository(),
        this.getTatumService(),
        this.getCryptoRepository(),
        this.getNetworkRepository(),
        this.getBreetService(),
        this.getUserRepository(),
      );
    }
    return this.cryptoBreakdownService;
  }

  static getCryptoTransactionService(): CryptoTransactionService {
    if (!this.cryptoTransactionService) {
      this.cryptoTransactionService = new CryptoTransactionService(
        this.getCryptoTransactionRepository(),
        this.getNotificationService(),
      );
    }
    return this.cryptoTransactionService;
  }

  static getNowPaymentCryptoTradeService(): NowPaymentCryptoTradeService {
    if (!this.nowPaymentCryptoTradeService) {
      this.nowPaymentCryptoTradeService = new NowPaymentCryptoTradeService(
        this.getNowPaymentsService(),
        this.getCryptoUtilityService(),
        this.getWalletService(),
        this.getCryptoBreakdownService(),
        this.getCryptoTransactionRepository(),
      );
    }
    return this.nowPaymentCryptoTradeService;
  }

  static getBreetCryptoTradeService(): BreetCryptoTradeService {
    if (!this.breetCryptoTradeService) {
      this.breetCryptoTradeService = new BreetCryptoTradeService(
        this.getCryptoRepository(),
        this.getNetworkRepository(),
        this.getUserRepository(),
        this.getCryptoTransactionRepository(),
        this.getBankAccountRepository(),
        this.getWalletService(),
        this.getNotificationService(),
        this.getCryptoBreakdownService(),
        this.getBreetService(),
        this.getHelperService(),
      );
    }
    return this.breetCryptoTradeService;
  }

  static getTatumCryptoTradeService(): TatumCryptoTradeService {
    if (!this.tatumCryptoTradeService) {
      this.tatumCryptoTradeService = new TatumCryptoTradeService(
        this.getCryptoUtilityService(),
        this.getWalletService(),
        this.getCryptoBreakdownService(),
        this.getCryptoRepository(),
        this.getNetworkRepository(),
        this.getCryptoTransactionRepository(),
        this.getTatumService(),
        this.getUserRepository(),
        this.getTransactionRepository(),
        this.getTradeBonusProcessorService(),
        this.getNotificationService(),
      );
    }
    return this.tatumCryptoTradeService;
  }

  static getCryptoManualTradeService(): CryptoManualTradeService {
    if (!this.cryptoManualTradeService) {
      this.cryptoManualTradeService = new CryptoManualTradeService(
        this.getCryptoUtilityService(),
        this.getWalletService(),
        this.getNotificationService(),
        this.getTradeBonusProcessorService(),
        this.getCryptoBreakdownService(),
        this.getCryptoTransactionRepository(),
        this.getTransactionRepository(),
        this.getHelperService(),
        this.getBankAccountRepository(),
      );
    }
    return this.cryptoManualTradeService;
  }

  static getAuthService(): AuthService {
    return new AuthService(
      this.getOTPService(),
      this.getEmailService(),
      this.getSMSService(),
      this.getUserRepository(),
      this.getWalletRepository(),
      this.getCacheService(),
      this.getReferralRepository(),
      this.getBiometricService(),
      this.getStateRepository(),
      this.getCountryRepository(),
    );
  }

  static getBankAccountService(): BankAccountService {
    return new BankAccountService(
      this.getBankAccountRepository(),
      this.getSaveHavenService(),
      this.getMonnifyService(),
      this.getBankRepository(),
    );
  }

  static getFAQService(): FAQService {
    return new FAQService(
      this.getFAQRepository(),
      this.getFaqCategoryRepository(),
    );
  }

  static getGiftCardRateService(): GiftCardRateService {
    return new GiftCardRateService(
      this.getGiftCardRepository(),
      this.getGiftCardCategoryRepository(),
      this.getProviderService(),
      this.getHelperService(),
      this.getReloadlyService(),
    );
  }

  static getGiftCardService(): GiftCardService {
    return withProviderMonitoring(
      new GiftCardService(
        this.getGiftCardRepository(),
        this.getGiftCardCategoryRepository(),
        this.getGiftCardTransactionRepository(),
        this.getTransactionRepository(),
        this.getWalletService(),
        this.getNotificationService(),
        this.getProviderService(),
        this.getGiftCardRateService(),
        this.getHelperService(),
        this.getTradeBonusProcessorService(),
        this.getCacheService(),
        this.getBankAccountRepository(),
      ),
      "giftcard",
      "giftcard_provider",
    );
  }

  static getIdentityVerificationService(): IdentityVerificationService {
    return new IdentityVerificationService(
      this.getWalletRepository(),
      this.getCacheService(),
      this.getTransactionRepository(),
      this.getUserRepository(),
      this.getVirtualAccountRepository(),
      this.getNotificationRepository(),
      this.getSaveHavenService(),
      this.getMonnifyService(),
      this.getProviderRepository(),
      this.getVirtualAccountService(),
    );
  }

  static getPaymentService(): PaymentService {
    return new PaymentService(
      this.getWalletService(),
      this.getNotificationRepository(),
      this.getSaveHavenService(),
      this.getHelperService(),
      this.getMonnifyService(),
      this.getFlutterwaveService(),
      this.getXixapayService(),
      this.getProviderService(),
      this.getWalletRepository(),
      this.getVirtualAccountRepository(),
      this.getCacheService(),
      this.getBankRepository(),
      this.getSystemBankAccountRepository(),
    );
  }

  static getProfileService(): ProfileService {
    return new ProfileService(this.getUserRepository(), this.getCacheService());
  }

  static getReferenceDataService(): ReferenceDataService {
    return new ReferenceDataService(
      this.getCountryRepository(),
      this.getStateRepository(),
      this.getCityRepository(),
      this.getProviderRepository(),
      this.getServiceRepository(),
      this.getProductRepository(),
      this.getBankAccountRepository(),
      this.getSaveHavenService(),
      this.getBankRepository(),
      this.getBannerRepository(),
      this.getServiceChargeRepository(),
      this.getSystemBankAccountRepository(),
      this.getServiceTypeRepository(),
      this.getAppVersionRepository(),
      this.getCashbackRuleRepository(),
        this.getEmailService(),
      this.getCacheService(),
    );
  }

  static getReferralService(): ReferralService {
    return new ReferralService(
      this.getReferralRepository(),
      this.getUserRepository(),
      this.getWalletService(),
      this.getCacheService(),
      this.getReferralTermsRepository(),
    );
  }

  static getTransactionService(): TransactionService {
    return new TransactionService(
      this.getTransactionRepository(),
      this.getWalletRepository(),
      this.getCryptoService(),
      this.getGiftCardService(),
      this.getCryptoTransactionService(),
    );
  }

  static getTravelBookingService(): TravelBookingService {
    return new TravelBookingService(
      this.getTransactionRepository(),
      this.getWalletService(),
      this.getProviderService(),
      this.getNotificationRepository(),
    );
  }

  static getVirtualAccountService(): VirtualAccountService {
    return new VirtualAccountService(
      this.getVirtualAccountRepository(),
      this.getUserRepository(),
      this.getSaveHavenService(),
      this.getMonnifyService(),
      this.getXixapayService(),
      this.getCacheService(),
    );
  }

  static getWithdrawalService(): WithdrawalService {
    return new WithdrawalService(
      this.getBankAccountRepository(),
      this.getWalletRepository(),
      this.getNotificationService(),
      this.getEmailService(),
      this.getUserRepository(),
      this.getTransactionRepository(),
      this.getBankRepository(),
      this.getSaveHavenService(),
      this.getHelperService(),
      this.getMonnifyService(),
      this.getFlutterwaveService(),
      this.getXixapayService(),
      this.getWalletService(),
      this.getManualWithdrawalRepository(),
    );
  }

  static getTransactionPollingService(): TransactionPollingService {
    return new TransactionPollingService(
      this.getTransactionRepository(),
      this.getClubKonnectService(),
      this.getVTPassService(),
      this.getVtuNgService(),
      this.getReloadlyService(),
      this.getCoolsubService(),
      this.getMySimHostingService(),
      this.getGiftBillsService(),
      this.getBilalsadasubService(),
      this.getWalletService(),
      this.getNotificationService(),
      this.getEmailService(),
      this.getAuditLoggingService(),
      this.getPartnerWebHookService(),
      this.getUserRepository(),
    );
  }

  static getApiKeyService(): ApiKeyService {
    return new ApiKeyService(this.getApiKeyRepository());
  }

  static getPartnerService(): PartnerService {
    return new PartnerService(
      this.getUserRepository(),
      this.getApiKeyService(),
      this.getWalletRepository(),
    );
  }
  static getPartnerGiftCardService(): PartnerGiftCardService {
    return new PartnerGiftCardService(
      this.getGiftCardService(),
      this.getUserRepository(),
      this.getGiftCardTransactionRepository(),
    );
  }

  static getPartnerAirtimeService(): PartnerAirtimeService {
    return new PartnerAirtimeService(
      this.getAirtimeService(),
      this.getProviderService(),
      this.getUserRepository(),
      this.getTransactionRepository(),
      this.getPartnerWebHookService(),
    );
  }

  static getPartnerDataService(): PartnerDataService {
    return new PartnerDataService(
      this.getDataService(),
      this.getUserRepository(),
      this.getTransactionRepository(),
      this.getPartnerWebHookService(),
    );
  }

  static getPartnerElectricityService(): PartnerElectricityService {
    return new PartnerElectricityService(
      this.getElectricityService(),
      this.getProviderService(),
      this.getUserRepository(),
      this.getTransactionRepository(),
      this.getPartnerWebHookService(),
    );
  }

  static getPartnerCableTvService(): PartnerCableTvService {
    return new PartnerCableTvService(
      this.getCableTvService(),
      this.getProviderService(),
      this.getUserRepository(),
      this.getTransactionRepository(),
      this.getPartnerWebHookService(),
    );
  }

  static getPartnerBettingService(): PartnerBettingService {
    return new PartnerBettingService(
      this.getBettingService(),
      this.getProviderService(),
      this.getUserRepository(),
      this.getTransactionRepository(),
      this.getPartnerWebHookService(),
    );
  }

  static getPartnerEducationService(): PartnerEducationService {
    return new PartnerEducationService(
      this.getEducationService(),
      this.getProviderService(),
      this.getUserRepository(),
      this.getTransactionRepository(),
      this.getPartnerWebHookService(),
    );
  }

  static getPartnerInternationalService(): PartnerInternationalService {
    return new PartnerInternationalService(
      this.getInternationalService(),
      this.getProviderService(),
      this.getUserRepository(),
      this.getTransactionRepository(),
      this.getPartnerWebHookService(),
    );
  }

  static getPartnerWebHookService(): PartnerWebhookService {
    return new PartnerWebhookService(
      this.getWebHookLogRepository(),
      this.getUserRepository(),
    );
  }

  static getPartnerCommissionService(): PartnerCommissionService {
    return new PartnerCommissionService(
      new PartnerCommissionRepository(),
      this.getCacheService(),
    );
  }

  static getPartnerDashboardService(): PartnerDashboardService {
    return new PartnerDashboardService(
      this.getUserRepository(),
      this.getWalletService(),
      this.getGiftCardTransactionRepository(),
      this.getTransactionRepository(),
      this.getWebHookLogRepository(),
    );
  }

  // Chat Services
  static getChannelIdentityRepository(): ChannelIdentityRepository {
    if (!this.channelIdentityRepository) {
      this.channelIdentityRepository = new ChannelIdentityRepository();
    }
    return this.channelIdentityRepository;
  }

  static getChatSessionService(): ChatSessionService {
    if (!this.chatSessionService) {
      this.chatSessionService = new ChatSessionService(this.getCacheService());
    }
    return this.chatSessionService;
  }

  static getChannelLinkService(): ChannelLinkService {
    if (!this.channelLinkService) {
      this.channelLinkService = new ChannelLinkService(
        this.getUserRepository(),
        this.getChannelIdentityRepository(),
        this.getOTPService(),
        this.getSMSService(),
        this.getCacheService()
      );
    }
    return this.channelLinkService;
  }

  static getTelegramMessengerService(): TelegramMessengerService {
    if (!this.telegramMessengerService) {
      this.telegramMessengerService = new TelegramMessengerService();
    }
    return this.telegramMessengerService;
  }

  static getWhatsAppMessengerService(): WhatsAppMessengerService {
    if (!this.whatsappMessengerService) {
      this.whatsappMessengerService = new WhatsAppMessengerService();
    }
    return this.whatsappMessengerService;
  }

  static getChatGatewayService(): ChatGatewayService {
    if (!this.chatGatewayService) {
      this.chatGatewayService = new ChatGatewayService(
        this.getChatSessionService(),
        this.getChannelLinkService(),
        this.getAirtimeService(),
        this.getDataService(),
        this.getElectricityService(),
        this.getCableTvService(),
        this.getBettingService(),
        this.getEducationService(),
        this.getProviderService(),
        this.getReferenceDataService(),
        this.getCacheManager(),
        this.getWalletService(),
        this.getAuthService()
      );
    }
    return this.chatGatewayService;
  }
}

export default ServiceContainer;