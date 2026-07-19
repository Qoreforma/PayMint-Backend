import { AppError } from "@/middlewares/shared/errorHandler";
import { Crypto } from "@/models/crypto/Crypto";
import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Types } from "mongoose";

export interface CreateNetworkDTO {
  networkId: string;
  name: string;
  code: string;
  confirmationsRequired?: number;
  addressPattern?: string;
  explorerUrl?: string;
  platformDepositAddress?: string;
  isActive?: boolean;
  priority?: number;
  description?: string;
}

export interface UpdateNetworkDTO {
  name?: string;
  code?: string;
  confirmationsRequired?: number;
  addressPattern?: string;
  explorerUrl?: string;
  platformDepositAddress?: string;
  isActive?: boolean;
  priority?: number;
  description?: string;
}

export interface BulkUpdateStatusDTO {
  ids: string[];
  isActive: boolean;
}

export interface BulkDeleteDTO {
  ids: string[];
}

export class NetworkService {
  constructor(
    private networkRepository: NetworkRepository,
    private cryptoRepository: CryptoRepository,
  ) {}

  async listNetworks(
    page: number = 1,
    limit: number = 10,
    isActive?: string,
    search?: string,
    providerId?: string,
    adminPermissions?: string[],
  ): Promise<any> {
    const filter: any = { deletedAt: null };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
        { networkId: { $regex: search, $options: "i" } },
      ];
    }

    if (isActive !== undefined) {
      filter.isActive = isActive === "true";
    }

    if (providerId) {
      filter.providerId = new Types.ObjectId(providerId);
    } else {
      filter.providerId = { $exists: false };
    }

    if (adminPermissions && !adminPermissions.includes("*")) {
      const scopedNetworkIds = new Set<string>();

      adminPermissions.forEach((permission) => {
        if (
          permission.startsWith(
            `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY}.network:`,
          )
        ) {
          scopedNetworkIds.add(
            permission.split(
              `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY}.network:`,
            )[1],
          );
        }
        if (
          permission.startsWith(
            `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL}.network:`,
          )
        ) {
          scopedNetworkIds.add(
            permission.split(
              `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL}.network:`,
            )[1],
          );
        }
      });

      if (scopedNetworkIds.size === 0) {
        return { data: [], total: 0 };
      }
      // Case-insensitive match — works whether DB stores "tron", "TRON", or "Tron"
      filter.networkId = {
        $in: Array.from(scopedNetworkIds).map(
          (id) => new RegExp(`^${id}$`, "i"),
        ),
      };
    }


    const { data, total } = await this.networkRepository.findWithPagination(
      filter,
      page,
      limit,
      { name: 1 },
    );

    const dataWithCount = await Promise.all(
      data.map(async (network) => {
        const cryptoCount = await Crypto.countDocuments({
          networks: network._id,
          deletedAt: null,
        });

        return {
          ...network.toObject(),
          cryptoCount: cryptoCount || 0,
        };
      }),
    );

    return { data: dataWithCount, total };
  }

  async createNetwork(dto: CreateNetworkDTO): Promise<any> {
    // Check if network with same networkId already exists
    const existingNetwork = await this.networkRepository.findByNetworkId(
      dto.networkId,
    );

    if (existingNetwork) {
      throw new AppError(
        "Network with this ID already exists",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.DUPLICATE_ENTRY,
      );
    }

    const networkData = {
      networkId: dto.networkId,
      name: dto.name,
      code: dto.code.toUpperCase(),
      confirmationsRequired: dto.confirmationsRequired ?? 6,
      addressPattern: dto.addressPattern,
      explorerUrl: dto.explorerUrl,
      platformDepositAddress: dto.platformDepositAddress,
      isActive: dto.isActive ?? true,
      priority: dto.priority ?? 0,
      description: dto.description,
    };

    const network = await this.networkRepository.create(networkData);
    return network;
  }

  async getNetworkById(id: string): Promise<any> {
    const network = await this.networkRepository.findById(id);

    if (!network || network.deletedAt) {
      throw new AppError(
        "Network not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return network;
  }

  async updateNetwork(id: string, dto: UpdateNetworkDTO): Promise<any> {
    const network = await this.networkRepository.findById(id);

    if (!network || network.deletedAt) {
      throw new AppError(
        "Network not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const updatedNetwork = await this.networkRepository.update(id, dto);
    return updatedNetwork;
  }

  async deleteNetwork(id: string): Promise<void> {
    const network = await this.networkRepository.findById(id);

    if (!network || network.deletedAt) {
      throw new AppError(
        "Network not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const usageCount = await this.checkNetworkUsage(id);

    if (usageCount > 0) {
      throw new AppError(
        `Cannot delete network. This network is being used by ${usageCount} crypto(s)`,
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.RESOURCE_IN_USE,
      );
    }
    await this.networkRepository.softDelete(id);
  }

  async updateStatus(id: string, isActive: boolean): Promise<any> {
    const network = await this.networkRepository.findById(id);

    if (!network || network.deletedAt) {
      throw new AppError(
        "Network not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const updatedNetwork = await this.networkRepository.update(id, {
      isActive,
    });
    return updatedNetwork;
  }

  async bulkUpdateStatus(dto: BulkUpdateStatusDTO): Promise<any> {
    if (!dto.ids || dto.ids.length === 0) {
      throw new AppError(
        "No network IDs provided",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const result = await this.networkRepository.bulkUpdateStatus(
      dto.ids,
      dto.isActive,
    );

    return {
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} network(s) updated successfully`,
    };
  }

  async bulkDelete(dto: BulkDeleteDTO): Promise<any> {
    if (!dto.ids || dto.ids.length === 0) {
      throw new AppError(
        "No network IDs provided",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // Check if any networks are being used by cryptos
    const usageInfo = await this.checkBulkNetworkUsage(dto.ids);

    if (usageInfo.inUse) {
      const details = usageInfo.usageDetails
        .map((u) => `${u.networkId} (${u.cryptoCount} crypto(s))`)
        .join(", ");

      throw new AppError(
        `Cannot delete networks. Found ${usageInfo.affectedCount} network(s) in use: ${details}`,
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.RESOURCE_IN_USE,
      );
    }

    const result = await this.networkRepository.bulkSoftDelete(dto.ids);

    return {
      deletedCount: result.modifiedCount,
      message: `${result.modifiedCount} network(s) deleted successfully`,
    };
  }

  private async checkBulkNetworkUsage(networkIds: string[]): Promise<{
    inUse: boolean;
    affectedCount: number;
    usageDetails: Array<{ networkId: string; cryptoCount: number }>;
  }> {
    const objectIds = networkIds.map((id) => new Types.ObjectId(id));

    const usageDetails: Array<{ networkId: string; cryptoCount: number }> = [];
    let totalInUse = 0;

    for (const networkId of networkIds) {
      const cryptosUsingNetwork =
        await this.cryptoRepository.findByNetworkId(networkId);

      if (cryptosUsingNetwork.length > 0) {
        usageDetails.push({
          networkId,
          cryptoCount: cryptosUsingNetwork.length,
        });
        totalInUse++;
      }
    }

    return {
      inUse: totalInUse > 0,
      affectedCount: totalInUse,
      usageDetails,
    };
  }

  private async checkNetworkUsage(networkId: string): Promise<number> {
    const cryptosUsingNetwork =
      await this.cryptoRepository.findByNetworkId(networkId);
    return cryptosUsingNetwork.length;
  }
}
