import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";
import { TatumService } from "@/services/client/providers/crypto/TatumService";
import { OTPService } from "@/services/core/OTPService";
import { EmailService } from "@/services/core/EmailService";
import { CryptoUtilityService } from "@/services/client/crypto/CryptoUtilityService";
import { registerKmsTransaction } from "@/routes/client/tatum";
import logger from "@/logger";

export class AdminWalletService {
  constructor(
    private networkRepository: NetworkRepository,
    private tatumService: TatumService,
    private otpService: OTPService,
    private emailService: EmailService,
    private cryptoUtilityService: CryptoUtilityService,
  ) {}

  async getMasterWalletBalances() {
    const networks = await this.networkRepository.findActive();

    return Promise.all(
      networks
        .filter((n) => n.platformDepositAddress)
        .map(async (n) => {
          try {
            const balance = await this.tatumService.getMasterWalletBalance(
              n.code,
              n.networkPath,
              n.platformDepositAddress as string,
            );
            return {
              networkId: n._id,
              name: n.name,
              code: n.code,
              chainType: n.chainType,
              address: n.platformDepositAddress,
              balance,
            };
          } catch (error) {
            logger.error(`AdminWalletService: balance fetch failed for ${n.code}`, error);
            return {
              networkId: n._id,
              name: n.name,
              code: n.code,
              chainType: n.chainType,
              address: n.platformDepositAddress,
              balance: null,
              error: "Unable to fetch balance",
            };
          }
        }),
    );
  }

  async requestTransferOtp(adminId: string, email: string, fullName: string) {
    const otp = await this.otpService.generateAndStore(adminId, "wallet_transfer");
    await this.emailService.send2FAEmail(email, otp, fullName);
  }

  async transfer(params: {
    adminId: string;
    networkId: string;
    toAddress: string;
    amount: string;
    otp: string;
  }) {
    const verified = await this.otpService.verify(
      params.adminId,
      "wallet_transfer",
      params.otp,
    );
    if (!verified) {
      throw new AppError(
        "Invalid or expired verification code",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    const network = await this.networkRepository.findById(params.networkId);
    if (!network || !network.platformDepositAddress) {
      throw new AppError(
        "Network not found or has no master wallet configured",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    if (!this.cryptoUtilityService.validateAddress(params.toAddress, network)) {
      throw new AppError(
        "Destination address is not valid for this network",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const signatureId = this.tatumService.getKmsSignatureIdForChain(network.chainType);

    const { txHash, tatumPendingId } = await this.tatumService.sendCryptoFromMasterWallet({
      fromAddress: network.platformDepositAddress,
      to: params.toAddress,
      amount: params.amount,
      currency: network.code,
      signatureId,
      chainType: network.chainType,
      networkPath: network.networkPath,
    });

    if (tatumPendingId) {
      await registerKmsTransaction(tatumPendingId);
    }

    return { txHash };
  }
}