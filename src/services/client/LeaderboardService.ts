import { LeaderboardRepository } from "@/repositories/client/LeaderboardRepository";
import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { UserRepository } from "@/repositories/client/UserRepository";
import { CacheService } from "../core/CacheService";
import { AppError } from "@/middlewares/shared/errorHandler";
import {
  HTTP_STATUS,
  ERROR_CODES,
  LEADERBOARD_TYPES,
  LEADERBOARD_PERIODS,
  LEADERBOARD_COMPOSITE_TYPES,
  getCompositeKey,
  CACHE_KEYS,
  CACHE_TTL,
  ADMIN_DEPOSIT_TRANSACTION_TYPES,
  TRANSACTION_TYPES,
  LEADERBOARD_ACTIVE_PERIODS,
} from "@/utils/constants";
import logger from "@/logger";
import { startOfWeek, startOfMonth, startOfDay, format } from "date-fns";
import { maskEmail, roundAmount } from "@/utils/helpers";
import { CryptoTransactionRepository } from "@/repositories/client/CryptoTransactionRepository";
import { GiftCardTransactionRepository } from "@/repositories/client/GiftCardTransactionRepository";

// Types (and composite keys) ranked by USD instead of NGN.
// USD is the stable unit of value for these — NGN is just an FX snapshot
// that drifts on its own, independent of how much the user actually traded.
// Mirrors the same set in LeaderboardRepository.ts.
const USD_RANKED_TYPES = new Set(["crypto", "giftcard", "crypto|giftcard"]);

export class LeaderboardService {
  constructor(
    private leaderboardRepository: LeaderboardRepository,
    private transactionRepository: TransactionRepository,
    private userRepository: UserRepository,
    private cacheService: CacheService,
    private cryptoTransactionRepository: CryptoTransactionRepository,
    private giftCardTransactionRepository: GiftCardTransactionRepository,
  ) {}

  private getActualTradeType(
    transactionType: string,
    metaMethod?: string,
    transactableType?: string,
  ): string {
    // First — meta.method (most explicit)
    if (transactionType === TRANSACTION_TYPES.DEPOSIT && metaMethod) {
      switch (metaMethod) {
        case ADMIN_DEPOSIT_TRANSACTION_TYPES.GIFTCARD_APPROVE:
        case ADMIN_DEPOSIT_TRANSACTION_TYPES.GIFTCARD_SECOND_APPROVE:
          return TRANSACTION_TYPES.GIFTCARD;
        case ADMIN_DEPOSIT_TRANSACTION_TYPES.CRYPTO_APPROVE:
        case ADMIN_DEPOSIT_TRANSACTION_TYPES.CRYPTO_SECOND_APPROVE:
          return TRANSACTION_TYPES.CRYPTO;
        default:
          break;
      }
    }

    // Fallback — transactableType when meta.method is absent or unrecognised
    if (transactionType === TRANSACTION_TYPES.DEPOSIT && transactableType) {
      switch (transactableType) {
        case "CryptoTransaction":
          return TRANSACTION_TYPES.CRYPTO;
        case "GiftCardTransaction":
          return TRANSACTION_TYPES.GIFTCARD;
        default:
          break;
      }
    }

    return transactionType;
  }

  private isAdminManualDeposit(metaMethod?: any): boolean {
    return metaMethod
      ? Object.values(ADMIN_DEPOSIT_TRANSACTION_TYPES).includes(metaMethod)
      : false;
  }

  private async isLeaderboardTypeEnabled(type: string): Promise<boolean> {
    if (type === "general" || LEADERBOARD_TYPES.includes(type as any)) {
      return true;
    }
    return false;
  }

  async getValidLeaderboardTypes(): Promise<string[]> {
    return [...LEADERBOARD_TYPES];
  }

  // HELPER

  // Returns the composite type key for a given set of multiples if it is a
  // known pre-computed combination, otherwise returns null.
  private getKnownCompositeKey(types: string[]): string | null {
    const key = getCompositeKey(types);
    const isKnown = LEADERBOARD_COMPOSITE_TYPES.some(
      (group) => getCompositeKey(group) === key,
    );
    return isKnown ? key : null;
  }
  private mapEntry(entry: any) {
    return {
      rank: entry.rank,
      user: {
        id: entry.userId,
        firstname: entry.userDetails.firstname,
        lastname: entry.userDetails.lastname,
        email: maskEmail(entry.userDetails.email),
        phone: entry.userDetails.phone,
        username: entry.userDetails.username,
      },
      totalAmount: roundAmount(entry.totalAmount),
      totalAmountUSD: roundAmount(entry.totalAmountUSD),
      transactionCount: entry.transactionCount,
      lastTransactionAt: entry.lastTransactionAt,
    };
  }

  // GET LEADERBOAR─

