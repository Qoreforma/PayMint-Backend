import { NextFunction } from "express";
import { Response } from "express";
import { LeaderboardService } from "../../services/client/LeaderboardService";
import { sendSuccessResponse } from "../../utils/helpers";
import { AuthRequest } from "../../middlewares/client/auth";
import ServiceContainer from "@/services/client/container";

export class LeaderboardController {
  private leaderboardService: LeaderboardService;

  constructor() {
    this.leaderboardService = ServiceContainer.getLeaderboardService();
  }

  getLeaderboard = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const type = (req.query.type as string) || "general";
      const period = (req.query.period as string) || "monthly";
      const limit = parseInt(req.query.limit as string) || 50;
      const multiples = req.query.multiples
        ? (req.query.multiples as string).split(",").map((t) => t.trim())
        : undefined;

      const leaderboard = await this.leaderboardService.getLeaderboard(
        type,
        period,
        limit,
        multiples,
      );

      return sendSuccessResponse(
        res,
        leaderboard,
        "Leaderboard retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getUserRank = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const type = (req.query.type as string) || "general";
      const period = (req.query.period as string) || "monthly";
      const multiples = req.query.multiples
      ? (req.query.multiples as string).split(",").map((t) => t.trim())
      : undefined;
      const rank = await this.leaderboardService.getUserRank(
        userId,
        type,
        period,
        multiples,
      );

      return sendSuccessResponse(res, rank, "User rank retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  getUserAllRanks = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;

      const ranks = await this.leaderboardService.getUserAllRanks(userId);

      return sendSuccessResponse(
        res,
        ranks,
        "User ranks retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };
}
