import mongoose, { Schema, Document, Types } from "mongoose";

export interface IService extends Document {
  name: string;
  code: string;
  logo?: string;
  serviceTypeId: Types.ObjectId;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  legacyServiceId?: string;
  supportedProviders: Types.ObjectId[];
}

const ServiceSchema = new Schema<IService>(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    logo: { type: String },
    serviceTypeId: {
      type: Schema.Types.ObjectId,
      ref: "ServiceType",
      required: true,
    },
    isActive: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 0 },
    deletedAt: { type: Date },
    legacyServiceId: { type: String, index: true,sparse: true  },
    supportedProviders: [
      {
        type: Schema.Types.ObjectId,
        ref: "Provider",
      },
    ],
  },
  {
    timestamps: true,
  },
);

// Indexes
ServiceSchema.index({ isActive: 1 });
ServiceSchema.index({ serviceTypeId: 1 });
ServiceSchema.index({ serviceTypeId: 1, isActive: 1 });
ServiceSchema.index({ displayOrder: 1 });

export const Service = mongoose.model<IService>("Service", ServiceSchema);
