import { BaseRepository } from "../BaseRepository";
import { Network, INetwork } from "@/models/crypto/Network";
import { Types } from "mongoose";

export class NetworkRepository extends BaseRepository<INetwork> {
  constructor() {
    super(Network);
  }

  async findByNetworkId(networkId: string): Promise<INetwork | null> {
    return this.model.findOne({ networkId, deletedAt: null }).exec();
  }

  async findByCode(code: string): Promise<INetwork | null> {
    return this.model.findOne({ code, deletedAt: null }).exec();
  }

  async upsertByNetworkId(
    networkId: string,
    providerId: string | undefined,
    data: Partial<INetwork>,
  ): Promise<INetwork> {
    const filter: any = { networkId };
    if (providerId) filter.providerId = new Types.ObjectId(providerId);

    const result = await this.model.findOneAndUpdate(
      filter,
      { $set: data },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    return result!;
  }

  async findActive(): Promise<INetwork[]> {
    return this.model
      .find({ isActive: true, deletedAt: null })
      .sort({ priority: -1, createdAt: -1 })
      .exec();
  }

  // Fetch multiple networks by their MongoDB ObjectIds
  async findByIds(ids: string[]): Promise<INetwork[]> {
    const objectIds = ids.map((id) => new Types.ObjectId(id));
    return this.model
      .find({
        _id: { $in: objectIds },
        deletedAt: null,
      })
      .sort({ priority: -1 })
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
  
  async claimNextDerivationIndex(
    networkObjectId: string,
  ): Promise<INetwork | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(networkObjectId), deletedAt: null },
        { $inc: { derivationPathCounter: 1 } },
        { new: false },
      )
      .exec();

    // this is a guard if using the same credentials for tatum staging and production
    // staging must never claim into production's index range
    const max = process.env.DERIVATION_INDEX_MAX
      ? Number(process.env.DERIVATION_INDEX_MAX)
      : null;
    if (max !== null && doc && (doc.derivationPathCounter ?? 0) >= max) {
      throw new Error(
        `Derivation index cap (${max}) reached for network ${networkObjectId} — refusing to claim further indices on this environment.`,
      );
    }

    return doc;
  }
}
