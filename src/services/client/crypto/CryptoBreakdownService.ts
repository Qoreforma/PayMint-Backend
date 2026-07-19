import { AppError } from "@/middlewares/shared/errorHandler";
import { IServiceCharge } from "@/models/billing/fees/ServiceCharge";
import { HTTP_STATUS, ERROR_CODES, TRANSACTION_TYPES } from "@/utils/constants";
import { HelperService } from "../utility/HelperService";
import { ProviderRateConfigRepository } from "@/repositories/admin/Providerrateconfigrepository";
import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";
import { TatumService } from "../providers/crypto/TatumService";
import { CryptoUtilityService } from "./CryptoUtilityService";
import { BreetService } from "../providers/crypto/BreetService";
import logger from "@/logger";
import { Types } from "mongoose";
import { UserRepository } from "@/repositories/client/UserRepository";

export class CryptoBreakdownService {
  constructor(
    private cryptoUtilityService: CryptoUtilityService,
    private helperService: HelperService,
    private providerRateConfigRepository: ProviderRateConfigRepository,
    private tatumService: TatumService,
    private cryptoRepository: CryptoRepository,
    private networkRepository: NetworkRepository,
    private breetService: BreetService,
    private userRepository: UserRepository,
  ) {}

  // Moved from TatumCryptoTradeService — unchanged logic, just relocated so
  // the breakdown preview and the real sell order use the identical address.
  async createUserDepositAddress(
    userId: string,
    networkId: string,
  ): Promise<{ address: string; accountId: string }> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    const existing = user.userCryptoAddresses?.find((addr: any) =>
      addr.networkId.equals(networkId),
    );

    if (existing) {
      // Previously this returned the cached address unconditionally, even if
      // the original webhook subscription had failed — which is exactly what
      // let deposits go un-notified. Now: if the address is unsubscribed (or
      // this is an old record from before this field existed), retry the
      // subscription before handing the address back, instead of trusting
      // that "it's cached" means "it's watched".
      if (existing.webhookSubscriptionStatus !== "subscribed") {
        const network = await this.networkRepository.findById(networkId);
        try {
          const { subscriptionId } =
            await this.tatumService.createAddressSubscription({
              address: existing.depositAddress,
              chain: network?.tatumChainCode || "",
              url: `${process.env.BASE_URL}/api/v1/webhooks/tatum`,
              isTestnet: process.env.TATUM_ENVIRONMENT !== "mainnet",
            });
          existing.webhookSubscriptionId = subscriptionId;
          existing.webhookSubscriptionStatus = "subscribed";
        } catch (err: any) {
          logger.warn(`Retry of webhook subscription failed`, {
            error: err.message,
            address: existing.depositAddress,
          });
          existing.webhookSubscriptionStatus = "failed";
        }
        existing.webhookLastAttemptAt = new Date();
        await this.userRepository.update(userId, {
          userCryptoAddresses: user.userCryptoAddresses,
        });
      }

      return {
        address: existing.depositAddress,
        accountId: existing.tatumAccountId,
      };
    }

    const networkBeforeIncrement =
      await this.networkRepository.claimNextDerivationIndex(networkId);

