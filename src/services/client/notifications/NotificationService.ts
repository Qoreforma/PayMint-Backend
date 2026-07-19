import { NotificationRepository } from "@/repositories/client/NotificationRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Types } from "mongoose";
import { PushNotificationService } from "./PushNotificationService";
import logger from "@/logger";
import { AdminRepository } from "@/repositories/admin/AdminRepository";
import { emailColors } from "@/config/emailColors";
import { EmailService } from "@/services/core/EmailService";
import { SMSService } from "@/services/core/SMSService";
import { stripToPlainText } from "@/utils/sanitizeAlertBody";

export interface CreateNotificationDTO {
  type: string;
  notifiableType: "User" | "Admin";
  notifiableId: Types.ObjectId;
  title?: string;
  message?: string;
  data?: any;
  sendEmail?: boolean;
  sendSMS?: boolean;
  sendPush?: boolean;
}

interface NotificationContent {
  title: string;
  message: string;
}

export class NotificationService {
  constructor(
    private emailService: EmailService,
    private smsService: SMSService,
    private pushNotificationService: PushNotificationService,
    private notificationRepository: NotificationRepository,
    private userRepository: UserRepository,
    private adminRepository: AdminRepository,
  ) {}

  private generateNotificationContent(
    type: string,
    data: any,
  ): NotificationContent {
    let title = `${process.env.APP_NAME} Notification`;
    let message = "";

    switch (type) {
      // GENERAL TRANSACTION NOTIFICATIONS
      case "transaction_success":
        title = "Transaction Successful";
        message = `Your ${
          data.transactionType?.charAt(0).toUpperCase() +
          data.transactionType?.slice(1)
        } purchase of ₦${data.amount?.toLocaleString() || data.totalAmount?.toLocaleString()} was successful. Reference: ${data.reference}`;
        break;

      case "transaction_failed":
        title = "Transaction Failed";
        message = `Your ${
          data.transactionType?.charAt(0).toUpperCase() +
          data.transactionType?.slice(1)
        } purchase of ₦${data.amount?.toLocaleString() || data.totalAmount?.toLocaleString()} failed. Your ₦${data.amount?.toLocaleString() || data.totalAmount?.toLocaleString()} has been refunded to your wallet.`;
        break;

      case "transaction_pending":
        title = "Transaction Pending";
        message = `Your ${
          data.transactionType
        } transaction of ₦${data.amount?.toLocaleString() || data.totalAmount?.toLocaleString()} is pending. Reference: ${
          data.reference
        }`;
        break;

      case "transaction_processing":
        title = "Transaction Processing";
        message = `Your ${
          data.transactionType
        } transaction of ₦${data.amount?.toLocaleString() || data.totalAmount?.toLocaleString()} is processing. Reference: ${
          data.reference
        }`;
        break;

      // PAYMENT NOTIFICATIONS
      case "payment_success":
        title = "Payment Successful";
        message = `Your ${
          data.transactionType
        } payment of ₦${data.amount?.toLocaleString()} was successful via ${
          data.provider
        }. ${
          data.fees ? `Fees: ₦${data.fees?.toLocaleString()}. ` : ""
        }New balance: ₦${data.balance?.toLocaleString()}. Reference: ${
          data.reference
        }`;
        break;

      case "payment_reversed":
        title = "Payment Reversed";
        message = `Your ${
          data.transactionType
        } payment of ₦${data.amount?.toLocaleString()} via ${
          data.provider
        } has been reversed. ${
          data.reason ? `Reason: ${data.reason}. ` : ""
        }Reference: ${data.reference}`;
        break;

      case "payment_failed":
        title = "Payment Failed";
        message = `Your ${
          data.transactionType
        } payment of ₦${data.amount?.toLocaleString()} via ${
          data.provider
        } failed. ${data.reason ? `Reason: ${data.reason}. ` : ""}Reference: ${
          data.reference
        }`;
        break;

      // WALLET NOTIFICATIONS
      case "wallet_credit":
        title = "Wallet Credited";
        message = `Your wallet has been credited with ₦${data.amount?.toLocaleString()}. New balance: ₦${data.balance?.toLocaleString()}`;
        break;

      case "wallet_debit":
        title = "Wallet Debited";
        message = `Your wallet has been debited with ₦${data.amount?.toLocaleString()}. New balance: ₦${data.balance?.toLocaleString()}`;
        break;

      case "deposit":
        title = "Deposit Received";
        message = `You have received a deposit of ₦${data.amount?.toLocaleString()}. ${
          data.description ? `Description: ${data.description}. ` : ""
        }New balance: ₦${data.balance?.toLocaleString()}`;
        break;

      // CRYPTO BUY NOTIFICATIONS
      case "crypto_buy_pending":
        title = "Crypto Purchase Pending";
        message = `Your purchase of $${data.cryptoAmount} worth of ${
          data.cryptoCode
        } (₦${data.fiatAmount?.toLocaleString()}) is pending admin approval. Reference: ${
          data.reference
        }`;
        break;

      case "crypto_buy_approved":
        title = "Crypto Purchase Approved";
        message = `Your purchase of $${data.cryptoAmount} ${data.cryptoCode} has been approved. ${data.cryptoAmount} ${data.cryptoCode} will be sent to your wallet shortly.`;
        break;

      case "crypto_buy_completed":
        title = "Crypto Received";
        message = `You have successfully received $${data.cryptoAmount} ${data.cryptoCode}. Check your ${data.network} wallet. TX Hash: ${data.txHash}`;
        break;

      case "crypto_buy_failed":
        title = "Crypto Purchase Failed";
        message = `Your crypto purchase of $${data.cryptoAmount} ${
          data.cryptoCode
        } failed. ₦${data.fiatAmount?.toLocaleString()} has been refunded to your wallet. Reference: ${
          data.reference
        }`;
        break;

      case "crypto_buy_declined":
        title = "Crypto Purchase Declined";
        message = `Your crypto purchase of $${data.cryptoAmount} ${
          data.cryptoCode
        } was declined. ₦${data.fiatAmount?.toLocaleString()} has been refunded. Reason: ${
          data.reason || "No reason provided"
        }`;
        break;

      // CRYPTO SELL NOTIFICATIONS
      case "crypto_sell_pending":
        title = "Crypto Sale Pending";
        message = `Your sale of $${data.cryptoAmount} ${
          data.cryptoCode
        } (₦${data.fiatAmount?.toLocaleString()}) is pending. Send the crypto to the provided address to complete the transaction. Reference: ${
          data.reference
        }`;
        break;

      case "crypto_sell_awaiting_deposit":
        title = "Awaiting Crypto Deposit";
        message = `Your crypto sale request is registered. Send exactly ${data.cryptoAmount} ${data.cryptoCode} to complete your transaction. Reference: ${data.reference}`;
        break;

      case "crypto_sell_deposit_received":
        title = "Crypto Deposit Received";
        message = `We have received your ${data.cryptoAmount} ${data.cryptoCode} deposit. Your sale is being verified. Reference: ${data.reference}`;
        break;

      case "crypto_sell_completed":
        title = "Crypto Sale Completed";
        message = `You have successfully sold $${data.cryptoAmount} ${
          data.cryptoCode
        } for ₦${data.totalAmount?.toLocaleString()}. Funds have been transferred to your bank. Reference: ${
          data.reference
        }`;
        break;

      case "crypto_sell_failed":
        title = "Crypto Sale Failed";
        message = `Your crypto sale of $${data.cryptoAmount} ${data.cryptoCode} failed. The crypto has been returned to your wallet. Reference: ${data.reference}`;
        break;

      case "crypto_sell_declined":
        title = "Crypto Sale Declined";
        message = `Your crypto sale of $${data.cryptoAmount} ${
          data.cryptoCode
        } was declined and has been refunded to your wallet. Reason: ${
          data.reason || "No reason provided"
        }`;
        break;

      case "crypto_sale_declined":
        title = "Crypto Sale Declined";
        message = `Your crypto sale of $${data.cryptoAmount} ${
          data.cryptoCode
        } was declined and has been refunded to your wallet. Reason: ${
          data.reason || "No reason provided"
        }`;
        break;

      case "crypto_sale_approved":
        title = "Crypto Sale Approved";
        message = `Your sale of $${data.cryptoAmount} ${
          data.cryptoCode
        } has been approved. ₦${data.totalPayout?.toLocaleString()} has been credited to your wallet ${data.serviceCharge ? `Service charge of ₦${data.serviceCharge?.toLocaleString()}` : ""}. Reference: ${
          data.reference
        }`;
        break;

      case "crypto_sale_second_approved":
        title = "Crypto Sale Second Approved";
        message = `Your sale of $${data.cryptoAmount} ${
          data.cryptoCode
        } has been approved with a revised amount. ₦${data.approvedAmount?.toLocaleString()} credited to your wallet (Original: ₦${data.originalAmount?.toLocaleString()}, ₦${data.serviceCharge ? `Service charge: ${data.serviceCharge?.toLocaleString()}` : ""}). Reason: ${
          data.reason || "Rate adjustment"
        }. Reference: ${data.reference}`;
        break;

      case "crypto_buy_second_approved":
        title = "Crypto Buy Second Approved";
        message = `Your Buy of $${data.cryptoAmount} has been approved with a revised amount.  Reference: ${data.reference}`;
        break;

      case "crypto_purchase_completed":
        title = "Crypto Purchase Completed";
        message = `Your purchase of $${data.cryptoAmount} ${data.cryptoCode} has been completed. The crypto has been transferred to your wallet. TX Hash: ${data.txHash}. Reference: ${data.reference}`;
        break;

      // GIFTCARD NOTIFICATIONS
      case "giftcard_sale_completed":
        title = "Gift Card Sale Completed";
        message = `Your gift card sale has been completed successfully. ${
          data.cardType ? `Card: ${data.cardType}. ` : ""
        }Funds have been credited to your wallet. Reference: ${data.reference}`;
        break;

      case "giftcard_sale_approved":
        title = "Gift Card Sale Approved";
        message = `Your gift card sale of ₦${data.originalAmount?.toLocaleString()} has been approved. ${
          data.serviceCharge
            ? `Service charge: ₦${data.serviceCharge?.toLocaleString()}. `
            : ""
        }Net payout: ₦${data.netPayout?.toLocaleString()}. Reference: ${data.reference}`;
        break;

      case "giftcard_sale_declined":
        title = "Gift Card Sale Declined";
        message = `Your gift card sale of ₦${data.amount?.toLocaleString()} was declined. ${
          data.reason ? `Reason: ${data.reason}. ` : ""
        }Reference: ${data.reference}`;
        break;

      case "giftcard_purchase_initiated":
        title = "Gift Card Purchase Initiated";
        message = `Your gift card purchase has been initiated. Amount: ₦${data.amount?.toLocaleString()}. ${
          data.quantity ? `Quantity: ${data.quantity}. ` : ""
        }${data.giftCardName ? `Card: ${data.giftCardName}. ` : ""}Reference: ${data.reference}`;
        break;

      case "giftcard_purchase_failed":
        title = "Gift Card Purchase Failed";
        message = `Your gift card purchase of ₦${data.amount?.toLocaleString()} has failed and has been refunded. ${
          data.reason ? `Reason: ${data.reason}. ` : ""
        }Reference: ${data.reference}`;
        break;

      case "giftcard_sale_pending_review":
        title = "Gift Card Sale Pending Review";
        message = `Your gift card sale of ${data.quantity} card(s) - ${data.giftCardName} (₦${data.amount?.toLocaleString()}) is pending admin review. ${
          data.serviceCharge
            ? `Service charge: ₦${data.serviceCharge?.toLocaleString()}. `
            : ""
        }Reference: ${data.reference}`;
        break;

      case "giftcard_sale_submitted":
        title = "Gift Card Sale Submitted";
        message = `Your gift card sale of ${data.quantity} card(s) - ${data.giftCardName} for ₦${data.amount?.toLocaleString()} has been submitted. ${
          data.serviceCharge
            ? `Service charge: ₦${data.serviceCharge?.toLocaleString()}. `
            : ""
        }Status: Pending. Reference: ${data.reference}`;
        break;

      // ADMIN NOTIFICATIONS
      case "admin_crypto_buy_pending":
        title = "🔔 New Crypto Buy Request";
        message = `New crypto purchase: $${data.cryptoAmount} worth of ${
          data.cryptoCode
        } (₦${data.fiatAmount?.toLocaleString()}) from user. Reference: ${
          data.reference
        }. Action required.`;
        break;

      case "admin_crypto_sell_pending":
        title = "🔔 New Crypto Sell Request";
        message = `New crypto sale: $${data.cryptoAmount} worth of ${
          data.cryptoCode
        } (₦${data.fiatAmount?.toLocaleString()}). Reference: ${data.reference}. Action required.`;
        break;

      case "admin_notification":
        title = data?.title || "Admin Notification";
        message = data?.message;
        break;

      case "admin_crypto_proof_uploaded":
        title = "📸 Crypto Proof Uploaded";
        message = `User uploaded proof for crypto sale (${data.cryptoAmount} ${data.cryptoCode}). Reference: ${data.reference}. Review and approve.`;
        break;

      case "admin_critical_no_rate_config":
        title = "🚨 CRITICAL: Exchange Rate Missing";
        message = `CRITICAL ERROR - Cannot credit wallet. No exchange rate found (crypto or provider config). Reference: ${data.reference}, Crypto: ${data.cryptoCode}, Amount: ${data.actualCryptoReceived} USD Value: $${data.usdValue}. Manual intervention required immediately.`;
        break;

      case "admin_crypto_deposit_received":
        title = "💰 Crypto Deposit Received";
        message = `Received ${data.cryptoAmount} ${
          data.cryptoCode
        } (₦${data.fiatAmount?.toLocaleString()}) deposit. Reference: ${
          data.reference
        }. Verify and process.`;
        break;

      case "admin_crypto_deposit_auto_reconciled":
        title = "⚠️ Unmatched Deposit Auto-Reconciled";
        message = `A deposit arrived with no matching pending request and was auto-credited. User: ${
          data.userEmail || "unknown"
        }. Amount: ${data.cryptoAmount} ${
          data.cryptoCode
        } (₦${data.fiatAmount?.toLocaleString()}). Reference: ${
          data.reference
        }. Please verify this was legitimate.`;
        break;

      // WITHDRAWAL NOTIFICATIONS
      case "withdrawal_approved":
        title = "Withdrawal Approved";
        message = `Your withdrawal of ₦${data.amount?.toLocaleString()} has been approved and is being processed. Reference: ${
          data.reference
        }`;
        break;

      case "withdrawal_declined":
        title = "Withdrawal Declined";
        message = `Your withdrawal of ₦${data.amount?.toLocaleString()} was declined and refunded to your wallet. Reason: ${
          data.reason
        }. New balance: ₦${data.balance?.toLocaleString()}`;
        break;

      case "withdrawal_completed":
        title = "Withdrawal Completed";
        message = `Your withdrawal of ₦${data.amount?.toLocaleString()} has been completed successfully. Reference: ${
          data.reference
        }`;
        break;

      case "withdrawal_failed":
        title = "Withdrawal Failed";
        message = `Your withdrawal of ₦${data.amount?.toLocaleString()} failed. ${
          data.refunded ? "The amount has been refunded to your wallet." : ""
        } Reason: ${
          data.failureReason || data.reason || "Unknown error"
        }. Reference: ${data.reference}`;
        break;

      case "withdrawal_reversed":
        title = "Withdrawal Reversed";
        message = `Your withdrawal of ₦${data.amount?.toLocaleString()} has been reversed by the payment provider. ${
          data.refunded ? "The amount has been refunded to your wallet." : ""
        } Reference: ${data.reference}`;
        break;

      case "withdrawal_initiated":
        title = "Withdrawal Initiated";
        message = `Your withdrawal request of ₦${data.amount?.toLocaleString()} has been initiated. ${
          data.bankName ? `Bank: ${data.bankName}. ` : ""
        }${data.accountNumber ? `Account: ...${data.accountNumber.slice(-4)}. ` : ""}Reference: ${data.reference}`;
        break;

      case "deposit_request_approved":
        title = "Deposit Request Approved";
        message = `Your deposit request of ₦${data.amount?.toLocaleString()} has been approved. Reference: ${
          data.reference
        }`;
        break;

      case "deposit_request_rejected":
        title = "Deposit Request Rejected";
        message = `Your deposit request of ₦${data.amount?.toLocaleString()} has been rejected. Reason: ${
          data.reason
        }. Reference: ${data.reference}`;
        break;

      // TRANSFER NOTIFICATIONS
      case "transfer_sent":
        title = "Transfer Sent";
        message = `You have sent ₦${data.amount?.toLocaleString()} to ${
          data.recipientName
        }. Reference: ${
          data.reference
        }. New balance: ₦${data.balance?.toLocaleString()}`;
        break;

      case "transfer_received":
        title = "Transfer Received";
        message = `You have received ₦${data.amount?.toLocaleString()} from ${
          data.senderName
        }. Reference: ${
          data.reference
        }. New balance: ₦${data.balance?.toLocaleString()}`;
        break;

      // KYC & VERIFICATION NOTIFICATIONS
      case "kyc_approved":
        title = "KYC Verified";
        message = `Your KYC verification has been approved. You now have full access to all features.`;
        break;

      case "kyc_rejected":
        title = "KYC Rejected";
        message = `Your KYC verification was rejected. Reason: ${data.reason}. Please resubmit with correct information.`;
        break;

      case "bvn_verified":
        title = "BVN Verified";
        message = `Your BVN has been successfully verified. Enhanced security enabled on your account.`;
        break;

      // ALERT NOTIFICATIONS
      case "alert":
        title = data?.title || "Important Alert";
        message = data?.message || "You have an important notification";
        break;

      case "announcement":
        title = data?.title || "Announcement";
        message = data?.message || "You have a new announcement";
        break;

      case "provider_health_alert":
        title = "⚠️ Service Provider Alert";
        message = `${
          data.provider || "A service provider"
        } is experiencing issues. ${
          data.status ? `Status: ${data.status}. ` : ""
        }${data.message || "We're working to resolve this."}`;
        break;

      // DEFAULT FALLBACK
      default:
        title = data?.title || " Notification";
        message = data?.message || "You have a new notification";
    }

    return { title, message };
  }

