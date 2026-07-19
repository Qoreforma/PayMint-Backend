import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";
import { ProviderService } from "../ProviderService";
import { NowPaymentCryptoTradeService } from "./trades/automated/NowPaymentsCryptoTradeService";
import { TatumCryptoTradeService } from "./trades/automated/TatumCryptoTradeService";
import { CryptoUtilityService } from "./CryptoUtilityService";
import { BreetCryptoTradeService } from "./trades/automated/BreetCryptoTradeService";
import { CryptoBreakdownService } from "./CryptoBreakdownService";
import logger from "@/logger";

export interface BuyCryptoData {
  userId: string;
  cryptoId: string;
  cryptoAmount: number;
  walletAddress: string;
  networkId: string;
  channel?: "ios" | "android" | "web" | "api";
}

export interface SellCryptoData {
  userId: string;
  cryptoId: string;
  cryptoAmount: number;
  networkId: string;
  comment?: string;
  proof?: string;
  bankAccountId?: string;
  channel?: "ios" | "android" | "web" | "api";
}

export interface BuyCryptoAutomatedData {
  userId: string;
  cryptoId: string;
  networkId: string;
  usdAmount: number;
  walletAddress: string;
  extraId?: string;
  channel?: "ios" | "android" | "web" | "api";
}

export interface SellCryptoAutomatedData {
  userId: string;
  cryptoId: string;
  networkId: string;
  usdAmount?: number;
  comment?: string;
  proof?: string;
  bankAccountId?: string;
  channel?: "ios" | "android" | "web" | "api";
}

export interface InitiateSellTransactionData {
  userId: string;
  cryptoId: string;
  networkId: string;
  channel?: string;
}

export class CryptoService {
  constructor(
    private cryptoRepository: CryptoRepository,
    private networkRepository: NetworkRepository,
    private providerService: ProviderService,
    private cryptoBreakdownService: CryptoBreakdownService,
    private nowpaymentCryptoTradeService: NowPaymentCryptoTradeService,
    private tatumCryptoTradeService: TatumCryptoTradeService,
    private cryptoUtilityService: CryptoUtilityService,
    private breetCryptoTradeService: BreetCryptoTradeService,
  ) {}
  async getCryptos(filters: any = {}, page: number = 1, limit: number = 10) {
    const query: any = { deletedAt: null };
    const result =
      await this.providerService.getActiveProvidersByServiceTypeCode(
        TRANSACTION_TYPES.CRYPTO,
      );

    if (result.length !== 0) {
      query.providerId = result[0].id;
    } else {
      query.providerId = { $exists: false }; // only return cryptos with no providerId
    }
    if (filters.saleActivated) {
      query.saleActivated = filters.saleActivated;
    }
    if (filters.purchaseActivated) {
      query.purchaseActivated = filters.purchaseActivated;
    }

    if (filters.search) {
      return this.cryptoRepository.searchCryptos(
        filters.search,
        page,
        limit,
        query.providerId,
      );
    }

    return this.cryptoRepository.findWithPagination(
      query,
      page,
      limit,
      { name: 1 },
      [{ path: "networks", select: "+addressPattern" }],
    );
  }

  async getCryptoNetworks(cryptoId: string) {
    const crypto = await this.cryptoUtilityService.getCryptoById(cryptoId);

    if (!crypto.networks || crypto.networks.length === 0) {
      return [];
    }

    const networks = await this.networkRepository.findByIds(
      crypto.networks.map((id) => id.toString()),
    );

    return networks
      .filter((n) => n && !n.deletedAt)
      .map((n) => ({
        id: n._id,
        networkId: n.networkId,
        name: n.name,
        code: n.code,
        platformDepositAddress: n.platformDepositAddress,
        confirmationsRequired: n.confirmationsRequired,
        explorerUrl: n.explorerUrl,
      }));
  }

  // UI-facing only: collapses the real provider identity down to manual/automated
  // so the frontend just knows which flow to call. Internal callers that need the
  // real provider (calculateBreakdown, buy/sell automated) keep using
  // getCryptoPaymentProviders() / getActiveApiProvider() directly — don't repoint them here.
  async getCryptoProviderMode() {
    const result = await this.providerService.getProvidersByServiceTypeCode(
      TRANSACTION_TYPES.CRYPTO,
    );

    if (result.length === 0) {
      return [
        {
          id: "manual-crypto-deposit",
          name: "Manual Crypto Deposit",
          code: "manual-crypto-deposit",
          logo: "",
          serviceTypeCode: TRANSACTION_TYPES.CRYPTO,
          isActive: true,
          paymentOptions: [TRANSACTION_TYPES.CRYPTO],
        },
      ];
    }

    return [
      {
        id: "automated",
        name: "Automated Crypto Provider",
        code: "automated",
        logo: "",
        serviceTypeCode: TRANSACTION_TYPES.CRYPTO,
        isActive: true,
        paymentOptions: [TRANSACTION_TYPES.CRYPTO],
      },
    ];
  }

