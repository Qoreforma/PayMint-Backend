import { BaseRepository } from "../BaseRepository";
import { ITradeBonus, TradeBonus } from "@/models/billing/bonuses/TradeBonus";

export class TradeBonusRepository extends BaseRepository<ITradeBonus> {
  constructor() {
    super(TradeBonus);
  }

  async getBonuses(): Promise<ITradeBonus[]> {
    return await this.find({
      startDate: { $lte: new Date() },
      $or: [{ endDate: null }, { endDate: { $gte: new Date() } }],
    });
  }

  async getBonusesByAmountTraded(amountTraded: number): Promise<ITradeBonus[]> {
    const bonuses = await this.find({
      isActive: true,
      amountRequired: { $lte: amountTraded },
    });

    // Return sorted by amountRequired DESC (most relevant/generous first)
    return bonuses.sort((a, b) => b.amountRequired - a.amountRequired);
  }
}