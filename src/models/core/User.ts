import mongoose, { Schema, Document, Types } from "mongoose";

export interface IFCMToken {
  token: string;
  deviceType: "ios" | "android";
  deviceId: string;
  lastUsedAt: Date;
}

// IBiometricToken — add frontendToken field
export interface IBiometricToken {
  tokenHash: string;
  frontendToken?: string; // stored plain for retrieval; tokenHash is still used for verification
  createdAt: Date;
}
export interface IUserCryptoAddress {
  networkId: Types.ObjectId;
  derivationIndex: number;
  depositAddress: string;
  tatumAccountId: string;
  createdAt: Date;
  // track whether Tatum actually accepted the webhook subscription for
  // this address. Without this, a failed subscription is indistinguishable
  // from a successful one once the address is cached — that's the bug that
  // caused deposits to go un-notified.
  webhookSubscriptionId?: string | null;
  webhookSubscriptionStatus: "subscribed" | "failed" | "pending";
  webhookLastAttemptAt?: Date;
}

export interface IBreetWalletAddress {
  cryptoId: Types.ObjectId;
  breetWalletId: string;
  walletAddress: string;
  asset: string;
  label: string;
  qrCodeUrl?: string;
  autoSettlementEnabled: boolean;
  linkedBankAccountId?: Types.ObjectId;
  settlementMode: "bank" | "wallet";
  lastDepositAt?: Date;
  totalDepositsUSD?: number;
  createdAt: Date;
}
export interface IUser extends Document {
  firstname: string;
  lastname: string;
  email: string;
  phoneCode?: string;
  phone?: string;
  username?: string;
  gender?: "male" | "female" | "other";
  refCode?: string;
  referredBy?: Types.ObjectId | undefined;
  avatar?: string | null;
  country?: string | null;
  state?: string;
  city?: string;
  address?: string;
  postalCode?: string;
  bvnVerified: boolean;
  bvnValidated: boolean;
  emailVerifiedAt?: Date;
  phoneVerifiedAt?: Date;
  lifecycleEmails?: {
    profileIncompleteSentAt?: Date;
    day3NoTxnSentAt?: Date;
    day7NoTxnSentAt?: Date;
    inactivitySent?: number[]; // thresholds already emailed, e.g. [30, 60]
  };
  pinActivatedAt?: Date;
  twoFactorEnabledAt?: Date;
  twofactorEnabled?: boolean;
  loginBiometricEnabled?: boolean;
  transactionBiometricEnabled?: boolean;
  biometricEnabled?: boolean;

  // New token arrays (multi-device, max 5)
  loginBiometricTokens?: IBiometricToken[];
  transactionBiometricTokens?: IBiometricToken[];

  twoFactorForcedBySystem?: boolean;

  password: string;
  status: "active" | "inactive" | "suspended" | "fraudulent" | "shadow-banned";
  fcmTokens: string[];
  authType: "password" | "biometric" | "social";
  userType: "regular" | "influencer" | "micro-influencer" | "vendor";
  referralEarningRate?: number;
  pin?: string;
  otp?: string;
  otpExpiry?: Date;
  virtualAccount?: any;
  dateOfBirth: Date;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  legacyUserId?: string;
  partner?: IUserPartner;

  //system
  isSystemUser?: boolean;
  adminLevel?: string;

  tatumCustomerId?: string; // Tatum Customer ID
  userCryptoAddresses?: IUserCryptoAddress[];
  breetWalletAddresses?: IBreetWalletAddress[]; // For Breet integration

  // new fields
  bvn: string;
  nin: string;

  // Xixapay KYC linkage
  xixapayCustomerId?: string;
  xixapayKyc?: {
    address?: string;
    state?: string;
    city?: string;
    postalCode?: string;
    idCardUrl?: string;
    utilityBillUrl?: string;
    verifiedAt?: Date;
    status?: "pending" | "verified" | "failed";
  };
}

export interface IUserResponse {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  phoneCode?: string | null;
  phone?: string | null;
  username?: string | null;
  gender?: "male" | "female" | "other" | null;
  refCode?: string | null;
  referredBy?: string | Types.ObjectId | null;
  avatar?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  address?: string | null;
  postalCode?: string | null;
  legacyUserId?: string;
  partner?: IUserPartner | null;

  status?:
    | "active"
    | "inactive"
    | "suspended"
    | "fraudulent"
    | "shadow-banned"
    | null;
  authType?: "password" | "biometric" | "social" | null;
  twofactorEnabled?: boolean;

  userType?: "regular" | "influencer" | "micro-influencer" | "vendor";
  referralEarningRate?: number;

  // Replace the two array fields added earlier
  loginBiometricToken?: string | null;
  transactionBiometricToken?: string | null;

  bvnVerified?: boolean;
  bvnValidated?: boolean;

  emailVerifiedAt?: Date | null;
  phoneVerifiedAt?: Date | null;
  pinActivatedAt?: Date | null;
  twoFactorEnabledAt?: Date | null;
  dateOfBirth?: Date | null;
  loginBiometricEnabled?: boolean;
  transactionBiometricEnabled?: boolean;
  biometricEnabled?: boolean;

  twoFactorForcedBySystem?: boolean;

  fcmTokens: string[];
  virtualAccount?: any | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  deletedAt?: Date | null;
  lastLoginAt?: Date;

  // new fields
  bvn?: string | null;
  nin?: string | null;
}

export interface IUserPartner {
  isPartner: boolean;
  status: "pending" | "active" | "suspended";
  companyName: string;
  contactPerson: string;
  webhookUrl: string | null;
  webhookSecret: string;
  createdAt: Date;
}

