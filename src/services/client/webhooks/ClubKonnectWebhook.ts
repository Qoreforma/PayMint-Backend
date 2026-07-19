import logger from "@/logger";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Transaction } from "@/models/wallet/Transaction";
import { Types } from "mongoose";
import { NotificationService } from "../notifications/NotificationService";
import { WalletService } from "../wallet/WalletService";

export class ClubKonnectWebhook {
  constructor(
    private walletService: WalletService,
    private notificationService: NotificationService,
  ) {}

  // Handle ClubKonnect webhook callback
  // Supports both query string and JSON formats
  async handleWebhook(payload: any): Promise<void> {
    try {
      if (!this.validatePayload(payload)) {
        logger.error("ClubKonnect webhook: Invalid payload", { payload });
        throw new AppError(
          "Invalid webhook payload",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      const orderId = payload.orderid;
      const statusCode = parseInt(payload.statuscode as string) || 0;
      const status = (payload.orderstatus || "").toUpperCase();
      const remark = payload.orderremark || "";

      logger.info("ClubKonnect webhook received", {
        orderId,
        statusCode,
        status,
      });

      const transaction = await Transaction.findOne({
        providerReference: orderId,
      });

      if (!transaction) {
        // Try by request ID (internal reference)
        const txnByReference = await Transaction.findOne({
          reference: payload.requestid,
        });

        if (!txnByReference) {
          logger.warn("ClubKonnect webhook: Transaction not found", {
            orderId,
            requestId: payload.requestid,
          });
          return;
        }

        return this.processTransaction(
          txnByReference,
          orderId,
          statusCode,
          status,
          remark,
          payload,
        );
      }

      // If already success or failed, skip (prevent duplicate refunds/actions)
      if (transaction.status === "success" || transaction.status === "failed") {
        logger.warn(
          "ClubKonnect webhook: Transaction already in final state, skipping",
          {
            transactionId: transaction._id,
            orderId,
            currentStatus: transaction.status,
            webhookStatus: status,
          },
        );
        return;
      }

      await this.processTransaction(
        transaction,
        orderId,
        statusCode,
        status,
        remark,
        payload,
      );
    } catch (error: any) {
      logger.error("ClubKonnect webhook processing failed", {
        error: error.message,
        stack: error.stack,
        payload,
      });
      // Don't throw - webhook endpoint should return 200 OK
    }
  }

  // Process transaction based on status code
  private async processTransaction(
    transaction: any,
    orderId: string,
    statusCode: number,
    status: string,
    remark: string,
    payload: any,
  ): Promise<void> {
    const newStatus = this.mapStatusToTransactionStatus(statusCode, status);

    logger.info("ClubKonnect webhook: Processing transaction", {
      transactionId: transaction._id,
      orderId,
      oldStatus: transaction.status,
      newStatus,
      statusCode,
    });

    if (transaction.meta?.clubkonnect?.webhookReceivedAt) {
      logger.info(
        "ClubKonnect webhook: Already processed (duplicate), skipping",
        {
          transactionId: transaction._id,
          orderId,
          previousStatus: transaction.status,
          newStatus,
        },
      );
      return;
    }

    // Update transaction with webhook data
    const epinPatch =
      newStatus === "success" && transaction.type === "data_epin"
        ? {
            "meta.epins":
              payload.TXN_EPIN_DATABUNDLE ?? transaction.meta?.epins ?? [],
          }
        : {};

    const updatedTxn = await Transaction.findByIdAndUpdate(
      transaction._id,
      {
        status: newStatus,
        providerReference: orderId,
        $set: {
          "meta.clubkonnect": {
            statusCode,
            status,
            message: this.getStatusMessage(statusCode, status),
            remark,
            orderDate: payload.orderdate,
            webhookReceivedAt: new Date(),
          },
          "meta.providerResponse": payload,
          ...epinPatch,
        },
      },
      { new: true },
    );

    if (newStatus === "success") {
      await this.handleSuccess(updatedTxn, remark);
    } else if (newStatus === "failed") {
      await this.handleFailure(updatedTxn, remark, orderId);
    }
    // Pending - no special handling, polling handled by cron job
  }

  // Handle successful transaction
  private async handleSuccess(transaction: any, remark: string): Promise<void> {
    try {
      logger.info("ClubKonnect transaction completed successfully", {
        transactionId: transaction._id,
        type: transaction.type,
        amount: transaction.amount,
      });

      // Send notification to user
      await this.notificationService
        .createNotification({
          type: "transaction_success",
          notifiableType: "User",
          notifiableId: transaction.userId,
          data: {
            transactionType: transaction.type,
            amount: transaction.amount,
            reference: transaction.reference,
            message: remark || "Transaction completed successfully",
          },
          sendEmail: true,
          sendSMS: true,
          sendPush: true,
        })
        .catch((err: any) =>
          logger.error("Failed to send success notification", {
            error: err.message,
          }),
        );
    } catch (error: any) {
      logger.error("Error handling ClubKonnect success", {
        transactionId: transaction._id,
        error: error.message,
      });
    }
  }

  // Handle failed transaction - refund wallet
  // SAFE: Only refunds if not already refunded
  private async handleFailure(
    transaction: any,
    remark: string,
    orderId: string,
  ): Promise<void> {
    try {
      logger.error("ClubKonnect transaction failed", {
        transactionId: transaction._id,
        orderId,
        type: transaction.type,
        amount: transaction.amount,
        reason: remark,
      });

      // Check if refund already processed
      if (transaction.meta?.clubkonnect_refunded) {
        logger.warn("ClubKonnect transaction: Already refunded, skipping", {
          transactionId: transaction._id,
          orderId,
        });
        return; // Already refunded, don't refund again
      }

      // Refund wallet only if:
      // 1. Transaction is DEBIT (money left wallet)
      // 2. Transaction is now FAILED (not already failed)
      // 3. Not yet refunded
      if (transaction.direction === "DEBIT") {
        await this.refundWallet(transaction, orderId, remark);

        // Mark as refunded to prevent double-refund
        await Transaction.findByIdAndUpdate(transaction._id, {
          $set: {
            "meta.clubkonnect_refunded": true,
            "meta.clubkonnect_refunded_at": new Date(),
          },
        });
      }

      // Send failure notification
      await this.notificationService
        .createNotification({
          type: "transaction_failed",
          notifiableType: "User",
          notifiableId: transaction.userId,
          data: {
            transactionType: transaction.type,
            amount: transaction.amount,
            reference: transaction.reference,
            reason: remark || "Transaction failed",
          },
          sendEmail: true,
          sendSMS: true,
          sendPush: true,
        })
        .catch((err: any) =>
          logger.error("Failed to send failure notification", {
            error: err.message,
          }),
        );
    } catch (error: any) {
      logger.error("Error handling ClubKonnect failure", {
        transactionId: transaction._id,
        error: error.message,
      });
    }
  }

  // Refund wallet for failed transaction
  // ATOMIC: Uses idempotency key to prevent double-refunds
  private async refundWallet(
    transaction: any,
    orderId: string,
    remark: string,
  ): Promise<void> {
    try {
      logger.info("Refunding wallet for failed ClubKonnect transaction", {
        transactionId: transaction._id,
        userId: transaction.userId,
        amount: transaction.amount,
        orderId,
      });

      // Use original transaction ID as idempotency key for refund
      // This ensures we never refund the same transaction twice
      const refundIdempotencyKey = `REFUND-${transaction._id.toString()}`;

      await this.walletService.creditWallet(
        transaction.userId,
        transaction.amount,
        "Refund",
        {
          type: "refund",
          provider: "clubkonnect",
          providerReference: orderId,
          transactableType: transaction.transactableType,
          transactableId: transaction.transactableId,
          idempotencyKey: refundIdempotencyKey, // Prevent double-refund
          remark: `Refund for failed ${transaction.type} transaction (Order: ${orderId})`,
          meta: {
            originalTransactionId: transaction._id.toString(),
            originalReference: transaction.reference,
            failureRemark: remark,
            clubkonnectOrderId: orderId,
          },
        },
      );

      logger.info("Wallet refunded successfully", {
        transactionId: transaction._id,
        orderId,
        amount: transaction.amount,
        refundIdempotencyKey,
      });
    } catch (error: any) {
      logger.error("Failed to refund wallet", {
        transactionId: transaction._id,
        orderId,
        error: error.message,
        stack: error.stack,
      });
      // Don't throw - already logged, refund can be retried
    }
  }

  // Validate webhook payload structure
  private validatePayload(payload: any): boolean {
    if (!payload || typeof payload !== "object") {
      return false;
    }

    const hasOrderId = payload.orderid && typeof payload.orderid === "string";
    const hasStatusCode =
      payload.statuscode !== undefined && payload.statuscode !== null;
    const hasOrderStatus =
      payload.orderstatus && typeof payload.orderstatus === "string";

    return hasOrderId && hasStatusCode && hasOrderStatus;
  }

  // Map ClubKonnect status codes to transaction status
  private mapStatusToTransactionStatus(
    statusCode: number,
    status: string,
  ): "success" | "pending" | "failed" {
    const statusUpper = status.toUpperCase();

    // SUCCESS
    if (statusCode === 200 && statusUpper === "ORDER_COMPLETED") {
      return "success";
    }

    // FAILED
    if (
      (statusCode >= 400 &&
        statusCode < 500 &&
        statusUpper === "ORDER_ERROR") ||
      (statusCode >= 500 &&
        statusCode < 600 &&
        statusUpper === "ORDER_CANCELLED")
    ) {
      return "failed";
    }

    // PENDING (default)
    return "pending";
  }

  // Get human-readable status message
  private getStatusMessage(statusCode: number, status: string): string {
    const statusUpper = status.toUpperCase();

    if (statusCode === 200 && statusUpper === "ORDER_COMPLETED") {
      return "Transaction completed successfully";
    }

    if (statusCode === 100 && statusUpper === "ORDER_RECEIVED") {
      return "Order received and being processed";
    }

    if (statusCode === 300 && statusUpper === "ORDER_PROCESSED") {
      return "Order sent to network, awaiting response";
    }

    if (
      statusCode >= 400 &&
      statusCode < 500 &&
      statusUpper === "ORDER_ERROR"
    ) {
      return "Transaction failed due to an error";
    }

    if (
      statusCode >= 500 &&
      statusCode < 600 &&
      statusUpper === "ORDER_CANCELLED"
    ) {
      return "Transaction was cancelled";
    }

    if (
      statusCode >= 600 &&
      statusCode < 700 &&
      statusUpper === "ORDER_ONHOLD"
    ) {
      return "Transaction on hold, will retry automatically";
    }

    return `Transaction status: ${status}`;
  }
}

export default ClubKonnectWebhook;
