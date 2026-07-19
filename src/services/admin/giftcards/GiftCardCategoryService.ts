import { GiftCardCategoryRepository } from "@/repositories/shared/GiftCardCategoryRepository";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, CACHE_KEYS } from "@/utils/constants";
import mongoose, { Types } from "mongoose";
import { GiftCardRepository } from "@/repositories/shared/GiftCardRepository";
import { CacheService } from "../../core/CacheService";
import { Admin } from "@/models/admin/Admin";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { GiftCard } from "@/models/giftcard/GiftCard";

export interface CreateGiftCardCategoryDTO {
  providerId: string;
  name: string;
  icon?: string;
  transactionType: "buy" | "sell" | "both";
  saleTerm?: string;
  purchaseTerm?: string;
  saleActivated?: boolean;
  purchaseActivated?: boolean;
  isActive?: boolean;
  countries: Types.ObjectId[] | [];
}

export interface UpdateGiftCardCategoryDTO {
  name?: string;
  icon?: string;
  transactionType?: "buy" | "sell" | "both";
  saleTerm?: string;
  purchaseTerm?: string;
  saleActivated?: boolean;
  purchaseActivated?: boolean;
  isActive?: boolean;
  countries?: Types.ObjectId[];
}

export class GiftCardCategoryService {
  constructor(
    private giftCardCategoryRepository: GiftCardCategoryRepository,
    private giftCardRepository: GiftCardRepository,
    private cacheService: CacheService,
  ) {}

  async listCategories(
    page: number = 1,
    limit: number = 10,
    search?: string,
    isActive?: string,
    adminPermissions?: string[],
  ): Promise<any> {
    const filter: any = { deletedAt: null, transactionType: "sell" };

    if (search) {
      filter.$or = [{ name: { $regex: search, $options: "i" } }];
    }

    if (isActive !== undefined) {
      filter.isActive = isActive === "true";
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

      filter._id = { $in: permittedCategoryIds };
    }

    const { data, total } =
      await this.giftCardCategoryRepository.findWithPagination(
        filter,
        page,
        limit,
        { createdAt: -1 },
        [
          { path: "providerId", select: "name code" },
          { path: "countries", select: "name iso2 iso3 code flag" },
        ],
      );

    const dataWithCount = await Promise.all(
      data.map(async (category) => {
        const productCount = await GiftCard.countDocuments({
          categoryId: category._id,
          deletedAt: null,
        });

        return {
          ...category.toObject(),
          productCount: productCount || 0,
        };
      }),
    );

    return { data: dataWithCount, total };
  }

  async createCategory(dto: CreateGiftCardCategoryDTO): Promise<any> {
    // Check if category with same name and provider already exists
    const existingCategory = await this.giftCardCategoryRepository.findOne({
      name: dto.name,
      deletedAt: null,
    });

    if (existingCategory) {
      throw new AppError(
        "Gift card category with this name already exists",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.DUPLICATE_ENTRY,
      );
    }

    const category = await this.giftCardCategoryRepository.create({
      providerId: new Types.ObjectId(dto.providerId),
      name: dto.name,
      icon: dto.icon,
      saleTerm: dto.saleTerm,
      saleActivated: dto.saleActivated ?? false,
      isActive: dto.isActive ?? true,
      transactionType: "sell",

      countries: dto.countries,
    });

    await this.invalidateCategoriesCache(dto.transactionType);

    return category;
  }

