import { BaseRepository } from "../BaseRepository";
import { Crypto, ICrypto } from "@/models/crypto/Crypto";
import {
  CryptoTransaction,
  ICryptoTransaction,
} from "@/models/crypto/CryptoTransaction";
import { Types } from "mongoose";

export class CryptoRepository extends BaseRepository<ICrypto> {
  constructor() {
    super(Crypto);
  }

  async findByAssetId(assetId: string): Promise<ICrypto | null> {
    return this.model.findOne({ assetId, deletedAt: null }).exec();
  }

  async findByCode(code: string): Promise<ICrypto | null> {
    return this.model.findOne({ code, deletedAt: null }).exec();
  }
  async findByNetworkId(networkId: string): Promise<ICrypto[]> {
    return this.model
      .find({
        networks: new Types.ObjectId(networkId),
        deletedAt: null,
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  async upsertByCode(
  code: string,
  providerId: string | undefined,
  data: Partial<ICrypto>,
): Promise<ICrypto> {
  const filter: any = { code, providerCode: "tatum" };
  if (providerId) filter.providerId = new Types.ObjectId(providerId);

  const result = await this.model.findOneAndUpdate(
    filter,
    { $set: data },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return result!;
}
  async findByCodeAndProvider(
    code: string,
    providerId?: string,
  ): Promise<ICrypto | null> {
    const query: any = { code, deletedAt: null };
    if (providerId) {
      query.providerId = new Types.ObjectId(providerId);
    }
    return this.model.findOne(query).exec();
  }

  async findActiveForUsers(): Promise<ICrypto[]> {
    return this.model
      .find({
        isActive: true,
        deletedAt: null,
        $or: [{ saleActivated: true }, { purchaseActivated: true }],
      })
      .populate("networks")
      .sort({ priority: -1, createdAt: -1 })
      .exec();
  }

  async findByProvider(providerId: string): Promise<ICrypto[]> {
    return this.model
      .find({
        providerId: new Types.ObjectId(providerId),
        deletedAt: null,
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  // Search cryptos by name/code
  async searchCryptos(
    search: string,
    page: number = 1,
    limit: number = 10,
    providerId?: any,
  ): Promise<{ data: ICrypto[]; total: number }> {
    const searchRegex = { $regex: search, $options: "i" };
    const query: any = {
      deletedAt: null,
      isActive: true,
      $or: [{ name: searchRegex }, { code: searchRegex }],
    };

    if (providerId !== undefined) {
      query.providerId = providerId;
    }

    return this.findWithPagination(query, page, limit, { createdAt: -1 }, [
      { path: "networks" },
    ]);
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
  // REPOSITORY METHODS
  async bulkUpdateSellRate(
    ids: string[],
    sellRate: number,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateMany(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        { $set: { sellRate } },
      )
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  async bulkUpdateBuyRate(
    ids: string[],
    buyRate: number,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateMany(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        { $set: { buyRate } },
      )
      .exec();

    return { modifiedCount: result.modifiedCount };
  }

  async bulkUpdateSaleActivation(
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

  async bulkUpdatePurchaseActivation(
    ids: string[],
    purchaseActivated: boolean,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.model
      .updateMany(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        { $set: { purchaseActivated } },
      )
      .exec();

    return { modifiedCount: result.modifiedCount };
  }
  async addNetwork(
    cryptoId: string,
    networkId: string,
  ): Promise<ICrypto | null> {
    return this.model
      .findByIdAndUpdate(
        cryptoId,
        { $addToSet: { networks: new Types.ObjectId(networkId) } },
        { new: true },
      )
      .populate("networks")
      .exec();
  }

  async removeNetwork(
    cryptoId: string,
    networkId: string,
  ): Promise<ICrypto | null> {
    return this.model
      .findByIdAndUpdate(
        cryptoId,
        { $pull: { networks: new Types.ObjectId(networkId) } },
        { new: true },
      )
      .populate("networks")
      .exec();
  }

  async countByProvider(providerId: string): Promise<number> {
    return this.model
      .countDocuments({
        providerId: new Types.ObjectId(providerId),
        deletedAt: null,
      })
      .exec();
  }

  async findByBreetAssetId(assetId: string) {
  return await this.model.findOne({ breetAssetId: assetId, deletedAt: null });
}
}
