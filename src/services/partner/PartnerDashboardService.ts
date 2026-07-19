import { UserRepository } from "@/repositories/client/UserRepository";
import { GiftCardTransactionRepository } from "@/repositories/client/GiftCardTransactionRepository";
import { WebhookLogRepository } from "@/repositories/partner/WebhookLogRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { Types } from "mongoose";
import { WalletService } from "../client/wallet/WalletService";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { PeriodFilter, resolveDateRange } from "@/utils/dateRange";

export class PartnerDashboardService {
  constructor(
    private userRepository: UserRepository,
    private walletService: WalletService,
    private giftCardTransactionRepository: GiftCardTransactionRepository,
    private transactionRepository: TransactionRepository,
    private webhookLogRepository: WebhookLogRepository,
  ) {}

  // Get partner dashboard overview
async getDashboardStats(partnerId: string, filters: PeriodFilter = {}): Promise<any> {
    const partner = await this.userRepository.findById(partnerId);

    if (!partner || !partner.partner?.isPartner) {
      throw new AppError(
        "Partner not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Get wallet
    const wallet = await this.walletService.getWallet(partnerId);

    const dateRange = resolveDateRange(filters);

    // Get transaction stats
    const allTransactions = await this.giftCardTransactionRepository.find({
      userId: new Types.ObjectId(partnerId),
      parentId: { $exists: false },
      ...(dateRange ? { createdAt: dateRange } : {}),
    });

    const buyTransactions = allTransactions.filter(
      (t) => t.tradeType === "buy",
    );
    const sellTransactions = allTransactions.filter(
      (t) => t.tradeType === "sell",
    );

    const successfulBuys = buyTransactions.filter(
      (t) => t.status === "success",
    );
    const successfulSells = sellTransactions.filter(
      (t) => t.status === "approved" || t.status === "s.approved",
    );
    const pendingSells = sellTransactions.filter(
      (t) => t.status === "pending" || t.status === "approved",
    );

    const totalBuyVolume = successfulBuys.reduce(
      (sum, t) => sum + (t.payableAmount || 0),
      0,
    );
    const totalSellVolume = successfulSells.reduce(
      (sum, t) => sum + (t.payableAmount || 0),
      0,
    );
    // Bill payment partner transactions
    const billPaymentResult =
      await this.transactionRepository.findWithPaginationAndPopulate(
        {
          sourceId: new Types.ObjectId(partnerId),
          "meta.isPartnerTransaction": true,
        },
        1,
        10000,
      );
    const billPaymentTxns = billPaymentResult.data ?? [];
    const billPaymentVolume = billPaymentTxns
      .filter((t: any) => t.status === "success")
      .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

    // Get recent transactions
    const recentTransactions = allTransactions
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 10);

    return {
      account: {
        companyName: partner.partner.companyName,
        contactPerson: partner.partner.contactPerson,
        status: partner.partner.status,
        email: partner.email,
        phone: partner.phone,
        webhookConfigured: !!partner.partner.webhookUrl,
      },
      wallet: {
        balance: wallet.balance,
        currency: "NGN",
      },
      transactions: {
        giftcard: {
          totalBuys: buyTransactions.length,
          successfulBuys: successfulBuys.length,
          totalSells: sellTransactions.length,
          successfulSells: successfulSells.length,
          pendingSells: pendingSells.length,
        },
        billPayments: {
          total: billPaymentTxns.length,
          successful: billPaymentTxns.filter((t: any) => t.status === "success")
            .length,
          pending: billPaymentTxns.filter((t: any) => t.status === "pending")
            .length,
        },
      },
      volume: {
        totalBuyVolume,
        totalSellVolume,
        billPaymentVolume,
        totalVolume: totalBuyVolume + totalSellVolume + billPaymentVolume,
      },
      recentTransactions: recentTransactions.map((t) => ({
        reference: t.reference,
        tradeType: t.tradeType,
        status: t.status,
        amount: t.amount,
        quantity: t.quantity,
        createdAt: t.createdAt,
      })),
    };
  }

  // Get partner wallet details
  async getWalletDetails(partnerId: string): Promise<any> {
    const wallet = await this.walletService.getWallet(partnerId);

    // Get recent transactions
    const transactions = await this.walletService.getWalletTransactions(
      partnerId,
      {},
      1,
      20,
    );

    return {
      balance: wallet.balance,
      currency: "NGN",
      lastUpdated: new Date(),
      recentTransactions: transactions.data.map((t: any) => ({
        reference: t.reference,
        type: t.type,
        amount: t.amount,
        direction: t.direction,
        status: t.status,
        description: t.remark,
        timestamp: t.createdAt,
      })),
    };
  }

  // Get API key management info
  async getApiKeyManagement(partnerId: string): Promise<any> {
    const partner = await this.userRepository.findById(partnerId);

    if (!partner || !partner.partner?.isPartner) {
      throw new AppError(
        "Partner not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return {
      companyName: partner.partner.companyName,
      webhookUrl: partner.partner.webhookUrl || "Not configured",
      webhookConfigured: !!partner.partner.webhookUrl,
      message: partner.partner.webhookUrl
        ? "Your webhook is configured. Codes will be sent to this URL when ready."
        : "Configure your webhook URL to receive codes and notifications.",
    };
  }

  // Get transaction details
  async getTransactionDetails(
    partnerId: string,
    reference: string,
  ): Promise<any> {
    const txn = await this.giftCardTransactionRepository.findOne(
      {
        userId: new Types.ObjectId(partnerId),
        reference,
      },
      undefined,
      [
        { path: "giftCardId", select: "name currency" },
        { path: "bankAccountId", select: "bankName accountNumber" },
      ],
    );
    if (!txn) {
      const billTxn =
        await this.transactionRepository.findByReference(reference);
      if (billTxn && billTxn.sourceId?.toString() === partnerId) {
        return {
          productCategory: billTxn.type,
          reference: billTxn.reference,
          partnerReference: billTxn.meta?.partnerReference ?? null,
          status: billTxn.status,
          amount: billTxn.amount,
          phone: billTxn.meta?.phone ?? null,
          token: billTxn.meta?.token ?? null,
          createdAt: billTxn.createdAt,
          updatedAt: billTxn.updatedAt,
        };
      }
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const giftcardInfo = txn.giftCardId as any;

    return {
      reference: txn.reference,
      partnerReference: txn.meta?.partnerReference,
      tradeType: txn.tradeType,
      status: txn.status,
      productName: giftcardInfo?.name,
      quantity: txn.quantity,
      amount: txn.amount,
      payableAmount: txn.payableAmount,
      serviceCharge: txn.serviceCharge || 0,
      balanceBefore: txn.balanceBefore,
      balanceAfter: txn.balanceAfter,
      codes:
        txn.tradeType === "buy" && txn.status === "success"
          ? txn.meta?.codes
          : null,
      reviewNote: txn.reviewNote,
      declineNote: txn.declineNote,
      createdAt: txn.createdAt,
      updatedAt: txn.updatedAt,
    };
  }

  // Get webhook delivery history
  async getWebhookHistory(
    partnerId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<any> {
    const result = await this.webhookLogRepository.findByUserId(
      partnerId,
      page,
      limit,
    );

    return {
      data: result.data.map((log) => ({
        id: log._id,
        event: log.event,
        status: log.status,
        retryCount: log.retryCount,
        responseStatus: log.responseStatus,
        lastAttemptAt: log.lastAttemptAt,
        succeededAt: log.succeededAt,
        nextRetryAt: log.nextRetryAt,
        createdAt: log.createdAt,
      })),
      total: result.total,
      page,
      limit,
    };
  }
}
