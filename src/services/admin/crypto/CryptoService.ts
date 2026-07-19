import { CryptoRepository } from "@/repositories/client/CryptoRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Types } from "mongoose";
import { NetworkRepository } from "@/repositories/shared/NetworkRepository";
import { CryptoTransactionRepository } from "@/repositories/client/CryptoTransactionRepository";
import { Provider } from "@/models/reference/Provider";
import { ServiceType } from "@/models/reference/ServiceType";
import { Admin } from "@/models/admin/Admin";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { Crypto } from "@/models/crypto/Crypto";
export interface CreateCryptoDTO {
  providerId?: string;
  assetId?: string;
  name: string;
  code: string;
  icon?: string;
  description?: string;
  sellRate?: number;
  buyRate?: number;
  sellMinAmount?: number;
  sellMaxAmount?: number;
  buyMinAmount?: number;
  buyMaxAmount?: number;
  saleTerm?: string;
  purchaseTerm?: string;
  saleActivated?: boolean;
  purchaseActivated?: boolean;
  isActive?: boolean;
  networks?: string[]; // Array of network IDs
  priority?: number;
  tags?: string[];
}

export interface UpdateCryptoDTO {
  name?: string;
  icon?: string;
  description?: string;
  sellRate?: number;
  buyRate?: number;
  sellMinAmount?: number;
  sellMaxAmount?: number;
  buyMinAmount?: number;
  buyMaxAmount?: number;
  saleTerm?: string;
  purchaseTerm?: string;
  saleActivated?: boolean;
  purchaseActivated?: boolean;
  isActive?: boolean;
  priority?: number;
  tags?: string[];
  networks?: string[];
}

export interface BulkUpdateStatusDTO {
  ids: string[];
  isActive: boolean;
}

export interface BulkDeleteDTO {
  ids: string[];
}

export interface BulkUpdateSellRateDTO {
  ids: string[];
  sellRate: number;
}

export interface BulkUpdateBuyRateDTO {
  ids: string[];
  buyRate: number;
}

export interface BulkUpdateSaleActivationDTO {
  ids: string[];
  saleActivated: boolean;
}

export interface BulkUpdatePurchaseActivationDTO {
  ids: string[];
  purchaseActivated: boolean;
}

export class CryptoService {
  constructor(
    private cryptoRepository: CryptoRepository,
    private networkRepository: NetworkRepository,
    private cryptoTransactionRepository: CryptoTransactionRepository,
  ) {}

