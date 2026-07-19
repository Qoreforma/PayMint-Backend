import { BaseRepository } from "../BaseRepository";
import { Wallet, IWallet } from "@/models/wallet/Wallet";
import { Types } from "mongoose";

export class WalletRepository extends BaseRepository<IWallet> {
  constructor() {
    super(Wallet);
  }

  async findByUserId(userId: string | Types.ObjectId): Promise<IWallet | null> {
    // Now returns the main wallet (type='main') which has all balances
    return this.model.findOne({ userId, type: "main" }).exec();
  }

  async findAllByUserId(userId: string | Types.ObjectId): Promise<IWallet[]> {
    return this.model.find({ userId }).exec();
  }

  async updateBalance(
    walletId: string,
    newBalance: number
  ): Promise<IWallet | null> {
    return this.model
      .findByIdAndUpdate(walletId, { balance: newBalance }, { new: true })
      .exec();
  }

  // In WalletRepository class

  async incrementBalance(
    walletId: string,
    amount: number
  ): Promise<IWallet | null> {
    return this.model
      .findByIdAndUpdate(walletId, { $inc: { balance: amount } }, { new: true })
      .exec();
  }

  async decrementBalance(
    walletId: string,
    amount: number,
  ): Promise<IWallet | null> {
    // Use atomic operation with condition to prevent negative balance
    return this.model
      .findOneAndUpdate(
        {
          _id: walletId,
          balance: { $gte: amount }, // Ensure sufficient balance
        },
        { $inc: { balance: -amount } },
        { new: true }
      )
      .exec();
  }

  async incrementBonusBalance(
    walletId: string,
    amount: number
  ): Promise<IWallet | null> {
    return this.model
      .findByIdAndUpdate(walletId, { $inc: { bonusBalance: amount } }, { new: true })
      .exec();
  }

  async decrementBonusBalance(
    walletId: string,
    amount: number,
  ): Promise<IWallet | null> {
    // Use atomic operation with condition to prevent negative balance
    return this.model
      .findOneAndUpdate(
        {
          _id: walletId,
          bonusBalance: { $gte: amount }, // Ensure sufficient bonus balance
        },
        { $inc: { bonusBalance: -amount } },
        { new: true }
      )
      .exec();
  }
}