  private static readonly TRANSIENT_NOTIFICATION_TYPES = new Set([
    // Wallet
    "wallet_debit",
    "wallet_credit",
    "refund",
    // Alerts
    "alert",
    // Transactions
    "transaction_success",
    "transaction_failed",
    "transaction_pending",
    "transaction_processing",
    // Payments
    "payment_success",
    "payment_reversed",
    "payment_failed",
    // Crypto Buy
    "crypto_buy_pending",
    "crypto_buy_approved",
    "crypto_buy_completed",
    "crypto_buy_failed",
    "crypto_buy_declined",
    "crypto_purchase_completed",
    // Crypto Sell
    "crypto_sell_pending",
    "crypto_sell_awaiting_deposit",
    "crypto_sell_deposit_received",
    "crypto_sell_completed",
    "crypto_sell_failed",
    "crypto_sell_declined",
    "crypto_sale_declined",
    // Gift Cards
    "giftcard_sale_completed",
    "giftcard_sale_declined",
    "giftcard_purchase_initiated",
    "giftcard_purchase_failed",
    "giftcard_sale_pending_review",
    "giftcard_sale_submitted",
    // Withdrawals
    "withdrawal_approved",
    "withdrawal_declined",
    "withdrawal_completed",
    "withdrawal_failed",
    "withdrawal_reversed",
    "withdrawal_initiated",
    // Transfers
    "transfer_sent",
    // Deposits
    "deposit",
  ]);

