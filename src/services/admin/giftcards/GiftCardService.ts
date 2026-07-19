import { GiftCardRepository } from "@/repositories/shared/GiftCardRepository";
import { GiftCardCategoryRepository } from "@/repositories/shared/GiftCardCategoryRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Types } from "mongoose";
import { GiftCardTransactionRepository } from "@/repositories/client/GiftCardTransactionRepository";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { CacheService } from "@/services/core/CacheService";

export interface CreateGiftCardDTO {
  countryId?: string;
  categoryId: string;
  name: string;
  sellRate?: number;
  sellMinAmount?: number;
  sellMaxAmount?: number;
  saleActivated?: boolean;
  commissionType?: string;
  commisionValue?: number;
  isActive?: boolean;
}

export interface UpdateGiftCardDTO {
  countryId?: string;
  categoryId: string;
  name: string;
  sellRate?: number;
  sellMinAmount?: number;
  sellMaxAmount?: number;
  saleActivated?: boolean;
  isActive?: boolean;
}

export interface BulkUpdateStatusDTO {
  ids: string[];
  isActive: boolean;
}

export interface BulkDeleteDTO {
  ids: string[];
}

export interface BulkUpdateSaleActivationStatusDTO {
  ids: string[];
  saleActivated: boolean;
}

export interface BulkUpdateSaleRateDTO {
  ids: string[];
  sellRate: number;
}

export interface BulkUpdateCommissionDTO {
  ids: string[];
  commissionType: "flat" | "percentage";
  commisionValue: number;
}

export interface BulkUpdateHottestDTO {
  ids: string[];
  isHottest: boolean;
}

export class GiftCardService {
  constructor(
    private giftCardRepository: GiftCardRepository,
    private giftCardCategoryRepository: GiftCardCategoryRepository,
    private giftCardTransactionRepository: GiftCardTransactionRepository,
    private cacheService: CacheService,
  ) {}

