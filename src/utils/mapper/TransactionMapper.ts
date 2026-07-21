import {
  TransactionResponseDTO,
  TransactionListResponseDTO,
  TransactionMetadata,
} from "@/types";
import { TRANSACTION_TYPES } from "../constants";
import { toDisplayProviderName } from "../helpers";

export class TransactionMapper {
  // Handle single transaction
  static toDTO(
    transaction: any,
    linkedTransaction?: any,
  ): TransactionResponseDTO {
    return {
      id: transaction._id?.toString() || transaction.id,
      reference: transaction.reference,
      amount: transaction.amount,
      direction: transaction.direction,
      type: transaction.type,
      displayType: this.formatDisplayType(
        transaction.type,
        transaction.direction,
      ),
      status: transaction.status,
      purpose: transaction.purpose,
      remark:
        transaction.remark ||
        transaction.purpose ||
        transaction.description ||
        "",
      provider:
        toDisplayProviderName(transaction.provider) || transaction.provider,
      baseAmount: transaction.chargeInfo?.baseAmount, // Include baseAmount if available
      description: this.generateDescription(transaction),
      balanceBefore: transaction.balanceBefore,
      balanceAfter: transaction.balanceAfter,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      metadata: this.getSanitizedMetadata(transaction),
      transactableType: transaction.transactableType || "",
      transactableId: transaction.transactableId || "",
      reversal: this.getReversalSummary(linkedTransaction),
    };
  }

  // Handle list of transactions
  static toDTOList(
    transactions: any[],
    linkedMap?: Map<string, any>,
  ): TransactionResponseDTO[] {
    return transactions.map((t) =>
      this.toDTO(t, linkedMap?.get(t._id?.toString())),
    );
  }

  // Handle paginated list of transactions
  static toPaginatedDTO(
    data: any[],
    total: number,
    page?: number,
    limit?: number,
    linkedMap?: Map<string, any>,
  ): TransactionListResponseDTO {
    return {
      data: this.toDTOList(data, linkedMap),
      total,
      page,
      limit,
      totalPages: limit ? Math.ceil(total / limit) : undefined,
    };
  }

  //  Format display type based on transaction type and direction
  private static formatDisplayType(
    type: string,
    direction: "CREDIT" | "DEBIT",
  ): string {
    // For giftcard and crypto: show "DIRECTION - TYPE" format
    if (type === "giftcard" || type === "crypto") {
      const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);
      return `${direction} - ${capitalizedType}`;
    }

    // For all other types: convert snake_case to Title Case
    // e.g., "wallet_debit" → "Wallet Debit",
    return type
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  private static generateDescription(transaction: any): string {
    const meta = transaction.meta || {};

    switch (transaction.type) {
      case TRANSACTION_TYPES.WALLET_TRANSFER:
        if (transaction.direction === "DEBIT") {
          return `Transfer to ${meta.recipientUsername || meta.recipientEmail || "user"
            }`;
        }
        return "Transfer received";

      case TRANSACTION_TYPES.WITHDRAWAL:
        return `Withdrawal to ${meta.bankName || "bank account"}`;

      case TRANSACTION_TYPES.DEPOSIT:
        return "Wallet funded";

      case TRANSACTION_TYPES.WALLET_CREDIT:
        return meta.reason || transaction.remark || "Wallet credited";

      case TRANSACTION_TYPES.AIRTIME:
        if (transaction.status === "reversed") {
          return `${meta.serviceName || "Airtime"} purchase – reversed`;
        }
        return `${meta.serviceName || "Airtime"} purchase`;

      case TRANSACTION_TYPES.DATA:
        return meta.productName
          ? `${meta.productName}`
          : `${meta.serviceName || "Data"} bundle`;

      case TRANSACTION_TYPES.ELECTRICITY:
        return `${meta.serviceName || "Electricity"} bill payment`;

      case TRANSACTION_TYPES.CABLE:
        const subType =
          meta.subscriptionType === "renew" ? "renewal" : "subscription";
        return `${meta.serviceName || "Cable TV"} ${subType}`;

      case TRANSACTION_TYPES.BETTING:
        return `${meta.serviceCode || "Betting"} wallet funding`;

      case TRANSACTION_TYPES.EDUCATION:
        return `${meta.productName || "Education"} purchase`;

      case TRANSACTION_TYPES.INTERNATIONALAIRTIME:
        return `International airtime - ${meta.countryCode || ""}`;

      case TRANSACTION_TYPES.INTERNATIONALDATA:
        return `International data - ${meta.countryCode || ""}`;

      case TRANSACTION_TYPES.REFUND:
        return transaction.remark || "Refund";

      default:
        return transaction.remark || transaction.purpose || "Transaction";
    }
  }

