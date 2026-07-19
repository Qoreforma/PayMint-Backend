import { BaseRepository } from "../BaseRepository";
import { GiftCard, IGiftCard } from "@/models/giftcard/GiftCard";
import {
  GiftCardCategory,
  IGiftCardCategory,
} from "@/models/giftcard/GiftCardCategory";
import {
  GiftCardTransaction,
  IGiftCardTransaction,
} from "@/models/giftcard/GiftCardTransaction";
import mongoose, { Types } from "mongoose";

export class GiftCardRepository extends BaseRepository<IGiftCard> {
  constructor() {
    super(GiftCard);
  }

  async findByProductId(productId: string): Promise<IGiftCard | null> {
    return this.model.findOne({ productId, status: "active" }).exec();
  }

  async findAll(filters: any = {}, page: number = 1, limit: number = 10) {
    return this.findWithPagination(filters, page, limit);
  }

  async findByCategory(
    categoryId: string | Types.ObjectId,
    page: number = 1,
    limit: number = 10,
  ) {
    return this.findWithPagination(
      { categoryId, status: "active" },
      page,
      limit,
    );
  }

  async findByCountry(
    countryId: string | Types.ObjectId,
    page: number = 1,
    limit: number = 10,
  ) {
    return this.findWithPagination(
      { countryId, status: "active" },
      page,
      limit,
    );
  }

  async searchGiftCards(query: string, page: number = 1, limit: number = 10) {
    const searchRegex = new RegExp(query, "i");
    return this.findWithPagination(
      { name: searchRegex, status: "active" },
      page,
      limit,
    );
  }

  async findByCategoryId(categoryId: string): Promise<IGiftCard[]> {
    return this.model
      .find({ categoryId: new Types.ObjectId(categoryId), deletedAt: null })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findByCountryId(countryId: string): Promise<IGiftCard[]> {
    return this.model
      .find({ countryId: new Types.ObjectId(countryId), deletedAt: null })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findActiveProducts(type?: "buy" | "sell"): Promise<IGiftCard[]> {
    const filter: any = {
      isActive: true,
      deletedAt: null,
    };

    if (type) {
      filter.type = type;
    }

    return this.model.find(filter).sort({ createdAt: -1 }).exec();
  }

  async findByNameAndCategory(
    name: string,
    categoryId: string,
  ): Promise<IGiftCard | null> {
    return this.model
      .findOne({
        name,
        categoryId: new Types.ObjectId(categoryId),
        deletedAt: null,
      })
      .exec();
  }

  async bulkUpdateStatus(
    ids: string[],
    isActive: boolean,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateMany(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        { $set: { isActive } },
      )
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  async bulkSoftDelete(ids: string[]): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateMany(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        { $set: { deletedAt: new Date() } },
      )
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  async bulkUpdateSaleActivationStatus(
    ids: string[],
    saleActivated: boolean,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateMany(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        { $set: { saleActivated } },
      )
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  async bulkUpdateSaleRate(ids: string[], sellRate: number): Promise<any> {
    const result = await this.model
      .updateMany(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        { $set: { sellRate } },
      )
      .exec();

    return {
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} gift card(s) updated successfully`,
    };
  }

  async bulkUpdateHottest(
    ids: string[],
    isHottest: boolean,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateMany(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        { $set: { isHottest } },
      )
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  async findHottest(filters: any = {}): Promise<IGiftCard[]> {
    return this.model
      .find({ isHottest: true, deletedAt: null, ...filters })
      .populate({
        path: "categoryId",
        select: "name providerId transactionType icon",
      })
      .populate({ path: "countryId", select: "name iso2 flag currency" })
      .sort({ updatedAt: -1 })
      .exec();
  }

  async bulkUpdateCommission(
    ids: string[],
    commissionType: "flat" | "percentage",
    commisionValue: number,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateMany(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        { $set: { commissionType, commisionValue } },
      )
      .exec();

    return { modifiedCount: result.modifiedCount };
  }
  async countByCategory(categoryId: string): Promise<number> {
    return this.model
      .countDocuments({
        categoryId: new Types.ObjectId(categoryId),
        deletedAt: null,
      })
      .exec();
  }

  async countActiveByProvider(providerId: string): Promise<number> {
    return this.model
      .aggregate([
        {
          $match: {
            deletedAt: null,
            isActive: true,
          },
        },
        {
          $lookup: {
            from: "giftcardcategories",
            localField: "categoryId",
            foreignField: "_id",
            as: "category",
          },
        },
        {
          $unwind: "$category",
        },
        {
          $match: {
            "category.providerId": new Types.ObjectId(providerId),
            "category.deletedAt": null,
            "category.isActive": true,
          },
        },
        {
          $count: "total",
        },
      ])
      .then((result) => result[0]?.total || 0);
  }
  async findDistinctCategoryIds(filters: any = {}): Promise<Types.ObjectId[]> {
    return this.model.distinct("categoryId", filters).exec();
  }

  async softDeleteByCategory(
  categoryId: string | Types.ObjectId,
  session?: mongoose.ClientSession,
): Promise<number> {
  const result = await this.model
    .updateMany(
      {
        categoryId: new Types.ObjectId(categoryId),
        deletedAt: null,
      },
      { $set: { deletedAt: new Date(), isActive: false } },
    )
    .session(session ?? null)
    .exec();

  return result.modifiedCount;
}
}
