import mongoose, { Schema, Document, Types } from "mongoose";

export interface IUserTradeMetrics extends Document {
  userId: Types.ObjectId;
  totalAmountTraded: number; // LIFETIME TOTAL AMOUNT (main metric)
  totalTradesCount: number; // Also track number of trades
  lastTradeDate: Date;
  bonusesApplied: Array<{
    bonusId: Types.ObjectId;
    appliedAt: Date;
    cashbackAmount: number;
    transactionId: Types.ObjectId;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const UserTradeMetricsSchema = new Schema<IUserTradeMetrics>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    totalAmountTraded: { type: Number, default: 0, index: true }, 
    totalTradesCount: { type: Number, default: 0 }, 
    lastTradeDate: Date,
    bonusesApplied: [
      {
        bonusId: { type: Schema.Types.ObjectId, ref: "TradeBonus" },
        appliedAt: Date,
        cashbackAmount: Number,
        transactionId: { type: Schema.Types.ObjectId, ref: "Transaction" },
      },
    ],
  },
  { timestamps: true }
);

export const UserTradeMetrics = mongoose.model<IUserTradeMetrics>(
  "UserTradeMetrics",
  UserTradeMetricsSchema
);