const PartnerSchema = new Schema<IUserPartner>({
  isPartner: { type: Boolean, default: false, index: true },
  status: {
    type: String,
    enum: ["pending", "active", "suspended"],
    default: "pending",
  },
  companyName: { type: String },
  contactPerson: { type: String },
  webhookUrl: { type: String },
  webhookSecret: { type: String },
  createdAt: { type: Date },
});

const BiometricTokenSchema = new Schema<IBiometricToken>(
  {
    tokenHash: { type: String, required: true },
    frontendToken: { type: String }, // add this line
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const UserSchema = new Schema<IUser>(
  {
    firstname: { type: String, required: true },
    lastname: { type: String },
    email: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    phoneCode: { type: String },
    phone: { type: String, sparse: true, index: true },
    username: { type: String, unique: true, sparse: true, index: true },
    gender: { type: String, enum: ["male", "female", "other"] },
    refCode: { type: String, unique: true, sparse: true, index: true },
    referredBy: { type: Schema.Types.ObjectId, ref: "User" },
    avatar: { type: String },
    country: { type: String },
    state: { type: String },
    city: { type: String },
    address: { type: String },
    postalCode: { type: String },

    bvnVerified: { type: Boolean, default: false },
    bvnValidated: { type: Boolean, default: false },

    userType: {
      type: String,
      enum: ["regular", "influencer", "micro-influencer", "vendor"],
      default: "regular",
    },
    referralEarningRate: { type: Number, default: 0 },
    emailVerifiedAt: { type: Date },
    phoneVerifiedAt: { type: Date },
    lifecycleEmails: {
      profileIncompleteSentAt: { type: Date },
      day3NoTxnSentAt: { type: Date },
      day7NoTxnSentAt: { type: Date },
      inactivitySent: { type: [Number], default: [] },
    },
    pinActivatedAt: { type: Date },
    twoFactorEnabledAt: { type: Date },
    twoFactorForcedBySystem: { type: Boolean, default: false },
    dateOfBirth: { type: Date },
    twofactorEnabled: { type: Boolean, default: false },

    loginBiometricEnabled: { type: Boolean, default: false },
    transactionBiometricEnabled: { type: Boolean, default: false },
    biometricEnabled: { type: Boolean, default: false },

    // New token arrays (max 5 devices each)
    loginBiometricTokens: {
      type: [BiometricTokenSchema],
      default: [],
    },
    transactionBiometricTokens: {
      type: [BiometricTokenSchema],
      default: [],
    },

    password: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended", "fraudulent", "shadow-banned"],
      default: "active",
    },
    fcmTokens: {
      type: [String],
      default: [],
    },
    authType: {
      type: String,
      enum: ["password", "biometric", "social"],
      default: "password",
    },
    legacyUserId: { type: String, index: true, sparse: true },
    pin: { type: String },
    otp: { type: String },
    otpExpiry: { type: Date },
    virtualAccount: { type: Schema.Types.Mixed },
    deletedAt: { type: Date },
    lastLoginAt: { type: Date },

    isSystemUser: { type: Boolean, default: false, index: true },

    bvn: { type: String },
    nin: { type: String },
    xixapayCustomerId: { type: String, sparse: true, index: true },
    xixapayKyc: {
      address: { type: String },
      state: { type: String },
      city: { type: String },
      postalCode: { type: String },
      idCardUrl: { type: String },
      utilityBillUrl: { type: String },
      verifiedAt: { type: Date },
      status: {
        type: String,
        enum: ["pending", "verified", "failed"],
      },
    },

    createdAt: { type: Date, immutable: true },
    tatumCustomerId: { type: String, sparse: true, index: true },
    userCryptoAddresses: [
      {
        networkId: { type: Schema.Types.ObjectId, ref: "Network" },
        derivationIndex: { type: Number, required: true },
        depositAddress: { type: String, required: true },
        tatumAccountId: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
        webhookSubscriptionId: { type: String, default: null },
        webhookSubscriptionStatus: {
          type: String,
          enum: ["subscribed", "failed", "pending"],
          default: "pending",
        },
        webhookLastAttemptAt: { type: Date, default: null },
      },
    ],
    breetWalletAddresses: [
      {
        cryptoId: {
          type: Schema.Types.ObjectId,
          ref: "Crypto",
          required: true,
        },
        breetWalletId: { type: String, required: true, index: true },
        walletAddress: { type: String, required: true },
        asset: { type: String, required: true },
        label: { type: String, required: true },
        qrCodeUrl: String,
        autoSettlementEnabled: { type: Boolean, default: false },
        linkedBankAccountId: {
          type: Schema.Types.ObjectId,
          ref: "BankAccount",
          sparse: true,
        },
        settlementMode: {
          type: String,
          enum: ["bank", "wallet"],
          required: true,
        },
        lastDepositAt: Date,
        totalDepositsUSD: { type: Number, default: 0 },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  },
);

UserSchema.add({
  partner: PartnerSchema,
});

UserSchema.pre("save", async function (next) {
  if (this.userType === "regular" && this.referralEarningRate) {
    this.referralEarningRate = undefined;
  }
  next();
});

UserSchema.pre("findOneAndUpdate", async function (next) {
  const update = this.getUpdate() as any;

  if (
    update.userType === "regular" &&
    update.referralEarningRate !== undefined
  ) {
    update.referralEarningRate = undefined;
  }

  next();
});

// Indexes
UserSchema.index({ status: 1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ "userCryptoAddresses.depositAddress": 1 }, { sparse: true });
UserSchema.index({ "breetWalletAddresses.walletAddress": 1 }, { sparse: true });

export const User = mongoose.model<IUser>("User", UserSchema);