  async listGiftCards(
    page: number = 1,
    limit: number = 10,
    search?: string,
    categoryId?: string,
    countryId?: string,
    isActive?: string,
    saleActivated?: string,
    purchaseActivated?: string,
    adminPermissions?: string[],
  ): Promise<any> {
    const filter: any = { deletedAt: null, type: "sell" };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { productId: { $regex: search, $options: "i" } },
      ];
    }

    if (countryId) {
      filter.countryId = new Types.ObjectId(countryId);
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

    if (adminPermissions && !adminPermissions.includes("*")) {
      const permittedCategoryIds = adminPermissions
        .filter((p) =>
          p.startsWith(`${ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL}.category:`),
        )
        .map(
          (p) =>
            p.split(`${ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL}.category:`)[1],
        );

      if (permittedCategoryIds.length === 0) {
        return { data: [], total: 0 };
      }

      if (categoryId) {
        if (!permittedCategoryIds.includes(categoryId)) {
          return { data: [], total: 0 };
        }
        filter.categoryId = new Types.ObjectId(categoryId);
      } else {
        filter.categoryId = { $in: permittedCategoryIds };
      }
    } else if (categoryId) {
      filter.categoryId = new Types.ObjectId(categoryId);
    }

    const { data, total } = await this.giftCardRepository.findWithPagination(
      filter,
      page,
      limit,
      { createdAt: -1 },
      [
        { path: "categoryId", select: "name providerId transactionType" },
        { path: "countryId", select: "name iso2 flag currency" },
      ],
    );

    return { data, total };
  }

  async createGiftCard(dto: CreateGiftCardDTO): Promise<any> {
    // Verify category exists and is active
    const category = await this.giftCardCategoryRepository.findById(
      dto.categoryId,
    );

    if (!category || category.deletedAt) {
      throw new AppError(
        "Gift card category not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Check if product with same name and category already exists
    const existingProduct = await this.giftCardRepository.findByNameAndCategory(
      dto.name,
      dto.categoryId,
    );

    if (existingProduct) {
      throw new AppError(
        "Gift card product with this name already exists for this category",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.DUPLICATE_ENTRY,
      );
    }

    const giftCardData: any = {
      ...dto,
      logo: category.icon,
      categoryId: new Types.ObjectId(dto.categoryId),
      type: "sell",
      saleActivated: "true",
    };

    if (dto.countryId) {
      giftCardData.countryId = new Types.ObjectId(dto.countryId);
    }

    const giftCard = await this.giftCardRepository.create(giftCardData);

    return giftCard;
  }

  async getGiftCardById(id: string, adminPermissions?: string[]): Promise<any> {
    const populate = [
      {
        path: "categoryId",
        select: "name providerId transactionType icon",
        populate: { path: "providerId", select: "name code logo" },
      },
      { path: "countryId", select: "name iso2 iso3 flag currency" },
    ];

    const giftCard = await this.giftCardRepository.findById(id, populate);

    if (!giftCard || giftCard.deletedAt) {
      throw new AppError(
        "Gift card product not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (adminPermissions && !adminPermissions.includes("*")) {
      const categoryId = (
        (giftCard.categoryId as any)?._id ?? giftCard.categoryId
      )?.toString();
      const categoryPermission = `${ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL}.category:${categoryId}`;

      if (!adminPermissions.includes(categoryPermission)) {
        throw new AppError(
          "You do not have permission to access this resource",
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.UNAUTHORIZED,
        );
      }
    }

    return giftCard;
  }

  async updateGiftCard(id: string, dto: UpdateGiftCardDTO): Promise<any> {
    const giftCard = await this.giftCardRepository.findById(id);

    if (!giftCard || giftCard.deletedAt) {
      throw new AppError(
        "Gift card product not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (giftCard.type !== "sell") {
      throw new AppError(
        "Gift card product not available for update",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    if (!giftCard.categoryId) {
      throw new AppError(
        "Gift card product has no category assigned",
        HTTP_STATUS.BAD_REQUEST,
      );
    }

    // Check if updating name and if it conflicts
    if (dto.name && dto.name !== giftCard.name) {
      const existingProduct =
        await this.giftCardRepository.findByNameAndCategory(
          dto.name,
          giftCard.categoryId.toString(),
        );

      if (existingProduct && existingProduct.id.toString() !== id) {
        throw new AppError(
          "Gift card product with this name already exists for this category",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.DUPLICATE_ENTRY,
        );
      }
    }

    const updateData: any = { ...dto };

    if (dto.countryId) {
      updateData.countryId = new Types.ObjectId(dto.countryId);
    }

    const updatedGiftCard = await this.giftCardRepository.update(
      id,
      updateData,
    );

    return updatedGiftCard;
  }

  async deleteGiftCard(id: string): Promise<void> {
    const giftCard = await this.giftCardRepository.findById(id);

    if (!giftCard || giftCard.deletedAt) {
      throw new AppError(
        "Gift card product not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const pendingCount = await this.checkPendingTransactionsForGiftCard(id);

    if (pendingCount > 0) {
      throw new AppError(
        `Cannot delete gift card. Found ${pendingCount} pending transaction(s)`,
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.CANNOT_DELETE_WITH_PENDING_TRANSACTIONS,
      );
    }

    await this.giftCardRepository.softDelete(id);
  }

  async updateStatus(id: string, isActive: boolean): Promise<any> {
    const giftCard = await this.giftCardRepository.findById(id);

    if (!giftCard || giftCard.deletedAt) {
      throw new AppError(
        "Gift card product not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const updatedGiftCard = await this.giftCardRepository.update(id, {
      isActive,
    });

    return updatedGiftCard;
  }

  async updateSaleActivationStatus(
    id: string,
    saleActivated: boolean,
  ): Promise<any> {
    const giftCard = await this.giftCardRepository.findById(id);

    if (!giftCard || giftCard.deletedAt) {
      throw new AppError(
        "Gift card product not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const updatedGiftCard = await this.giftCardRepository.update(id, {
      saleActivated,
    });

    return updatedGiftCard;
  }

  async updatePurchaseActivationStatus(
    id: string,
    purchaseActivated: boolean,
  ): Promise<any> {
    const giftCard = await this.giftCardRepository.findById(id);

    if (!giftCard || giftCard.deletedAt) {
      throw new AppError(
        "Gift card product not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const updatedGiftCard = await this.giftCardRepository.update(id, {
      purchaseActivated,
    });

    return updatedGiftCard;
  }

  async toggleHottest(id: string, isHottest: boolean): Promise<any> {
    const giftCard = await this.giftCardRepository.findById(id);

    if (!giftCard || giftCard.deletedAt) {
      throw new AppError(
        "Gift card product not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    await this.giftCardRepository.update(id, { isHottest });
    await this.invalidateHottestCache();

    return this.giftCardRepository.findHottest(); // returns ALL hottest cards
  }

  async bulkUpdateHottest(dto: BulkUpdateHottestDTO) {
    const result = await this.giftCardRepository.bulkUpdateHottest(
      dto.ids,
      dto.isHottest,
    );

    await this.invalidateHottestCache();

    const hottestGiftCards = await this.giftCardRepository.findHottest();

    return {
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} gift card(s) updated successfully`,
      data: hottestGiftCards,
    };
  }

  async bulkUpdateStatus(dto: BulkUpdateStatusDTO): Promise<any> {
    const result = await this.giftCardRepository.bulkUpdateStatus(
      dto.ids,
      dto.isActive,
    );

    return {
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} gift card(s) updated successfully`,
    };
  }

  async bulkDelete(dto: BulkDeleteDTO): Promise<any> {
    if (!dto.ids || dto.ids.length === 0) {
      throw new AppError(
        "No gift card IDs provided",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    // Check if any of the gift cards have pending transactions
    const { hasPending, affectedCount } =
      await this.checkBulkPendingTransactions(dto.ids);

    if (hasPending) {
      throw new AppError(
        `Cannot delete gift cards. Found pending transactions for ${affectedCount} gift card(s)`,
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.CANNOT_DELETE_WITH_PENDING_TRANSACTIONS,
      );
    }
    const result = await this.giftCardRepository.bulkSoftDelete(dto.ids);

    return {
      deletedCount: result.modifiedCount,
      message: `${result.modifiedCount} gift card(s) deleted successfully`,
    };
  }

  async bulkUpdateSaleActivationStatus(dto: BulkUpdateSaleActivationStatusDTO) {
    const result = await this.giftCardRepository.bulkUpdateSaleActivationStatus(
      dto.ids,
      dto.saleActivated,
    );

    return {
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} gift card(s) updated successfully`,
    };
  }
  async bulkUpdateSaleRate(dto: BulkUpdateSaleRateDTO) {
    const result = await this.giftCardRepository.bulkUpdateSaleRate(
      dto.ids,
      dto.sellRate,
    );

    return {
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} gift card(s) updated successfully`,
    };
  }

  async bulkUpdateCommission(dto: BulkUpdateCommissionDTO) {
    const result = await this.giftCardRepository.bulkUpdateCommission(
      dto.ids,
      dto.commissionType,
      dto.commisionValue,
    );

    return {
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} gift card(s) updated successfully`,
    };
  }
  private async checkBulkPendingTransactions(
    giftCardIds: string[],
  ): Promise<{ hasPending: boolean; affectedCount: number }> {
    const objectIds = giftCardIds.map((id) => new Types.ObjectId(id));

    const result = await this.giftCardTransactionRepository.findWithFilters(
      {
        giftCardId: { $in: objectIds },
        status: { $in: ["pending", "processing", "approved", "multiple"] },
      },
      1,
      1,
    );

    if (result.total === 0) {
      return { hasPending: false, affectedCount: 0 };
    }

    // Count unique gift cards with pending transactions
    const affectedGiftCards = new Set<string>();

    // Fetch all pending transactions to get affected gift cards
    const allPendingResult =
      await this.giftCardTransactionRepository.findWithFilters(
        {
          giftCardId: { $in: objectIds },
          status: { $in: ["pending", "processing", "approved", "multiple"] },
        },
        1,
        1000, // Get up to 1000 records to identify unique gift cards
      );

    allPendingResult.data.forEach((transaction: any) => {
      affectedGiftCards.add(transaction.giftCardId.toString());
    });

    return { hasPending: true, affectedCount: affectedGiftCards.size };
  }
  private async checkPendingTransactionsForGiftCard(
    giftCardId: string,
  ): Promise<number> {
    const result = await this.giftCardTransactionRepository.findWithFilters(
      {
        giftCardId: new Types.ObjectId(giftCardId),
        status: { $in: ["pending", "processing", "approved", "multiple"] },
      },
      1,
      1,
    );

    return result.total;
  }

  private async invalidateHottestCache(): Promise<void> {
    await this.cacheService.deletePattern(`giftcard:hottest:*`);
  }
}
