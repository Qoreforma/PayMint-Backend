// "" (unset) => legacy SafeHaven OTP flow. "xixapay" => /accounts/initiate skips OTP.
export const SUBACCOUNT_PROVIDER = (process.env.SUBACCOUNT_PROVIDER || "xixapay").toLowerCase();

export const PROVIDERS = {
  SAVEHAVEN: {
    name: "SafeHaven",
    baseUrl: process.env.SAFEHAVEN_BASE_URL || "https://api.safehavenmfb.com",
    apiKey: process.env.SAFEHAVEN_API_KEY || "",
    clientId: process.env.SAFEHAVEN_CLIENT_ID,
    clientAssertion: process.env.SAFEHAVEN_CLIENT_ASSERTION,
    isSandBox: process.env.SAFEHAVEN_SANDBOX,
  },
  FLUTTERWAVE: {
    name: "Flutterwave",
    baseUrl:
      process.env.FLUTTERWAVE_BASE_URL || "https://api.flutterwave.com/v3",
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY,
    publicKey: process.env.FLUTTERWAVE_PUBLIC_KEY,
    encryptionKey: process.env.FLUTTERWAVE_ENCRYPTION_KEY,
    webhookSecret: process.env.FLUTTERWAVE_WEBHOOK_SECRET || "",
  },
  MONNIFY: {
    name: "Monnify",
    baseUrl: process.env.MONNIFY_BASE_URL || "https://api.monnify.com",
    apiKey: process.env.MONNIFY_API_KEY || "",
    secretKey: process.env.MONNIFY_SECRET_KEY || "",
    contractCode: process.env.MONNIFY_CONTRACT_CODE || "",
    walletAccountNumber: process.env.MONNIFY_WALLET_ACCOUNT_NUMBER || "",
  },
  VTPASS: {
    baseUrl:
      process.env.VTPASS_BASE_URL || "https://api-service.vtpass.com/api",
    apiKey: process.env.VTPASS_API_KEY || "",
    secretKey: process.env.VTPASS_SECRET_KEY || "",
  },
  CLUBKONNECT: {
    baseUrl:
      process.env.CLUBKONNECT_BASE_URL || "https://www.nellobytesystems.com",
    userId: process.env.CLUBKONNECT_USER_ID || "",
    apiKey: process.env.CLUBKONNECT_API_KEY || "",
  },
  COOLSUB: {
    baseUrl: process.env.COOLSUB_BASE_URL || "https://subandgain.com/api",
    apiKey: process.env.COOLSUB_API_KEY || "",
    username: process.env.COOLSUB_USERNAME || "",
  },
  MYSIMHOSTING: {
    baseUrl:
      process.env.MYSIMHOSTING_BASE_URL || "https://api.mysimhosting.com",
    apiKey: process.env.MYSIMHOSTING_API_KEY || "",
  },
  VTUNG: {
    baseUrl: process.env.VTUNG_BASE_URL || "https://vtu.ng/wp-json",
    username: process.env.VTUNG_USERNAME || "",
    password: process.env.VTUNG_PASSWORD || "",
    userPin: process.env.VTUNG_USER_PIN || "",
  },
  BILALSADASUB: {
    baseUrl:
      process.env.BILALSADASUB_BASE_URL || "https://bilalsadasub.com/api",
    apiKey: process.env.BILALSADASUB_API_KEY || "",
  },
  GIFTBILLS: {
    baseUrl: process.env.GIFTBILLS_BASE_URL || "https://api.giftbills.com/v1",
    apiKey: process.env.GIFTBILLS_API_KEY || "",
    merchantId: process.env.GIFTBILLS_MERCHANT_ID || "",
    encryptionKey: process.env.GIFTBILLS_ENCRYPTION_KEY || "",
  },
  AMADEUS: {
    name: "Amadeus",
    baseUrl: process.env.AMADEUS_BASE_URL || "https://test.api.amadeus.com",
    apiKey: process.env.AMADEUS_API_KEY || "",
    secretKey: process.env.AMADEUS_SECRET_KEY || "",
  },

  RELOADLY: {
    name: "Reloadly",
    baseUrl: process.env.RELOADLY_BASE_URL || "https://topups.reloadly.com",
    clientId: process.env.RELOADLY_CLIENT_ID || "",
    clientSecret: process.env.RELOADLY_CLIENT_SECRET || "",
    audience: process.env.RELOADLY_AUDIENCE || "",
    isSandbox: process.env.RELOADLY_SANDBOX === "true",
  },

  MYDATAPLUG: {
    name: "MyDataPlug",
    baseUrl: process.env.MYDATAPLUG_BASE_URL || "https://mydataplug.com/api",
    apiKey: process.env.MYDATAPLUG_API_KEY || "",
    secretKey: process.env.MYDATAPLUG_SECRET_KEY || "",
  },

  NOWPAYMENTS: {
    name: "NowPayments",
    baseUrl:
      process.env.NOWPAYMENTS_SANDBOX === "true"
        ? "https://api-sandbox.nowpayments.io"
        : "https://api.nowpayments.io",
    apiKey: process.env.NOWPAYMENTS_API_KEY || "",
    email: process.env.NOWPAYMENTS_EMAIL || "",
    ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET || "",
    totpSecret: process.env.NOWPAYMENTS_TOTP_SECRET || "",
    isSandbox: process.env.NOWPAYMENTS_SANDBOX === "true",
  },

  PAYSTACK: {
    name: "Paystack",
    baseUrl: "https://api.paystack.co",
    secretKey: process.env.PAYSTACK_SECRET_KEY || "",
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || "",
  },
  DOJAH: {
    baseUrl: process.env.DOJAH_BASE_URL || "https://sandbox.dojah.io",
    appId: process.env.DOJAH_APP_ID,
    secretKey: process.env.DOJAH_SECRET_KEY,
  },
  QOREID: {
    name: "QoreID",
    baseUrl: process.env.QOREID_BASE_URL || "https://api.qoreid.com",
    clientId: process.env.QOREID_CLIENT_ID || "",
    secret: process.env.QOREID_SECRET || "",
  },
} as const;

