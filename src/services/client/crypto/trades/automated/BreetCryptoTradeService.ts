import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import logger from "@/logger";
import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";
import { CryptoTransactionRepository } from "@/repositories/client/CryptoTransactionRepository";
import { BankAccountRepository } from "@/repositories/client/BankAccountRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { NotificationService } from "@/services/client/notifications/NotificationService";
import { WalletService } from "@/services/client/wallet/WalletService";
import { CryptoBreakdownService } from "../../CryptoBreakdownService";
import {
  BuyCryptoAutomatedData,
  SellCryptoAutomatedData,
} from "../../CryptoService";
import { BreetService } from "@/services/client/providers/crypto/BreetService";
import { HelperService } from "@/services/client/utility/HelperService";

const SETTLEMENT_MODE = (process.env.BREET_SETTLEMENT_MODE || "wallet") as
  | "bank"
  | "wallet";

export class BreetCryptoTradeService {
  constructor(
    private cryptoRepository: CryptoRepository,
    private networkRepository: NetworkRepository,
    private userRepository: UserRepository,
    private cryptoTransactionRepository: CryptoTransactionRepository,
    private bankAccountRepository: BankAccountRepository,
    private walletService: WalletService,
    private notificationService: NotificationService,
    private cryptoBreakdownService: CryptoBreakdownService,
    private breetService: BreetService,
    private helperService: HelperService,
  ) {}

