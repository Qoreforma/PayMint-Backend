import { ProviderRepository } from "@/repositories/shared/ProviderRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { ProviderRateConfigRepository } from "@/repositories/admin/Providerrateconfigrepository";

export class ProviderRateConfigService {
  constructor(
    private providerRateConfigRepository: ProviderRateConfigRepository,
    private providerRepository: ProviderRepository
  ) {}

  async listAll() {
    return this.providerRateConfigRepository.findAllActive();
  }

  async getByProviderCode(providerCode: string) {
    const config =
      await this.providerRateConfigRepository.findByProviderCode(providerCode);

    if (!config) {
      throw new AppError(
        `Rate config not found for provider: ${providerCode}`,
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }

    return config;
  }

  async upsert(
    data: {
      providerId: string;
      buyRate: number;
      sellRate: number;
      isActive?: boolean;
    },
    adminId: string
  ) {
    // Validate provider exists
    const provider = await this.providerRepository.findById(data.providerId);
    if (!provider) {
      throw new AppError(
        "Provider not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }

    // Validate rates
    if (data.buyRate < 0 || data.sellRate < 0) {
      throw new AppError(
        "Buy rate and sell rate must be non-negative",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    return this.providerRateConfigRepository.upsertByProviderId(
      data.providerId,
      {
        providerId: data.providerId as any,
        providerCode: provider.code,
        serviceType: "crypto",
        buyRate: data.buyRate,
        sellRate: data.sellRate,
        isActive: data.isActive ?? true,
        updatedBy: adminId as any,
      }
    );
  }

  async updateRates(
    providerId: string,
    rates: { buyRate?: number; sellRate?: number },
    adminId: string
  ) {
    const existing =
      await this.providerRateConfigRepository.findByProviderId(providerId);

    if (!existing) {
      throw new AppError(
        "Rate config not found for this provider",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }

    return this.providerRateConfigRepository.update(String(existing._id), {
      ...rates,
      updatedBy: adminId,
    });
  }

  async toggleActive(providerId: string, isActive: boolean, adminId: string) {
    const existing =
      await this.providerRateConfigRepository.findByProviderId(providerId);

    if (!existing) {
      throw new AppError(
        "Rate config not found for this provider",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND
      );
    }

    return this.providerRateConfigRepository.update(String(existing._id), {
      isActive,
      updatedBy: adminId,
    });
  }
}