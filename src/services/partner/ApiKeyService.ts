import * as crypto from "crypto";
import * as bcrypt from "bcryptjs";
import { ApiKeyRepository } from "@/repositories/partner/ApiKeyRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Types } from "mongoose";
import logger from "@/logger";
import { IApiKey } from "@/models/partner/ApiKey";
import { encryptApiSecret, hashApiKey } from "@/utils/cryptography";

export class ApiKeyService {
  constructor(private apiKeyRepository: ApiKeyRepository) {}

  // Generate new API key pair
  async generateApiKey(
    userId: string | Types.ObjectId,
    keyName: string,
  ): Promise<{ apiKey: string; apiSecret: string; id: string }> {
    // Generate a fresh key pair every call — this doubles as the rotate path.
    const apiKey = `sk_live_${crypto.randomBytes(32).toString("hex")}`;
    const apiSecret = crypto.randomBytes(64).toString("hex");

    const apiKeyLookupHash = hashApiKey(apiKey);
    const encryptedSecret = encryptApiSecret(apiSecret);

    const existingKey = await this.apiKeyRepository.findByUserId(userId);

    const savedKey = existingKey
      ? await this.apiKeyRepository.update(existingKey._id.toString(), {
          name: keyName,
          apiKeyHash: apiKeyLookupHash,
          apiSecret: encryptedSecret,
          isActive: true,
        })
      : await this.apiKeyRepository.create({
          userId: new Types.ObjectId(userId),
          name: keyName,
          apiKeyHash: apiKeyLookupHash,
          apiSecret: encryptedSecret,
          isActive: true,
        });

    logger.info(
      existingKey
        ? `API key rotated for user ${userId}`
        : `API key generated for user ${userId}`,
    );

    // Return unhashed/unencrypted versions (only shown once)
    return {
      id: savedKey!._id.toString(),
      apiKey,
      apiSecret,
    };
  }

  // Verify API key and get user
  async verifyApiKey(apiKey: string): Promise<{
    userId: string;
    keyId: string;
    user: any;
  }> {
    const key = await this.apiKeyRepository.findByApiKey(apiKey);

    if (!key) {
      throw new AppError(
        "Invalid API key",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // Verify the user is a partner
    const user = (await key.populate("userId")) as any;

    if (!user.userId.partner?.isPartner) {
      throw new AppError("User is not a partner", HTTP_STATUS.FORBIDDEN);
    }

    if (user.userId.partner?.status !== "active") {
      throw new AppError(
        "Partner account is not active",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.INVALID_STATUS,
      );
    }

    return {
      userId: key.userId._id.toString(),
      keyId: key._id.toString(),
      user: user.userId,
    };
  }

  // Verify HMAC signature
  // Verify HMAC signature
  async verifySignature(
    apiSecret: string,
    message: string,
    signature: string,
  ): Promise<boolean> {
    const expectedSignature = crypto
      .createHmac("sha256", apiSecret)
      .update(message)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    const providedBuffer = Buffer.from(signature, "hex");

    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  }

  // Get partner's API keys
  async getUserKeys(userId: string | Types.ObjectId): Promise<any> {
    const key = await this.apiKeyRepository.findByUserId(userId);
    return key;
  }

  // Deactivate key
  async deactivateKey(keyId: string | Types.ObjectId): Promise<void> {
    await this.apiKeyRepository.deactivate(keyId);
    logger.info(`API key deactivated: ${keyId}`);
  }

  // Delete key (soft delete)
  async deleteKey(keyId: string): Promise<void> {
    await this.apiKeyRepository.softDelete(keyId);
    logger.info(`API key deleted: ${keyId}`);
  }
}
