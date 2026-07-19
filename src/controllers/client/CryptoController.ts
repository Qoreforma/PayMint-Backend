import { Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { CryptoService } from "@/services/client/crypto/CryptoService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import ServiceContainer from "@/services/client/container";
import { CryptoBreakdownService } from "@/services/client/crypto/CryptoBreakdownService";
import { CryptoTransactionService } from "@/services/client/crypto/CryptoTransactionService";
import { CryptoUtilityService } from "@/services/client/crypto/CryptoUtilityService";
import { CryptoManualTradeService } from "@/services/client/crypto/trades/CryptoManualTradeService";
export class CryptoController {
  private cryptoService: CryptoService;
  private cryptoUtilityService: CryptoUtilityService;
  private cryptoBreakdownService: CryptoBreakdownService;
  private cryptoTransactionService: CryptoTransactionService;
  private cryptoManualTradeService: CryptoManualTradeService;
  constructor() {
    this.cryptoService = ServiceContainer.getCryptoService();
    this.cryptoUtilityService = ServiceContainer.getCryptoUtilityService();
    this.cryptoBreakdownService = ServiceContainer.getCryptoBreakdownService();
    this.cryptoTransactionService =
      ServiceContainer.getCryptoTransactionService();
    this.cryptoManualTradeService =
      ServiceContainer.getCryptoManualTradeService();
    //   this.nowPaymentCryptoTradeService =
    //     ServiceContainer.getNowPaymentCryptoTradeService();
    //   this.tatumCryptoTradeService =
    //     ServiceContainer.getTatumCryptoTradeService();
    //   this.cryptoManualTradeService =
    //     ServiceContainer.getCryptoManualTradeService();
  }

  // Get list of available cryptocurrencies
  getCryptos = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      let filters = {};

      if (req.query.saleActivated !== undefined) {
        filters = {
          ...filters,
          saleActivated: req.query.saleActivated === "true",
        };
      }
      if (req.query.purchaseActivated !== undefined) {
        filters = {
          ...filters,
          purchaseActivated: req.query.purchaseActivated === "true",
        };
      }
      if (req.query.search) {
        filters = { ...filters, search: req.query.search as string };
      }

      const result = await this.cryptoService.getCryptos(filters, page, limit);

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Cryptocurrencies retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  // Get single cryptocurrency details
  getCryptoById = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { cryptoId } = req.params;
      const crypto = await this.cryptoUtilityService.getCryptoById(cryptoId);

      return sendSuccessResponse(
        res,
        crypto,
        "Cryptocurrency retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  // Get available networks for a cryptocurrency
  getCryptoNetworks = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { cryptoId } = req.params;
      const networks = await this.cryptoService.getCryptoNetworks(cryptoId);

      return sendSuccessResponse(
        res,
        networks,
        "Networks retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  // Get current exchange rates for all cryptos
  getCryptoRates = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const rates = await this.cryptoService.getCryptoRates();

      return sendSuccessResponse(
        res,
        rates,
        "Crypto rates retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };


  getCryptoPaymentProviders = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const providers = await this.cryptoService.getCryptoProviderMode();

      return sendSuccessResponse(
        res,
        providers,
        "Crypto payment providers retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  // Calculate transaction breakdown before initiating
  calculateBreakdown = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const breakdown = await this.cryptoService.calculateBreakdown(req.body,   req.user!.id,);
      
      return sendSuccessResponse(
        res,
        breakdown,
        "Breakdown calculated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  // Initiate crypto purchase (BUY)
  buyCrypto = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const channel = (req as any).channel || "web";
      const data = { ...req.body, userId, channel };

      const result = await this.cryptoManualTradeService.buyCrypto(data);

      return sendSuccessResponse(
        res,
        result,
        "Crypto purchase initiated successfully. Your transaction is being processed.",
      );
    } catch (error) {
      next(error);
    }
  };

  buyCryptoAutomated = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const channel = (req as any).channel || "web";
      const { cryptoId, networkId, cryptoAmount, walletAddress } = req.body;
      const data = {
        userId,
        cryptoId,
        networkId,
        usdAmount: cryptoAmount,
        walletAddress,
        channel
      };

      const result = await this.cryptoService.buyCryptoAutomated(data);

      return sendSuccessResponse(
        res,
        result,
        "Crypto purchase initiated successfully. Your transaction is being processed.",
      );
    } catch (error) {
      next(error);
    }
  };
  // Initiate crypto sale (SELL)
  sellCrypto = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const channel = (req as any).channel || "web";
      const data = { ...req.body, userId, channel };

      const result = await this.cryptoManualTradeService.sellCrypto(data);

      return sendSuccessResponse(
        res,
        result,
        "Crypto sale request submitted successfully. Please send the crypto to the provided address.",
      );
    } catch (error) {
      next(error);
    }
  };

  sellCryptoAutomated = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const channel = (req as any).channel || "web";

      const { cryptoId, networkId, cryptoAmount } = req.body;
      const data = {
        cryptoId,
        networkId,
        cryptoAmount,
        // usdAmount: cryptoAmount,
        userId,
        channel,
      };

      const result = await this.cryptoService.sellCryptoAutomated(data);

      return sendSuccessResponse(
        res,
        result,
        "Crypto sale request submitted successfully. Please send the crypto to the provided address.",
      );
    } catch (error) {
      next(error);
    }
  };

  // Polling fallback — client calls this if the IPN webhook is delayed
  // and the user wants to know the current status of their NowPayments payment.
  getNowPaymentsPaymentStatus = async function (
    this: any,
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { paymentId } = req.params;
      const userId = req.user!.id;

      // Verify the paymentId belongs to this user
      const transaction =
        await this.cryptoService.getCryptoTransactionByNowPaymentsId(
          paymentId,
          userId,
        );

      if (!transaction) {
        return res.status(404).json({
          success: false,
          message: "Payment not found",
        });
      }

      // Fetch live status from NowPayments
      const status =
        await this.cryptoService.getNowPaymentsPaymentStatus(paymentId);

      return sendSuccessResponse(
        res,
        status,
        "Payment status retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  // Get user's crypto transactions with filters
  getCryptoTransactions = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const filters = {
        tradeType: req.query.tradeType as string,
        status: req.query.status as string,
        cryptoId: req.query.cryptoId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        reference: req.query.reference as string,
        search: req.query.search as string,
      };

      const result = await this.cryptoTransactionService.getCryptoTransactions(
        userId,
        filters,
        page,
        limit,
      );

      return sendPaginatedResponse(
        res,
        result.data,
        { total: result.total, page, limit },
        "Crypto transactions retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getUserTransactionStats = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;

      const filters: any = {};
      if (req.query.startDate) {
        filters.startDate = new Date(req.query.startDate as string);
      }
      if (req.query.endDate) {
        filters.endDate = new Date(req.query.endDate as string);
      }
      if (req.query.cryptoId) {
        filters.cryptoId = req.query.cryptoId as string;
      }

      const stats =
        await this.cryptoTransactionService.getUserTransactionsStats(
          userId,
          filters,
        );

      return sendSuccessResponse(
        res,
        stats,
        "Crypto transaction stats retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };
  // Get single transaction by ID
  getCryptoTransactionById = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { transactionId } = req.params;

      const transaction =
        await this.cryptoTransactionService.getCryptoTransactionById(
          transactionId,
          userId,
        );

      return sendSuccessResponse(
        res,
        transaction,
        "Transaction retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  // Get transaction by reference
  getCryptoTransactionByReference = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { reference } = req.params;

      const transaction =
        await this.cryptoTransactionService.getCryptoTransactionByReference(
          reference,
          userId,
        );

      return sendSuccessResponse(
        res,
        transaction,
        "Transaction retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  exportCryptoTransactions = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;

      const filters = {
        tradeType: req.query.tradeType as string,
        status: req.query.status as string,
        cryptoId: req.query.cryptoId as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      };

      const csvData =
        await this.cryptoTransactionService.exportCryptoTransactions(
          userId,
          filters,
        );

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=crypto_transactions_${
          new Date().toISOString().split("T")[0]
        }.csv`,
      );

      return res.send(csvData);
    } catch (error) {
      next(error);
    }
  };

  generateCryptoReceipt = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { reference } = req.params;
      const userId = req.user!.id;

      const receipt = await this.cryptoTransactionService.generateCryptoReceipt(
        reference,
        userId,
      );

      return sendSuccessResponse(
        res,
        receipt,
        "Receipt generated successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  uploadTransactionProof = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { reference } = req.params;
      const userId = req.user!.id;
      const { proof } = req.body;

      const transaction =
        await this.cryptoTransactionService.uploadTransactionProof(
          reference,
          userId,
          proof,
        );

      return sendSuccessResponse(
        res,
        transaction,
        "Proof uploaded successfully",
      );
    } catch (error) {
      next(error);
    }
  };
}
