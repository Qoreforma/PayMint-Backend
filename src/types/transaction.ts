// types/transaction.types.ts (update your existing types file)

import { IServiceCharge } from "@/models/billing/fees/ServiceCharge";

export interface TransactionResponseDTO {
  id: string;
  reference: string;
  amount: number;
  direction: "CREDIT" | "DEBIT";
  type: string;
  displayType: string;
  status: string;
  purpose: string;
  baseAmount?: number; // Optional, only for transactions with fees
  provider: string;
  remark: string;
  description: string;
  balanceBefore: number;
  balanceAfter: number;
  createdAt: Date;
  updatedAt?: Date;
  transactableType?: string;
  transactableId?: string;
  // Optional metadata (sanitized)
  metadata?: TransactionMetadata;
  reversal?: {
    reference: string;
    amount: number;
    direction: "CREDIT" | "DEBIT";
    occurredAt: Date;
    reason?: string;
  };
}

export interface CountryData {
  name: string;
  currencyCode: string;
  flag: string;
  iso2: string;
  iso3: string;
}

export interface TransactionMetadata {
  // Provider (from transaction level, not meta)
  provider?: string;
  providerReference?: string;

  // Wallet transfers
  recipientName?: string;
  recipentUsername?: string;
  recipientEmail?: string;
  recipientId?: string;
  senderName?: string;
  senderUsername?: string;
  senderEmail?: string;
  senderId?: string;
  transferId?: string;

  // Bank transfers / Withdrawals
  accountNumber?: string; // Masked
  accountName?: string;
  bankName?: string;
  bankCode?: string;
  debitAccountNumber?: string; // Masked
  debitAccountName?: string;
  debitBankName?: string;

  // Airtime / Data / Bill Payments (UI needs these)
  phone?: string; // Masked
  serviceName?: string;
  serviceCode?: string;
  productName?: string;
  network?: string;
  logo?: string;

  // Electricity
  meterNumber?: string; // Masked
  meterType?: string;
  token?: string; // Keep for user to access
  customerName?: string;
  customerAddress?: string;
  tokenAmount?: number;
  units?: string;

  // Cable TV
  smartCardNumber?: string; // Masked
  subscriptionType?: string;

  // Betting
  customerId?: string;

  // E-Pin
  profileId?: string;
  pin?: string; // Keep for user to access

  // International transactions
  countryCode?: string;
  country?: CountryData;

  // Fees (for deposits/withdrawals)
  fees?: number;
  vat?: number;
  grossAmount?: number;
  netAmount?: number;

  // Response messages
  responseMessage?: string;

  // Refund specific
  originalReference?: string;
  reason?: string;

  email?: string;
  // General
  remark?: string;

  chargeInfo?: {
    baseAmount?: number;
    chargeAmount?: number;
    totalAmount?: number;
    serviceCharge?: IServiceCharge | null;
    amountSaved?: number;
    discountedAmount?: number;
    chargeType?: string;
    chargeValue?: number;
    totalDeduction?: number;
  };
}

export interface TransactionListResponseDTO {
  data: TransactionResponseDTO[];
  total: number;
  page?: number;
  limit?: number;
  totalPages?: number;
}
