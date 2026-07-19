// models/Network.ts - UPDATED WITH CHAINTYPE AND NETWORKPATH

import mongoose, { Schema, Document, Types } from "mongoose";

export type ChainType =
  | "EVM"
  | "BITCOIN"
  | "TRON"
  | "SOLANA"
  | "RIPPLE"
  | "OTHER";

export interface INetwork extends Document {
  providerId?: Types.ObjectId;
  networkId: string; // 'ethereum', 'tron', 'bsc', 'bitcoin'
  legacyNetworkId?: string;
  name: string; // 'Ethereum', 'Tron', 'Binance Smart Chain'
  code: string; // 'ERC20', 'TRC20', 'BEP20', 'Native'

  chainType: ChainType; // 'EVM', 'BITCOIN', 'TRON', 'SOLANA', 'RIPPLE', 'OTHER'
  networkPath: string; // 'ethereum', 'bsc', 'bitcoin', 'tron', 'solana', 'xrp' (used in API endpoints)
  tatumChainCode: string; // Exact Tatum identifier

  // Network-specific fees
  confirmationsRequired: number;
  contractAddress?: string;

  // Validation and utilities
  addressPattern?: string;
  explorerUrl?: string;

  // Platform wallet for this network
  platformDepositAddress?: string;

  // Status
  isActive: boolean;

  // Metadata
  priority?: number;
  description?: string;
  minSweepThresholdUsd?: number;
  derivationPathCounter?: number;
  masterXpub: string;
  breetAssetId?: string;
  breetNetworkCode?: string;

  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

const networkSchema = new Schema<INetwork>(
  {
    providerId: {
      type: Schema.Types.ObjectId,
      ref: "Provider",
      index: true,
    },
    networkId: {
      type: String,
      required: true,
      index: true,
      uppercase: true,
    },
    legacyNetworkId: {
      type: String,
      index: true,
      sparse: true,
    },
    name: {
      type: String,
      required: true,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
    },

    // NEW FIELDS FOR DYNAMIC ROUTING
    chainType: {
      type: String,
      required: true,
      enum: ["EVM", "BITCOIN", "TRON", "SOLANA", "RIPPLE", "OTHER"],
      default: "EVM",
      index: true,
      description: "Blockchain architecture type for routing transactions",
    },
    masterXpub: {
      type: String,
    },

    networkPath: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
      description:
        'Path for Tatum API endpoints (e.g., "ethereum", "bsc", "bitcoin")',
    },
    tatumChainCode: {
      type: String,
      index: true,
      sparse: true,
      description: "Exact Tatum identifier for the blockchain",
    },

    // Existing fields
    confirmationsRequired: {
      type: Number,
      default: 6,
    },
    contractAddress: String,
    addressPattern: String,
    explorerUrl: String,
    platformDepositAddress: String,
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    priority: {
      type: Number,
      default: 0,
    },
    description: String,
    deletedAt: Date,
    createdAt: {
      type: Date,
      immutable: true,
    },
    minSweepThresholdUsd: {
      type: Number,
      default: 50,
      min: 0,
    },
    breetAssetId: { type: String, sparse: true, index: true },
    breetNetworkCode: { type: String },
    derivationPathCounter: {
      type: Number,
      default: 0,
      description: "Tracks next available derivation index for users",
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for fast querying
networkSchema.index({ networkId: 1, isActive: 1 });
networkSchema.index({ code: 1, isActive: 1 });
networkSchema.index({ chainType: 1, isActive: 1 });
networkSchema.index({ networkPath: 1, isActive: 1 });
networkSchema.index(
  { networkId: 1, providerId: 1 },
  { unique: true, sparse: true },
);
networkSchema.index(
  { tatumChainCode: 1, providerId: 1 },
  { unique: true, sparse: true },
);

export const Network = mongoose.model<INetwork>("Network", networkSchema);