  async createNotification(
    dto: CreateNotificationDTO & {
      adminNotificationScope?: {
        type: "crypto_network" | "giftcard_category";
        id: string;
        tradeType: "buy" | "sell";
      };
    },
  ): Promise<any> {
    // Generate title and message
    const { title, message } = this.generateNotificationContent(
      dto.type,
      dto.data,
    );

    let notification;
    if (NotificationService.TRANSIENT_NOTIFICATION_TYPES.has(dto.type)) {
      notification = {
        type: dto.type,
        notifiableType: dto.notifiableType,
        notifiableId: dto.notifiableId,
        title,
        message,
        data: dto.data,
      };
    } else {
      notification = await this.notificationRepository.create({
        type: dto.type,
        notifiableType: dto.notifiableType,
        notifiableId: dto.notifiableId,
        title,
        message,
        data: dto.data,
      });
    }

    // Send email if requested
    if (dto.sendEmail && dto.notifiableType === "User") {
      try {
        const user = await this.userRepository.findById(
          dto.notifiableId.toString(),
        );
        if (user && user.email) {
          // Alerts compose their own message (with or without a "Hi {name},"
          // prefix, per Alert.isPersonalised) — don't double it up here.
          const greeting =
            dto.type === "alert" ? undefined : `Hello ${user.firstname},`;
          const isRichHtml =
            dto.type === "alert" || dto.type === "announcement";
          await this.sendNotificationEmail(
            user.email,
            title,
            message,
            greeting,
            isRichHtml,
          );
        }
      } catch (error) {
        logger.error("Error sending notification email:", error);
      }
    }

    // Send SMS if requested
    if (dto.sendSMS && dto.notifiableType === "User") {
      try {
        const user = await this.userRepository.findById(
          dto.notifiableId.toString(),
        );
        if (user && user.phone && user.phoneCode) {
          await this.sendNotificationSMS(
            `${user.phoneCode}${user.phone}`,
            message,
          );
        }
      } catch (error) {
        logger.error("Error sending notification SMS:", error);
      }
    }

    // Send Push Notification if requested
    if (dto.sendPush && dto.notifiableType === "User") {
      try {
        const user = await this.userRepository.findById(
          dto.notifiableId.toString(),
        );
        if (user) {
          await this.sendPushNotification(
            dto.notifiableId.toString(),
            title,
            message,
            dto.type,
            dto.data,
          );
        }
      } catch (error) {
        logger.error("Error sending push notification:", error);
      }
    }

    // Use new admin notification logic
    if (dto.sendEmail && dto.notifiableType === "Admin") {
      await this.sendAdminNotificationEmails(
        title,
        message,
        dto.adminNotificationScope,
      );
    }

    return notification;
  }

