import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICryptoTransaction extends Document {
  cryptoId: Types.ObjectId;
  legacyCryptoTxId?: string;
  userId: Types.ObjectId;

  // Transaction identifiers
  transactionId?: string;
  reference: string;

  // Trade details
  tradeType: "buy" | "sell";

  // Network information (snapshot from crypto.networks at time of transaction)
  network: {
    networkId: string;
    code: string;
    name: string;
    contractAddress?: string;
    confirmationsRequired?: number;
    explorerUrl?: string;
  };

  walletAddress: string; // For BUY: user's wallet | For SELL: platform's wallet

  balanceBefore: number; // ← For reconciliation
  balanceAfter: number; // ← For reconciliation

  // Amounts and rates
  cryptoAmount: number; // Amount of crypto (e.g., 100 USDT)
  fiatAmount: number; // Fiat equivalent (e.g., ₦150,000)
  exchangeRate: number; // Rate at time of transaction
  serviceFee: number; // Platform fee in fiat
  serviceFeeUsd?: number;
  totalAmount: number; // For BUY: total debit | For SELL: total payout
  amountsFinalized: boolean; // false = estimate at creation, true = webhook-confirmed final values

  status:
    | "pending"
    | "pending_deposit"
    | "approved"
    | "transferred"
    | "failed"
    | "success"
    | "processing"
    | "flagged"
    | "declined"
    | "s.approved";
  claimedAt?: Date;
  tatumPendingId?: string;

  // Blockchain details
  txHash?: string; // Blockchain transaction hash
  confirmations?: number; // Current number of confirmations
  blockNumber?: number; // Block number where tx was included

  // For SELL transactions - Bank details
  bankId?: Types.ObjectId;
  bankCode?: string;
  accountName?: string;
  accountNumber?: string;

  // Proof of payment (for SELL - user uploads)
  proof?: string;

  // Admin review (for manual processing)
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  reviewNote?: string; // Admin's notes
  reviewRate?: number; // Adjusted rate if needed
  reviewAmount?: number; // Adjusted amount if needed
  reviewProof?: string; // Admin's proof of payout

  declineNote?: string; // Reason for decline
  declinedBy?: Types.ObjectId; // Admin who declined
  declinedAt?: Date;
  declineProof?: string; // Proof document for decline
  declinePrompt?: string;

  // Additional data
  comment?: string; // User's comment
  meta?: Record<string, any>; // Flexible field for extra data

  // Processing tracking
  processedAt?: Date; // When crypto was sent/received
  completedAt?: Date; // When entire flow completed

  nowPaymentsPaymentId?: string; // For SELL: NP payment_id (deposit tracking)
  nowPaymentsPayoutId?: string; // For BUY:  NP payout id  (withdrawal tracking)
  isAutomated?: boolean;
  paymentMethod?: "platform" | "manual" | "pending";

  // Tatum-specific fields
  tatumDepositAddress?: string; // User's permanent deposit address
  tatumAccountId?: string; // Virtual Account ID
  tatumWebhookId?: string; // Webhook ID for idempotency
  tatumSweepTxHash?: string; // Transaction hash of sweep to Master Wallet
  sweepStatus?: "pending" | "confirmed" | "failed"; // Status of sweep operation

  // Breet-specific fields
  breetTradeId?: string;
  breetWalletId?: string; // Breet wallet address ID
  breetWebhookId?: string; // For idempotency
  breetAutoSettled?: boolean; // Was auto-settlement applied?
  breetSettledBankAccountId?: Types.ObjectId; // Which bank was it settled to?
  breetMarkupPercent?: number; // Markup % at time of settlement
  breetMarkupAmount?: number; // Absolute markup deducted
  breetAmountSettled?: number; // Final amount settled to bank
  breetFlaggedStatus?: "pending" | "resolved" | "none"; // Flagged deposit tracking
  breetFlagResolvedAt?: Date;
  errorMessage?: string;
  retryCount?: number;

  derivationIndex?: number; // User's derivation index from master xpub (Tatum)
  webhookReceivedAt?: Date;
  channel: "ios" | "android" | "web" | "api";
  profit?: number;
  createdAt: Date;
  updatedAt: Date;
}

