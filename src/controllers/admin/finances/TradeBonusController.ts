import { NextFunction, Response, Request } from "express";
import { TradeBonusService } from "@/services/admin/finances/TradeBonusService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import AdminServiceContainer from "@/services/admin/container";

export class TradeBonusController {
  private tradeBonusService: TradeBonusService;

  constructor() {
    this.tradeBonusService = AdminServiceContainer.getTradeBonusService();
  }

  createBonus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bonus = await this.tradeBonusService.createTradeBonus(req.body);
      return sendSuccessResponse(res, bonus, "Trade bonus created successfully", HTTP_STATUS.CREATED);
    } catch (error) {
      next(error);
    }
  };

  getBonuses = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const bonuses = await this.tradeBonusService.getBonuses();
      return sendSuccessResponse(res, bonuses, "Bonuses retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  getBonusById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bonus = await this.tradeBonusService.getBonusById(req.params.id);
      if (!bonus) {
        throw new AppError(
          "Trade bonus not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND
        );
      }
      return sendSuccessResponse(res, bonus, "Trade bonus retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  updateBonus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bonus = await this.tradeBonusService.updateTradeBonus(
        req.params.id,
        req.body
      );
      if (!bonus) {
        throw new AppError(
          "Trade bonus not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND
        );
      }
      return sendSuccessResponse(res, bonus, "Trade bonus updated successfully");
    } catch (error) {
      next(error);
    }
  };

  deleteBonus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await this.tradeBonusService.deleteTradeBonus(req.params.id);
      return sendSuccessResponse(res, null, "Trade bonus deleted successfully");
    } catch (error) {
      next(error);
    }
  };
}