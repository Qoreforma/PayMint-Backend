import mongoose, { Schema, Document } from "mongoose";

export interface ITradeBonus extends Document {
  name: string;
  description?: string;
  amountRequired: number; // e.g., 100,000 (in base currency)
  bonusType: "flat" | "percentage"; // Type of bonus
  value: number; // Amount (for flat) or percentage (for percentage)
  maxCashbackAmount?: number; // Optional cap (useful for percentage bonuses)
  isActive: boolean;
  startDate: Date;
  endDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TradeBonusSchema = new Schema<ITradeBonus>(
  {
    name: { type: String, required: true, unique: true },
    description: String,
    amountRequired: { type: Number, required: true, min: 0 },
    bonusType: { 
      type: String, 
      enum: ["flat", "percentage"], 
      required: true 
    },
    value: { type: Number, required: true, min: 0 },
    maxCashbackAmount: Number,
    isActive: { type: Boolean, default: true, index: true },
    startDate: { type: Date, default: Date.now },
    endDate: Date,
    createdAt: { type: Date, immutable: true },
  },
  { timestamps: true }
);

TradeBonusSchema.index({ isActive: 1, tradesRequired: 1 });

export const TradeBonus = mongoose.model<ITradeBonus>(
  "TradeBonus",
  TradeBonusSchema
);