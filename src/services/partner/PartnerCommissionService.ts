import logger from "@/logger";
import { CacheService } from "@/services/core/CacheService";
import { PartnerCommissionRepository } from "@/repositories/partner/PartnerCommissionRepository";
import { IPartnerCommission } from "@/models/partner/PartnerCommission";
import { Types } from "mongoose";
import { CACHE_TTL } from "@/utils/constants";

// Cache key mirrors the auto discount pattern: partner:commission:{providerId}:{serviceId}
const cacheKey = (providerId: string, serviceId: string) =>
  `partner:commission:${providerId}:${serviceId}`;

export class PartnerCommissionService {
  constructor(
    private commissionRepository: PartnerCommissionRepository,
    private cacheService: CacheService,
  ) {}


// Returns the partner commission shaped exactly like IDiscount
// so helperService.applyDiscount() consumes it unchanged.
// Returns null if no active commission → partner pays full base price.
  
  async getPartnerDiscountCached(
    serviceId: string | Types.ObjectId,
    providerId: string | Types.ObjectId,
  ): Promise<IPartnerCommission | null> {
    try {
      const key = cacheKey(providerId.toString(), serviceId.toString());

      const cached = await this.cacheService.get<IPartnerCommission>(key);
      if (cached) return cached;

      const commission =
        await this.commissionRepository.findByServiceAndProvider(
          serviceId,
          providerId,
        );

      if (commission) {
        this.cacheService
          .set(key, commission, CACHE_TTL.ONE_DAY)
          .catch((err) =>
            logger.error("Failed to cache partner commission:", err),
          );
      }

      return commission ?? null;
    } catch (err) {
      logger.error("getPartnerDiscountCached failed", err);
      return null;
    }
  }

  async bulkUpdateCommissions(ids: string[], data: any) {
    const { providerId, serviceId, ...safeData } = data;
    const commissions = await this.commissionRepository.find({
      _id: { $in: ids },
    } as any);
    if (commissions.length === 0)
      throw new Error("No matching commissions found");

    const result = await this.commissionRepository.bulkUpdate(ids, safeData);

    const seen = new Set<string>();
    for (const commission of commissions) {
      const key = `${commission.providerId}:${commission.serviceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await this.invalidateCache(
        commission.serviceId.toString(),
        commission.providerId.toString(),
      );
    }

    return {
      message: `${result.modifiedCount} of ${ids.length} commissions updated successfully`,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  }

  private async invalidateCache(
    serviceId: string,
    providerId: string,
  ): Promise<void> {
    await this.cacheService
      .delete(cacheKey(providerId, serviceId))
      .catch((err) =>
        logger.error("Failed to invalidate partner commission cache:", err),
      );
  }

  async listCommissions(
    page = 1,
    limit = 50,
    providerId?: string,
    serviceId?: string,
    status?: string,
    code?: string,
  ) {
    const query: any = {};

    if (serviceId) {
      query.serviceId = serviceId;
    }

    if (status !== undefined) {
      query.active = status === "active";
    }

    if (providerId) {
      query.providerId = providerId;
    }

    if (code) {
      query.code = { $regex: code, $options: "i" };
    }

    const result = await this.commissionRepository.findWithPagination(
      query,
      page,
      limit,
    );

    return {
      data: result.data,
      total: result.total,
    };
  }

  async upsertCommission(data: {
    providerId: string;
    serviceId: string;
    name: string;
    type: "flat" | "percentage";
    value: number;
    active?: boolean;
  }): Promise<IPartnerCommission> {
    const commission =
      await this.commissionRepository.upsertByProviderAndService(
        data.providerId,
        data.serviceId,
        {
          name: data.name,
          type: data.type,
          value: data.value,
          active: data.active ?? true,
        },
      );

    await this.invalidateCache(data.serviceId, data.providerId);
    return commission;
  }

  async toggleCommission(
    id: string,
    active: boolean,
  ): Promise<IPartnerCommission | null> {
    const commission = await this.commissionRepository.update(id, { active });
    if (commission) {
      await this.invalidateCache(
        commission.serviceId.toString(),
        commission.providerId.toString(),
      );
    }
    return commission;
  }

  async getCommissionById(id: string): Promise<IPartnerCommission | null> {
    return this.commissionRepository.findById(id);
  }

  async setCommissionActiveByProviderAndService(
  providerId: string,
  serviceId: string,
  active: boolean,
) {
  const commission = await this.commissionRepository.setActiveByProviderAndService(
    providerId,
    serviceId,
    active,
  );
  if (commission) {
    await this.invalidateCache(serviceId, providerId);
  }
  return commission;
}
}
