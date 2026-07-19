import { BaseRepository } from "../BaseRepository";
import { Types } from "mongoose";
import { Bank, IBank } from "@/models/reference/Bank";

export class BankRepository extends BaseRepository<IBank> {
  constructor() {
    super(Bank);
  }

  async findByFlutterWaveCode(code: string): Promise<IBank | null> {
    return this.model.findOne({ flutterwaveCode: code });
  }

  async findByMonnifyCode(code: string): Promise<IBank | null> {
    return this.model.findOne({ monnifyCode: code });
  }

  async findBySavehavenCode(code: string): Promise<IBank | null> {
    return this.model.findOne({ savehavenCode: code });
  }

  async syncBreetBank(bank: {
    id: string;
    name: string;
    slug: string;
    country: string;
    currency: string;
    monnifyCode: string;
  }): Promise<{ matched: boolean }> {
    const existing = await Bank.findOne({
      monnifyCode: bank.monnifyCode,
      deletedAt: null,
    });

    if (!existing) {
      return { matched: false };
    }

    await Bank.updateOne(
      { _id: existing._id },
      {
        $set: {
          breetBankId: bank.id,
          breetSlug: bank.slug,
          breetCountry: bank.country,
        },
      },
    );

    return { matched: true };
  }

  async findByBreetBankId(breetBankId: string) {
    return await this.model.findOne({ breetBankId, deletedAt: null });
  }
}
