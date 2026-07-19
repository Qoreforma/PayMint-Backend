import { CacheService } from "@/services/core/CacheService";
import { CACHE_KEYS, CACHE_TTL } from "@/utils/constants";
import { ChatSessionState, ChatChannel } from "@/types/chat";

const SESSION_TTL = CACHE_TTL.FIFTEEN_MINUTES;

export class ChatSessionService {
  constructor(private cacheService: CacheService) {}

  async get(channel: ChatChannel, externalId: string): Promise<ChatSessionState> {
    const stored = await this.cacheService.get<ChatSessionState>(
      CACHE_KEYS.CHAT_SESSION(channel, externalId),
    );
    return stored || { step: "idle" };
  }

  async set(channel: ChatChannel, externalId: string, state: ChatSessionState): Promise<void> {
    await this.cacheService.set(CACHE_KEYS.CHAT_SESSION(channel, externalId), state, SESSION_TTL);
  }

  async clear(channel: ChatChannel, externalId: string): Promise<void> {
    await this.cacheService.delete(CACHE_KEYS.CHAT_SESSION(channel, externalId));
  }
}