    if (!networkBeforeIncrement) {
      throw new AppError(
        "Network not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    if (!networkBeforeIncrement.masterXpub) {
      throw new AppError(
        `Master xpub not configured for ${networkBeforeIncrement.name}`,
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const RESERVED_DERIVATION_INDICES = [0];
    let derivationIndex = networkBeforeIncrement.derivationPathCounter || 0;

    while (RESERVED_DERIVATION_INDICES.includes(derivationIndex)) {
      logger.warn(`Reserved derivation index claimed — skipping`, {
        networkId,
        reservedIndex: derivationIndex,
      });
      const nextClaim =
        await this.networkRepository.claimNextDerivationIndex(networkId);
      derivationIndex = nextClaim?.derivationPathCounter ?? derivationIndex + 1;
    }

    const { address } = await this.tatumService.generateAddressFromXpub({
      networkPath: networkBeforeIncrement.networkPath,
      xpub: networkBeforeIncrement.masterXpub,
      index: derivationIndex,
      isTestnet: process.env.TATUM_ENVIRONMENT !== "mainnet",
    });

    let webhookSubscriptionId: string | null = null;
    let webhookSubscriptionStatus: "subscribed" | "failed" = "failed";

    try {
      const { subscriptionId } =
        await this.tatumService.createAddressSubscription({
          address,
          chain: networkBeforeIncrement.tatumChainCode,
          url: `${process.env.BASE_URL}/api/v1/webhooks/tatum`,
          isTestnet: process.env.TATUM_ENVIRONMENT !== "mainnet",
        });
      webhookSubscriptionId = subscriptionId;
      webhookSubscriptionStatus = "subscribed";
    } catch (err: any) {
      // NOTE: previously this error was only logged, and the address was
      // cached anyway with no record that the subscription had failed. That
      // silent failure is what caused deposits to never trigger a webhook.
      // We still cache the address below (the derivation index and on-chain
      // address are already consumed/real), but now the failure is recorded
      // so getUserDepositAddress / createUserDepositAddress can retry later
      // instead of trusting a dead subscription forever.
      logger.warn(`Failed to create webhook subscription`, {
        error: err.message,
        address,
      });
    }

    user.userCryptoAddresses = user.userCryptoAddresses || [];
    user.userCryptoAddresses.push({
      networkId: new Types.ObjectId(networkId),
      derivationIndex,
      depositAddress: address,
      tatumAccountId: `derived_${derivationIndex}`,
      createdAt: new Date(),
      webhookSubscriptionId,
      webhookSubscriptionStatus,
      webhookLastAttemptAt: new Date(),
    });

    await this.userRepository.update(userId, {
      userCryptoAddresses: user.userCryptoAddresses,
    });

    return { address, accountId: `derived_${derivationIndex}` };
  }

  async getUserDepositAddress(
    userId: string,
    networkId: string,
  ): Promise<string> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    const existing = user.userCryptoAddresses?.find((addr: any) =>
      addr.networkId.equals(networkId),
    );

    if (existing) {
      return existing.depositAddress;
    }

    const { address } = await this.createUserDepositAddress(userId, networkId);
    return address;
  }

  async calculateBreakdown(data: {
    cryptoId: string;
    cryptoAmount: number;
    tradeType: "buy" | "sell";
    networkId: string;
  }) {
    const crypto = await this.cryptoUtilityService.getCryptoById(data.cryptoId);
    const network = await this.cryptoUtilityService.getNetwork(
      data.cryptoId,
      data.networkId,
    );

    const exchangeRate =
      data.tradeType === "buy" ? crypto.buyRate : crypto.sellRate;

    if (!exchangeRate || exchangeRate <= 0) {
      throw new AppError(
        `${data.tradeType === "buy" ? "Purchase" : "Sale"} rate not configured`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const fiatAmount = data.cryptoAmount * exchangeRate;
    let chargeCalculation: {
      baseAmount: number;
      chargeAmount: number;
      totalAmount: number;
      serviceCharge: IServiceCharge | null;
    };
    if (data.tradeType === "buy") {
      chargeCalculation = await this.helperService.calculateAmountWithCharge(
        fiatAmount,
        TRANSACTION_TYPES.CRYPTO_PURCHASE,
      );
    } else {
      chargeCalculation = await this.helperService.calculateAmountWithCharge(
        fiatAmount,
        TRANSACTION_TYPES.CRYPTO_SALE,
      );
    }

    const serviceFee = chargeCalculation.chargeAmount;

    let totalAmount: number;
    if (data.tradeType === "buy") {
      totalAmount = fiatAmount + serviceFee;
    } else {
      totalAmount = fiatAmount - serviceFee;
    }

    if (data.tradeType === "sell") {
      return {
        crypto: {
          id: crypto._id,
          name: crypto.name,
          code: crypto.code,
          icon: crypto.icon,
        },
        network: {
          id: network._id,
          networkId: network.networkId,
          name: network.name,
          code: network.code,
        },
        cryptoAmount: data.cryptoAmount,
        fiatAmount,
        exchangeRate,
        serviceFee,
        totalAmount,
        tradeType: data.tradeType,
        serviceCharge: chargeCalculation.serviceCharge,
        depositInstructions: {
          address: network.platformDepositAddress,
          network: network.name,
          confirmationsRequired: network.confirmationsRequired,
          explorerUrl: network.explorerUrl,
        },
      };
    } else {
      return {
        crypto: {
          id: crypto._id,
          name: crypto.name,
          code: crypto.code,
          icon: crypto.icon,
        },
        network: {
          id: network._id,
          networkId: network.networkId,
          name: network.name,
          code: network.code,
        },
        cryptoAmount: data.cryptoAmount,
        fiatAmount,
        exchangeRate,
        serviceFee,
        totalAmount,
        tradeType: data.tradeType,
        serviceCharge: chargeCalculation.serviceCharge,
      };
    }
  }

  async calculateBreakdownAutomated(data: {
    cryptoId: string;
    usdAmount: number;
    tradeType: "buy" | "sell";
    networkId: string;
  }) {
    const crypto = await this.cryptoUtilityService.getCryptoById(data.cryptoId);
    const network = await this.cryptoUtilityService.getNetwork(
      data.cryptoId,
      data.networkId,
    );

    let usdToNgnRate: number;

    const cryptoRate =
      data.tradeType === "buy" ? crypto.buyRate : crypto.sellRate;

    if (cryptoRate) {
      usdToNgnRate = cryptoRate;
    } else {
      const rateConfig =
        await this.providerRateConfigRepository.findByProviderCode(
          "nowpayment",
        );

      if (!rateConfig) {
        throw new AppError(
          "Exchange rate config not found for this provider",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      usdToNgnRate =
        data.tradeType === "buy" ? rateConfig.buyRate : rateConfig.sellRate;
    }

    const fiatAmount = data.usdAmount * usdToNgnRate;

    const txType =
      data.tradeType === "buy"
        ? TRANSACTION_TYPES.CRYPTO_PURCHASE
        : TRANSACTION_TYPES.CRYPTO_SALE;

    const chargeCalculation =
      await this.helperService.calculateAmountWithCharge(fiatAmount, txType);

    const serviceFee = chargeCalculation.chargeAmount;
    const serviceFeeUsd = serviceFee / usdToNgnRate;
    const totalAmount =
      data.tradeType === "buy"
        ? fiatAmount + serviceFee
        : fiatAmount - serviceFee;

    // Build depositInstructions conditionally, then return once for both trade types
    const depositInstructions =
      data.tradeType === "sell"
        ? {
            address: network.platformDepositAddress,
            network: network.name,
            confirmationsRequired: network.confirmationsRequired,
            explorerUrl: network.explorerUrl,
          }
        : null;

    return {
      crypto: {
        id: crypto._id,
        name: crypto.name,
        code: crypto.code,
        icon: crypto.icon,
      },
      network: {
        id: network._id,
        networkId: network.networkId,
        name: network.name,
        code: network.code,
      },
      usdAmount: data.usdAmount,
      cryptoAmount: data.usdAmount,
      fiatAmount,
      serviceFee,
      serviceFeeUsd: serviceFeeUsd,
      totalAmount,
      tradeType: data.tradeType,
      exchangeRate: usdToNgnRate,
      serviceCharge: chargeCalculation.serviceCharge,
      depositInstructions,
    };
  }

  // Calculate breakdown with Tatum live rates
  async calculateBreakdownWithTatum(data: {
    cryptoId: string;
    usdAmount: number;
    tradeType: "buy" | "sell";
    networkId: string;
    userId?: string;
  }): Promise<any> {
    const crypto = await this.cryptoRepository.findById(data.cryptoId);
    const network = await this.networkRepository.findById(data.networkId);

    if (!crypto || !network) {
      throw new AppError(
        "Crypto or network not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    let usdRate: number;
    try {
      usdRate = await this.tatumService.getExchangeRate({
        symbol: crypto.code,
        basePair: "USD",
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error("CryptoBreakdownService: getExchangeRate failed", error);
      throw new AppError(
        "Unable to fetch exchange rate. Please try again later.",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }

    // Get USD to NGN rate (use correct direction)
    const usdToNgnRate =
      data.tradeType === "buy"
        ? crypto.sellRate ||
          (await this.providerRateConfigRepository.findByProviderCode("tatum"))
            ?.sellRate
        : crypto.buyRate ||
          (await this.providerRateConfigRepository.findByProviderCode("tatum"))
            ?.buyRate;

    if (!usdToNgnRate) {
      throw new AppError(
        "Something went wrong while calculating the breakdown. Please try again later.",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }

    let cryptoAmount = 0;
    let fiatAmountUSD = 0;
    let fiatAmount = 0;

    fiatAmountUSD = data.usdAmount;
    cryptoAmount = fiatAmountUSD / usdRate;

    cryptoAmount = Math.round(cryptoAmount * 100000000) / 100000000;

    fiatAmount = fiatAmountUSD * usdToNgnRate;

    const txType =
      data.tradeType === "buy"
        ? TRANSACTION_TYPES.CRYPTO_PURCHASE
        : TRANSACTION_TYPES.CRYPTO_SALE;

    const chargeCalculation =
      await this.helperService.calculateAmountWithCharge(fiatAmount, txType);

    const serviceFee = chargeCalculation.chargeAmount;
    const totalAmount =
      data.tradeType === "buy"
        ? fiatAmount + serviceFee
        : fiatAmount - serviceFee;

    // Build depositInstructions conditionally, then return once for both trade types
    // Build depositInstructions conditionally, then return once for both trade types
    let depositInstructions: any = null;
    if (data.tradeType === "sell") {
      if (data.userId) {
        const { address } = await this.createUserDepositAddress(
          data.userId,
          data.networkId,
        );
        depositInstructions = {
          address,
          network: network.name,
          confirmationsRequired: network.confirmationsRequired,
          explorerUrl: network.explorerUrl,
        };
      } else {
        // No authenticated user on this call — never fall back to the
        // shared platform wallet, just omit the address.
        depositInstructions = {
          address: null,
          network: network.name,
          confirmationsRequired: network.confirmationsRequired,
          explorerUrl: network.explorerUrl,
        };
      }
    }

    // Calculate USD equivalent of service fee
    const serviceFeeUsd = serviceFee / usdToNgnRate;

    return {
      crypto: {
        id: crypto._id,
        name: crypto.name,
        code: crypto.code,
        icon: crypto.icon,
      },
      network: {
        id: network._id,
        networkId: network.networkId,
        name: network.name,
        code: network.code,
      },
      cryptoAmount,
      usdAmount: fiatAmountUSD,
      tradeType: data.tradeType,
      fiatAmount,
      serviceFee,
      serviceFeeUsd,
      totalAmount,
      exchangeRate: usdRate,
      serviceCharge: chargeCalculation.serviceCharge,
      depositInstructions,
    };
  }

  async calculateBreakdownWithBreet(data: {
    cryptoId: string;
    usdAmount: number;
    tradeType: "buy" | "sell";
    networkId: string;
  }): Promise<any> {
    // Get crypto
    const crypto = await this.cryptoRepository.findById(data.cryptoId);
    const network = await this.cryptoUtilityService.getNetwork(
      data.cryptoId,
      data.networkId,
    );

    if (!crypto || !network) {
      throw new AppError(
        "Crypto or network not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    // Get Breet rate
    // Get Breet rate
    // In CryptoBreakdownService.calculateBreakdownWithBreet
    let breetRate: any;
    try {
      breetRate = await this.breetService.calculateRate({
        assetId: network.breetAssetId as string,
        amountInUSD: data.usdAmount,
        currency: "ngn",
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error("CryptoBreakdownService: Breet calculateRate failed", error);
      throw new AppError(
        "Unable to fetch exchange rate. Please try again later.",
        HTTP_STATUS.BAD_GATEWAY,
        ERROR_CODES.PROVIDER_ERROR,
      );
    }

    logger.info("Breet calculateRate params", {
      cryptoBreetAssetId: crypto?.breetAssetId,
      networkBreetAssetId: network?.breetAssetId,
      usdAmount: data.usdAmount,
    });

    const fiatAmountNGN = breetRate.NGNAmount;

    // Calculate charge based on BUY or SELL
    const txType =
      data.tradeType === "buy"
        ? TRANSACTION_TYPES.CRYPTO_PURCHASE
        : TRANSACTION_TYPES.CRYPTO_SALE;

    const chargeCalculation =
      await this.helperService.calculateAmountWithCharge(fiatAmountNGN, txType);

    const usdToNgnRate =
      data.tradeType === "buy"
        ? crypto.sellRate ||
          (await this.providerRateConfigRepository.findByProviderCode("tatum"))
            ?.sellRate
        : crypto.buyRate ||
          (await this.providerRateConfigRepository.findByProviderCode("tatum"))
            ?.buyRate;

    if (!usdToNgnRate) {
      throw new AppError(
        "Something went wrong while calculating the breakdown. Please try again later.",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const serviceFee = chargeCalculation.chargeAmount;
    // Calculate USD equivalent
    const serviceFeeUsd = serviceFee / usdToNgnRate;

    let totalAmount: number;
    if (data.tradeType === "buy") {
      totalAmount = fiatAmountNGN + serviceFee; // User pays more
    } else {
      totalAmount = fiatAmountNGN - serviceFee; // User receives less
    }

    return {
      crypto: {
        id: crypto._id,
        name: crypto.name,
        code: crypto.code,
        icon: crypto.icon,
      },
      network: {
        id: network._id,
        networkId: network.networkId,
        name: network.name,
        code: network.code,
      },
      cryptoAmount: breetRate.cryptoAmount,
      fiatAmount: fiatAmountNGN,
      exchangeRate: breetRate.rate,
      serviceFee,
      serviceFeeUsd: serviceFeeUsd,
      totalAmount,
      tradeType: data.tradeType,
      serviceCharge: chargeCalculation.serviceCharge,
    };
  }
}
