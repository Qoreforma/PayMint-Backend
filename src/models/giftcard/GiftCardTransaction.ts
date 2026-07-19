import { SystemProvider } from "@/utils/constants";
import mongoose, { Schema, Document, Types } from "mongoose";

export interface IGiftCardTransaction extends Document {
  giftCardId: Types.ObjectId;
  userId: Types.ObjectId;
  legacyGiftCardTxId?: string;
  parentId?: Types.ObjectId; // For referencing parent transaction
  transactionId?: Types.ObjectId; // Links to main Transaction record
  reference: string;
  tradeType: "buy" | "sell";

  // Sell-specific fields
  cardType?: "physical" | "e-code";
  cards?: string[];
  comment?: string;
  bankAccountId?: Types.ObjectId;

  // Transaction flow
  direction: "DEBIT" | "CREDIT"; // CREDIT for sell (receiving money), DEBIT for buy (spending money)

  // Transaction amounts
  amount: number;
  quantity: number;
  serviceCharge?: number;
  rate?: number;
  payableAmount: number;

  // Balance tracking (for reconciliation)
  balanceBefore: number;
  balanceAfter: number;

  // Grouping for multiple transactions
  groupTag?: string;

  status:
    | "success"
    | "pending"
    | "approved"
    | "declined"
    | "failed"
    | "multiple"
    | "archived"
    | "s.approved";

  // Bank details (copied from bankAccountId for reference)
  bankId?: Types.ObjectId;
  bankCode?: string;
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  profit?: number;
  // Admin review fields (first approval)
  reviewNote?: string;
  reviewProof?: string; // Proof document for second approval
  reviewedBy?: Types.ObjectId; // Admin who reviewed
  reviewedAt?: Date;
  reviewedAmount?: number; // The new amount admin sets (if changed from original)

  declineNote?: string; // Reason for decline
  declinedBy?: Types.ObjectId; // Admin who declined
  declinedAt?: Date;
  declineProof?: string; // Proof document for decline
  declinePrompt?: string;

  // Provider reference (for buy transactions)
  providerReference?: string;

  // Transaction safety
  idempotencyKey?: string; // Prevent duplicate processing

  providerCardIndex?: number;

  totalDeduction?: number;
  paymentMethod?: "platform" | "manual" | "manual";

  // Initiator tracking
  initiatedBy?: Types.ObjectId;
  initiatedByType?: SystemProvider;

  // Metadata
  meta?: {
    recipientEmail?: string;
    recipientPhone?: string;
    cardImages?: string[]; // Store multiple card images
    ipAddress?: string;
    userAgent?: string;
    [key: string]: any;
  };
  channel?: "ios" | "android" | "web" | "api";
  // Soft delete
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GiftCardTransactionSchema = new Schema<IGiftCardTransaction>(
  {
    giftCardId: { type: Schema.Types.ObjectId, ref: "GiftCard" },
    legacyGiftCardTxId: { type: String, index: true, sparse: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    parentId: { type: Schema.Types.ObjectId, ref: "GiftCardTransaction" },
    transactionId: { type: Schema.Types.ObjectId, ref: "Transaction" },
    reference: { type: String, required: true, unique: true },
    tradeType: { type: String, enum: ["buy", "sell"], required: true },

    // Sell-specific fields
    cardType: { type: String, enum: ["physical", "e-code"] },
    cards: [{ type: String }],
    comment: { type: String },
    bankAccountId: { type: Schema.Types.ObjectId, ref: "BankAccount" },

    // Transaction flow
    direction: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      required: true,
    },

    // Transaction amounts
    amount: { type: Number, required: true },
    quantity: { type: Number, required: true, default: 1 },
    serviceCharge: { type: Number, default: 0 },
    rate: { type: Number },
    payableAmount: { type: Number },

    // Balance tracking
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },

    // Grouping
    groupTag: { type: String },
    paymentMethod: {
      type: String,
      enum: ["platform", "manual", "pending"],
      default: "platform",
    },
    profit: {
      type: Number,
      default: null,
    },
    // Status
    status: {
      type: String,
      enum: [
        "pending",
        "success",
        "approved",
        "declined",
        "failed",
        "multiple",
        "s.approved",
        "archived",
      ],
      default: "pending",
    },

    // Bank details
    bankId: { type: Schema.Types.ObjectId, ref: "Bank" },
    bankCode: { type: String },
    accountName: { type: String },
    accountNumber: { type: String },

    // Admin review (first approval)
    reviewNote: { type: String },
    reviewedAmount: { type: Number },
    reviewProof: { type: String },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    reviewedAt: { type: Date },

    //Decline review
    declineNote: { type: String },
    declinedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    declinedAt: { type: Date },
    declineProof: { type: String },
    declinePrompt: { type: String },
    // Provider
    providerReference: { type: String },

    providerCardIndex: { type: Number },

    totalDeduction: { type: Number },

    // Transaction safety
    idempotencyKey: { type: String, index: true, sparse: true },

    // Initiator tracking
    initiatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    initiatedByType: {
      type: String,
      enum: ["user", "system", "admin"],
      default: "user",
    },

    // Metadata
    meta: { type: Schema.Types.Mixed },

    // Soft delete
    deletedAt: { type: Date },
    channel: {
      type: String,
      enum: ["ios", "android", "web", "api"],
      sparse: true,
      index: true,
    },
    createdAt: { type: Date, immutable: true },
  },
  {
    timestamps: true,
  },
);

// Indexes
GiftCardTransactionSchema.index({ userId: 1 });
GiftCardTransactionSchema.index({ giftCardId: 1 });
GiftCardTransactionSchema.index({ status: 1 });
GiftCardTransactionSchema.index({ tradeType: 1 });
GiftCardTransactionSchema.index({ groupTag: 1 });
GiftCardTransactionSchema.index({ parentId: 1 });
GiftCardTransactionSchema.index({ createdAt: -1 });
GiftCardTransactionSchema.index({ providerReference: 1 });
GiftCardTransactionSchema.index({ reference: 1, status: 1 });
GiftCardTransactionSchema.index({ userId: 1, createdAt: -1 });
GiftCardTransactionSchema.index({ tradeType: 1, status: 1, createdAt: -1 });

// Virtual for children transactions (when status is 'multiple')
GiftCardTransactionSchema.virtual("children", {
  ref: "GiftCardTransaction",
  localField: "_id",
  foreignField: "parentId",
});

export const GiftCardTransaction = mongoose.model<IGiftCardTransaction>(
  "GiftCardTransaction",
  GiftCardTransactionSchema,
);
