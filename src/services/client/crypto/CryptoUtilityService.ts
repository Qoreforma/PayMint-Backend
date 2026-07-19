import { AppError } from "@/middlewares/shared/errorHandler";
import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Types } from "mongoose";

export class CryptoUtilityService {
  constructor(
    private cryptoRepository: CryptoRepository,
    private networkRepository: NetworkRepository,
  ) {}

  async getCryptoById(cryptoId: string) {
    const crypto = await this.cryptoRepository.findById(cryptoId);
    if (!crypto || crypto.deletedAt) {
      throw new AppError(
        "Crypto not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }
    return crypto;
  }
  async getNetwork(cryptoId: string, networkId: string) {
    const crypto = await this.cryptoRepository.findById(cryptoId);

    if (!crypto || crypto.deletedAt) {
      throw new AppError(
        "Crypto asset not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    const networkObjectId = new Types.ObjectId(networkId);

    const isNetworkAssociated = crypto.networks.some((id) =>
      id.equals(networkObjectId),
    );

    if (!isNetworkAssociated) {
      throw new AppError(
        `The selected network is not supported for ${crypto.code}`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const network = await this.networkRepository.findById(networkId);

    if (!network || network.deletedAt || !network.isActive) {
      throw new AppError(
        "The selected network is currently unavailable",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    return network;
  }

  validateAddress(address: string, network: any): boolean {
    if (!address || address.trim().length === 0) return false;
    const trimmed = address.trim();
    if (network.addressPattern) {
      const regex = new RegExp(network.addressPattern);
      return regex.test(trimmed);
    }
    return true;
  }
  validateWalletAddress(address: string, network: any) {
    if (!address || address.trim().length === 0) {
      throw new AppError(
        "Wallet address is required",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const trimmedAddress = address.trim();
    if (network.addressPattern) {
      const regex = new RegExp(network.addressPattern);
      if (!regex.test(trimmedAddress)) {
        throw new AppError(
          `Invalid wallet address format for ${network.name}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
    }

    return trimmedAddress;
  }

  sanitizeCryptoTransaction(transaction: any) {
    return {
      id: transaction._id || transaction.id,
      reference: transaction.reference,
      tradeType: transaction.tradeType,
      network: transaction.network,
      walletAddress: transaction.walletAddress,
      cryptoAmount: transaction.cryptoAmount,
      fiatAmount: transaction.fiatAmount,
      exchangeRate: transaction.exchangeRate,
      serviceFee: transaction.serviceFee,
      totalAmount: transaction.totalAmount,
      status: transaction.status,
      txHash: transaction.txHash,
      confirmations: transaction.confirmations,
      blockNumber: transaction.blockNumber,
      comment: transaction.comment,
      proof: transaction.proof,
      reviewNote: transaction.reviewNote,
      ...(transaction.accountNumber && {
        bankDetails: {
          accountName: transaction.accountName,
          accountNumber: transaction.accountNumber,
          bankCode: transaction.bankCode,
        },
      }),
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      processedAt: transaction.processedAt,
      completedAt: transaction.completedAt,
    };
  }
}