  async listCryptos(
    page: number = 1,
    limit: number = 10,
    search?: string,
    providerId?: string,
    isActive?: string,
    saleActivated?: string,
    purchaseActivated?: string,
  ): Promise<any> {
    const filter: any = { deletedAt: null };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
      ];
    }

    if (providerId) {
      filter.providerId = new Types.ObjectId(providerId);
    } else {
      filter.providerId = { $exists: false };
    }

    if (isActive !== undefined) {
      filter.isActive = isActive === "true";
    }

    if (saleActivated !== undefined) {
      filter.saleActivated = saleActivated === "true";
    }

    if (purchaseActivated !== undefined) {
      filter.purchaseActivated = purchaseActivated === "true";
    }

    const { data, total } = await this.cryptoRepository.findWithPagination(
      filter,
      page,
      limit,
      { name: 1 },
      [
        { path: "providerId", select: "name code logo" },
        {
          path: "networks",
          select: "networkId name code isActive platformDepositAddress",
        },
      ],
    );

    return { data, total };
  }

  async getProvider() {
    const serviceType = await ServiceType.findOne({
      code: "crypto",
    });

    if (!serviceType) {
      return [];
    }

    const providers = await Provider.find({
      serviceType: serviceType._id,
      deletedAt: null,
    })
      .select("_id name code logo paymentOptions isActive")
      .lean();

    return providers;
  }
  async createCrypto(dto: CreateCryptoDTO): Promise<any> {
    const existingCrypto = await this.cryptoRepository.findByCode(dto.code);

    if (existingCrypto) {
      throw new AppError(
        "Crypto with this code already exists",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.DUPLICATE_ENTRY,
      );
    }

    // Validate rate requirements
    if (dto.saleActivated && !dto.sellRate) {
      throw new AppError(
        "Sell rate is required when sale is activated",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (dto.purchaseActivated && !dto.buyRate) {
      throw new AppError(
        "Buy rate is required when purchase is activated",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (dto.networks && dto.networks.length > 0) {
      for (const networkId of dto.networks) {
        const network = await this.networkRepository.findById(networkId);
        if (!network) {
          throw new AppError(
            `Network with ID ${networkId} not found`,
            HTTP_STATUS.BAD_REQUEST,
            ERROR_CODES.NOT_FOUND,
          );
        }
      }
    }

    const cryptoData: any = {
      name: dto.name,
      code: dto.code.toUpperCase(),
      icon: dto.icon,
      description: dto.description,
      sellRate: dto.sellRate,
      buyRate: dto.buyRate,
      sellMinAmount: dto.sellMinAmount,
      sellMaxAmount: dto.sellMaxAmount,
      buyMinAmount: dto.buyMinAmount,
      buyMaxAmount: dto.buyMaxAmount,
      saleTerm: dto.saleTerm,
      purchaseTerm: dto.purchaseTerm,
      saleActivated: dto.saleActivated ?? false,
      purchaseActivated: dto.purchaseActivated ?? false,
      isActive: dto.isActive ?? true,
      networks: dto.networks?.map((id) => new Types.ObjectId(id)) || [],
      priority: dto.priority ?? 0,
      tags: dto.tags || [],
    };

    if (dto.providerId) {
      cryptoData.providerId = new Types.ObjectId(dto.providerId);
    }

    if (dto.assetId) {
      cryptoData.assetId = dto.assetId;
    } else {
      // Generate assetId if not provided
      cryptoData.assetId = `${dto.code}_${Date.now()}`;
    }

    const crypto = await this.cryptoRepository.create(cryptoData);

    await crypto.populate("networks");

    return crypto;
  }

  async getCryptoById(id: string): Promise<any> {
    const populate = [
      {
        path: "providerId",
        select: "name code logo isActive",
      },
      {
        path: "networks",
        select: "networkId name code isActive",
      },
    ];

    const crypto = await this.cryptoRepository.findById(id, populate);

    if (!crypto || crypto.deletedAt) {
      throw new AppError(
        "Crypto not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return crypto;
  }

  async updateCrypto(id: string, dto: UpdateCryptoDTO): Promise<any> {
    const crypto = await this.cryptoRepository.findById(id);

    if (!crypto || crypto.deletedAt) {
      throw new AppError(
        "Crypto not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const saleActivated = dto.saleActivated ?? crypto.saleActivated;
    const purchaseActivated = dto.purchaseActivated ?? crypto.purchaseActivated;
    const sellRate = dto.sellRate ?? crypto.sellRate;
    const buyRate = dto.buyRate ?? crypto.buyRate;

    if (saleActivated && !sellRate) {
      throw new AppError(
        "Sell rate is required when sale is activated",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (purchaseActivated && !buyRate) {
      throw new AppError(
        "Buy rate is required when purchase is activated",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const updatedCrypto = await this.cryptoRepository.update(id, dto);
    await updatedCrypto?.populate("networks");

    return updatedCrypto;
  }

  async deleteCrypto(id: string): Promise<void> {
    const crypto = await this.cryptoRepository.findById(id);

    if (!crypto || crypto.deletedAt) {
      throw new AppError(
        "Crypto not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    await this.checkPendingTransactions(id);

    await this.cryptoRepository.softDelete(id);
  }

  async updateStatus(id: string, isActive: boolean): Promise<any> {
    const crypto = await this.cryptoRepository.findById(id);

    if (!crypto || crypto.deletedAt) {
      throw new AppError(
        "Crypto not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const updatedCrypto = await this.cryptoRepository.update(id, { isActive });
    return updatedCrypto;
  }

  async activateSale(id: string, saleActivated: boolean): Promise<any> {
    const crypto = await this.cryptoRepository.findById(id);

    if (!crypto || crypto.deletedAt) {
      throw new AppError(
        "Crypto not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const updatedCrypto = await this.cryptoRepository.update(id, {
      saleActivated,
    });
    return updatedCrypto;
  }

  async activatePurchase(id: string, purchaseActivated: boolean): Promise<any> {
    const crypto = await this.cryptoRepository.findById(id);

    if (!crypto || crypto.deletedAt) {
      throw new AppError(
        "Crypto not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const updatedCrypto = await this.cryptoRepository.update(id, {
      purchaseActivated,
    });
    return updatedCrypto;
  }

  async updateSaleActivationStatus(
    id: string,
    saleActivated: boolean,
  ): Promise<any> {
    const crypto = await this.cryptoRepository.findById(id);

    if (!crypto || crypto.deletedAt) {
      throw new AppError(
        "Crypto not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (saleActivated && !crypto.sellRate) {
      throw new AppError(
        "Sell rate must be set before activating sale",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const updatedCrypto = await this.cryptoRepository.update(id, {
      saleActivated,
    });
    return updatedCrypto;
  }

  async updatePurchaseActivationStatus(
    id: string,
    purchaseActivated: boolean,
  ): Promise<any> {
    const crypto = await this.cryptoRepository.findById(id);

    if (!crypto || crypto.deletedAt) {
      throw new AppError(
        "Crypto not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (purchaseActivated && !crypto.buyRate) {
      throw new AppError(
        "Buy rate must be set before activating purchase",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const updatedCrypto = await this.cryptoRepository.update(id, {
      purchaseActivated,
    });
    return updatedCrypto;
  }

  async bulkUpdateStatus(dto: BulkUpdateStatusDTO): Promise<any> {
    if (!dto.ids || dto.ids.length === 0) {
      throw new AppError(
        "No crypto IDs provided",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const result = await this.cryptoRepository.bulkUpdateStatus(
      dto.ids,
      dto.isActive,
    );

    return {
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} crypto(s) updated successfully`,
    };
  }

  async bulkDelete(dto: BulkDeleteDTO): Promise<any> {
    if (!dto.ids || dto.ids.length === 0) {
      throw new AppError(
        "No crypto IDs provided",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    await this.checkBulkPendingTransactions(dto.ids);

    const result = await this.cryptoRepository.bulkSoftDelete(dto.ids);

    return {
      deletedCount: result.modifiedCount,
      message: `${result.modifiedCount} crypto(s) deleted successfully`,
    };
  }
  // SERVICE METHODS
  async bulkUpdateSellRate(dto: BulkUpdateSellRateDTO): Promise<any> {
    if (!dto.ids || dto.ids.length === 0) {
      throw new AppError(
        "No crypto IDs provided",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (dto.sellRate === undefined || dto.sellRate === null) {
      throw new AppError(
        "Sell rate is required",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (dto.sellRate < 0) {
      throw new AppError(
        "Sell rate must be a positive number",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const result = await this.cryptoRepository.bulkUpdateSellRate(
      dto.ids,
      dto.sellRate,
    );

    return {
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} crypto(s) sell rate updated successfully`,
    };
  }

  async bulkUpdateBuyRate(dto: BulkUpdateBuyRateDTO): Promise<any> {
    if (!dto.ids || dto.ids.length === 0) {
      throw new AppError(
        "No crypto IDs provided",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (dto.buyRate === undefined || dto.buyRate === null) {
      throw new AppError(
        "Buy rate is required",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (dto.buyRate < 0) {
      throw new AppError(
        "Buy rate must be a positive number",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const result = await this.cryptoRepository.bulkUpdateBuyRate(
      dto.ids,
      dto.buyRate,
    );

    return {
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} crypto(s) buy rate updated successfully`,
    };
  }

  async bulkUpdateSaleActivation(
    dto: BulkUpdateSaleActivationDTO,
  ): Promise<any> {
    if (!dto.ids || dto.ids.length === 0) {
      throw new AppError(
        "No crypto IDs provided",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (dto.saleActivated === undefined || dto.saleActivated === null) {
      throw new AppError(
        "saleActivated flag is required",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const result = await this.cryptoRepository.bulkUpdateSaleActivation(
      dto.ids,
      dto.saleActivated,
    );

    const action = dto.saleActivated ? "activated" : "deactivated";
    return {
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} crypto(s) sales ${action} successfully`,
    };
  }

  async bulkUpdatePurchaseActivation(
    dto: BulkUpdatePurchaseActivationDTO,
  ): Promise<any> {
    if (!dto.ids || dto.ids.length === 0) {
      throw new AppError(
        "No crypto IDs provided",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (dto.purchaseActivated === undefined || dto.purchaseActivated === null) {
      throw new AppError(
        "purchaseActivated flag is required",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const result = await this.cryptoRepository.bulkUpdatePurchaseActivation(
      dto.ids,
      dto.purchaseActivated,
    );

    const action = dto.purchaseActivated ? "activated" : "deactivated";
    return {
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} crypto(s) purchases ${action} successfully`,
    };
  }
  // Network Management for Crypto

  async addNetworkToCrypto(cryptoId: string, networkId: string): Promise<any> {
    const crypto = await this.cryptoRepository.findById(cryptoId);

    if (!crypto || crypto.deletedAt) {
      throw new AppError(
        "Crypto not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Check if network exists
    const network = await this.networkRepository.findById(networkId);
    if (!network) {
      throw new AppError(
        "Network not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Check if network already added
    const alreadyAdded = crypto.networks.some(
      (n) => n.toString() === networkId,
    );

    if (alreadyAdded) {
      throw new AppError(
        "Network already added to this crypto",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.DUPLICATE_ENTRY,
      );
    }

    const updatedCrypto = await this.cryptoRepository.addNetwork(
      cryptoId,
      networkId,
    );

    return updatedCrypto;
  }

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

  async createNetwork(dto: any): Promise<any> {
    // Create the network first
    const networkData: any = {
      networkId: dto.networkId || dto.name.toLowerCase().replace(/\s+/g, "_"),
      name: dto.name,
      code: dto.code.toUpperCase(),
      confirmationsRequired: dto.confirmationsRequired ?? 6,
      addressPattern: dto.addressPattern,
      explorerUrl: dto.explorerUrl,
      platformDepositAddress: dto.platformDepositAddress,
      isActive: dto.isActive ?? true,
    };

    const network = await this.networkRepository.create(networkData);

    return network;
  }

  async updateNetwork(id: string, dto: any): Promise<any> {
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

  deleteNetwork(id: string): Promise<any> {
    return this.networkRepository.softDelete(id);
  }

  async removeNetworkFromCrypto(
    cryptoId: string,
    networkId: string,
  ): Promise<any> {
    const crypto = await this.cryptoRepository.findById(cryptoId);

    if (!crypto || crypto.deletedAt) {
      throw new AppError(
        "Crypto not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Check if network is added
    const isAdded = crypto.networks.some((n) => n.toString() === networkId);

    if (!isAdded) {
      throw new AppError(
        "Network not found for this crypto",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    await this.checkNetworkPendingTransactions(cryptoId, networkId);

    const updatedCrypto = await this.cryptoRepository.removeNetwork(
      cryptoId,
      networkId,
    );

    return updatedCrypto;
  }

  async getCryptoNetworks(cryptoId: string): Promise<any> {
    const crypto = await this.cryptoRepository.findById(cryptoId, [
      {
        path: "networks",
        select: "networkId name code isActive  explorerUrl",
      },
    ]);

    if (!crypto || crypto.deletedAt) {
      throw new AppError(
        "Crypto not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return crypto.networks;
  }

  async getNetworkAdmins(networkId: string): Promise<any> {
    const network = await this.networkRepository.findById(networkId);
    if (!network || network.deletedAt) {
      throw new AppError(
        "Network not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Use network.networkId string not ObjectId
    const normalizedNetworkId = network.networkId.toLowerCase();
    const buyNetworkPermission = `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY}.network:${normalizedNetworkId}`;
    const sellNetworkPermission = `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL}.network:${normalizedNetworkId}`;

    const admins = await Admin.find({
      status: "active",
      adminLevel: { $ne: "super_admin" },
      permissions: {
        $in: [
          ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY,
          ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL,
        ],
      },
    }).select("_id firstName lastName phone profilePicture email permissions");

    const result = admins.map((admin) => ({
      admin: {
        _id: admin._id,
        firstName: admin.firstName,
        lastName: admin.lastName,
        email: admin.email,
        phone: admin.phone,
        profilePicture: admin.profilePicture,
      },
      buyEnabled: admin.permissions.some(
        (p) => p.toLowerCase() === buyNetworkPermission,
      ),
      sellEnabled: admin.permissions.some(
        (p) => p.toLowerCase() === sellNetworkPermission,
      ),
    }));

    // Toggled-on admins first
    return result.sort((a, b) => {
      const aActive = a.buyEnabled || a.sellEnabled ? 1 : 0;
      const bActive = b.buyEnabled || b.sellEnabled ? 1 : 0;
      return bActive - aActive;
    });
  }

  async toggleNetworkAdminPermission(
    networkId: string,
    adminId: string,
    type: "buy" | "sell",
    enabled: boolean,
  ): Promise<any> {
    const network = await this.networkRepository.findById(networkId);
    if (!network || network.deletedAt) {
      throw new AppError(
        "Network not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const admin = await Admin.findById(adminId);
    if (!admin || admin.status !== "active") {
      throw new AppError(
        "Admin not found or inactive",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const globalPermission =
      type === "buy"
        ? ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY
        : ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL;

    // Always normalize networkId to lowercase
    const normalizedNetworkId = network.networkId.toLowerCase();
    const networkPermission = `${globalPermission}.network:${normalizedNetworkId}`;

    const networkPermissionRegex = new RegExp(
      `^${globalPermission}\\.network:${normalizedNetworkId}$`,
      "i",
    );

    if (enabled) {
      const permissionsToAdd: string[] = [networkPermission];

      if (!admin.permissions.includes(globalPermission)) {
        permissionsToAdd.push(globalPermission);
      }

      // Step 1: Pull ALL case variants of this network permission first
      await Admin.updateOne(
        { _id: adminId },
        { $pull: { permissions: { $regex: networkPermissionRegex } } },
      );

      // Step 2: Add back only the clean lowercase version
      await Admin.updateOne(
        { _id: adminId },
        { $addToSet: { permissions: { $each: permissionsToAdd } } },
      );
    } else {
      // Pull ALL case variants on revoke
      await Admin.updateOne(
        { _id: adminId },
        { $pull: { permissions: { $regex: networkPermissionRegex } } },
      );
    }

    const updatedAdmin = await Admin.findById(adminId).select("permissions");

    const buyNetworkPermission = `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY}.network:${normalizedNetworkId}`;
    const sellNetworkPermission = `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL}.network:${normalizedNetworkId}`;

    return {
      adminId,
      networkId: network.networkId,
      type,
      enabled,
      buyEnabled: updatedAdmin?.permissions.some(
        (p) => p.toLowerCase() === buyNetworkPermission,
      ),
      sellEnabled: updatedAdmin?.permissions.some(
        (p) => p.toLowerCase() === sellNetworkPermission,
      ),
    };
  }

  async getNetworkAssets(networkId: string): Promise<any> {
    // Verify network exists
    const network = await this.networkRepository.findById(networkId);
    if (!network || network.deletedAt) {
      throw new AppError(
        "Network not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const cryptos = await this.cryptoRepository.findWithPagination(
      {
        networks: new Types.ObjectId(networkId),
        deletedAt: null,
      },
      1,
      100,
      { name: 1 },
      [{ path: "networks", select: "networkId name code isActive" }],
    );

    return {
      resourceType: "crypto",
      total: cryptos.total,
      data: cryptos.data,
    };
  }
  async getNetworkOverview(
    networkId: string,
    page: number = 1,
    limit: number = 10,
    search?: string,
  ): Promise<any> {
    // Verify network exists
    const network = await this.networkRepository.findById(networkId);
    if (!network || network.deletedAt) {
      throw new AppError(
        "Network not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Build filter
    const filter: any = {
      networks: new Types.ObjectId(networkId),
      deletedAt: null,
    };

    // Add search if provided
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
      ];
    }

    // Get cryptos with pagination
    const cryptos = await this.cryptoRepository.findWithPagination(
      filter,
      page,
      limit,
      { name: 1 },
      [
        {
          path: "networks",
          select: "networkId name code isActive platformDepositAddress",
        },
      ],
    );

    // Get admins with buy/sell toggle state
    const admins = await Admin.find({
      status: "active",
      adminLevel: { $ne: "super_admin" },
      permissions: {
        $in: [
          ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY,
          ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL,
        ],
      },
    }).select("_id firstName lastName phone profilePicture email permissions");

    const normalizedNetworkId = network.networkId.toLowerCase();
    const buyNetworkPermission = `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY}.network:${normalizedNetworkId}`;
    const sellNetworkPermission = `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL}.network:${normalizedNetworkId}`;

    const adminList = admins
      .map((admin) => ({
        admin: {
          _id: admin._id,
          firstName: admin.firstName,
          lastName: admin.lastName,
          email: admin.email,
          profilePicture: admin.profilePicture,
        },
        buyEnabled: admin.permissions.some(
          (p) => p.toLowerCase() === buyNetworkPermission,
        ),
        sellEnabled: admin.permissions.some(
          (p) => p.toLowerCase() === sellNetworkPermission,
        ),
      }))
      .sort((a, b) => {
        const aActive = a.buyEnabled || a.sellEnabled ? 1 : 0;
        const bActive = b.buyEnabled || b.sellEnabled ? 1 : 0;
        return bActive - aActive;
      });

    return {
      network,
      assets: {
        total: cryptos.total,
        page,
        limit,
        data: cryptos.data,
      },
      admins: adminList,
    };
  }

  async bulkToggleNetworkAdminBuyPermission(
    networkId: string,
    adminIds: string[],
    enabled: boolean,
  ): Promise<any> {
    const network = await this.networkRepository.findById(networkId);
    if (!network || network.deletedAt) {
      throw new AppError(
        "Network not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const globalPermission = ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY;
    const normalizedNetworkId = network.networkId.toLowerCase();
    const networkPermission = `${globalPermission}.network:${normalizedNetworkId}`;
    const networkPermissionRegex = new RegExp(
      `^${globalPermission}\\.network:${normalizedNetworkId}$`,
      "i",
    );

    if (enabled) {
      // Pull all case variants first, then add clean lowercase
      await Admin.updateMany(
        { _id: { $in: adminIds }, status: "active" },
        { $pull: { permissions: { $regex: networkPermissionRegex } } },
      );
      await Admin.updateMany(
        { _id: { $in: adminIds }, status: "active" },
        {
          $addToSet: {
            permissions: { $each: [globalPermission, networkPermission] },
          },
        },
      );
    } else {
      await Admin.updateMany(
        { _id: { $in: adminIds } },
        { $pull: { permissions: { $regex: networkPermissionRegex } } },
      );
    }
    return {
      networkId: network.networkId,
      adminIds,
      type: "buy",
      enabled,
    };
  }

  async bulkToggleNetworkAdminSellPermission(
    networkId: string,
    adminIds: string[],
    enabled: boolean,
  ): Promise<any> {
    const network = await this.networkRepository.findById(networkId);
    if (!network || network.deletedAt) {
      throw new AppError(
        "Network not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const globalPermission = ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL;
    const normalizedNetworkId = network.networkId.toLowerCase();
    const networkPermission = `${globalPermission}.network:${normalizedNetworkId}`;
    const networkPermissionRegex = new RegExp(
      `^${globalPermission}\\.network:${normalizedNetworkId}$`,
      "i",
    );

    if (enabled) {
      // Pull all case variants first, then add clean lowercase
      await Admin.updateMany(
        { _id: { $in: adminIds }, status: "active" },
        { $pull: { permissions: { $regex: networkPermissionRegex } } },
      );
      await Admin.updateMany(
        { _id: { $in: adminIds }, status: "active" },
        {
          $addToSet: {
            permissions: { $each: [globalPermission, networkPermission] },
          },
        },
      );
    } else {
      await Admin.updateMany(
        { _id: { $in: adminIds } },
        { $pull: { permissions: { $regex: networkPermissionRegex } } },
      );
    }

    return {
      networkId: network.networkId,
      adminIds,
      type: "sell",
      enabled,
    };
  }

  private async checkNetworkPendingTransactions(
    cryptoId: string,
    networkId: string,
  ): Promise<void> {
    const pendingTransactions = await this.cryptoTransactionRepository.find({
      cryptoId: new Types.ObjectId(cryptoId),
      "network.networkId": networkId,
      status: { $in: ["pending", "approved", "transferred"] },
    });

    if (pendingTransactions.length > 0) {
      throw new AppError(
        `Cannot remove network. Found ${pendingTransactions.length} pending transaction(s) using this network`,
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.CANNOT_DELETE_WITH_PENDING_TRANSACTIONS,
      );
    }
  }

  private async checkBulkPendingTransactions(
    cryptoIds: string[],
  ): Promise<void> {
    const objectIds = cryptoIds.map((id) => new Types.ObjectId(id));

    const pendingTransactions = await this.cryptoTransactionRepository.find({
      cryptoId: { $in: objectIds },
      status: { $in: ["pending", "approved", "transferred"] },
    });

    if (pendingTransactions.length > 0) {
      const uniqueCryptos = new Set(
        pendingTransactions.map((t) => t.cryptoId.toString()),
      );
      throw new AppError(
        `Cannot delete cryptos. Found pending transactions for ${uniqueCryptos.size} crypto(s)`,
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.CANNOT_DELETE_WITH_PENDING_TRANSACTIONS,
      );
    }
  }

  private async checkPendingTransactions(cryptoId: string): Promise<void> {
    const pendingTransactions = await this.cryptoTransactionRepository.find({
      cryptoId: new Types.ObjectId(cryptoId),
      status: { $in: ["pending", "approved", "transferred"] },
    });

    if (pendingTransactions.length > 0) {
      throw new AppError(
        `Cannot delete crypto. Found ${pendingTransactions.length} pending transaction(s)`,
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.CANNOT_DELETE_WITH_PENDING_TRANSACTIONS,
      );
    }
  }
}