export type ProviderName = keyof typeof PROVIDERS;

export const BILL_PAYMENT_PROVIDER_CONFIG = {
  vtpass: {
    code: "vtpass",
    name: "VTPass",
    supportedMethods: ["WEBHOOK", "POLLING"],
    preferredMethod: "WEBHOOK", // Try webhook first, fallback to polling
    pollingIntervalMs: 10000, // 10 seconds
    pollingTimeoutMinutes: 30, // 30 minute timeout
    webhookTimeoutMinutes: 30,
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "/transaction/{reference}", // Example
  },

  clubkonnect: {
    code: "clubkonnect",
    name: "ClubKonnect",
    supportedMethods: ["WEBHOOK", "POLLING"],
    preferredMethod: "POLLING", // Currently you poll
    pollingIntervalMs: 10000,
    pollingTimeoutMinutes: 30,
    webhookTimeoutMinutes: 30,
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "/order/status/{reference}",
  },

  vtung: {
    code: "vtung",
    name: "VTU.ng",
    supportedMethods: ["POLLING"],
    preferredMethod: "POLLING", // Requery API only
    pollingIntervalMs: 15000, // 15 seconds
    pollingTimeoutMinutes: 45,
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "/requery", // Requery endpoint
  },

  reloadly: {
    code: "reloadly",
    name: "Reloadly",
    supportedMethods: ["IMMEDIATE", "POLLING"],
    preferredMethod: "IMMEDIATE", // Returns immediately, no polling needed
    pollingIntervalMs: 20000,
    pollingTimeoutMinutes: 60,
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "/v2/transactions/{id}", // Fallback polling
  },

  mysimhosting: {
    code: "mysimhosting",
    name: "My Sim Hosting",
    supportedMethods: ["WEBHOOK", "POLLING"],
    preferredMethod: "WEBHOOK", // Try webhook first
    pollingIntervalMs: 10000,
    pollingTimeoutMinutes: 30,
    webhookTimeoutMinutes: 30,
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "/api/transaction/status/{reference}",
  },

  mydataplug: {
    code: "mydataplug",
    name: "MyDataPlug",
    supportedMethods: ["IMMEDIATE"],
    preferredMethod: "IMMEDIATE", // Instant API response
    pollingIntervalMs: 0, // Not needed
    pollingTimeoutMinutes: 0,
    hasStatusCheckEndpoint: false, // No polling needed
    note: "Returns instant response, optional manual polling if needed",
  },

  coolsub: {
    code: "coolsub",
    name: "Coolsub",
    supportedMethods: ["IMMEDIATE"],
    preferredMethod: "IMMEDIATE", // Direct API response
    pollingIntervalMs: 0,
    pollingTimeoutMinutes: 0,
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "/transaction/status/{reference}",
    note: "Returns immediate response, optional status check endpoint",
  },

  giftbills: {
    code: "giftbills",
    name: "GiftBills",
    supportedMethods: ["IMMEDIATE"],
    preferredMethod: "IMMEDIATE", // Synchronous API response
    pollingIntervalMs: 0,
    pollingTimeoutMinutes: 0,
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "/api/transaction/{id}/status",
    note: "Synchronous response, optional polling via status endpoint",
  },

  bilalsadasub: {
    code: "bilalsadasub",
    name: "Bilalsadasub",
    supportedMethods: ["IMMEDIATE"],
    preferredMethod: "IMMEDIATE", // Instant response
    pollingIntervalMs: 0,
    pollingTimeoutMinutes: 0,
    hasStatusCheckEndpoint: true,
    statusCheckEndpoint: "/status/{reference}",
    note: "Immediate response, optional polling for pending status",
  },
};

export function getProviderConfig(providerCode: string) {
  const code = providerCode.toLowerCase();
  return BILL_PAYMENT_PROVIDER_CONFIG[
    code as keyof typeof BILL_PAYMENT_PROVIDER_CONFIG
  ];
}

export function shouldPollProvider(providerCode: string): boolean {
  const config = getProviderConfig(providerCode);
  return config?.supportedMethods.includes("POLLING") ?? false;
}

export function shouldUseWebhookProvider(providerCode: string): boolean {
  const config = getProviderConfig(providerCode);
  return config?.supportedMethods.includes("WEBHOOK") ?? false;
}

export function isImmediateResponseProvider(providerCode: string): boolean {
  const config = getProviderConfig(providerCode);
  return config?.supportedMethods.includes("IMMEDIATE") ?? false;
}
