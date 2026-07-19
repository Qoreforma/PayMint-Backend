import { BaseRepository } from "../BaseRepository";
import { Admin, IAdmin } from "@/models/admin/Admin";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { FilterQuery } from "mongoose";

export class AdminRepository extends BaseRepository<IAdmin> {
  private static readonly EXCLUDE_SYSTEM_SECURED = {
    isSystemSecured: { $ne: true },
  };
  
  constructor() {
    super(Admin);
  }

  async findByEmail(email: string): Promise<IAdmin | null> {
    if (!email) return null;
    return this.model.findOne({ email: email.toLowerCase() }).exec();
  }

  async findActiveAdmins(filter: FilterQuery<IAdmin> = {}): Promise<IAdmin[]> {
    return this.model.find({ ...filter, status: "active" }).exec();
  }

  async findByAdminLevel(adminLevel: string): Promise<IAdmin[]> {
    return this.model.find({ adminLevel }).exec();
  }

  async findByDepartment(department: string): Promise<IAdmin[]> {
    return this.model.find({ department }).exec();
  }

  async updateStatus(
    adminId: string,
    status: "active" | "pending_verification" | "suspended" | "deactivated",
    updatedBy?: string,
  ): Promise<IAdmin | null> {
    const updateData: any = { status };
    if (updatedBy) {
      updateData.updatedBy = updatedBy;
    }
    return this.model
      .findByIdAndUpdate(adminId, updateData, { new: true })
      .exec();
  }

  async updatePassword(
    adminId: string,
    hashedPassword: string,
  ): Promise<IAdmin | null> {
    const admin = await this.model.findById(adminId).exec();
    if (!admin) return null;

    // Add current password to history
    if (admin.password) {
      admin.passwordHistory.push(admin.password);
      // Keep only last 5 passwords
      if (admin.passwordHistory.length > 5) {
        admin.passwordHistory = admin.passwordHistory.slice(-5);
      }
    }

    admin.password = hashedPassword;
    return await admin.save();
  }

  async updatePermissions(
    adminId: string,
    permissions: string[],
    updatedBy?: string,
  ): Promise<IAdmin | null> {
    const updateData: any = { permissions };
    if (updatedBy) {
      updateData.updatedBy = updatedBy;
    }
    return this.model
      .findByIdAndUpdate(adminId, updateData, { new: true })
      .exec();
  }

  async updateAdminLevel(
    adminId: string,
    adminLevel: string,
    updatedBy?: string,
  ): Promise<IAdmin | null> {
    const updateData: any = { adminLevel };
    if (updatedBy) {
      updateData.updatedBy = updatedBy;
    }
    return this.model
      .findByIdAndUpdate(adminId, updateData, { new: true })
      .exec();
  }

  async updateTwoFactorStatus(
    adminId: string,
    enabled: boolean,
  ): Promise<IAdmin | null> {
    return this.model
      .findByIdAndUpdate(adminId, { twoFactorEnabled: enabled }, { new: true })
      .exec();
  }

  async updateActiveToken(
    adminId: string,
    tokenId: string | null,
  ): Promise<IAdmin | null> {
    return this.model
      .findByIdAndUpdate(adminId, { activeTokenId: tokenId }, { new: true })
      .exec();
  }

  async updateLastLogin(adminId: string): Promise<IAdmin | null> {
    return this.model
      .findByIdAndUpdate(
        adminId,
        {
          lastLogin: new Date(),
          $inc: { totalLogins: 1 },
        },
        { new: true },
      )
      .exec();
  }

  async findByStatus(
    status: "active" | "pending_verification" | "suspended" | "deactivated",
  ): Promise<IAdmin[]> {
    return this.model.find({ status }).exec();
  }

  async findLockedAdmins(): Promise<IAdmin[]> {
    return this.model
      .find({
        lockUntil: { $exists: true, $gt: new Date() },
      })
      .exec();
  }

  async unlockAccount(adminId: string): Promise<IAdmin | null> {
    return this.model
      .findByIdAndUpdate(
        adminId,
        {
          $set: { loginAttempts: 0 },
          $unset: { lockUntil: 1 },
        },
        { new: true },
      )
      .exec();
  }

  async updateProfilePicture(
    adminId: string,
    profilePicture: string,
  ): Promise<IAdmin | null> {
    return this.model
      .findByIdAndUpdate(adminId, { profilePicture }, { new: true })
      .exec();
  }

  async updatePhone(adminId: string, phone: string): Promise<IAdmin | null> {
    return this.model
      .findByIdAndUpdate(adminId, { phone }, { new: true })
      .exec();
  }

  async updateDepartment(
    adminId: string,
    department: string,
  ): Promise<IAdmin | null> {
    return this.model
      .findByIdAndUpdate(adminId, { department }, { new: true })
      .exec();
  }

  async findWithTwoFactorEnabled(): Promise<IAdmin[]> {
    return this.model.find({ twoFactorEnabled: true }).exec();
  }

