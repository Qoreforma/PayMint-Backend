import logger from "@/logger";
import { CryptoTransactionRepository } from "@/repositories/client/CryptoTransactionRepository";
import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import crypto from "crypto";
import { NotificationService } from "../notifications/NotificationService";
import { TatumService } from "../providers/crypto/TatumService";
import { HelperService } from "../utility/HelperService";
import { WalletService } from "../wallet/WalletService";
import SocketService from "@/services/core/SocketService";
import { ProviderRateConfigRepository } from "@/repositories/admin/Providerrateconfigrepository";
import mongoose from "mongoose";
import { ICryptoTransaction } from "@/models/crypto/CryptoTransaction";
import { SWEEP_MODE } from "@/config/sweepConfig";
import {
  sweepSingleDeposit,
  meetsSweepThreshold,
} from "../crypto/sweep/SweepExecutor";
import { CryptoProfitCalculatorService } from "../crypto/CryptoProfitCalculatorService";
import { UserRepository } from "@/repositories/client/UserRepository";
import { generateReference } from "@/utils/helpers";

export interface ITatumWebhookPayload {
  subscriptionType: string; // "ADDRESS_EVENT"
  type: string; // "native" | "token"
  address: string;
  amount: string;
  asset: string;
  txId: string;
  chain: string;
  counterAddress?: string;
  blockNumber?: number;
  tokenId?: string | null;
  countConfirmations?: number;
  reorg?: boolean;
  [key: string]: any;
}
//  Verify signature (HMAC-SHA512)
//  Validate payload structure
//  Process deposit webhook
//  Credit user wallet
//  Update transaction status
//  Send notifications
export class TatumWebhookService {
  private tatumService: TatumService;
  private cryptoTransactionRepository: CryptoTransactionRepository;
  private cryptoRepository: CryptoRepository;
  private networkRepository: NetworkRepository;
  private walletService: WalletService;
  private notificationService: NotificationService;
  private helperService: HelperService;
  private providerRateConfigRepository: ProviderRateConfigRepository;
  private userRepository: UserRepository;

  constructor(
    tatumService: TatumService,
    cryptoTransactionRepository: CryptoTransactionRepository,
    cryptoRepository: CryptoRepository,
    networkRepository: NetworkRepository,
    walletService: WalletService,
    notificationService: NotificationService,
    helperService: HelperService,
    providerRateConfigRepository: ProviderRateConfigRepository,
    userRepository: UserRepository,
  ) {
    this.tatumService = tatumService;
    this.cryptoTransactionRepository = cryptoTransactionRepository;
    this.cryptoRepository = cryptoRepository;
    this.networkRepository = networkRepository;
    this.walletService = walletService;
    this.notificationService = notificationService;
    this.helperService = helperService;
    this.providerRateConfigRepository = providerRateConfigRepository;
    this.userRepository = userRepository;
  }

  // PROCESSOR METHODS

  // Verify Tatum webhook signature (HMAC-SHA512)
  // Signature sent in 'x-payload-hash' header
  verifySignature(parsedBody: object, signature: string): boolean {
    if (!process.env.TATUM_IPN_SECRET) {
      logger.error("Tatum webhook: TATUM_IPN_SECRET not configured");
      return false;
    }

    if (!signature) {
      logger.warn("Tatum webhook: missing signature header");
      return false;
    }

    // AFTER
    try {
      const expected = crypto
        .createHmac("sha512", process.env.TATUM_IPN_SECRET)
        .update(JSON.stringify(parsedBody))
        .digest("base64");

      const expectedBuf = Buffer.from(expected, "base64");
      const signatureBuf = Buffer.from(signature, "base64");

      if (expectedBuf.length !== signatureBuf.length) {
        logger.warn("Tatum webhook: signature length mismatch", {
          expectedLength: expectedBuf.length,
          receivedLength: signatureBuf.length,
        });
        return false;
      }

      const isValid = crypto.timingSafeEqual(expectedBuf, signatureBuf);

      if (!isValid) {
        logger.warn("Tatum webhook: signature mismatch", {
          signature: signature.substring(0, 16) + "...",
        });
      }

      return isValid;
    } catch (err: any) {
      logger.error("Tatum webhook: signature verification error", err);
      return false;
    }
  }