const cryptoTransactionSchema = new Schema<ICryptoTransaction>(
  {
    cryptoId: {
      type: Schema.Types.ObjectId,
      ref: "Crypto",
      required: true,
      index: true,
    },
    legacyCryptoTxId: { type: String, index: true, sparse: true },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    transactionId: String,
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    tradeType: {
      type: String,
      enum: ["buy", "sell"],
      required: true,
      index: true,
    },
    network: {
      type: {
        networkId: { type: String, required: true },
        code: { type: String, required: true },
        name: { type: String, required: true },
        contractAddress: String,
        confirmationsRequired: Number,
        explorerUrl: String,
      },
      required: true,
    },
    walletAddress: {
      type: String,
      // required: true, //TODO: make it requierd back after ksb tech data migration
      trim: true,
    },

    cryptoAmount: {
      type: Number,
      // required: true,
      min: 0,
    },
    fiatAmount: {
      type: Number,
      // required: true,
      min: 0,
    },
    exchangeRate: {
      type: Number,
      required: true,
      min: 0,
    },
    serviceFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    balanceBefore: {
      type: Number,
      required: true,
      min: 0,
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },

    totalAmount: {
      type: Number,
      // required: true,
      min: 0,
    },
    amountsFinalized: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "pending_deposit",
        "transferred",
        "approved",
        "s.approved",
        "success",
        "processing",
        "flagged",
        "failed",
        "declined",
      ],
      default: "pending",
      required: true,
      index: true,
    },
    txHash: {
      type: String,
      trim: true,
      index: true,
      sparse: true, // Allows multiple null values
    },
    confirmations: {
      type: Number,
      min: 0,
    },
    blockNumber: Number,
    bankId: { type: Types.ObjectId, ref: "Bank" },
    bankCode: String,
    accountName: String,
    accountNumber: String,
    proof: String,
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
    },
    reviewedAt: Date,
    reviewNote: String,
    reviewRate: Number,
    reviewAmount: Number,
    reviewProof: String,

    //Decline review
    declineNote: { type: String },
    declinedBy: { type: Schema.Types.ObjectId, ref: "Admin" },
    declinedAt: { type: Date },
    declineProof: { type: String },
    declinePrompt: { type: String },

    comment: String,
    meta: Schema.Types.Mixed,
    processedAt: Date,
    completedAt: Date,
    errorMessage: String,

    nowPaymentsPaymentId: {
      type: String,
      index: true,
      sparse: true, // allows multiple null values
    },
    nowPaymentsPayoutId: {
      type: String,
      index: true,
      sparse: true,
    },
    isAutomated: {
      type: Boolean,
      default: false,
    },
    paymentMethod: {
      type: String,
      enum: ["platform", "manual", "pending"],
      default: "platform",
    },
    retryCount: {
      type: Number,
      default: 0,
    },

    createdAt: { type: Date, immutable: true },
    tatumDepositAddress: {
      type: String,
      sparse: true,
      index: true,
      description: "Permanent deposit address (Tatum)",
    },
    tatumAccountId: {
      type: String,
      sparse: true,
      description: "Virtual Account ID (Tatum)",
    },
    tatumWebhookId: {
      type: String,
      sparse: true,
      unique: true,
      description: "Webhook ID for idempotency check",
    },
    tatumSweepTxHash: {
      type: String,
      sparse: true,
      description: "Transaction hash of sweep to Master Wallet",
    },
    sweepStatus: {
      type: String,
      enum: ["pending", "confirmed", "failed"],
      sparse: true,
      description: "Status of sweep operation (sell flow only)",
    },

    // Breet-specific fields
    breetTradeId: {
      type: String,
      sparse: true,
      index: true,
    },
    breetWalletId: {
      type: String,
      sparse: true,
    },
    breetWebhookId: {
      type: String,
      sparse: true,
      unique: true,
    },
    breetAutoSettled: {
      type: Boolean,
      default: false,
    },
    breetSettledBankAccountId: {
      type: Schema.Types.ObjectId,
      ref: "BankAccount",
      sparse: true,
    },
    breetMarkupPercent: {
      type: Number,
      min: 0,
      sparse: true,
    },
    breetMarkupAmount: {
      type: Number,
      min: 0,
      sparse: true,
    },
    breetAmountSettled: {
      type: Number,
      min: 0,
      sparse: true,
    },
    breetFlaggedStatus: {
      type: String,
      enum: ["pending", "resolved", "none"],
      default: "none",
      sparse: true,
    },
    breetFlagResolvedAt: {
      type: Date,
      sparse: true,
    },
    webhookReceivedAt: {
      type: Date,
      sparse: true,
    },
    derivationIndex: {
      type: Number,
      sparse: true,
      description: "User's derivation index from master xpub (Tatum)",
    },
    claimedAt: {
      type: Date,
      sparse: true,
    },
    tatumPendingId: {
      type: String,
      sparse: true,
      index: true,
    },
    profit: {
      type: Number,
      sparse: true,
    },
    channel: {
      type: String,
      enum: ["ios", "android", "web", "api"],
      required: false,
      default: "web",
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes for common queries
cryptoTransactionSchema.index({ userId: 1, createdAt: -1 });
cryptoTransactionSchema.index({ status: 1, createdAt: -1 });
cryptoTransactionSchema.index({ tradeType: 1, status: 1 });
cryptoTransactionSchema.index({ cryptoId: 1, createdAt: -1 });

cryptoTransactionSchema.index({ tatumDepositAddress: 1, status: 1 }); // claimForProcessing query
cryptoTransactionSchema.index({ tatumWebhookId: 1, tatumDepositAddress: 1 }); // idempotency + reorg lookup
cryptoTransactionSchema.index({ sweepStatus: 1, tradeType: 1 }); // daily sweep cron
cryptoTransactionSchema.index({ status: 1, tatumWebhookId: 1 });
cryptoTransactionSchema.index({ channel: 1, createdAt: -1 });
cryptoTransactionSchema.index({ channel: 1, tradeType: 1 });

export const CryptoTransaction = mongoose.model<ICryptoTransaction>(
  "CryptoTransaction",
  cryptoTransactionSchema,
);