  async getAdminStats() {
    return this.model.aggregate([
      {
        $facet: {
          totalAdmins: [{ $count: "count" }],
          activeAdmins: [{ $match: { status: "active" } }, { $count: "count" }],
          pendingAdmins: [
            { $match: { status: "pending_verification" } },
            { $count: "count" },
          ],
          suspendedAdmins: [
            { $match: { status: "suspended" } },
            { $count: "count" },
          ],
          deactivatedAdmins: [
            { $match: { status: "deactivated" } },
            { $count: "count" },
          ],
          lockedAdmins: [
            {
              $match: {
                lockUntil: { $exists: true, $gt: new Date() },
              },
            },
            { $count: "count" },
          ],
          twoFactorEnabled: [
            { $match: { twoFactorEnabled: true } },
            { $count: "count" },
          ],
          byAdminLevel: [
            { $group: { _id: "$adminLevel", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          byDepartment: [
            { $match: { department: { $exists: true, $ne: null } } },
            { $group: { _id: "$department", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
        },
      },
    ]);
  }

  async getRecentlyActive(limit: number = 10): Promise<IAdmin[]> {
    return this.model
      .find({ lastActiveAt: { $exists: true } })
      .sort({ lastActiveAt: -1 })
      .limit(limit)
      .exec();
  }

  async searchAdmins(searchTerm: string): Promise<IAdmin[]> {
    const regex = new RegExp(searchTerm, "i");
    return this.model
      .find({
        $or: [{ firstName: regex }, { lastName: regex }, { email: regex }],
      })
      .exec();
  }

  async checkPasswordHistory(
    adminId: string,
    hashedPassword: string,
  ): Promise<boolean> {
    const admin = await this.model.findById(adminId).exec();
    if (!admin) return false;
    return admin.passwordHistory.includes(hashedPassword);
  }

  async bulkUpdateStatus(
    adminIds: string[],
    status: "active" | "pending_verification" | "suspended" | "deactivated",
    updatedBy?: string,
  ): Promise<number> {
    const updateData: any = { status };
    if (updatedBy) {
      updateData.updatedBy = updatedBy;
    }
    const result = await this.model
      .updateMany({ _id: { $in: adminIds } }, updateData)
      .exec();
    return result.modifiedCount;
  }

  async findByRole(roleName: string): Promise<IAdmin[]> {
    return this.model.find({ adminLevel: roleName }).exec();
  }

  async findByRoleWithPagination(
    roleName: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    data: IAdmin[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const query = { adminLevel: roleName };

    const [data, total] = await Promise.all([
      this.model
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.model.countDocuments(query).exec(),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async updateRole(
    adminId: string,
    roleName: string,
    permissions: String[],
  ): Promise<IAdmin | null> {
    return this.model
      .findByIdAndUpdate(
        adminId,
        {
          adminLevel: roleName,
          permissions: permissions,
        },
        { new: true },
      )
      .exec();
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && !email.includes(",");
  }

  async getSuperAdmin(): Promise<IAdmin | null> {
    return this.model
      .findOne({
        adminLevel: "super_admin",
        status: "active",
        ...AdminRepository.EXCLUDE_SYSTEM_SECURED,
      })
      .exec();
  }

  async getAdminsForCryptoNetwork(
    networkId: string,
    tradeType: "buy" | "sell",
  ): Promise<IAdmin[]> {
    const normalizedNetworkId = networkId.toLowerCase();
    const permission =
      tradeType === "buy"
        ? `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY}.network:${normalizedNetworkId}`
        : `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL}.network:${normalizedNetworkId}`;

    const admins = await this.model
      .find({
        status: "active",
        ...AdminRepository.EXCLUDE_SYSTEM_SECURED,
        $or: [
          { adminLevel: "super_admin" },
          {
            adminLevel: { $ne: "super_admin" },
            permissions: { $regex: new RegExp(`^${permission}$`, "i") },
          },
        ],
      })
      .exec();

    const adminsMap = new Map<string, IAdmin>();
    admins.forEach((admin) => {
      if (admin.email) {
        adminsMap.set(admin.email, admin);
      }
    });

    return Array.from(adminsMap.values());
  }

  async getAdminsForGiftCardCategory(
    categoryId: string,
    tradeType: "buy" | "sell",
  ): Promise<IAdmin[]> {
    const permission =
      tradeType === "buy"
        ? `${ADMIN_PERMISSIONS.GIFTCARD.MANAGE_BUY}.category:${categoryId}`
        : `${ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL}.category:${categoryId}`;

    // Single combined query for better performance
    const admins = await this.model
      .find({
        status: "active",
        ...AdminRepository.EXCLUDE_SYSTEM_SECURED,
        $or: [
          // Super admin
          { adminLevel: "super_admin" },
          // Scoped admins
          {
            adminLevel: { $ne: "super_admin" },
            permissions: permission,
          },
        ],
      })
      .exec();

    // Deduplicate by email
    const adminsMap = new Map<string, IAdmin>();
    admins.forEach((admin) => {
      if (admin.email) {
        adminsMap.set(admin.email, admin);
      }
    });

    return Array.from(adminsMap.values());
  }

  async getSuperAdminEmail(): Promise<string | null> {
    const superAdmin = await this.getSuperAdmin();
    return superAdmin?.email || null;
  }

  async getCryptoNetworkAdminEmails(
    networkId: string,
    tradeType: "buy" | "sell",
  ): Promise<string[]> {
    const admins = await this.getAdminsForCryptoNetwork(networkId, tradeType);
    return admins
      .map((admin) => admin.email)
      .filter((email) => !!email && this.isValidEmail(email));
  }

  async getGiftCardCategoryAdminEmails(
    categoryId: string,
    tradeType: "buy" | "sell",
  ): Promise<string[]> {
    const admins = await this.getAdminsForGiftCardCategory(
      categoryId,
      tradeType,
    );
    return admins
      .map((admin) => admin.email)
      .filter((email) => !!email && this.isValidEmail(email));
  }
}
