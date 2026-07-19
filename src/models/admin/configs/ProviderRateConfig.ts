import mongoose, { Schema, Document, Types } from "mongoose";

export interface IProviderRateConfig extends Document {
  providerId: Types.ObjectId;
  providerCode: string; // e.g. 'nowpayment'
  serviceType: string;  // e.g. 'crypto' — for clarity/filtering, not enforcement
  buyRate: number;      // platform buys from user (user sells)
  sellRate: number;     // platform sells to user (user buys)
  isActive: boolean;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProviderRateConfigSchema = new Schema<IProviderRateConfig>(
  {
    providerId: {
      type: Schema.Types.ObjectId,
      ref: "Provider",
      required: true,
      unique: true, // one config per provider
      index: true,
    },
    providerCode: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    serviceType: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      default: "crypto",
    },
    buyRate: {
      type: Number,
      required: true,
      min: 0,
    },
    sellRate: {
      type: Number,
      required: true,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  {
    timestamps: true,
  }
);

ProviderRateConfigSchema.index({ providerCode: 1, isActive: 1 });

export const ProviderRateConfig = mongoose.model<IProviderRateConfig>(
  "ProviderRateConfig",
  ProviderRateConfigSchema
);