  // Validate webhook payload structure
  validatePayload(payload: any): boolean {
    if (!payload) {
      logger.error("Tatum webhook: payload is empty");
      return false;
    }

    // AFTER
    const requiredFields = [
      "subscriptionType",
      "address",
      "amount",
      "txId",
      "chain",
    ];
    const missing = requiredFields.filter((field) => !payload[field]);

    if (missing.length > 0) {
      logger.error("Tatum webhook: missing required fields", { missing });
      return false;
    }

    // Validate amount is a positive finite number
    const cryptoAmount = parseFloat(payload.amount);
    if (isNaN(cryptoAmount) || cryptoAmount <= 0 || !isFinite(cryptoAmount)) {
      logger.error("Tatum webhook: invalid amount", { amount: payload.amount });
      return false;
    }

    return true;
  }

  // SERVICE METHODS

  async processWebhook(payload: ITatumWebhookPayload): Promise<void> {
    logger.info(`Processing Tatum deposit webhook: ${payload.txId}`, {
      type: payload.type,
      subscriptionType: payload.subscriptionType,
      amount: payload.amount,
      asset: payload.asset,
      address: payload.address,
      chain: payload.chain,
    });

    if (payload.reorg === true) {
      logger.warn("Received reorg notification — flagging for manual review", {
        txId: payload.txId,
        address: payload.address,
      });

      const creditedTx = await this.cryptoTransactionRepository.findOne({
        tatumWebhookId: `${payload.txId}:${payload.address}`,
        status: "success",
      });

      if (creditedTx) {
        await this.cryptoTransactionRepository.update(
          creditedTx.id.toString(),
          {
            meta: {
              ...creditedTx.meta,
              reorgDetected: true,
              providerResponse: payload,
              reorgDetectedAt: new Date().toISOString(),
              needsManualIntervention: true,
            },
          },
        );

        logger.error(
          "CRITICAL: Reorg detected on already-credited transaction — manual reversal required",
          {
            txId: payload.txId,
            address: payload.address,
            reference: creditedTx.reference,
            userId: creditedTx.userId,
          },
        );
      }

      return;
    }

    const alreadyProcessed = await this.cryptoTransactionRepository.findOne({
      tatumWebhookId: `${payload.txId}:${payload.address}`,
      tatumDepositAddress: payload.address,
      status: "success",
    });

    if (alreadyProcessed) {
      logger.info("Duplicate webhook ignored", { txId: payload.txId });
      return;
    }

    logger.debug(`[WEBHOOK_RECEIVED] Full payload structure:`, {
      fullPayload: JSON.stringify(payload, null, 2),
      payloadKeys: Object.keys(payload),
      timestamp: new Date().toISOString(),
    });

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      let transaction: ICryptoTransaction | null;

      try {
        transaction = await this.cryptoTransactionRepository.claimForProcessing(
          {
            tatumDepositAddress: payload.address,
            status: "pending_deposit",
          },
          payload.txId,
          session,
        );
      } catch (err: any) {
        if (err.code === 11000) {
          logger.info(
            "Tatum webhook: duplicate claim detected — another worker already processing",
            {
              txId: payload.txId,
              address: payload.address,
            },
          );
          await session.abortTransaction();
          return;
        }
        throw err;
      }

      if (!transaction) {
        try {
          transaction = await this.autoCreateFromDepositAddress(
            payload,
            session,
          );
        } catch (err: any) {
          if (err.code === 11000) {
            logger.info(
              "Tatum webhook: duplicate claim detected on auto-create — another worker already processing",
              { txId: payload.txId, address: payload.address },
            );
            await session.abortTransaction();
            return;
          }
          throw err;
        }

        if (!transaction) {
          logger.warn(
            `Tatum webhook: no pending deposit for address or already claimed, and address does not belong to any user`,
            { address: payload.address, txId: payload.txId },
          );
          await session.abortTransaction();
          return;
        }

        logger.info(
          `Tatum webhook: no pending deposit found — auto-created transaction from reverse address lookup`,
          {
            address: payload.address,
            txId: payload.txId,
            transactionId: transaction.id,
            userId: transaction.userId,
          },
        );
      }
      logger.debug(`[TRANSACTION_FOUND] Complete transaction object:`, {
        transactionId: transaction.id,
        reference: transaction.reference,
        userId: transaction.userId,
        status: transaction.status,
        cryptoId: transaction.cryptoId,
        networkId: transaction.network?.networkId,
        tatumDepositAddress: transaction.tatumDepositAddress,
        tatumWebhookId: transaction.tatumWebhookId,
        createdAt: transaction.createdAt,
        meta: JSON.stringify(transaction.meta, null, 2),
        fullTransaction: JSON.stringify(transaction, null, 2),
      });

      logger.debug(`Found pending deposit transaction`, {
        reference: transaction.reference,
        transactionId: transaction.id,
      });

      await this.creditAndFinalizeDeposit(transaction, payload, session);
    } catch (error: any) {
      logger.error(`Error processing Tatum deposit webhook`, {
        error: error.message,
        stack: error.stack,
        webhookId: payload.txId,
        address: payload.address,
      });

      try {
        await session.abortTransaction();
      } catch (abortErr: any) {
        logger.error(`Failed to abort webhook session`, abortErr);
      }
    } finally {
      try {
        await session.endSession();
      } catch (err) {
        logger.error("Failed to end webhook session", err);
      }
    }
  }

  // Shared by both paths that produce a transaction to credit: the
  // normal matched-claim path (an existing pending_deposit record) and
  // the auto-create fallback (reverse address lookup, no prior record).
  // Fetches crypto/network, calculates rates, credits the wallet, marks
  // the transaction success, sweeps if eligible, and sends notifications.
  private async creditAndFinalizeDeposit(
    transaction: ICryptoTransaction,
    payload: ITatumWebhookPayload,
    session: mongoose.ClientSession,
  ): Promise<void> {
    // 4: Get crypto and network info

    const [crypto, network] = await Promise.all([
      this.cryptoRepository.findById(
        transaction.cryptoId.toString(),
        undefined,
        undefined,
        session,
      ),
      this.networkRepository.findByNetworkId(transaction.network.networkId),
    ]);

    if (!crypto || !network) {
      logger.error(`Tatum webhook: crypto or network not found`, {
        cryptoId: transaction.cryptoId,
        networkId: transaction.network.networkId,
      });
      await session.abortTransaction();
      return;
    }

    logger.debug(`[CRYPTO_FETCHED] Complete crypto object:`, {
      cryptoId: crypto.id,
      code: crypto.code,
      name: crypto.name,
      sellRate: crypto.sellRate,
      buyRate: crypto.buyRate,
      isActive: crypto.isActive,
      createdAt: crypto.createdAt,
      fullCrypto: JSON.stringify(crypto, null, 2),
    });

    logger.debug(`[NETWORK_FETCHED] Complete network object:`, {
      networkId: network.id,
      name: network.name,
      confirmationsRequired: network.confirmationsRequired,
      isActive: network.isActive,
      explorerUrl: network.explorerUrl,
      fullNetwork: JSON.stringify(network, null, 2),
    });

    logger.debug(`Fetched crypto and network info`, {
      cryptoCode: crypto.code,
      networkName: network.name,
    });

    const confirmations = network.confirmationsRequired;

    logger.debug(`Minimum confirmations reached`, {
      reference: transaction.reference,
      confirmations,
      required: network.confirmationsRequired,
    });

    const usdRate = await this.tatumService.getExchangeRate({
      symbol: crypto.code,
      basePair: "USD",
    });

    logger.debug(`[USD_RATE_FETCHED] Exchange rate response:`, {
      cryptoCode: crypto.code,
      basePair: "USD",
      usdRate: usdRate,
      rateType: typeof usdRate,
      timestamp: new Date().toISOString(),
    });

    logger.debug(`Exchange rate fetched`, {
      currency: crypto.code,
      rate: usdRate,
    });

    // AFTER
    // 7: Get USD to NGN rate — crypto's own configured sell rate is
    // authoritative (same rate the manual-sell flow already uses); the
    // provider rate config is only consulted if that's missing. If
    // neither resolves, abort loudly rather than silently drop the
    // deposit — this used to fall through without aborting the
    // transaction, leaving nothing credited and no error surfaced.
    let ngnRate: number;

    if (crypto.sellRate && crypto.sellRate > 0) {
      ngnRate = crypto.sellRate;

      logger.debug(`USD-NGN rate resolved from crypto.sellRate`, {
        rate: ngnRate,
        cryptoCode: crypto.code,
      });
    } else {
      const providerRateConfig =
        await this.providerRateConfigRepository.findByProviderCode("tatum");

      if (!providerRateConfig || !providerRateConfig.sellRate) {
        logger.error(
          `Tatum webhook: no usable USD-NGN rate — crypto.sellRate unset and no active provider rate config for "tatum"`,
          {
            reference: transaction.reference,
            cryptoCode: crypto.code,
          },
        );
        await session.abortTransaction();
        return;
      }

      ngnRate = providerRateConfig.sellRate;

      logger.debug(`USD-NGN rate resolved from provider rate config`, {
        rate: ngnRate,
        provider: "tatum",
      });
    }

    const cryptoAmount = parseFloat(payload.amount);
    const usdAmount = cryptoAmount * usdRate;
    const fiatAmountNGN = usdAmount * ngnRate;

    logger.debug(`Webhook amount parsed`, {
      payloadAmount: payload.amount,
      cryptoAmount,
      txId: payload.txId,
    });

    logger.debug(`Amount calculations`, {
      cryptoAmount,
      exchangeRate: usdRate,
      usdAmount,
      ngnRate,
      fiatAmountNGN,
    });

    const chargeCalculation =
      await this.helperService.calculateAmountWithCharge(
        fiatAmountNGN,
        TRANSACTION_TYPES.CRYPTO_SALE,
      );

    const serviceFeeNGN = chargeCalculation.chargeAmount;
    const totalPayout = fiatAmountNGN - serviceFeeNGN;

    logger.debug(`Service charge calculation`, {
      fiatAmountNGN,
      serviceFeeNGN,
      totalPayout,
    });

    logger.debug(
      `[PRE_CREDIT_CALCULATIONS] Final amounts before wallet credit:`,
      {
        cryptoAmount: cryptoAmount,
        cryptoCode: crypto.code,
        usdRate: usdRate,
        usdAmount: usdAmount,
        ngnRate: ngnRate,
        fiatAmountNGN: fiatAmountNGN,
        serviceFeeNGN: serviceFeeNGN,
        totalPayoutNGN: totalPayout,
        timestamp: new Date().toISOString(),
      },
    );

    logger.info(`Crediting user wallet`, {
      reference: transaction.reference,
      userId: transaction.userId,
      amount: totalPayout,
    });

    let creditResult: any;

    try {
      creditResult = await this.walletService.creditWallet(
        transaction.userId.toString(),
        totalPayout,
        "Crypto Sale Credit",
        {
          type: TRANSACTION_TYPES.CRYPTO,
          provider: "tatum",
          idempotencyKey: `${transaction.reference}_credit`,
          remark: `Crypto sale: ${cryptoAmount} ${crypto.code}`,
          meta: {
            reference: transaction.reference,
            webhookId: payload.txId,
            depositAddress: payload.address,
            txHash: payload.txId,
            confirmations,
            cryptoCode: crypto.code,
            cryptoAmount,
          },
        },
      );

      logger.debug(`[WALLET_CREDIT_SUCCESS] Full credit result:`, {
        userId: transaction.userId,
        amountCredited: totalPayout,
        balanceBefore: creditResult.balanceBefore,
        balanceAfter: creditResult.balanceAfter,
        walletTransactionId: creditResult.walletTransactionId,
        fullCreditResult: JSON.stringify(creditResult, null, 2),
        timestamp: new Date().toISOString(),
      });

      logger.info(`User wallet credited successfully`, {
        reference: transaction.reference,
        amount: totalPayout,
        newBalance: creditResult.balanceAfter,
      });
    } catch (creditError: any) {
      logger.error(
        `CRITICAL: Wallet credit failed, user funds at risk - needs manual intervention`,
        {
          error: creditError.message,
          errorCode: creditError.code,
          errorStack: creditError.stack,
          reference: transaction.reference,
          userId: transaction.userId,
          amount: totalPayout,
          webhookId: payload.txId,
          creditResult: creditResult
            ? JSON.stringify(creditResult, null, 2)
            : "null",
          timestamp: new Date().toISOString(),
        },
      );

      await session.abortTransaction();

      try {
        await this.cryptoTransactionRepository.update(
          transaction.id.toString(),
          {
            meta: {
              ...transaction.meta,
              providerResponse: payload,
              creditFailureReason: creditError.message,
              creditFailedAt: new Date().toISOString(),
              needsManualIntervention: true,
            },
          },
        );
      } catch (updateErr: any) {
        logger.error(`Failed to update transaction after credit failure`, {
          error: updateErr.message,
        });
      }

      return;
    }

    const profitBreakdown =
      CryptoProfitCalculatorService.calculateProvisional(serviceFeeNGN);

    await this.cryptoTransactionRepository.update(
      transaction.id.toString(),
      {
        cryptoAmount,
        fiatAmount: fiatAmountNGN,
        exchangeRate: usdRate,
        serviceFee: serviceFeeNGN,
        totalAmount: totalPayout,
        amountsFinalized: true,
        status: "success",
        completedAt: new Date(),
        webhookReceivedAt: new Date(),
        tatumWebhookId: `${payload.txId}:${payload.address}`,
        txHash: payload.txId,
        confirmations,
        blockNumber: payload.blockNumber,
        balanceAfter: creditResult.balanceAfter,
        profit: profitBreakdown.profit,
        meta: {
          ...transaction.meta,
          providerResponse: payload,
          creditedAt: new Date().toISOString(),
          creditedAmount: totalPayout,
          fiatBreakdown: {
            usdAmount,
            ngnRate,
            fiatAmountNGN,
            serviceFeeNGN,
            totalPayout,
          },
          profitBreakdown: {
            ...profitBreakdown,
            status: "provisional",
            calculatedAt: new Date().toISOString(),
          },
        },
      },
      undefined,
      undefined,
      session,
    );

    logger.debug(`Transaction updated to success`, {
      reference: transaction.reference,
      status: "success",
    });

    await session.commitTransaction();

    this.cryptoTransactionRepository.findById(transaction.id.toString())
      .then(updatedTransaction => {
        if (updatedTransaction) {
          SocketService.emitTransactionUpdate(transaction.reference, { status: "success", transaction: updatedTransaction });
        }
      })
      .catch(err => logger.error("Socket emit error", err));

    logger.debug(
      `[TRANSACTION_UPDATED_AND_SAVED] Complete updated transaction:`,
      {
        transactionId: transaction.id,
        reference: transaction.reference,
        status: "success",
        cryptoAmount,
        fiatAmount: fiatAmountNGN,
        totalAmount: totalPayout,
        serviceFee: serviceFeeNGN,
        exchangeRate: usdRate,
        balanceAfter: creditResult.balanceAfter,
        timestamp: new Date().toISOString(),
      },
    );
    logger.info(` Tatum deposit webhook processed successfully`, {
      reference: transaction.reference,
      webhookId: payload.txId,
      userId: transaction.userId,
      cryptoAmount,
      fiatAmountNGN,
      totalPayout,
    });

    if (SWEEP_MODE === "immediate" && meetsSweepThreshold(usdAmount, crypto)) {
      sweepSingleDeposit(
        {
          id: transaction.id,
          reference: transaction.reference,
          cryptoAmount,
          tatumDepositAddress: transaction.tatumDepositAddress,
          network: transaction.network,
          meta: {
            ...transaction.meta,
            fiatBreakdown: {
              usdAmount,
              ngnRate,
              fiatAmountNGN,
              serviceFeeNGN,
              totalPayout,
            },
          },
        },
        crypto,
      )
        .then((result) => {
          if (result?.skipped) {
            logger.info(`Immediate sweep skipped due to gas fee cap`, {
              reference: transaction.reference,
              reason: result.reason,
              retryAt: result.retryAt?.toISOString(),
              note: "Will be picked up by daily sweep or retried next hour",
            });
          } else if (result?.txHash) {
            logger.info(`Immediate sweep executed successfully`, {
              reference: transaction.reference,
              txHash: result.txHash,
            });
          }
        })
        .catch((err: any) => {
          logger.error(`Immediate sweep failed, will retry via daily sweep`, {
            error: err.message,
            reference: transaction.reference,
            stack: err.stack,
          });
        });
    }

    this.notificationService
      .createNotification({
        type: "transaction_complete",
        notifiableType: "User",
        notifiableId: transaction.userId,
        data: {
          reference: transaction.reference,
          transactionType: "Crypto Sale",
          cryptoAmount,
          cryptoCode: crypto.code,
          fiatAmount: fiatAmountNGN,
          serviceCharge: serviceFeeNGN,
          totalReceived: totalPayout,
          status: "completed",
          completedAt: new Date().toISOString(),
        },
        sendEmail: true,
        sendSMS: false,
        sendPush: true,
      })
      .catch((err) => {
        logger.error(`Failed to send completion notification`, {
          error: err.message,
          reference: transaction.reference,
        });
      });

    // Auto-reconciled deposits (no prior pending_deposit record) get a
    // separate admin heads-up so someone can eyeball the match.
    if (transaction.isAutomated) {
      this.notificationService
        .createNotification({
          type: "admin_crypto_deposit_auto_reconciled",
          notifiableType: "Admin",
          notifiableId: transaction.userId,
          data: {
            userEmail: transaction.meta?.autoReconciledUserEmail,
            cryptoAmount,
            cryptoCode: crypto.code,
            fiatAmount: fiatAmountNGN,
            reference: transaction.reference,
          },
          sendEmail: true,
          sendSMS: false,
          sendPush: false,
          adminNotificationScope: {
            type: "crypto_network",
            id: network.networkId,
            tradeType: "sell",
          },
        })
        .catch((err) => {
          logger.error(
            `Failed to send admin auto-reconciliation notification`,
            {
              error: err.message,
              reference: transaction.reference,
            },
          );
        });
    }

    this.helperService
      .updateLeaderboardAsync(
        transaction.userId.toString(),
        transaction.id,
        TRANSACTION_TYPES.CRYPTO,
        totalPayout,
        usdAmount,
      )
      .catch((err: any) => {
        logger.error(`Leaderboard update failed (Tatum sell)`, {
          error: err.message,
          reference: transaction.reference,
        });
      });
  }

  private async autoCreateFromDepositAddress(
    payload: ITatumWebhookPayload,
    session: mongoose.ClientSession,
  ): Promise<ICryptoTransaction | null> {
    const user = await this.userRepository.findByDepositAddress(
      payload.address,
    );
    if (!user) return null;

    const addressEntry = user.userCryptoAddresses?.find(
      (a) => a.depositAddress === payload.address,
    );
    if (!addressEntry) {
      logger.error(
        `Tatum webhook: user matched by deposit address but entry missing on re-read`,
        { userId: user.id, address: payload.address },
      );
      return null;
    }

    const network = await this.networkRepository.findById(
      addressEntry.networkId.toString(),
      undefined,
      undefined,
      session,
    );
    if (!network) {
      logger.error(
        `Tatum webhook: auto-create — network not found for user's address`,
        {
          userId: user.id,
          address: payload.address,
          networkId: addressEntry.networkId,
        },
      );
      return null;
    }

    const cryptosOnNetwork = await this.cryptoRepository.findByNetworkId(
      network.id,
    );
    const crypto = cryptosOnNetwork.find(
      (c) => c.code === payload.asset?.toUpperCase(),
    );
    if (!crypto) {
      logger.error(
        `Tatum webhook: auto-create — no crypto on this network matches the webhook asset`,
        {
          userId: user.id,
          address: payload.address,
          networkId: network.networkId,
          asset: payload.asset,
        },
      );
      return null;
    }

    const wallet = await this.walletService.getWallet(user.id.toString());
    const reference = generateReference();

    return this.cryptoTransactionRepository.create(
      {
        cryptoId: crypto._id,
        userId: user._id,
        reference,
        tradeType: "sell",
        network: {
          networkId: network.networkId,
          code: network.code,
          name: network.name,
          confirmationsRequired: network.confirmationsRequired,
          explorerUrl: network.explorerUrl || "",
        },
        walletAddress: payload.address,
        cryptoAmount: parseFloat(payload.amount),
        fiatAmount: 0,
        exchangeRate: 0,
        serviceFee: 0,
        totalAmount: 0,
        amountsFinalized: false,
        status: "processing",
        claimedAt: new Date(),
        balanceBefore: wallet.balance,
        balanceAfter: wallet.balance,
        isAutomated: true,
        tatumDepositAddress: payload.address,
        tatumWebhookId: `${payload.txId}:${payload.address}`,
        meta: {
          cryptoName: crypto.name,
          cryptoCode: crypto.code,
          network: network.name,
          automatedFlow: true,
          processedBy: "Tatum",
          autoReconciled: true,
          autoReconciledReason:
            "No pending_deposit record existed for this address when the webhook arrived",
          autoReconciledAt: new Date().toISOString(),
          autoReconciledUserEmail: user.email,
        },
      } as Partial<ICryptoTransaction>,
      session,
    );
  }
}