  async getLeaderboard(
    type: string = "general",
    period: string = "monthly",
    limit: number = 50,
    multiples?: string[],
  ) {
    const typesToQuery = multiples && multiples.length > 0 ? multiples : [type];

    for (const t of typesToQuery) {
      if (!LEADERBOARD_TYPES.includes(t as any)) {
        throw new AppError(
          `Invalid leaderboard type: ${t}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
      const isEnabled = await this.isLeaderboardTypeEnabled(t);
      if (!isEnabled) {
        throw new AppError(
          `Leaderboard type '${t}' is currently disabled`,
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.UNAUTHORIZED,
        );
      }
    }

    if (!Object.values(LEADERBOARD_PERIODS).includes(period as any)) {
      throw new AppError(
        "Invalid period",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    if (!LEADERBOARD_ACTIVE_PERIODS.includes(period)) {
      return {
        types: typesToQuery,
        period,
        periodKey: this.getPeriodKey(period),
        entries: [],
        lastUpdated: null,
      };
    }

    const periodKey = this.getPeriodKey(period);

    //  Fast path: pre-computed composite
    if (multiples && multiples.length > 1) {
      const compositeKey = this.getKnownCompositeKey(multiples);
      if (compositeKey) {
        const cacheKey = CACHE_KEYS.LEADERBOARD(
          compositeKey,
          period,
          periodKey,
        );
        const cached = await this.cacheService.get(cacheKey);
        if (cached) {
          logger.info(`Composite leaderboard cache hit: ${cacheKey}`);
          return cached;
        }

        const compositeEntries =
          await this.leaderboardRepository.findByTypeAndPeriod(
            compositeKey,
            period,
            periodKey,
            limit,
          );

        if (compositeEntries.length > 0) {
          const result = {
            types: typesToQuery,
            period,
            periodKey,
            entries: compositeEntries.map(this.mapEntry),
            lastUpdated: compositeEntries[0]?.calculatedAt || new Date(),
          };
          await this.cacheService.set(cacheKey, result, CACHE_TTL.LEADERBOARD);
          return result;
        }
        // No composite data yet — fall through to live consolidation below
        logger.info(
          `Composite ${compositeKey} not yet computed, falling back to live consolidation`,
        );
      }
    }

    //  Standard path (single type or live consolidation for multiples)
    const cacheKey =
      multiples && multiples.length > 0
        ? CACHE_KEYS.LEADERBOARD(
            `multiples_${[...multiples].sort().join("_")}`,
            period,
            periodKey,
          )
        : CACHE_KEYS.LEADERBOARD(type, period, periodKey);

    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      logger.info(`Leaderboard cache hit: ${cacheKey}`);
      return cached;
    }

    const leaderboards = await this.leaderboardRepository.findByTypesAndPeriod(
      typesToQuery,
      period,
      periodKey,
      limit * 10,
    );

    let entries = leaderboards.map((entry, index) => ({
      ...this.mapEntry(entry),
      rank: index + 1,
    }));

    if (multiples && multiples.length > 1) {
      const consolidated = new Map<string, any>();

      for (const entry of leaderboards) {
        const uid = entry.userId.toString();
        if (!consolidated.has(uid)) {
          consolidated.set(uid, {
            user: {
              id: entry.userId,
              firstname: entry.userDetails.firstname,
              lastname: entry.userDetails.lastname,
              email: maskEmail(entry.userDetails.email),
              phone: entry.userDetails.phone,
              username: entry.userDetails.username,
            },
            totalAmount: 0,
            totalAmountUSD: 0,
            transactionCount: 0,
            lastTransactionAt: entry.lastTransactionAt,
          });
        }
        const data = consolidated.get(uid)!;
        data.totalAmount += entry.totalAmount;
        data.totalAmountUSD += entry.totalAmountUSD || 0;
        data.transactionCount += entry.transactionCount;
        if (
          entry.lastTransactionAt &&
          data.lastTransactionAt &&
          new Date(entry.lastTransactionAt) > new Date(data.lastTransactionAt)
        ) {
          data.lastTransactionAt = entry.lastTransactionAt;
        }
      }

      // USD is the stable ranking unit for crypto/giftcard combos — NGN is
      // just an FX snapshot that drifts independently of value traded.
      const rankByUSD = multiples.every((t) => USD_RANKED_TYPES.has(t));

      entries = Array.from(consolidated.values())
        .sort((a, b) => {
          if (rankByUSD) {
            if (b.totalAmountUSD !== a.totalAmountUSD)
              return b.totalAmountUSD - a.totalAmountUSD;
            if (b.totalAmount !== a.totalAmount)
              return b.totalAmount - a.totalAmount;
          } else {
            if (b.totalAmount !== a.totalAmount)
              return b.totalAmount - a.totalAmount;
            if (b.totalAmountUSD !== a.totalAmountUSD)
              return b.totalAmountUSD - a.totalAmountUSD;
          }
          if (b.transactionCount !== a.transactionCount)
            return b.transactionCount - a.transactionCount;
          return 0;
        })
        .slice(0, limit)
        .map((entry, index) => ({
          rank: index + 1,
          user: entry.user,
          totalAmount: roundAmount(entry.totalAmount),
          totalAmountUSD: roundAmount(entry.totalAmountUSD),
          transactionCount: entry.transactionCount,
          lastTransactionAt: entry.lastTransactionAt,
        }));
    } else {
      entries = entries.slice(0, limit);
    }

    const result = {
      types: typesToQuery,
      period,
      periodKey,
      entries,
      lastUpdated: leaderboards[0]?.calculatedAt || new Date(),
    };

    await this.cacheService.set(cacheKey, result, CACHE_TTL.LEADERBOARD);
    return result;
  }

  // GET USER RAN

  async getUserRank(
    userId: string,
    type: string = "general",
    period: string = "monthly",
    multiples?: string[],
  ) {
    const typesToQuery = multiples && multiples.length > 0 ? multiples : [type];

    for (const t of typesToQuery) {
      if (!LEADERBOARD_TYPES.includes(t as any)) {
        throw new AppError(
          `Invalid leaderboard type: ${t}`,
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }
      const isEnabled = await this.isLeaderboardTypeEnabled(t);
      if (!isEnabled) {
        throw new AppError(
          `Leaderboard type '${t}' is currently disabled`,
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.UNAUTHORIZED,
        );
      }
    }
    if (!LEADERBOARD_ACTIVE_PERIODS.includes(period)) {
      return { ranked: false, message: "User not ranked yet" };
    }
    const periodKey = this.getPeriodKey(period);

    //  Single type — read stored rank directly (O(1))
    if (typesToQuery.length === 1) {
      const cacheKey = CACHE_KEYS.USER_LEADERBOARD_RANK(
        userId,
        typesToQuery[0],
        period,
        periodKey,
      );
      const cached = await this.cacheService.get(cacheKey);
      if (cached) return cached;

      const entry = await this.leaderboardRepository.findUserRank(
        userId,
        typesToQuery[0],
        period,
        periodKey,
      );

      if (!entry) {
        return { ranked: false, message: "User not ranked yet" };
      }

      const result = {
        ranked: true,
        rank: entry.rank,
        totalAmount: roundAmount(entry.totalAmount),
        totalAmountUSD: roundAmount(entry.totalAmountUSD),
        transactionCount: entry.transactionCount,
        lastTransactionAt: entry.lastTransactionAt,
        type: typesToQuery[0],
        period,
      };

      await this.cacheService.set(cacheKey, result, CACHE_TTL.USER_RANK);
      return result;
    }

    //  Multiple
    const compositeKey = this.getKnownCompositeKey(typesToQuery);
    const cacheKey = CACHE_KEYS.USER_LEADERBOARD_RANK(
      userId,
      compositeKey ?? `multiples_${[...typesToQuery].sort().join("_")}`,
      period,
      periodKey,
    );

    const cached = await this.cacheService.get(cacheKey);
    if (cached) return cached;

    //  Fast path: composite entry exists → O(log N) index count─
    if (compositeKey) {
      const userEntry = await this.leaderboardRepository.findUserRank(
        userId,
        compositeKey,
        period,
        periodKey,
      );

      if (userEntry) {
        // USD is the ranking unit for crypto/giftcard composites — NGN is
        // just an FX snapshot that drifts independently of value traded.
        const rankByUSD = USD_RANKED_TYPES.has(compositeKey);
        const rankField = rankByUSD ? "totalAmountUSD" : "totalAmount";
        const userRankValue = rankByUSD
          ? userEntry.totalAmountUSD
          : userEntry.totalAmount;

        // Count entries above the user using the index — no $group, no full scan
        const rankResult = await this.leaderboardRepository.aggregate([
          {
            $match: {
              type: compositeKey,
              period,
              periodKey,
              [rankField]: { $gt: userRankValue },
            },
          },
          { $count: "count" },
        ]);

        const rank = (rankResult[0]?.count || 0) + 1;

        const result = {
          ranked: true,
          rank,
          types: typesToQuery,
          totalAmount: roundAmount(userEntry.totalAmount),
          totalAmountUSD: roundAmount(userEntry.totalAmountUSD),
          transactionCount: userEntry.transactionCount,
          lastTransactionAt: userEntry.lastTransactionAt,
          period,
        };

        await this.cacheService.set(cacheKey, result, CACHE_TTL.USER_RANK);
        return result;
      }
      // No composite entry yet — fall through to live computation
      logger.info(
        `No composite entry for user ${userId} in ${compositeKey}, falling back to live computation`,
      );
    }

    //  Fallback: live aggregation across individual type entries─
    // Used when (a) the combination is not a known composite or
    // (b) the composite hasn't been computed yet for this user.
    const userEntries = await Promise.all(
      typesToQuery.map((t) =>
        this.leaderboardRepository.findUserRank(userId, t, period, periodKey),
      ),
    );

    if (userEntries.every((e) => !e)) {
      return { ranked: false, message: "User not ranked yet" };
    }

    let userTotalAmount = 0;
    let userTotalAmountUSD = 0;
    let userTransactionCount = 0;
    let userLastTransactionAt: Date | null = null;

    for (const entry of userEntries) {
      if (entry) {
        userTotalAmount += entry.totalAmount;
        userTotalAmountUSD += entry.totalAmountUSD || 0;
        userTransactionCount += entry.transactionCount;
        if (
          !userLastTransactionAt ||
          (entry.lastTransactionAt &&
            entry.lastTransactionAt > userLastTransactionAt)
        ) {
          userLastTransactionAt = entry.lastTransactionAt;
        }
      }
    }

    // USD is the ranking unit when every type in the query is USD-ranked
    // (e.g. crypto+giftcard) — NGN is just an FX snapshot that drifts
    // independently of value traded.
    const rankByUSD = typesToQuery.every((t) => USD_RANKED_TYPES.has(t));
    const rankField = rankByUSD ? "totalAmountUSD" : "totalAmount";
    const userRankValue = rankByUSD ? userTotalAmountUSD : userTotalAmount;

    // Group + count users above — O(N) but only used as a fallback
    const rankResult = await this.leaderboardRepository.aggregate([
      { $match: { type: { $in: typesToQuery }, period, periodKey } },
      {
        $group: {
          _id: "$userId",
          totalAmount: { $sum: "$totalAmount" },
          totalAmountUSD: { $sum: "$totalAmountUSD" },
        },
      },
      { $match: { [rankField]: { $gt: userRankValue } } },
      { $count: "count" },
    ]);

    const result = {
      ranked: true,
      rank: (rankResult[0]?.count || 0) + 1,
      types: typesToQuery,
      totalAmount: roundAmount(userTotalAmount),
      totalAmountUSD: roundAmount(userTotalAmountUSD),
      transactionCount: userTransactionCount,
      lastTransactionAt: userLastTransactionAt,
      period,
    };

    await this.cacheService.set(cacheKey, result, CACHE_TTL.USER_RANK);
    return result;
  }

  // GET ALL USER RANK─

  async getUserAllRanks(userId: string) {
    const validTypes = await this.getValidLeaderboardTypes();
    const periods = LEADERBOARD_ACTIVE_PERIODS;

    const ranks = await Promise.all(
      validTypes.flatMap((t) =>
        periods.map((p) => this.getUserRank(userId, t, p).catch(() => null)),
      ),
    );

    const grouped: any = {};
    let index = 0;
    for (const t of validTypes) {
      grouped[t] = {};
      for (const p of periods) {
        grouped[t][p] = ranks[index];
        index++;
      }
    }

    return grouped;
  }

  // CALCULATE INDIVIDUAL LEADERBOARD (cron)

  async calculateLeaderboard(type: string, period: string): Promise<void> {
    const isEnabled = await this.isLeaderboardTypeEnabled(type);
    if (!isEnabled) {
      logger.info(`Skipping disabled leaderboard: ${type}`);
      return;
    }

    const periodKey = this.getPeriodKey(period);
    const dateFilter = this.getDateFilter(period);

    logger.info(`Calculating leaderboard: ${type} - ${period} - ${periodKey}`);

    try {
      await this.leaderboardRepository.deleteStaleEntries(
        type,
        period,
        periodKey,
      );
      const { typeFilter, directionFilter, adminDepositMethods } =
        this.getTransactionFilters(type);

      const matchStage: any = {
        status: "success",
        ...(dateFilter && { createdAt: dateFilter }),
      };

      // directionFilter is scoped to the buy-side branch only — it must not
      // be applied at the matchStage level, since that would AND it against
      // the sell-side branch too, and sell payouts are always CREDIT
      // (making that branch unreachable).
      const typeConditions: any[] = [
        directionFilter
          ? { type: typeFilter, direction: directionFilter }
          : { type: typeFilter },
      ];
      if (adminDepositMethods && adminDepositMethods.length > 0) {
        typeConditions.push({
          type: TRANSACTION_TYPES.DEPOSIT,
          "meta.method": { $in: adminDepositMethods },
        });
      }
      matchStage.$or = typeConditions;

      const pipeline: any[] = [
        { $match: matchStage },
        {
          $group: {
            _id: "$sourceId",
            walletId: { $first: "$walletId" },
            totalAmount: { $sum: "$amount" },
            transactionCount: { $sum: 1 },
            lastTransactionAt: { $max: "$createdAt" },
          },
        },
        {
          $sort: {
            totalAmount: -1,
            transactionCount: -1,
            lastTransactionAt: 1,
          },
        },
        { $limit: 1000 },
      ];

      const results = await this.transactionRepository.aggregate(pipeline);

      if (results.length === 0) {
        logger.info(`No transactions found for ${type} - ${period}`);
        return;
      }

      const userIds = results.map((r: any) => r._id);
      const users = await this.userRepository.find({ _id: { $in: userIds } });
      const userMap = new Map(users.map((u) => [u.id.toString(), u]));

      // USD-ranked types (crypto/giftcard): this pipeline only has NGN data
      // from the Transaction collection, so rank can't be assigned correctly
      // here. Leave totalAmount/transactionCount as-is and re-derive rank
      // below via updateRanks(), which sorts by the right field once
      // totalAmountUSD is present on the stored documents.
      const rankByUSD = USD_RANKED_TYPES.has(type);

      const entries = results
        .map((result: any, index: number) => {
          const user = userMap.get(result._id.toString());
          if (!user) return null;

          return {
            userId: result._id,
            walletId: result.walletId,
            type,
            period,
            periodKey,
            totalAmount: roundAmount(result.totalAmount),
            // totalAmountUSD is not overwritten here — it accumulates via
            // real-time incrementUserStats calls and is preserved by bulkUpsert
            transactionCount: result.transactionCount,
            // For NGN-ranked types this NGN-sorted index is already correct.
            // For USD-ranked types it's a placeholder, corrected below.
            rank: index + 1,
            userDetails: {
              firstname: user.firstname,
              lastname: user.lastname,
              email: user.email,
              phone: user.phone,
              username: user.username,
            },
            lastTransactionAt: result.lastTransactionAt,
            calculatedAt: new Date(),
          };
        })
        .filter(Boolean);

      await this.leaderboardRepository.bulkUpsert(entries as any);

      if (rankByUSD) {
        // Re-derive rank now that totalAmountUSD is available on the stored
        // documents — this sorts by USD, not the NGN-based index above.
        await this.leaderboardRepository.updateRanks(type, period, periodKey);
      }

      await this.invalidateLeaderboardCache(type, period, periodKey);

      logger.info(
        `Leaderboard calculated: ${type} - ${period} - ${entries.length} entries`,
      );
    } catch (error: any) {
      logger.error(`Error calculating leaderboard: ${type} - ${period}`, error);
      throw error;
    }
  }

  // CALCULATE COMPOSITE LEADERBOARD

  async calculateCompositeLeaderboard(
    types: string[],
    period: string,
    periodKeyOverride?: string,
  ): Promise<void> {
    const compositeKey = getCompositeKey(types);
    const periodKey = periodKeyOverride || this.getPeriodKey(period);

    logger.info(
      `Calculating composite leaderboard: ${compositeKey} - ${period} - ${periodKey}`,
    );

    // Sharp cutover — same as calculateLeaderboard.
    await this.leaderboardRepository.deleteStaleEntries(
      compositeKey,
      period,
      periodKey,
    );

    const entries = await this.leaderboardRepository.findByTypesAndPeriod(
      types,
      period,
      periodKey,
      100_000,
    );

    if (entries.length === 0) {
      logger.info(
        `No individual entries found for composite ${compositeKey} - ${period}`,
      );
      return;
    }

    const consolidated = new Map<string, any>();

    for (const entry of entries) {
      const uid = entry.userId.toString();
      if (!consolidated.has(uid)) {
        consolidated.set(uid, {
          userId: entry.userId,
          walletId: entry.walletId,
          type: compositeKey,
          period,
          periodKey,
          totalAmount: 0,
          totalAmountUSD: 0,
          transactionCount: 0,
          lastTransactionAt: entry.lastTransactionAt,
          userDetails: entry.userDetails,
        });
      }
      const data = consolidated.get(uid)!;
      data.totalAmount += entry.totalAmount;
      data.totalAmountUSD += entry.totalAmountUSD || 0;
      data.transactionCount += entry.transactionCount;
      if (
        entry.lastTransactionAt &&
        data.lastTransactionAt &&
        new Date(entry.lastTransactionAt) > new Date(data.lastTransactionAt)
      ) {
        data.lastTransactionAt = entry.lastTransactionAt;
      }
    }

    const rankByUSD = USD_RANKED_TYPES.has(compositeKey);

    const sorted = Array.from(consolidated.values()).sort((a, b) => {
      if (rankByUSD) {
        if (b.totalAmountUSD !== a.totalAmountUSD)
          return b.totalAmountUSD - a.totalAmountUSD;
        if (b.totalAmount !== a.totalAmount)
          return b.totalAmount - a.totalAmount;
      } else {
        if (b.totalAmount !== a.totalAmount)
          return b.totalAmount - a.totalAmount;
        if (b.totalAmountUSD !== a.totalAmountUSD)
          return b.totalAmountUSD - a.totalAmountUSD;
      }
      if (b.transactionCount !== a.transactionCount)
        return b.transactionCount - a.transactionCount;
      return 0;
    });

    const compositeEntries = sorted.map((entry, i) => ({
      ...entry,
      rank: i + 1,
      calculatedAt: new Date(),
    }));

    await this.leaderboardRepository.bulkUpsert(compositeEntries);
    await this.invalidateLeaderboardCache(compositeKey, period, periodKey);

    logger.info(
      `Composite leaderboard calculated: ${compositeKey} - ${period} - ${compositeEntries.length} entries`,
    );
  }

  // CALCULATE ALL (cron entry point)

  async calculateAllLeaderboards(): Promise<void> {
    // ACTIVE_LEADERBOARD_TYPES below controls what the cron actually computes.
    // Trim getValidLeaderboardTypes()'s full list down to only what the UI consumes,
    // to avoid wasting cycles calculating types nobody reads.
    const ACTIVE_LEADERBOARD_TYPES = ["general", "crypto", "giftcard"];
    const validTypes = ACTIVE_LEADERBOARD_TYPES;
    const periods = LEADERBOARD_ACTIVE_PERIODS;

    logger.info("Starting full leaderboard calculation");

    // Individual types first
    for (const type of validTypes) {
      for (const period of periods) {
        try {
          await this.calculateLeaderboard(type, period);
        } catch (error: any) {
          logger.error(`Failed to calculate ${type} - ${period}:`, error);
        }
      }
    }

    // Composite types after — they read from the just-computed individual entries
    for (const compositeGroup of LEADERBOARD_COMPOSITE_TYPES) {
      for (const period of periods) {
        try {
          await this.calculateCompositeLeaderboard(compositeGroup, period);
        } catch (error: any) {
          logger.error(
            `Failed to calculate composite ${compositeGroup.join("+")} - ${period}:`,
            error,
          );
        }
      }
    }

    logger.info("Completed full leaderboard calculation");
  }

  // REAL-TIME UPDAT─

  async updateUserStats(
    userId: string,
    walletId: string,
    type: string,
    amount: number,
    direction?: "DEBIT" | "CREDIT",
    amountUSD: number = 0, // NEW — non-zero only for giftcard and crypto
  ): Promise<void> {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user) {
        logger.warn(`User not found for leaderboard update: ${userId}`);
        return;
      }

      const userDetails = {
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        phone: user.phone,
        username: user.username,
      };

      const typesToUpdate: string[] = ["general", type.toLowerCase()];
      const periods = LEADERBOARD_ACTIVE_PERIODS;

      //  Update individual type
      for (const updateType of typesToUpdate) {
        for (const period of periods) {
          const periodKey = this.getPeriodKey(period);

          await this.leaderboardRepository.incrementUserStats(
            userId,
            walletId,
            updateType,
            period,
            periodKey,
            amount,
            amountUSD,
            userDetails,
          );

          await this.invalidateLeaderboardCache(updateType, period, periodKey);

          const cacheKey = CACHE_KEYS.USER_LEADERBOARD_RANK(
            userId,
            updateType,
            period,
            periodKey,
          );
          await this.cacheService.delete(cacheKey);
        }
      }

      //  Also update any composite that includes this type
      const lowerType = type.toLowerCase();
      for (const compositeGroup of LEADERBOARD_COMPOSITE_TYPES) {
        if (!compositeGroup.includes(lowerType)) continue;

        const compositeKey = getCompositeKey(compositeGroup);

        for (const period of periods) {
          const periodKey = this.getPeriodKey(period);

          await this.leaderboardRepository.incrementUserStats(
            userId,
            walletId,
            compositeKey,
            period,
            periodKey,
            amount,
            amountUSD,
            userDetails,
          );

          await this.invalidateLeaderboardCache(
            compositeKey,
            period,
            periodKey,
          );

          const cacheKey = CACHE_KEYS.USER_LEADERBOARD_RANK(
            userId,
            compositeKey,
            period,
            periodKey,
          );
          await this.cacheService.delete(cacheKey);
        }
      }

      logger.info(`User stats updated for leaderboard: ${userId} - ${type}`);
    } catch (error: any) {
      logger.error("Error updating user leaderboard stats:", error);
    }
  }

  // RECALCULATE FROM TRANSACTIONS
  async recalculateLeaderboardFromTransactions(targetMonth?: string): Promise<{
    success: boolean;
    message: string;
    details: {
      deletedCount: number;
      leaderboardsCreated: number;
      entriesInserted: number;
    };
  }> {
    try {
      // targetMonth format: "yyyy-MM" (e.g. "2026-06"). Defaults to the
      // current month. Only ever touches ONE month, monthly period only —
      // never the full history, never other periods.
      const monthKey =
        targetMonth || format(startOfMonth(new Date()), "yyyy-MM");
      const monthStart = new Date(`${monthKey}-01T00:00:00.000Z`);
      const monthEnd = new Date(monthStart);
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
      const monthDateFilter = { $gte: monthStart, $lt: monthEnd };

      logger.info(`🧹 Starting leaderboard recalculation for ${monthKey}...`);

      // DELETE ONLY THIS MONTH'S LEADERBOARD DATA (monthly period only)
      const deletedCount = await this.leaderboardRepository.deleteMany({
        period: "monthly",
        periodKey: monthKey,
      });
      logger.info(
        ` Deleted ${deletedCount} old leaderboard entries for ${monthKey}`,
      );

      const cryptoUSDMap = new Map<string, number>();
      const giftcardUSDMap = new Map<string, number>();

      logger.info("💱 Building crypto USD map...");

      const cryptoTxs = await this.cryptoTransactionRepository.find({
        status: { $in: ["approved", "s.approved", "transferred", "success"] },
        deletedAt: { $exists: false },
        createdAt: monthDateFilter,
      });

      for (const tx of cryptoTxs) {
        const mapKey = `${tx.userId.toString()}_monthly_${monthKey}`;
        cryptoUSDMap.set(
          mapKey,
          (cryptoUSDMap.get(mapKey) || 0) + (tx.cryptoAmount || 0),
        );
      }

      logger.info(` Crypto USD map built — ${cryptoTxs.length} transactions`);

      logger.info("🎁 Building giftcard USD map...");

      // Buy: success status | Sell: approved or s.approved | "multiple" rows
      // (the group marker on multi-card parents) are excluded so they don't
      // double-count alongside their own children.
      const giftcardTxs = await this.giftCardTransactionRepository.find({
        status: { $ne: "multiple" },
        createdAt: monthDateFilter,
        $or: [
          { tradeType: "sell", status: { $in: ["approved", "s.approved"] } },
          { tradeType: "buy", status: "success" },
        ],
      });

      for (const tx of giftcardTxs) {
        const mapKey = `${tx.userId.toString()}_monthly_${monthKey}`;
        giftcardUSDMap.set(
          mapKey,
          (giftcardUSDMap.get(mapKey) || 0) + (tx.amount || 0),
        );
      }

      logger.info(
        ` Giftcard USD map built — ${giftcardTxs.length} transactions`,
      );

      // GET THIS MONTH'S SUCCESSFUL TRANSACTIONS ONLY
      const transactions = await this.transactionRepository.find({
        status: "success",
        deletedAt: { $exists: false },
        createdAt: monthDateFilter,
      });

      logger.info(
        `📊 Found ${transactions.length} successful transactions for ${monthKey}`,
      );

      const leaderboardData: Map<string, any> = new Map();

      for (const transaction of transactions) {
        const userId = transaction.sourceId!.toString();
        const createdAt = new Date(transaction.createdAt);

        const txType = this.getActualTradeType(
          transaction.type,
          transaction.meta?.method,
          transaction.transactableType,
        );

        if (
          transaction.type === TRANSACTION_TYPES.DEPOSIT &&
          txType === TRANSACTION_TYPES.DEPOSIT
        ) {
          continue;
        }

        const typesToTrack = ["general", txType];

        for (const type of typesToTrack) {
          if (type === "general" && !this.isValidLeaderboardType(txType)) {
            continue;
          }

          const mapKey = `${userId}_${type}_monthly_${monthKey}`;

          if (!leaderboardData.has(mapKey)) {
            leaderboardData.set(mapKey, {
              userId,
              type,
              period: "monthly",
              periodKey: monthKey,
              totalAmount: 0,
              totalAmountUSD: 0,
              transactionCount: 0,
              lastTransactionAt: null,
              userDetails: null,
            });
          }

          const data = leaderboardData.get(mapKey)!;
          data.totalAmount += transaction.amount;
          data.transactionCount += 1;
          if (!data.lastTransactionAt || createdAt > data.lastTransactionAt) {
            data.lastTransactionAt = createdAt;
          }
        }
      }

      logger.info(`📈 Prepared ${leaderboardData.size} leaderboard entries`);

      for (const [, data] of leaderboardData) {
        const usdLookupKey = `${data.userId}_monthly_${monthKey}`;

        if (data.type === TRANSACTION_TYPES.CRYPTO) {
          data.totalAmountUSD = cryptoUSDMap.get(usdLookupKey) || 0;
        } else if (data.type === TRANSACTION_TYPES.GIFTCARD) {
          data.totalAmountUSD = giftcardUSDMap.get(usdLookupKey) || 0;
        } else if (data.type === "general") {
          data.totalAmountUSD =
            (cryptoUSDMap.get(usdLookupKey) || 0) +
            (giftcardUSDMap.get(usdLookupKey) || 0);
        }
      }

      const userIds = Array.from(
        new Set(Array.from(leaderboardData.values()).map((d) => d.userId)),
      );
      const users = await this.userRepository.find({ _id: { $in: userIds } });
      const userMap = new Map(users.map((u) => [u.id.toString(), u]));

      logger.info(`👥 Loaded details for ${users.length} users`);

      const finalEntries: any[] = [];

      for (const [, data] of leaderboardData) {
        const user = userMap.get(data.userId);
        if (!user) {
          logger.warn(`User not found: ${data.userId}`);
          continue;
        }
        data.userDetails = {
          firstname: user.firstname,
          lastname: user.lastname,
          email: user.email,
          phone: user.phone,
          username: user.username,
        };
        finalEntries.push(data);
      }

      // Group and rank within each type bucket (single period: monthly)
      const grouped: any = {};
      for (const entry of finalEntries) {
        const key = entry.type;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(entry);
      }

      const rankedEntries: any[] = [];
      for (const [, group] of Object.entries(grouped)) {
        const sampleType = (group as any[])[0]?.type;
        const rankByUSD = USD_RANKED_TYPES.has(sampleType);

        const sortedGroup = (group as any[]).sort((a, b) => {
          if (rankByUSD) {
            if (b.totalAmountUSD !== a.totalAmountUSD)
              return b.totalAmountUSD - a.totalAmountUSD;
            if (b.totalAmount !== a.totalAmount)
              return b.totalAmount - a.totalAmount;
          } else {
            if (b.totalAmount !== a.totalAmount)
              return b.totalAmount - a.totalAmount;
            if (b.totalAmountUSD !== a.totalAmountUSD)
              return b.totalAmountUSD - a.totalAmountUSD;
          }
          if (b.transactionCount !== a.transactionCount)
            return b.transactionCount - a.transactionCount;
          return (
            new Date(a.lastTransactionAt).getTime() -
            new Date(b.lastTransactionAt).getTime()
          );
        });
        sortedGroup.forEach((entry, i) => {
          entry.rank = i + 1;
          entry.calculatedAt = new Date();
          rankedEntries.push(entry);
        });
      }

      logger.info(`🎯 Ranked ${rankedEntries.length} total entries`);

      if (rankedEntries.length > 0) {
        await this.leaderboardRepository.bulkUpsert(rankedEntries);
        logger.info(` Inserted ${rankedEntries.length} leaderboard entries`);
      }

      // REBUILD COMPOSITE LEADERBOARDS for this month only
      logger.info("🔗 Rebuilding composite leaderboards...");
      for (const compositeGroup of LEADERBOARD_COMPOSITE_TYPES) {
        try {
          await this.calculateCompositeLeaderboard(
            compositeGroup,
            "monthly",
            monthKey,
          );
        } catch (err: any) {
          logger.error(
            `Composite rebuild failed ${compositeGroup.join("+")} - monthly - ${monthKey}:`,
            err,
          );
        }
      }

      await this.cacheService.delete("*leaderboard*");
      logger.info("🧹 Cleared leaderboard caches");

      return {
        success: true,
        message: `Leaderboard successfully recalculated for ${monthKey}`,
        details: {
          deletedCount,
          leaderboardsCreated: Object.keys(grouped).length,
          entriesInserted: rankedEntries.length,
        },
      };
    } catch (error: any) {
      logger.error("❌ Error recalculating leaderboard:", error);
      throw error;
    }
  }

  // PRIVATE HELPER

  private isValidLeaderboardType(txType: string): boolean {
    return LEADERBOARD_TYPES.includes(txType as any);
  }

  private getPeriodKey(period: string): string {
    const now = new Date();
    switch (period) {
      case LEADERBOARD_PERIODS.ALL_TIME:
        return "all";
      case LEADERBOARD_PERIODS.MONTHLY:
        return format(startOfMonth(now), "yyyy-MM");
      case LEADERBOARD_PERIODS.WEEKLY:
        return format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-'W'ww");
      case LEADERBOARD_PERIODS.DAILY:
        return format(startOfDay(now), "yyyy-MM-dd");
      default:
        return "all";
    }
  }

  private getDateFilter(period: string): any {
    const now = new Date();
    switch (period) {
      case LEADERBOARD_PERIODS.ALL_TIME:
        return null;
      case LEADERBOARD_PERIODS.MONTHLY:
        return { $gte: startOfMonth(now) };
      case LEADERBOARD_PERIODS.WEEKLY:
        return { $gte: startOfWeek(now, { weekStartsOn: 1 }) };
      case LEADERBOARD_PERIODS.DAILY:
        return { $gte: startOfDay(now) };
      default:
        return null;
    }
  }

  private getTransactionFilters(type: string): {
    typeFilter: any;
    directionFilter?: string;
    adminDepositMethods?: string[];
  } {
    if (type === "general") {
      return {
        typeFilter: { $in: Array.from(LEADERBOARD_TYPES) },
        directionFilter: "DEBIT",
        adminDepositMethods: [
          ADMIN_DEPOSIT_TRANSACTION_TYPES.GIFTCARD_APPROVE,
          ADMIN_DEPOSIT_TRANSACTION_TYPES.GIFTCARD_SECOND_APPROVE,
          ADMIN_DEPOSIT_TRANSACTION_TYPES.CRYPTO_APPROVE,
          ADMIN_DEPOSIT_TRANSACTION_TYPES.CRYPTO_SECOND_APPROVE,
        ],
      };
    }
    if (type === TRANSACTION_TYPES.GIFTCARD) {
      return {
        typeFilter: TRANSACTION_TYPES.GIFTCARD,
        directionFilter: "DEBIT",
        adminDepositMethods: [
          ADMIN_DEPOSIT_TRANSACTION_TYPES.GIFTCARD_APPROVE,
          ADMIN_DEPOSIT_TRANSACTION_TYPES.GIFTCARD_SECOND_APPROVE,
        ],
      };
    }
    if (type === TRANSACTION_TYPES.CRYPTO) {
      return {
        typeFilter: TRANSACTION_TYPES.CRYPTO,
        directionFilter: "DEBIT",
        adminDepositMethods: [
          ADMIN_DEPOSIT_TRANSACTION_TYPES.CRYPTO_APPROVE,
          ADMIN_DEPOSIT_TRANSACTION_TYPES.CRYPTO_SECOND_APPROVE,
        ],
      };
    }
    if (LEADERBOARD_TYPES.includes(type as any)) {
      return { typeFilter: type, directionFilter: "DEBIT" };
    }
    return { typeFilter: type };
  }

  private async invalidateLeaderboardCache(
    type: string,
    period: string,
    periodKey: string,
  ): Promise<void> {
    await this.cacheService.delete(
      CACHE_KEYS.LEADERBOARD(type, period, periodKey),
    );
  }
}
