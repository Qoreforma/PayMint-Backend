import mongoose, { Schema, Document, Types } from "mongoose";

export interface IProvider extends Document {
  name: string;
  code: string;
  logo?: string;
  isActive: boolean;
  hasSync: boolean;
  lastSyncedAt?: Date;
  serviceType: Types.ObjectId[];
  paymentOptions?: string[];
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  legacyProviderId?: string;
}

const ProviderSchema = new Schema<IProvider>(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    logo: { type: String },
    isActive: { type: Boolean, default: true },
    paymentOptions: [{ type: String }],
    hasSync: { type: Boolean, default: false },
    lastSyncedAt: { type: Date },
    serviceType: [
      {
        type: Schema.Types.ObjectId,
        ref: "ServiceType",
      },
    ],
    deletedAt: { type: Date },
    legacyProviderId: { type: String, index: true,sparse: true  },
  },
  {
    timestamps: true,
  }
);

// Indexes
ProviderSchema.index({ isActive: 1 });
ProviderSchema.index({ hasSync: 1 });

// Virtual for checking if provider can sync
ProviderSchema.virtual("canSync").get(function () {
  return this.hasSync && this.isActive;
});

export const Provider = mongoose.model<IProvider>("Provider", ProviderSchema);
