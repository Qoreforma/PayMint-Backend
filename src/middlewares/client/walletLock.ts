import { Response, NextFunction } from "express";
import Sentry from "@/config/sentry";
import { AuthRequest } from "@/middlewares/client/auth";
import { sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { CacheService } from "@/services/core/CacheService";

const LOCK_TTL = 30; // Lock time-to-live in seconds
const LOCK_PREFIX = "wallet_lock:";

const cacheService = new CacheService();

export const walletLock = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user!.id;
    const lockKey = `${LOCK_PREFIX}${userId}`;

    // Try to acquire lock using SET NX (set if not exists) with expiration
    const lockAcquired = await cacheService.acquireLock(
      lockKey,
      Date.now().toString(),
      LOCK_TTL,
    );

    // If lock not acquired (returns null), wallet is already locked
    if (!lockAcquired) {
      try {
        Sentry.captureMessage(
          `Wallet lock conflict - concurrent transaction attempt`,
          {
            level: "warning",
            tags: {
              userId: userId.toString(),
              event: "wallet_lock_conflict",
              route: req.path,
            },
          },
        );
      } catch (sentryErr) {
        logger.error(
          "[Sentry] Failed to capture wallet lock conflict:",
          sentryErr,
        );
      }

      logger.warn(`Wallet lock conflict for user ${userId}`);
      return sendErrorResponse(
        res,
        "A transaction is currently in progress. Please wait.",
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.WALLET_LOCKED,
      );
    }

    logger.debug(`Wallet lock acquired for user ${userId}`);

    // Release lock after response is sent
    res.on("finish", async () => {
      try {
        await cacheService.delete(lockKey);
        logger.debug(`Wallet lock released for user ${userId}`);
      } catch (error) {
        logger.error(`Error releasing wallet lock for user ${userId}:`, error);

        try {
          Sentry.captureException(error as Error, {
            tags: {
              userId: userId.toString(),
              event: "wallet_lock_release_failure",
            },
          });
        } catch (sentryErr) {
          logger.error(
            "[Sentry] Failed to capture lock release failure:",
            sentryErr,
          );
        }
      }
    });

    next();
  } catch (error) {
    logger.error("Error in walletLock middleware:", error);

    try {
      Sentry.captureException(error as Error, {
        tags: {
          event: "wallet_lock_error",
          route: req.path,
        },
      });
    } catch (sentryErr) {
      logger.error("[Sentry] Failed to capture wallet lock error:", sentryErr);
    }

    next(error);
  }
};