  async getCategoryById(id: string, adminPermissions?: string[]): Promise<any> {
    const category = await this.giftCardCategoryRepository.findById(id, [
      {
        path: "countries",
        select: "name flag currency iso2 emoji",
      },
    ]);

    if (!category || category.deletedAt) {
      throw new AppError(
        "Gift card category not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (adminPermissions && !adminPermissions.includes("*")) {
      const categoryPermission = `${ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL}.category:${id}`;
      if (!adminPermissions.includes(categoryPermission)) {
        throw new AppError(
          "You do not have permission to access this resource",
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.UNAUTHORIZED,
        );
      }
    }

    return category;
  }

  async updateCategory(
    id: string,
    dto: UpdateGiftCardCategoryDTO,
  ): Promise<any> {
    const populate = [{ path: "providerId", select: "name code" }];
    const category = await this.giftCardCategoryRepository.findById(
      id,
      populate,
    );

    if (!category || category.deletedAt) {
      throw new AppError(
        "Gift card category not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Check if updating name and if it conflicts with existing category
    if (dto.name && dto.name !== category.name) {
      const existingCategory = await this.giftCardCategoryRepository.findOne({
        name: dto.name,
        providerId: category.providerId,
        deletedAt: null,
      });

      if (existingCategory) {
        throw new AppError(
          "Gift card category with this name already exists for this provider",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.DUPLICATE_ENTRY,
        );
      }
    }

    const updatedCategory = await this.giftCardCategoryRepository.update(
      id,
      dto,
    );

    await this.invalidateCategoriesCache(
      dto.transactionType || category.transactionType,
    );

    return updatedCategory;
  }

  async deleteCategory(
    id: string,
  ): Promise<{ message: string; deletedProductCount: number }> {
    const category = await this.giftCardCategoryRepository.findById(id);

    if (!category || category.deletedAt) {
      throw new AppError(
        "Gift card category not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const session = await mongoose.startSession();
    let deletedProductCount = 0;

    try {
      await session.withTransaction(async () => {
        deletedProductCount =
          await this.giftCardRepository.softDeleteByCategory(id, session);

        await this.giftCardCategoryRepository.softDelete(id, session);
      });
    } finally {
      await session.endSession();
    }

    await this.invalidateCategoriesCache(category.transactionType);

    return {
      message:
        deletedProductCount > 0
          ? `Category deleted along with ${deletedProductCount} associated gift card(s)`
          : "Category deleted successfully",
      deletedProductCount,
    };
  }

  async getCategoryProducts(
    categoryId: string,
    page: number = 1,
    limit: number = 10,
    search?: string,
    type?: "buy" | "sell",
    isActive?: string,
    sortBy: string = "createdAt",
    sortOrder: "asc" | "desc" = "desc",
    adminPermissions?: string[],
  ): Promise<any> {
    const category = await this.giftCardCategoryRepository.findById(categoryId);

    if (!category || category.deletedAt) {
      throw new AppError(
        "Gift card category not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    if (adminPermissions && !adminPermissions.includes("*")) {
      const categoryPermission = `${ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL}.category:${categoryId}`;
      if (!adminPermissions.includes(categoryPermission)) {
        throw new AppError(
          "You do not have permission to access this resource",
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.UNAUTHORIZED,
        );
      }
    }

    // Build filter
    const filter: any = {
      categoryId: new Types.ObjectId(categoryId),
      deletedAt: null,
    };

    // Filter by type if provided
    if (type) {
      filter.type = type;
    }

    // Filter by active status
    if (isActive !== undefined) {
      filter.isActive = isActive === "true";
    }

    // Search by name or productId
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { productId: { $regex: search, $options: "i" } },
      ];
    }

    // Build sort object with validation
    const allowedSortFields = [
      "createdAt",
      "updatedAt",
      "name",
      "sellRate",
      "buyRate",
      "isActive",
    ];
    const safeSort = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";
    const sort = { [safeSort]: sortOrder === "desc" ? -1 : 1 };

    // Get paginated results with populate
    const { data, total } = await this.giftCardRepository.findWithPagination(
      filter,
      page,
      limit,
      sort,
      [
        { path: "categoryId", select: "name icon transactionType" },
        { path: "countryId", select: "name iso2 iso3 code flag" },
      ],
    );

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
      category: {
        id: category._id,
        name: category.name,
        icon: category.icon,
      },
    };
  }
  async updateStatus(id: string, isActive: boolean): Promise<any> {
    const category = await this.giftCardCategoryRepository.findById(id);

    if (!category || category.deletedAt) {
      throw new AppError(
        "Gift card category not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const updatedCategory = await this.giftCardCategoryRepository.update(id, {
      isActive,
    });

    await this.invalidateCategoriesCache(category.transactionType);

    return updatedCategory;
  }

  async updateSaleActivationStatus(
    id: string,
    saleActivated: boolean,
  ): Promise<any> {
    const category = await this.giftCardCategoryRepository.findById(id);

    if (!category || category.deletedAt) {
      throw new AppError(
        "Gift card category not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const updatedCategory = await this.giftCardCategoryRepository.update(id, {
      saleActivated,
    });
    await this.invalidateCategoriesCache(category.transactionType);

    return updatedCategory;
  }

  async updatePurchaseActivationStatus(
    id: string,
    purchaseActivated: boolean,
  ): Promise<any> {
    const category = await this.giftCardCategoryRepository.findById(id);

    if (!category || category.deletedAt) {
      throw new AppError(
        "Gift card category not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const updatedCategory = await this.giftCardCategoryRepository.update(id, {
      purchaseActivated,
    });
    await this.invalidateCategoriesCache(category.transactionType);

    return updatedCategory;
  }
  async getCategoryAdmins(categoryId: string): Promise<any> {
    const category = await this.giftCardCategoryRepository.findById(categoryId);
    if (!category || category.deletedAt) {
      throw new AppError(
        "Gift card category not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Only admins with global sell permission appear — buy is automated
    const admins = await Admin.find({
      status: "active",
      adminLevel: { $ne: "super_admin" },
      permissions: {
        $in: [ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL],
      },
    }).select("_id firstName lastName phone profilePicture email permissions");

    const sellCategoryPermission = `${ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL}.category:${categoryId}`;

    const result = admins.map((admin) => ({
      admin: {
        _id: admin._id,
        firstName: admin.firstName,
        lastName: admin.lastName,
        email: admin.email,
        phone: admin.phone,
        profilePicture: admin.profilePicture,
      },
      sellEnabled: admin.permissions.includes(sellCategoryPermission),
    }));

    // Toggled-on admins first
    return result.sort((a, b) => {
      const aActive = a.sellEnabled ? 1 : 0;
      const bActive = b.sellEnabled ? 1 : 0;
      return bActive - aActive;
    });
  }

  async toggleCategoryAdminPermission(
    categoryId: string,
    adminId: string,
    enabled: boolean,
  ): Promise<any> {
    const category = await this.giftCardCategoryRepository.findById(categoryId);
    if (!category || category.deletedAt) {
      throw new AppError(
        "Gift card category not found",
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

    const globalPermission = ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL;
    const categoryPermission = `${globalPermission}.category:${categoryId}`;

    if (enabled) {
      const permissionsToAdd: string[] = [categoryPermission];

      // Ensure global permission exists too
      if (!admin.permissions.includes(globalPermission)) {
        permissionsToAdd.push(globalPermission);
      }

      await Admin.updateOne(
        { _id: adminId },
        { $addToSet: { permissions: { $each: permissionsToAdd } } },
      );
    } else {
      // Only remove the category-scoped permission
      // Keep the global permission regardless
      await Admin.updateOne(
        { _id: adminId },
        { $pull: { permissions: categoryPermission } },
      );
    }

    const updatedAdmin = await Admin.findById(adminId).select("permissions");

    return {
      adminId,
      categoryId,
      enabled,
      sellEnabled: updatedAdmin?.permissions.includes(categoryPermission),
    };
  }
  async bulkToggleCategoryAdminPermission(
    categoryId: string,
    adminIds: string[],
    enabled: boolean,
  ): Promise<any> {
    const category = await this.giftCardCategoryRepository.findById(categoryId);
    if (!category || category.deletedAt) {
      throw new AppError(
        "Gift card category not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const globalPermission = ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL;
    const categoryPermission = `${globalPermission}.category:${categoryId}`;

    if (enabled) {
      await Admin.updateMany(
        { _id: { $in: adminIds }, status: "active" },
        {
          $addToSet: {
            permissions: { $each: [globalPermission, categoryPermission] },
          },
        },
      );
    } else {
      await Admin.updateMany(
        { _id: { $in: adminIds } },
        { $pull: { permissions: categoryPermission } },
      );
    }

    return {
      categoryId,
      adminIds,
      enabled,
    };
  }
  // Call this when categories are created/updated/deleted
  async invalidateCategoriesCache(
    type?: "buy" | "sell" | "both",
  ): Promise<void> {
    if (type) {
      await this.cacheService.deletePattern(
        `${CACHE_KEYS.GIFTCARD_CATEGORIES(type)}:*`,
      );
    } else {
      // Invalidate all category cache keys
      await this.cacheService.deletePattern(`giftcard:categories:*`);
    }
  }
}
