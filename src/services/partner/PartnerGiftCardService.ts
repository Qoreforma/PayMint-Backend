import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import { Types } from "mongoose";
import logger from "@/logger";
import { GiftCardTransactionRepository } from "@/repositories/client/GiftCardTransactionRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { GiftCardService } from "../client/GiftCardService";

export class PartnerGiftCardService {
  constructor(
    private giftCardService: GiftCardService,
    private userRepository: UserRepository,
    private giftCardTransactionRepository: GiftCardTransactionRepository,
  ) {}

  // Partner: Purchase giftcard
  //
  // IMPORTANT: We do NOT pre-debit the partner wallet here.
  // GiftCardService.buyGiftCard() handles the wallet debit internally,
  // exactly as it does for regular users. Pre-debiting was a bug that
  // caused partners to be charged twice per purchase.
  async purchaseGiftCard(data: {
    partnerId: string;
    giftCardId: string;
    productId: string;
    amount: number;
    quantity: number;
    partnerReference?: string;
  }): Promise<any> {
    try {
      // Get partner user
      const partner = await this.userRepository.findById(data.partnerId);

      if (!partner || !partner.partner?.isPartner) {
        throw new AppError(
          "Partner not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      if (partner.partner?.status !== "active") {
        throw new AppError(
          "Partner account is not active",
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.INVALID_STATUS,
        );
      }

      // Purchase giftcard using existing GiftCardService.
      // This handles: rate calc, balance check, wallet debit, provider call, transaction record.
      const giftCardTxn = await this.giftCardService.buyGiftCard({
        giftCardId: data.giftCardId,
        amount: data.amount,
        quantity: data.quantity,
        userId: data.partnerId,
        user: partner,
        isPartnerPurchase: true,
        partnerReference: data.partnerReference,
      });

      const transactionReference = giftCardTxn.transaction.reference;
      const transactionId = giftCardTxn.transaction._id;

      // Stamp partner metadata onto the giftcard transaction
      if (data.partnerReference) {
        await this.giftCardTransactionRepository.update(
          transactionId.toString(),
          {
            $set: {
              "meta.isPartnerTransaction": true,
              "meta.partnerPurchase": true,
              "meta.partnerReference": data.partnerReference,
              "meta.productId": data.productId,
            },
          },
        );
      }

      logger.info(
        `Partner giftcard purchased: ${transactionReference} | Partner: ${data.partnerId}`,
      );

      return {
        success: true,
        transactionReference,
        partnerReference: data.partnerReference,
        status: giftCardTxn.transaction.status,
        productId: data.productId,
        quantity: data.quantity,
        amount: data.amount,
        totalCost: giftCardTxn.breakdown?.totalDeducted ?? null,
        codes: giftCardTxn.transaction.meta?.codes || null,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error("Partner giftcard purchase failed", error);
      throw new AppError(
        "Purchase failed",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
      );
    }
  }

  // Partner: Sell giftcard
  async sellGiftCard(data: {
    partnerId: string;
    giftCardId: string;
    productId: string;
    amount: number;
    quantity: number;
    cards: string[];
    comment?: string;
    partnerReference?: string;
  }): Promise<any> {
    try {
      // Get partner user
      const partner = await this.userRepository.findById(data.partnerId);

      if (!partner || !partner.partner?.isPartner) {
        throw new AppError(
          "Partner not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      if (partner.partner?.status !== "active") {
        throw new AppError(
          "Partner account is not active",
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.INVALID_STATUS,
        );
      }

      // Sell giftcard — creates a pending transaction for admin review
      const sellResult = await this.giftCardService.sellGiftCard({
        userId: data.partnerId,
        giftCardId: data.giftCardId,
        amount: data.amount,
        quantity: data.quantity,
        cardType: "e-code",
        cards: data.cards,
        comment: data.comment,
      });

      const transactionReference = sellResult.transaction.reference;

      // Stamp partner metadata onto the sell transaction
      await this.giftCardTransactionRepository.update(
        sellResult.transaction._id.toString(),
        {
          $set: {
            "meta.isPartnerTransaction": true,
            "meta.partnerPurchase": true,
            "meta.partnerReference": data.partnerReference,
            "meta.productId": data.productId,
          },
        },
      );

      logger.info(
        `Partner giftcard submitted for sale: ${transactionReference} | Partner: ${data.partnerId}`,
      );

      return {
        success: true,
        transactionReference,
        partnerReference: data.partnerReference,
        status: "pending",
        productId: data.productId,
        quantity: data.quantity,
        amount: data.amount,
        message:
          "Giftcards submitted for review. You will be notified via webhook when approved.",
        timestamp: Date.now(),
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error("Partner giftcard sale failed", error);
      throw new AppError(
        "Sale submission failed",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
      );
    }
  }

  // Get transaction status
  async getTransactionStatus(
    partnerId: string,
    transactionReference: string,
  ): Promise<any> {
    try {
      const txn = await this.giftCardTransactionRepository.findOne(
        {
          userId: new Types.ObjectId(partnerId),
          reference: transactionReference,
        },
        undefined,
        [{ path: "giftCardId", select: "name currency" }],
      );

      if (!txn) {
        throw new AppError(
          "Transaction not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      const giftcardInfo = txn.giftCardId as any;

      return {
        transactionReference: txn.reference,
        partnerReference: txn.meta?.partnerReference,
        status: txn.status,
        tradeType: txn.tradeType,
        productName: giftcardInfo?.name,
        quantity: txn.quantity,
        amount: txn.amount,
        payableAmount: txn.payableAmount,
        codes:
          txn.tradeType === "buy" && txn.status === "success"
            ? txn.meta?.codes
            : null,
        createdAt: txn.createdAt,
        updatedAt: txn.updatedAt,
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      logger.error("Failed to get transaction status", error);
      throw error;
    }
  }

  // List partner giftcard transactions
  async getTransactions(
    partnerId: string,
    filters: {
      tradeType?: string;
      status?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<any> {
    try {
      const page = filters.page || 1;
      const limit = filters.limit || 20;

      let query = {} as any;
      if (filters.tradeType) {
        query.tradeType = filters.tradeType;
      }
      if (filters.status) {
        query.status = filters.status;
      }

      const result = await this.giftCardTransactionRepository.findByUserId(
        partnerId,
        query,
        page,
        limit,
      );

      return {
        data: result.data.map((txn: any) => ({
          transactionReference: txn.reference,
          partnerReference: txn.meta?.partnerReference,
          status: txn.status,
          tradeType: txn.tradeType,
          productName: txn.giftCardId?.name,
          quantity: txn.quantity,
          amount: txn.amount,
          payableAmount: txn.payableAmount,
          createdAt: txn.createdAt,
        })),
        total: result.total,
        page,
        limit,
      };
    } catch (error: any) {
      logger.error("Failed to get transactions", error);
      throw error;
    }
  }
}
