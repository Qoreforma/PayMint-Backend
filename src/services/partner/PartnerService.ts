import { UserRepository } from "@/repositories/client/UserRepository";
import { ApiKeyService } from "./ApiKeyService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import * as crypto from "crypto";
import logger from "@/logger";
import { Types } from "mongoose";
import { hashPassword } from "@/utils/cryptography";
import { WalletRepository } from "@/repositories/client/WalletRepository";
import { isSafeWebhookUrl } from "@/utils/validators";

export class PartnerService {
  constructor(
    private userRepository: UserRepository,
    private apiKeyService: ApiKeyService,
    private walletRepository: WalletRepository,
  ) {}

  // Self-register as partner
  async selfRegisterPartner(data: {
    firstname: string;
    lastname: string;
    email: string;
    password: string;
    phone: string;
    companyName: string;
    contactPerson: string;
  }): Promise<any> {
    // Check if email exists
    const existingUser = await this.userRepository.findByEmail(data.email);
    if (existingUser) {
      throw new AppError(
        "Email already registered",
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.DUPLICATE_ENTRY,
      );
    }

    // Generate webhook secret
    const webhookSecret = crypto.randomBytes(32).toString("hex");

    const hashedPassword = await hashPassword(data.password);

    // Create user with partner object
    const user = await this.userRepository.create({
      firstname: data.firstname,
      lastname: data.lastname,
      email: data.email,
      password: hashedPassword,
      phone: data.phone,
      status: "active",
      partner: {
        isPartner: true,
        status: "pending",
        companyName: data.companyName,
        contactPerson: data.contactPerson,
        webhookUrl: null,
        webhookSecret,
        createdAt: new Date(),
      },
    });

    logger.info(`Partner self-registered: ${user._id} - ${data.companyName}`);

    await this.walletRepository.create({
      userId: user._id as Types.ObjectId,
      type: "main",
      balance: 0,
    });

    return {
      id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      companyName: user.partner?.companyName,
      status: user.partner?.status,
    };
  }

  // Admin: Create or attach partner to user
  async attachPartnerToUser(
    userId: string,
    data: { companyName: string; contactPerson: string },
  ): Promise<any> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (user.partner?.isPartner) {
      throw new AppError(
        "User is already a partner",
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.DUPLICATE_ENTRY,
      );
    }

    // Generate webhook secret
    const webhookSecret = crypto.randomBytes(32).toString("hex");

    // Update user with partner object
    const updated = await this.userRepository.update(userId, {
      partner: {
        isPartner: true,
        status: "active", // Admin creates = auto-active
        companyName: data.companyName,
        contactPerson: data.contactPerson,
        webhookUrl: null,
        webhookSecret,
        createdAt: new Date(),
      },
    });

    logger.info(`Partner attached to user: ${userId} - ${data.companyName}`);

    return {
      id: updated?._id,
      companyName: updated?.partner?.companyName,
      status: updated?.partner?.status,
    };
  }

  // Approve pending partner
  async approvePartner(userId: string): Promise<any> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AppError(
        "User not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (!user.partner?.isPartner) {
      throw new AppError(
        "User is not a partner",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const updated = await this.userRepository.update(userId, {
      "partner.status": "active",
    });

    logger.info(`Partner approved: ${userId}`);

    return {
      status: "active",
    };
  }

  // Suspend partner
  async suspendPartner(userId: string): Promise<any> {
    await this.userRepository.update(userId, {
      "partner.status": "suspended",
    });

    logger.info(`Partner suspended: ${userId}`);

    return {
      status: "suspended",
    };
  }

  // Get partner details
  async getPartnerProfile(userId: string): Promise<any> {
    const user = await this.userRepository.findById(userId);

    if (!user || !user.partner?.isPartner) {
      throw new AppError(
        "Partner not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return {
      id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      phone: user.phone,
      partner: {
        companyName: user.partner.companyName,
        contactPerson: user.partner.contactPerson,
        status: user.partner.status,
        webhookUrl: user.partner.webhookUrl,
        createdAt: user.partner.createdAt,
      },
    };
  }

// Update partner webhook
  async updatePartnerWebhook(userId: string, webhookUrl: string): Promise<any> {
    if (!webhookUrl || !webhookUrl.startsWith("http")) {
      throw new AppError(
        "Invalid webhook URL",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (!(await isSafeWebhookUrl(webhookUrl))) {
      throw new AppError(
        "Webhook URL points to a private, local, or otherwise disallowed address",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const updated = await this.userRepository.update(userId, {
      "partner.webhookUrl": webhookUrl,
    });

    logger.info(`Partner webhook updated: ${userId}`);

    return {
      webhookUrl: updated?.partner?.webhookUrl,
    };
  }

  // Generate API key for partner
  async generateApiKey(userId: string): Promise<any> {
    const user = await this.userRepository.findById(userId);

    if (!user || !user.partner?.isPartner) {
      throw new AppError(
        "Partner not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }
    const keyName = `${user?.firstname.trim().toLowerCase()}_default_key`;

    if (user.partner.status !== "active") {
      throw new AppError(
        "Partner account is not active",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.INVALID_STATUS,
      );
    }

    const keys = await this.apiKeyService.generateApiKey(userId, keyName);

    logger.info(`API key generated for partner: ${userId}`);

    return keys;
  }
}