  async bulkCreateNotifications(
    notifiableIds: Types.ObjectId[],
    notifiableType: "User" | "Admin",
    type: string,
    data: any,
    chunkSize: number = 1000,
  ): Promise<void> {
    if (notifiableIds.length === 0) return;

    const { title, message } = this.generateNotificationContent(type, data);

    for (let i = 0; i < notifiableIds.length; i += chunkSize) {
      const chunk = notifiableIds
        .slice(i, i + chunkSize)
        .map((notifiableId) => ({
          type,
          notifiableType,
          notifiableId,
          title,
          message,
          data,
        }));

      await this.notificationRepository.bulkInsert(chunk);
    }
  }

  // Like bulkCreateNotifications, but for cases where every recipient needs
  // distinct title/message text (e.g. a personalised in-app alert) instead
  // of one shared payload reused for every row.
  async bulkCreatePersonalisedNotifications(
    entries: Array<{
      notifiableId: Types.ObjectId;
      title: string;
      message: string;
    }>,
    notifiableType: "User" | "Admin",
    type: string,
    chunkSize: number = 1000,
  ): Promise<void> {
    if (entries.length === 0) return;

    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize).map((entry) => ({
        type,
        notifiableType,
        notifiableId: entry.notifiableId,
        title: entry.title,
        message: entry.message,
        data: { title: entry.title, message: entry.message },
      }));

