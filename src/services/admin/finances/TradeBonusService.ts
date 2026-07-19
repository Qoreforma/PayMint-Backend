import { TradeBonusRepository } from "@/repositories/admin/TradeBonusRepository";
import { CacheService } from "@/services/core/CacheService";
import { ITradeBonus } from "@/models/billing/bonuses/TradeBonus";
import { CACHE_KEYS, CACHE_TTL } from "@/utils/constants";
import logger from "@/logger";

export class TradeBonusService {
  constructor(
    private tradeBonusRepository: TradeBonusRepository,
    private cacheService: CacheService
  ) {}

  async createTradeBonus(data: Partial<ITradeBonus>): Promise<ITradeBonus> {
    const bonus = await this.tradeBonusRepository.create(data);
    await this.invalidateCache();
    logger.info(`Trade bonus created: ${bonus.name}`);
    return bonus;
  }

  async updateTradeBonus(
    id: string,
    data: Partial<ITradeBonus>
  ): Promise<ITradeBonus | null> {
    const bonus = await this.tradeBonusRepository.update(id, data);
    await this.invalidateCache();
    logger.info(`Trade bonus updated: ${bonus?.name}`);
    return bonus;
  }

  async deleteTradeBonus(id: string): Promise<void> {
    await this.tradeBonusRepository.delete(id);
    await this.invalidateCache();
    logger.info(`Trade bonus deleted: ${id}`);
  }

  async getBonuses(): Promise<ITradeBonus[]> {
    const cacheKey = CACHE_KEYS.ACTIVE_BONUSES;

    const cached = await this.cacheService.get(cacheKey);
    if (cached) return cached as ITradeBonus[];

    const bonuses = await this.tradeBonusRepository.getBonuses();

    if (bonuses) {
      await this.cacheService.set(cacheKey, bonuses, CACHE_TTL.TRADE_BONUS);
    }

    return bonuses;
  }

  async getBonusById(id: string): Promise<ITradeBonus | null> {
    const cacheKey = CACHE_KEYS.BONUS_BY_ID(id);

    const cached = await this.cacheService.get(cacheKey);
    if (cached) return cached as ITradeBonus;

    const bonus = await this.tradeBonusRepository.findById(id);

    if (bonus) {
      await this.cacheService.set(cacheKey, bonus, CACHE_TTL.TRADE_BONUS);
    }

    return bonus;
  }

  private async invalidateCache(): Promise<void> {
    await this.cacheService.delete(CACHE_KEYS.ACTIVE_BONUSES);
    await this.cacheService.deletePattern("trade-bonus:*");
  }
}