  async buyCryptoWithBreet(data: BuyCryptoAutomatedData): Promise<any> {
    logger.info(`Initiating Breet buy flow`, {
      userId: data.userId,
      cryptoId: data.cryptoId,
      usdAmount: data.usdAmount,
    });

    try {
      // 1. Validate crypto
      const crypto = await this.cryptoRepository.findById(data.cryptoId);
      if (!crypto) {
        throw new AppError(
          "Crypto not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      if (!crypto.purchaseActivated) {
        throw new AppError(
          "Purchase not available for this crypto",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // 2. Validate user
      const user = await this.userRepository.findById(data.userId);
      if (!user) {
        throw new AppError(
          "User not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      if (!data.walletAddress) {
        throw new AppError(
          "Wallet address is required",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // 3. Get wallet balance (source of truth)
      const wallet = await this.walletService.getWallet(data.userId);
      if (!wallet) {
        throw new AppError(
          "Wallet not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      // 4. Calculate breakdown using live Breet rate
      const breakdown =
        await this.cryptoBreakdownService.calculateBreakdownWithBreet({
          cryptoId: data.cryptoId,
          usdAmount: data.usdAmount,
          tradeType: "buy",
          networkId: data.networkId,
        });

      logger.info(`Buy breakdown calculated`, {
        usdAmount: data.usdAmount,
        fiatAmount: breakdown.fiatAmount,
        cryptoAmount: breakdown.cryptoAmount,
        fee: breakdown.serviceFee,
        totalAmount: breakdown.totalAmount,
      });

      // 5. Balance check
      if (wallet.balance < breakdown.totalAmount) {
        throw new AppError(
          `Insufficient balance. Need ₦${breakdown.totalAmount.toLocaleString()}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.INSUFFICIENT_BALANCE,
        );
      }

      // 6. Get Breet PIN
      const pin = process.env.BREET_WITHDRAWAL_PIN;
      if (!pin) {
        throw new AppError(
          "Breet PIN not configured",
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          ERROR_CODES.CONFIGURATION_ERROR,
        );
      }

      // 7. Determine token and network for Breet
      const network = await this.networkRepository.findById(data.networkId);
      if (!network) {
        throw new AppError(
          "Network not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      const token = crypto.code === "USDT" ? "USDT" : "USDC";
      let breetNetwork = (network.breetNetworkCode || "ERC20") as
        | "ERC20"
        | "TRC20"
        | "BSC"
        | "SOL"
        | "TON";

      // 8. Call Breet withdrawal
      const reference = `BREET_BUY_${crypto.code}_${Date.now()}`;

      const withdrawal = await this.breetService.withdrawStablecoin({
        amount: data.usdAmount,
        token: token as "USDT" | "USDC",
        network: breetNetwork,
        walletAddress: data.walletAddress,
        pin,
        externalId: reference,
      });

      logger.info(`Breet withdrawal initiated`, {
        withdrawalId: withdrawal.id,
        amount: data.usdAmount,
        token,
      });

      // 9. Debit wallet
      const chargeInfo = {
        baseAmount: breakdown.fiatAmount,
        serviceCharge: breakdown.serviceFee,
        chargeType: breakdown.serviceCharge?.type,
        chargeValue: breakdown.serviceCharge?.value,
        totalDeduction: breakdown.totalAmount,
      };

      const debitResult = await this.walletService.debitWallet(
        data.userId,
        breakdown.totalAmount,
        "Crypto Purchase",
        {
          type: TRANSACTION_TYPES.CRYPTO,
          provider: "breet",
          idempotencyKey: reference,
          channel: data.channel || "web",
          remark: `Crypto purchase: ${data.usdAmount} USD of ${token}`,
          meta: {
            breetWithdrawalId: withdrawal.id,
            usdAmount: data.usdAmount,
            token,
            chargeInfo,
          },
        },
      );

      // 10. Record transaction
      await this.cryptoTransactionRepository.create({
        userId: user._id,
        cryptoId: crypto._id,
        reference,
        tradeType: "buy",
        status: "transferred",
        walletAddress: data.walletAddress,
        cryptoAmount: breakdown.cryptoAmount,
        fiatAmount: breakdown.fiatAmount,
        exchangeRate: breakdown.exchangeRate,
        serviceFee: breakdown.serviceFee,
        totalAmount: breakdown.totalAmount,
        txHash: withdrawal.id, // no txHash on create, store withdrawal ID
        balanceBefore: debitResult.balanceBefore,
        balanceAfter: debitResult.balanceAfter,
        channel: data.channel || "web",
        network: {
          networkId: data.networkId,
          code: breetNetwork,
          name: breetNetwork,
        },
        processedAt: new Date(),
        breetTradeId: withdrawal.id,
        isAutomated: true,
        meta: {
          token,
          network: breetNetwork,
          usdAmount: data.usdAmount,
          ngnAmount: breakdown.fiatAmount,
          extraId: data.extraId,
          chargeInfo,
          processedBy: "breet",
          automatedFlow: true,
          initiatedAt: new Date().toISOString(),
        },
      });

      logger.info(`Breet buy transaction completed`, {
        reference,
        userId: data.userId,
        cryptoAmount: breakdown.cryptoAmount,
        usdAmount: data.usdAmount,
      });

      this.helperService
        .updateLeaderboardAsync(
          data.userId,
          debitResult.walletId.toString(),
          TRANSACTION_TYPES.CRYPTO,
          breakdown.fiatAmount,
          breakdown.cryptoAmount,
        )
        .catch((err: any) => {
          logger.error(`Leaderboard update failed (Breet buy)`, {
            error: err.message,
          });
        });

      // 11. Send notification (fire-and-forget)
      this.notificationService
        .createNotification({
          type: "transaction_complete",
          notifiableType: "User",
          notifiableId: user._id,
          data: {
            reference,
            transactionType: "Crypto Purchase",
            cryptoAmount: breakdown.cryptoAmount,
            cryptoCode: token,
            fiatAmount: breakdown.fiatAmount,
            serviceCharge: breakdown.serviceFee,
            totalPaid: breakdown.totalAmount,
            walletAddress: data.walletAddress,
            status: "completed",
          },
          sendEmail: true,
          sendSMS: false,
          sendPush: true,
        })
        .catch((err: any) => {
          logger.error(`Failed to send buy notification`, {
            error: err.message,
          });
        });

      return {
        success: true,
        reference,
        cryptoAmount: breakdown.cryptoAmount,
        token,
        walletAddress: data.walletAddress,
        breakdown: {
          fiatAmount: breakdown.fiatAmount,
          exchangeRate: breakdown.exchangeRate,
          serviceCharge: breakdown.serviceFee,
          totalDeducted: breakdown.totalAmount,
        },
        withdrawalId: withdrawal.id,
        status: "pending",
      };
    } catch (error: any) {
      logger.error("Breet buy flow failed", {
        error: error.message,
        userId: data.userId,
      });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        "Crypto purchase failed. Please try again later.",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  async sellCryptoWithBreet(data: SellCryptoAutomatedData): Promise<any> {
    logger.info(`Initiating Breet sell flow`, {
      userId: data.userId,
      cryptoId: data.cryptoId,
    });

    try {
      // 1. Validate crypto
      const crypto = await this.cryptoRepository.findById(data.cryptoId);
      if (!crypto || !crypto.breetAssetId) {
        throw new AppError(
          "Crypto not supported on Breet",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      if (!crypto.saleActivated) {
        throw new AppError(
          "Sale not available for this crypto",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // Get the network to find the correct breetAssetId
      const network = await this.networkRepository.findById(data.networkId);
      if (!network || !network.breetAssetId) {
        throw new AppError(
          "Network not supported on Breet",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // 2. Validate user
      const user = await this.userRepository.findById(data.userId);
      if (!user) {
        throw new AppError(
          "User not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.RESOURCE_NOT_FOUND,
        );
      }

      // 3. Return existing wallet if already generated
      const walletRecord = user.breetWalletAddresses?.find(
        (w: any) =>
          w.cryptoId.toString() === data.cryptoId &&
          w.networkId?.toString() === data.networkId,
      );

      if (walletRecord) {
        logger.info(`Returning existing wallet address`, {
          userId: data.userId,
          address: walletRecord.walletAddress,
        });

        return {
          success: true,
          walletId: walletRecord.breetWalletId,
          address: walletRecord.walletAddress,
          qrCode: walletRecord.qrCodeUrl,
          asset: crypto.code,
          minimum: crypto.breetMinimumUSD || 20,
          message: "Using existing wallet address",
        };
      }

      // 4. Determine auto-settlement
      let autoSettlementEnabled = false;
      let bankId: string | undefined;
      let accountNumber: string | undefined;
      let linkedBankAccountId: any;

      if (SETTLEMENT_MODE === "bank" && data.bankAccountId) {
        const bankAccount = await this.bankAccountRepository.findById(
          data.bankAccountId,
        );

        if (!bankAccount || bankAccount.userId.toString() !== data.userId) {
          throw new AppError(
            "Bank account not found or unauthorized",
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }

        autoSettlementEnabled = true;
        bankId = bankAccount.bankId.toString();
        accountNumber = bankAccount.accountNumber;
        linkedBankAccountId = bankAccount._id;

        logger.info(`Auto-settlement enabled for sell`, {
          userId: data.userId,
          bankId,
        });
      }

      // 5. Generate wallet via Breet
      const walletParams: any = {
        assetId: network.breetAssetId,
        label: `${user._id}_${data.cryptoId}`,
      };

      if (autoSettlementEnabled && bankId && accountNumber) {
        walletParams.bankId = bankId;
        walletParams.accountNumber = accountNumber;
        walletParams.narration =
          `${user.firstname} ${user.lastname || ""}`.trim();
        walletParams.autoSettlement = true;
      }

      const wallet =
        await this.breetService.generateWalletAddress(walletParams);

      if (autoSettlementEnabled) {
        await this.breetService.setAutoSettlement(wallet.id, true);
      }

      logger.info(`Wallet generated via Breet`, {
        walletId: wallet.id,
        address: wallet.address,
        asset: crypto.breetAssetId,
      });

      // 6. Store wallet on user
      await this.userRepository.updateOne(
        { _id: user._id },
        {
          $push: {
            breetWalletAddresses: {
              cryptoId: crypto._id,
              breetWalletId: wallet.id,
              networkId: network._id,
              walletAddress: wallet.address,
              asset: network.breetAssetId,
              label: walletParams.label,
              qrCodeUrl: wallet.qrCode,
              autoSettlementEnabled,
              linkedBankAccountId,
              settlementMode: SETTLEMENT_MODE,
              lastDepositAt: null,
              totalDepositsUSD: 0,
              createdAt: new Date(),
            },
          },
        },
      );

      logger.info(`Wallet address stored for sell`, {
        userId: data.userId,
        cryptoId: data.cryptoId,
        address: wallet.address,
        autoSettlement: autoSettlementEnabled,
      });

      // 7. Return wallet info
      return {
        success: true,
        walletId: wallet.id,
        address: wallet.address,
        qrCode: wallet.qrCode,
        asset: crypto.code,
        minimum: crypto.breetMinimumUSD || 20,
        autoSettlement: autoSettlementEnabled,
        settlementMode: SETTLEMENT_MODE,
        message: "Wallet address generated. Send crypto to this address.",
      };
    } catch (error: any) {
      logger.error("Breet sell flow failed", {
        error: error.message,
        userId: data.userId,
      });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        "Crypto sale failed. Please try again later.",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }
}