      await this.notificationRepository.bulkInsert(chunk);
    }
  }

  private async sendNotificationEmail(
    to: string,
    subject: string,
    message: string,
    greeting?: string,
    isPreformattedHtml: boolean = false,
  ): Promise<void> {
    const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #${emailColors.textPrimary}; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .logo-section { text-align: center; margin-bottom: 20px; }
          .logo-section img { height: 50px; width: auto; display: block; margin: 0 auto; }
          .header { background-color: #${emailColors.primary}; color: white; padding: 30px 20px; text-align: center; }
          .header h1 { margin: 0; padding: 0; font-size: 24px; }
          .content { background-color: #${emailColors.bgLight}; padding: 30px; }
          .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo-section">
            <img src="${process.env.EMAIL_LOGO_URL}" alt="Logo">
          </div>
          
          <div class="header">
            <h1>${subject}</h1>
          </div>
          
          <div class="content">
            ${greeting ? `<p>${greeting}</p>` : ""}
            ${isPreformattedHtml ? message : `<p>${message}</p>`}
          </div>
          
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;

    if (this.isTestEnvironment()) {
      return;
    }

    const plainMessage = isPreformattedHtml
      ? stripToPlainText(message)
      : message;
    const text = greeting ? `${greeting} ${plainMessage}` : plainMessage;
    await this.emailService.sendEmail({ to, subject, html, text });
  }

  private isTestEnvironment(): boolean {
    return (
      process.env.NODE_ENV === "test" ||
      process.env.JEST_WORKER_ID !== undefined
    );
  }

  private async sendNotificationSMS(
    to: string,
    message: string,
  ): Promise<void> {
    // Prefix with ${process.env.APP_NAME} and keep it concise for SMS
    const smsMessage = `${process.env.APP_NAME}: ${message}`;
    await this.smsService.sendSMS({ to, message: smsMessage });
  }

  private async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    type: string,
    data: any,
  ): Promise<void> {
    await this.pushNotificationService.sendToUser(userId, {
      title,
      body,
      data: {
        type,
        ...data,
      },
    });
  }

  async getUserNotifications(
    userId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<any> {
    const { data, total } =
      await this.notificationRepository.findByNotifiableId(userId, page, limit);

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async getUnreadNotifications(userId: string): Promise<any> {
    const notifications =
      await this.notificationRepository.findUnreadByNotifiableId(userId);
    return notifications;
  }

  async getUnreadCount(userId: string): Promise<number> {
    return await this.notificationRepository.countUnread(userId);
  }

  async markAsRead(notificationId: string): Promise<any> {
    const notification =
      await this.notificationRepository.markAsRead(notificationId);
    if (!notification) {
      throw new AppError(
        "Notification not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return notification;
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository.markAllAsRead(userId);
  }

  async getNotificationById(notificationId: string): Promise<any> {
    const notification =
      await this.notificationRepository.findById(notificationId);
    if (!notification) {
      throw new AppError(
        "Notification not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return notification;
  }

  async markAsUnread(notificationId: string): Promise<any> {
    const notification = await this.notificationRepository.update(
      notificationId,
      { read: false, readAt: null },
    );
    if (!notification) {
      throw new AppError(
        "Notification not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    return notification;
  }

  async deleteNotification(notificationId: string): Promise<void> {
    await this.notificationRepository.softDelete(notificationId);
  }

  async clearAllNotifications(userId: string): Promise<void> {
    await this.notificationRepository.deleteManyNotifications(userId);
  }

  private async sendAdminNotificationEmails(
    title: string,
    message: string,
    scope?: {
      type: "crypto_network" | "giftcard_category";
      id: string;
      tradeType: "buy" | "sell";
    },
  ): Promise<void> {
    try {
      let adminEmails: string[] = [];

      if (scope) {
        // Scoped notification (crypto network or giftcard category)
        if (scope.type === "crypto_network") {
          adminEmails = await this.adminRepository.getCryptoNetworkAdminEmails(
            scope.id,
            scope.tradeType,
          );
        } else if (scope.type === "giftcard_category") {
          adminEmails =
            await this.adminRepository.getGiftCardCategoryAdminEmails(
              scope.id,
              scope.tradeType,
            );
        }
      } else {
        // Generic notification - send to super admin only
        const superAdminEmail = await this.adminRepository.getSuperAdminEmail();
        if (superAdminEmail) {
          adminEmails = [superAdminEmail];
        }
      }

      // Send email to all admins
      if (adminEmails.length > 0) {
        const emailPromises = adminEmails.map((email) =>
          this.sendNotificationEmail(
            email,
            title,
            message,
            "Hello Admin,",
          ).catch((err) => {
            logger.error(`Failed to send admin notification to ${email}:`, err);
          }),
        );

        await Promise.all(emailPromises);
      } else {
        logger.warn(
          `No admin emails found for notification: ${title}. Scope: ${JSON.stringify(scope)}`,
        );
      }
    } catch (error) {
      logger.error("Error sending admin notification emails:", error);
    }
  }
}
