import mongoose, { Schema, Document, Types } from "mongoose";
import { v4 as uuidv4 } from "uuid";

export interface IGiftCard extends Document {
  countryId: Types.ObjectId;
  categoryId?: Types.ObjectId;
  legacyGiftCardId?: string;
  productId: string; //linked to the provider product id
  name: string;
  logo: string;
  cardType?: "physical" | "e-code";

  // Currency & Exchange
  currency?: string;
  senderCurrency?: string;
  exchangeRate?: number;

  // Rates & Fees
  sellRate?: number;
  buyRate?: number;
  senderFee?: number;
  senderFeePercentage?: number;
  discountPercentage?: number;

  type: "buy" | "sell";

  // Denomination Type
  denominationType: "RANGE" | "FIXED";

  // Range-based denominations (for RANGE type)
  sellMinAmount?: number;
  sellMaxAmount?: number;
  buyMinAmount?: number;
  buyMaxAmount?: number;

  // NGN converted amounts (for RANGE type)
  minAmountNgn?: number;
  maxAmountNgn?: number;

  // Fixed denominations (for FIXED type)
  priceList?: number[];
  ngnPriceList?: number[];
  mappedPriceList?: Record<string, number>;

  // Redeem instructions
  redeemInstructions?: {
    concise?: string;
    verbose?: string;
  };

  // Terms & Activation
  saleTerms?: string;
  purchaseTerms?: string;
  saleActivated: boolean;
  purchaseActivated: boolean;

  rateLastUpdated?: Date; // When was rate last updated
  rateSource?: string; // 'manual' | 'api' | 'provider'

  //commision
  commissionType: "flat" | "percentage";
  commisionValue: number;

  isActive: boolean;
   isHottest: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

const GiftCardSchema = new Schema<IGiftCard>(
  {
    countryId: {
      type: Schema.Types.ObjectId,
      ref: "Country",
      required: function () {
        return this.type === "buy";
      },
    },
    legacyGiftCardId: { type: String, index: true, sparse: true  },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "GiftCardCategory",
      required: true,
    },
    productId: { type: String, default: uuidv4, unique: true },
    name: { type: String, required: true },
    logo: { type: String },

    // Currency & Exchange
    currency: { type: String },
    senderCurrency: { type: String },
    exchangeRate: { type: Number },
    cardType: { type: String, enum: ["physical", "e-code"] },

    type: { type: String, enum: ["buy", "sell"], required: true },

    // Rates & Fees
    sellRate: { type: Number },
    buyRate: { type: Number },

    senderFee: { type: Number },
    senderFeePercentage: { type: Number },
    discountPercentage: { type: Number },

    // Denomination Type
    denominationType: { type: String, enum: ["RANGE", "FIXED"] },

    // Range-based denominations
    sellMinAmount: { type: Number },
    sellMaxAmount: { type: Number },
    buyMinAmount: { type: Number },
    buyMaxAmount: { type: Number },
    minAmountNgn: { type: Number },
    maxAmountNgn: { type: Number },

    // Fixed denominations
    priceList: [{ type: Number }],
    ngnPriceList: [{ type: Number }],
    mappedPriceList: { type: Schema.Types.Mixed },

    // Redeem instructions
    redeemInstructions: {
      concise: { type: String },
      verbose: { type: String },
    },

    saleTerms: { type: String },
    purchaseTerms: { type: String },
    saleActivated: { type: Boolean, default: false },
    purchaseActivated: { type: Boolean, default: false },

    // commision
    commissionType: { type: String, enum: ["flat", "percentage"] },
    commisionValue: { type: Number },

    rateLastUpdated: { type: Date },
    rateSource: { type: String },
    isActive: { type: Boolean, default: true },
       isHottest: { type: Boolean, default: false },
    deletedAt: { type: Date },
    createdAt: { type: Date, immutable: true },
  },
  {
    timestamps: true,
  },
);

GiftCardSchema.pre("save", function (next) {
  if (this.type === "buy" && !this.buyRate) {
    return next(new Error("Buy rate required for buy type"));
  }
  if (this.type === "sell" && !this.sellRate) {
    return next(new Error("Sell rate required for sell type"));
  }
  next();
});


// Indexes
GiftCardSchema.index({ countryId: 1 });
GiftCardSchema.index({ categoryId: 1 });
GiftCardSchema.index({ status: 1 });
GiftCardSchema.index({ isHottest: 1 });
GiftCardSchema.index({ type: 1 });
GiftCardSchema.index({ categoryId: 1, type: 1 });
GiftCardSchema.index({ denominationType: 1 });
GiftCardSchema.index({ currency: 1 });
GiftCardSchema.index(
  { productId: 1, countryId: 1 },
  { unique: true, name: "productId_countryId_unique" },
);

export const GiftCard = mongoose.model<IGiftCard>("GiftCard", GiftCardSchema);