  private static getSanitizedMetadata(
    transaction: any,
  ): TransactionMetadata | undefined {
    const meta = transaction.meta || {};
    const sanitized: TransactionMetadata = {};

    // Always include provider from transaction level (not meta)
    if (transaction.provider) {
      sanitized.provider = toDisplayProviderName(transaction.provider);
    }

    switch (transaction.type) {
      case TRANSACTION_TYPES.WALLET_TRANSFER:
        if (transaction.direction === "DEBIT") {
          sanitized.recipientName = meta.recipientUsername;
          sanitized.recipentUsername = meta.recipientUsername;
          sanitized.recipientEmail = meta.recipientEmail;
          sanitized.recipientId = meta.recipientId;
          //sender details
          sanitized.senderId = meta.senderId;
          sanitized.senderUsername = meta.senderUsername;
          sanitized.senderEmail = meta.senderEmail;
        } else {
          sanitized.recipientName = meta.recipientUsername;
          sanitized.recipentUsername = meta.recipientUsername;
          sanitized.recipientEmail = meta.recipientEmail;
          sanitized.recipientId = meta.recipientId;

          sanitized.senderName = meta.senderInfo || "Transfer received";
          sanitized.senderId = meta.senderId;
          sanitized.senderUsername = meta.senderUsername;
          sanitized.senderEmail = meta.senderEmail;
        }
        if (meta.transferId) {
          sanitized.transferId = meta.transferId;
        }
        if (transaction.remark) {
          sanitized.remark = transaction.remark;
        }
        break;

      case TRANSACTION_TYPES.WITHDRAWAL:
        if (meta.accountNumber) {
          sanitized.accountNumber = meta.accountNumber;
        }
        if (meta.accountName) {
          sanitized.accountName = meta.accountName;
        }
        sanitized.bankName = meta.bankName;
        sanitized.bankCode = meta.bankCode;

        // Include fees for withdrawals
        if (meta.fees) sanitized.fees = meta.fees;
        if (meta.vat) sanitized.vat = meta.vat;
        if (meta.responseMessage) {
          sanitized.responseMessage = meta.responseMessage;
        }
        break;

      case TRANSACTION_TYPES.DEPOSIT:
        if (meta.virtualAccount?.accountNumber) {
          sanitized.accountNumber = meta.virtualAccount.accountNumber;
        }
        if (meta.virtualAccount?.accountName) {
          sanitized.accountName = meta.virtualAccount.accountName;
        }
        if (meta.virtualAccount?.bankName) {
          sanitized.bankName = meta.virtualAccount.bankName;
        }

        // Include deposit fees
        if (meta.fees) sanitized.fees = meta.fees;
        if (meta.vat) sanitized.vat = meta.vat;
        if (meta.grossAmount) sanitized.grossAmount = meta.grossAmount;
        if (meta.netAmount) sanitized.netAmount = meta.netAmount;
        if (meta.responseMessage) {
          sanitized.responseMessage = meta.responseMessage;
        }
        if (meta.debitAccountName) {
          sanitized.debitAccountName = meta.debitAccountName;
          sanitized.senderName = meta.debitAccountName;
        }
        if (meta.debitAccountNumber) {
          sanitized.debitAccountNumber = meta.debitAccountNumber;
        }
        if (meta.debitBankName) {
          sanitized.debitBankName = meta.debitBankName;
        }
        break;

      case TRANSACTION_TYPES.AIRTIME:
      case TRANSACTION_TYPES.INTERNATIONALAIRTIME:
        if (meta.phone) {
          sanitized.phone = meta.phone;
        }
        sanitized.serviceName = meta.serviceName;
        sanitized.serviceCode = meta.serviceCode;
        sanitized.network = meta.network;
        sanitized.logo = meta.logo;

        if (meta.countryCode) {
          sanitized.countryCode = meta.countryCode;
        }
        if (meta.country) {
          sanitized.country = meta.country;
        }
        break;

      case TRANSACTION_TYPES.DATA:
      case TRANSACTION_TYPES.INTERNATIONALDATA:
        if (meta.phone) {
          sanitized.phone = meta.phone;
        }
        sanitized.serviceName = meta.serviceName;
        sanitized.serviceCode = meta.serviceCode;
        sanitized.productName = meta.productName;
        sanitized.logo = meta.logo;

        if (meta.countryCode) {
          sanitized.countryCode = meta.countryCode;
        }
        if (meta.country) {
          sanitized.country = meta.country;
        }
        break;

      case TRANSACTION_TYPES.ELECTRICITY:
        if (meta.meterNumber) {
          sanitized.meterNumber = meta.meterNumber;
        }
        sanitized.meterType = meta.meterType;
        sanitized.serviceName = meta.serviceName;
        sanitized.serviceCode = meta.serviceCode;
        sanitized.logo = meta.logo;
        sanitized.customerName = meta.customerName || "";
        sanitized.customerAddress = meta.customerAddress || "";
        sanitized.tokenAmount = meta.tokenAmount || 0;
        sanitized.meterNumber = meta.meterNumber || "";
        sanitized.units = meta.units || "";
        // Keep token - user needs it

        sanitized.token = meta.token || "";
        break;

      case TRANSACTION_TYPES.CABLE:
        if (meta.smartCardNumber) {
          sanitized.smartCardNumber = meta.smartCardNumber;
        }
        sanitized.serviceName = meta.serviceName;
        sanitized.serviceCode = meta.serviceCode;
        sanitized.productName = meta.productName;
        sanitized.subscriptionType = meta.subscriptionType;
        sanitized.logo = meta.logo;
        break;

      case TRANSACTION_TYPES.BETTING:
        if (meta.customerId) {
          sanitized.customerId = meta.customerId;
        }
        sanitized.serviceName = meta.serviceCode || meta.serviceName;
        sanitized.serviceCode = meta.serviceCode;
        sanitized.logo = meta.logo;
        break;

      case TRANSACTION_TYPES.EDUCATION:
        sanitized.serviceName = meta.serviceName;
        sanitized.serviceCode = meta.serviceCode;
        sanitized.productName = meta.productName;
        sanitized.logo = meta.logo;

        if (meta.profileId) {
          sanitized.profileId = meta.profileId;
        }
        if (meta.phone) {
          sanitized.phone = meta.phone;
        }
        // Keep pin - user needs it (but only include if present)
        if (meta.pin) {
          sanitized.pin = meta.pin;
        }
        break;

      case TRANSACTION_TYPES.REFUND:
      case TRANSACTION_TYPES.WALLET_CREDIT:
        if (transaction.remark) {
          sanitized.remark = transaction.remark;
        }
        if (meta.originalReference) {
          sanitized.originalReference = meta.originalReference;
        }
        if (meta.reason) {
          sanitized.reason = meta.reason;
        }
        if (meta.logo) {
          sanitized.logo = meta.logo;
        }
        if (meta.serviceName) {
          sanitized.serviceName = meta.serviceName;
        }

        if (meta.serviceCode) {
          sanitized.serviceCode = meta.serviceCode;
        }
        if (meta.phone) {
          sanitized.phone = meta.phone;
        }
        if (meta.country) {
          sanitized.country = meta.country;
        }
        if (meta.email) {
          sanitized.email = meta.email;
        }
        break;
    }

    // Add general fields if available and not already set
    if (transaction.remark && !sanitized.remark) {
      sanitized.remark = transaction.remark;
    }

    if (transaction.providerReference && !sanitized.providerReference) {
      sanitized.providerReference = transaction.providerReference;
    }

    if (meta.chargeInfo) {
      sanitized.chargeInfo = {
        baseAmount: meta.chargeInfo.baseAmount,
        chargeAmount: meta.chargeInfo.serviceCharge, // normalize from stored field name
        totalAmount: meta.chargeInfo.totalAmount,
        amountSaved: meta.chargeInfo.amountSaved,
        discountedAmount: meta.chargeInfo.discountedAmount,
        chargeType: meta.chargeInfo.chargeType,
        chargeValue: meta.chargeInfo.chargeValue,
        totalDeduction: meta.chargeInfo.totalDeduction,
      };
    }

    // Return undefined if no metadata was added
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }

  // Mask account number - show only last 4 digits
  private static maskAccountNumber(accountNumber: string): string {
    if (!accountNumber || accountNumber.length < 4) {
      return "****";
    }
    return "****" + accountNumber.slice(-4);
  }

  private static getReversalSummary(linkedTransaction?: any) {
    if (!linkedTransaction) return undefined;
    return {
      reference: linkedTransaction.reference,
      amount: linkedTransaction.amount,
      direction: linkedTransaction.direction,
      occurredAt: linkedTransaction.createdAt,
      reason:
        linkedTransaction.meta?.reversalReason ||
        linkedTransaction.meta?.reason ||
        undefined,
    };
  }

  // Mask phone number - show first 4 and last 2 digits
  private static maskPhone(phone: string): string {
    if (!phone || phone.length < 6) {
      return "****";
    }
    const cleaned = phone.replace(/\D/g, "");
    if (cleaned.length < 6) {
      return "****";
    }
    return cleaned.slice(0, 4) + "****" + cleaned.slice(-2);
  }
}