  async getCryptoPaymentProviders() {
    const result = await this.providerService.getProvidersByServiceTypeCode(
      TRANSACTION_TYPES.CRYPTO,
    );

    if (result.length === 0) {
      const result = [
        {
          id: "manual-crypto-deposit",
          name: "Manual Crypto Deposit",
          code: "manual-crypto-deposit",
          logo: "",
          serviceTypeCode: TRANSACTION_TYPES.CRYPTO,
          isActive: true,
          paymentOptions: [TRANSACTION_TYPES.CRYPTO],
        },
      ];
      return result;
    }

    return result;
  }

  async getCryptoRates() {
    const cryptos = await this.cryptoRepository.findWithPagination(
      { deletedAt: null, isActive: true },
      1,
      100,
    );

    return cryptos.data.map((crypto: any) => ({
      id: crypto._id,
      name: crypto.name,
      code: crypto.code,
      icon: crypto.icon,
      buyRate: crypto.buyRate,
      sellRate: crypto.sellRate,
    }));
  }

  async calculateBreakdown(
    data: {
      cryptoId: string;
      cryptoAmount: number;
      tradeType: "buy" | "sell";
      networkId: string;
    },
    userId?: string,
  ) {
    const activeProvider = (await this.getCryptoPaymentProviders()) as [
      {
        id: string;
        code: string;
        name: string;
        logo: string;
        serviceTypeCode: string;
        isActive: boolean;
        paymentOptions: string[];
      },
    ];
    const provider = activeProvider[0];

    let result;

    try {
      switch (provider.code.toLowerCase()) {
        case "tatum":
          result =
            await this.cryptoBreakdownService.calculateBreakdownWithTatum({
              cryptoId: data.cryptoId,
              networkId: data.networkId,
              tradeType: data.tradeType,
              usdAmount: data.cryptoAmount,
              userId
            });
          return result;
        case "breet":
          return await this.cryptoBreakdownService.calculateBreakdownWithBreet({
            cryptoId: data.cryptoId,
            networkId: data.networkId,
            tradeType: data.tradeType,
            usdAmount: data.cryptoAmount,
          });
        case "nowpayment":
          result =
            await this.cryptoBreakdownService.calculateBreakdownAutomated({
              cryptoId: data.cryptoId,
              networkId: data.networkId,
              tradeType: data.tradeType,
              usdAmount: data.cryptoAmount,
            });
          return result;
        default:
          return await this.cryptoBreakdownService.calculateBreakdown(data);
      }
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error("CryptoService: calculateBreakdown dispatch failed", error);
      throw new AppError(
        "Unable to calculate breakdown. Please try again later.",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }
  }

  // +++++++++++++++++++++++++++++ AUTOMATED FLOW ++++++++++++++++++++++++++++++++

  // ++++++++++++++++++++++++++++ PROVIDER SWITCH ++++++++++++++++++++++++
  async buyCryptoAutomated(data: BuyCryptoAutomatedData): Promise<any> {
    const provider = await this.providerService.getActiveApiProvider(
      TRANSACTION_TYPES.CRYPTO,
    );

    switch (provider.code.toLowerCase()) {
      case "nowpayment":
        return await this.nowpaymentCryptoTradeService.buyCryptoWithNowPayments(
          data,
        );
      case "tatum":
        return await this.tatumCryptoTradeService.buyCryptoWithTatum(data);
      case "breet":
        return await this.breetCryptoTradeService.buyCryptoWithBreet(data);
      default:
        throw new AppError(
          `Unknown crypto provider: ${provider.code}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.PROVIDER_ERROR,
        );
    }
  }
  async sellCryptoAutomated(data: SellCryptoData): Promise<any> {
    const provider = await this.providerService.getActiveApiProvider(
      TRANSACTION_TYPES.CRYPTO,
    );

    switch (provider.code.toLowerCase()) {
      case "nowpayment":
        return await this.nowpaymentCryptoTradeService.sellCryptoWithNowPayments(
          data,
        );
      case "tatum":
        return await this.tatumCryptoTradeService.sellCryptoWithTatum(data);
      case "breet":
        return await this.breetCryptoTradeService.sellCryptoWithBreet(data);

      default:
        throw new AppError(
          `Unknown crypto provider: ${provider.code}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.PROVIDER_ERROR,
        );
    }
  }
}
