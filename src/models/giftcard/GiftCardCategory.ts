import mongoose, { Schema, Document, Types } from "mongoose";

export interface IGiftCardCategory extends Document {
  providerId?: Types.ObjectId;
  legacyCategoryId?: string;
  name: string;
  icon?: string;
  countries: Types.ObjectId[];
  transactionType: "buy" | "sell" | "both";
  isGlobal: boolean;
  saleTerm?: string;
  purchaseTerm?: string;
  saleActivated: boolean;
  purchaseActivated: boolean;
  isActive: boolean;

  // Brand grouping fields
  brandName?: string;       // Canonical brand name used for deduplication (e.g. "PlayStation", "Xbox")
  isAutoGroup: boolean;     // true = created by sync engine, false = legacy Reloadly category
  groupLogo?: string;       // Best logo found across products in this group
  keywords: string[];       // Product names that have been mapped to this group (for traceability)

  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

const GiftCardCategorySchema = new Schema<IGiftCardCategory>(
  {
    providerId: {
      type: Schema.Types.ObjectId,
      ref: "Provider",
    },
    legacyCategoryId: { type: String, index: true, sparse: true  },
    name: { type: String, required: true, index: { unique: true, sparse: true } },
    icon: { type: String },
    countries: [{ type: Schema.Types.ObjectId, ref: "Country" }],
    isGlobal: {
      type: Boolean,
      default: false,
      index: true,
    },
    transactionType: {
      type: String,
      enum: ["buy", "sell", "both"],
      required: true,
    },

    saleTerm: { type: String },
    purchaseTerm: { type: String },
    saleActivated: { type: Boolean, default: false },
    purchaseActivated: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date },

    // Brand grouping fields
    brandName: { type: String, index: true },
    isAutoGroup: { type: Boolean, default: false, index: true },
    groupLogo: { type: String },
    keywords: [{ type: String }],
    createdAt: { type: Date, immutable: true },
  },
  {
    timestamps: true,
  }
);

// Indexes
GiftCardCategorySchema.index({ providerId: 1 });
GiftCardCategorySchema.index({ transactionType: 1 });
GiftCardCategorySchema.index({ countries: 1 });
GiftCardCategorySchema.index({ isAutoGroup: 1, isActive: 1 });


export const GiftCardCategory = mongoose.model<IGiftCardCategory>(
  "GiftCardCategory",
  GiftCardCategorySchema
);