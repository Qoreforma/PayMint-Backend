import mongoose, { Schema, Document, Types } from "mongoose";

export interface ILeaderboardEntry extends Document {
  userId: Types.ObjectId;
  walletId?: Types.ObjectId;
  type: string;
  period: "all_time" | "monthly" | "weekly" | "daily";
  periodKey: string;

  totalAmount: number;
  totalAmountUSD: number;
  transactionCount: number;
  rank: number;

  userDetails: {
    firstname: string;
    lastname: string;
    email: string;
    phone?: string;
    username?: string;
  };

  lastTransactionAt: Date;
  calculatedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

const LeaderboardSchema = new Schema<ILeaderboardEntry>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    walletId: {
      type: Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      index: true,
    },
    period: {
      type: String,
      enum: ["all_time", "monthly", "weekly", "daily"],
      required: true,
      index: true,
    },
    periodKey: {
      type: String,
      required: true,
      index: true,
    },

    totalAmount: { type: Number, default: 0, index: true },
    totalAmountUSD: { type: Number, default: 0, index: true },
    transactionCount: { type: Number, default: 0 },
    rank: { type: Number, index: true },

    userDetails: {
      firstname: { type: String, required: true },
      lastname: { type: String, required: true },
      email: { type: String, required: true },
      phone: { type: String },
      username: { type: String },
    },

    lastTransactionAt: { type: Date },
    calculatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, immutable: true },
  },
  {
    timestamps: true,
  },
);

LeaderboardSchema.index({ type: 1, period: 1, periodKey: 1, rank: 1 });
LeaderboardSchema.index(
  {
    userId: 1,
    type: 1,
    period: 1,
    periodKey: 1,
  },
  { unique: true },
);
LeaderboardSchema.index({
  type: 1,
  period: 1,
  periodKey: 1,
  totalAmount: -1,
});

export const Leaderboard = mongoose.model<ILeaderboardEntry>(
  "Leaderboard",
  LeaderboardSchema,
);
