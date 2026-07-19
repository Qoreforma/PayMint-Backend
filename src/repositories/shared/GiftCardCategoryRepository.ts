import {
  IGiftCardCategory,
  GiftCardCategory,
} from "@/models/giftcard/GiftCardCategory";
import { BaseRepository } from "../BaseRepository";

export class GiftCardCategoryRepository extends BaseRepository<IGiftCardCategory> {
  constructor() {
    super(GiftCardCategory);
  }

  async findActiveCategories(): Promise<IGiftCardCategory[]> {
    return this.model
      .find({ status: "active", deletedAt: null })
      .sort({ displayOrder: 1, createdAt: -1 })
      .exec();
  }

  async findByName(name: string): Promise<IGiftCardCategory | null> {
    return this.model.findOne({ name, deletedAt: null }).exec();
  }
  async findActive(
      page: number = 1,
      limit: number = 10,
      type?: "both" | "sell" | "buy"
    ) {
      return this.findWithPagination(
        { status: "active", transactionType: type },
        page,
        limit
      );
    }
  
    async findByCategoryId(
      categoryId: string
    ): Promise<IGiftCardCategory | null> {
      return this.model
        .findOne({ categoryId, status: "active" })
        .populate("providerId", "name code logo")
        .exec();
    }
}
