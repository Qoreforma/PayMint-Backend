import { UserRepository } from "@/repositories/client/UserRepository";
import { ChannelIdentityRepository } from "@/repositories/client/ChannelIdentityRepository";
import { OTPService } from "@/services/core/OTPService";
import { SMSService } from "@/services/core/SMSService";
import { CacheService } from "@/services/core/CacheService";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, CACHE_TTL } from "@/utils/constants";
import { ChatChannel } from "@/types/chat";

export class ChannelLinkService {
  constructor(
    private userRepository: UserRepository,
    private channelIdentityRepository: ChannelIdentityRepository,
    private otpService: OTPService,
    private smsService: SMSService,
    private cacheService: CacheService,
  ) {}

  async findLinkedUserId(channel: ChatChannel, externalId: string): Promise<string | null> {
    const identity = await this.channelIdentityRepository.findByChannelAndExternalId(channel, externalId);
    return identity ? identity.userId.toString() : null;
  }

  async requestLink(phone: string, channel: ChatChannel, externalId: string): Promise<{ userId: string }> {
    const rateLimitKey = `chat:ratelimit:link:${channel}:${externalId}`;
    const attempts = await this.cacheService.increment(rateLimitKey, CACHE_TTL.ONE_HOUR);
    if (attempts > 3) {
      throw new AppError(
        "Too many requests. Please try again later.",
        HTTP_STATUS.TOO_MANY_REQUESTS,
        ERROR_CODES.RATE_LIMIT_EXCEEDED,
      );
    }

    const user = await this.userRepository.findByPhone(phone);
    if (!user) {
      throw new AppError(
        "No account found with that phone number",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND,
      );
    }

    const otp = await this.otpService.generateAndStore(user.id.toString(), "phone_verification");

    await this.smsService.sendSMS({
      to: phone,
      message: `Your linking code is ${otp}. Reply with this code in the chat to link your account.`,
    });

    return { userId: user.id.toString() };
  }

  async confirmLink(channel: ChatChannel, externalId: string, userId: string, otp: string): Promise<boolean> {
    const isValid = await this.otpService.verify(userId, "phone_verification", otp);
    if (!isValid) return false;

    await this.channelIdentityRepository.link(channel, externalId, userId);
    return true;
  }
}
