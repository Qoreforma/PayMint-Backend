import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICrypto extends Document {
  providerId?: Types.ObjectId;
  assetId: string; 
  legacyCryptoId?: string;
  name: string; // 'Tether', 'Bitcoin', 'Ethereum'
  code: string; // 'USDT', 'BTC', 'ETH'
  icon?: string;
  description?: string;
  providerCode?: string;

  // Trading rates (global, but can be overridden per network)
  sellRate?: number; // Rate when user SELLS to platform (platform buys)
  buyRate?: number; // Rate when user BUYS from platform (platform sells)

  // Min/Max amounts (in USD equivalent, stored during sync, can be admin overridden)
  sellMinAmount?: number; // USD minimum for SELL flow
  sellMaxAmount?: number; // USD maximum for SELL flow
  buyMinAmount?: number; // USD minimum for BUY flow
  buyMaxAmount?: number; // USD maximum for BUY flow

  currentPriceUSD?: number; // 1 BTC = $102,000 (live)
  currentPriceNGN?: number; // Calculated: currentPriceUSD * sellRate

  // VALIDATION FIELDS (from NowPayments API)
  walletAddressRegex?: string; // Regex pattern for validating wallet addresses
  extraIdRequired?: boolean; // Does this crypto need memo/tag/destination_tag?
  extraIdName?: string; // "destination_tag" | "memo" | "account_id" | "extra_id"
  extraIdRegex?: string; // Regex pattern for validating extra_id field

  // METADATA
  lastPriceUpdate?: Date;
  lastSyncUpdate?: Date; // Last time synced from NowPayments
  priceSource?: string;

  // Terms and conditions
  saleTerm?: string; // Terms for selling
  purchaseTerm?: string; // Terms for buying

  // Feature flags
  saleActivated: boolean; // Can users sell this crypto?
  purchaseActivated: boolean; // Can users buy this crypto?
  isActive: boolean; // Is this crypto available at all?

  // Networks this crypto supports (array of Network ObjectIds)
  networks: Types.ObjectId[];

  // Metadata
  priority?: number; // Display order
  tags?: string[]; // ['stablecoin', 'popular', 'new']

  // Tatum-specific fields (new)
  tatumCurrencyCode?: string; // e.g., "eth", "btc", "usdt"
  minSweepThresholdUsd?: number; // Override network default

  // Breet-specific fields
  breetAssetId?: string; // e.g., "TRX_TEST", "BTC"
  breetAssetName?: string; // e.g., "Tron Test"
  breetMinimumUSD?: number; // Minimum deposit USD
  breetFlagFeeUSD?: number; // Fee for resolving flagged deposits
  breetNetwork?: string; // Network name from Breet
  breetIsAccountBased?: boolean; // Whether asset is account-based
  breetTxLink?: string; // Block explorer URL template
  breetLastSyncedAt?: Date; // When synced from Breet API

  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

const cryptoSchema = new Schema<ICrypto>(
  {
    providerId: {
      type: Schema.Types.ObjectId,
      ref: "Provider",
      index: true,
    },
    legacyCryptoId: { type: String, index: true, sparse: true },
    assetId: {
      type: String,
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    code: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },
    providerCode: { type: String },
    icon: String,
    description: String,
    sellRate: Number,
    buyRate: Number,

    // Min/Max amounts stored during sync
    sellMinAmount: {
      type: Number,
      min: 0,
      description: "Minimum USD amount user can sell (from NowPayments)",
    },
    sellMaxAmount: {
      type: Number,
      min: 0,
      description: "Maximum USD amount user can sell (from NowPayments)",
    },
    buyMinAmount: {
      type: Number,
      min: 0,
      description: "Minimum USD amount user can buy (from NowPayments)",
    },
    buyMaxAmount: {
      type: Number,
      min: 0,
      description: "Maximum USD amount user can buy (from NowPayments)",
    },

    saleTerm: String,
    purchaseTerm: String,
    saleActivated: {
      type: Boolean,
      default: false,
      index: true,
    },
    purchaseActivated: {
      type: Boolean,
      default: false,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    networks: [
      {
        type: Schema.Types.ObjectId,
        ref: "Network",
      },
    ],
    currentPriceUSD: {
      type: Number,
      min: 0,
    },
    currentPriceNGN: {
      type: Number,
      min: 0,
    },

    lastPriceUpdate: {
      type: Date,
    },
    lastSyncUpdate: {
      type: Date,
      description: "Last time this crypto was synced from NowPayments",
    },
    priceSource: {
      type: String,
      enum: ["coingecko", "binance", "coincap", "manual"],
      default: "coingecko",
    },

    // Validation fields from NowPayments
    walletAddressRegex: {
      type: String,
      description:
        "Regex pattern from NowPayments for validating wallet addresses",
    },
    extraIdRequired: {
      type: Boolean,
      default: false,
      description:
        "Does this crypto require extra_id (memo/tag/destination_tag)?",
    },
    extraIdName: {
      type: String,
      enum: ["destination_tag", "memo", "account_id", "extra_id", null],
      default: null,
      description:
        "Name of the extra_id field (e.g., 'destination_tag' for XRP)",
    },
    extraIdRegex: {
      type: String,
      description: "Regex pattern for validating extra_id field",
    },

    priority: { type: Number, default: 0 },
    tags: [String],
    deletedAt: Date,
    createdAt: { type: Date, immutable: true },

    tatumCurrencyCode: {
      type: String,
      lowercase: true,
      sparse: true,
      description: "Currency code in Tatum (e.g., eth, btc, usdt)",
    },
    minSweepThresholdUsd: {
      type: Number,
      min: 0,
      sparse: true,
      description:
        "Minimum USD amount to trigger sweep (overrides network default)",
    },

    // Breet-specific fields
    breetAssetId: {
      type: String,
      sparse: true,
      index: true,
    },
    breetAssetName: String,
    breetMinimumUSD: {
      type: Number,
      min: 0,
      sparse: true,
    },
    breetFlagFeeUSD: {
      type: Number,
      min: 0,
      sparse: true,
    },
    breetNetwork: String,
    breetIsAccountBased: Boolean,
    breetTxLink: String,
    breetLastSyncedAt: {
      type: Date,
      sparse: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for common queries
cryptoSchema.index({ code: 1, isActive: 1 });
cryptoSchema.index({ purchaseActivated: 1, isActive: 1 });
cryptoSchema.index({ saleActivated: 1, isActive: 1 });
cryptoSchema.index({ isActive: 1, networks: 1 });
cryptoSchema.index({ purchaseActivated: 1, isActive: 1, networks: 1 });
cryptoSchema.index({ saleActivated: 1, isActive: 1, networks: 1 });
cryptoSchema.index(
  { code: 1, providerCode: 1, providerId: 1 },
  { unique: true, sparse: true }
);

export const Crypto = mongoose.model<ICrypto>("Crypto", cryptoSchema);
