import { Response, NextFunction } from "express";
import Sentry from "@/config/sentry";
import { AuthenticatedAdminRequest } from "./adminAuth";
import { sendErrorResponse } from "@/utils/helpers";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { CryptoTransaction } from "@/models/crypto/CryptoTransaction";
import { ADMIN_PERMISSIONS } from "@/utils/admin-permissions";
import { GiftCardTransaction } from "@/models/giftcard/GiftCardTransaction";
import logger from "@/logger";
import { Network } from "@/models/crypto/Network";

export const requirePermission = (...permissions: string[]) => {
  return (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    if (!req.admin) {
      return sendErrorResponse(
        res,
        "Admin authentication required",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // Super admin has all permissions
    if (req.admin.permissions.includes("*")) {
      return next();
    }

    // Check if admin has at least one of the required permissions
    const hasPermission = permissions.some((permission) =>
      req.admin.permissions.includes(permission),
    );

    if (!hasPermission) {
      try {
        Sentry.captureMessage(
          `Admin permission denied: required permissions not granted`,
          {
            level: "warning",
            tags: {
              adminId: req.admin.id.toString(),
              adminLevel: req.admin.adminLevel,
              route: req.path,
            },
            contexts: {
              permissionDenial: {
                requiredPermissions: permissions,
                adminPermissions: req.admin.permissions.slice(0, 10), // First 10 for context
              },
            },
          },
        );
      } catch (sentryErr) {
        logger.error(
          "[Sentry] Failed to capture permission denial:",
          sentryErr,
        );
      }

      return sendErrorResponse(
        res,
        "Insufficient permissions",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    next();
  };
};

export const requireNetworkPermission = async (
  req: AuthenticatedAdminRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.admin) {
      return sendErrorResponse(
        res,
        "Admin authentication required",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // Super admin bypasses everything
    if (req.admin.permissions.includes("*")) {
      return next();
    }

    const { id } = req.params;

    // Fetch the transaction
    const transaction = await CryptoTransaction.findById(id);
    if (!transaction) {
      return sendErrorResponse(
        res,
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    const { networkId } = transaction.network;
    const { tradeType } = transaction;

    // Determine which permission to check based on tradeType
    const globalPermission =
      tradeType === "buy"
        ? ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY
        : ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL;

    const normalizedNetworkId = networkId.toLowerCase();
    const networkPermission = `${globalPermission}.network:${normalizedNetworkId}`;

    if (
      !req.admin.permissions.some((p: string) => p.toLowerCase() === networkPermission)
    ) {
      try {
        Sentry.captureMessage(
          `Admin network permission denied for crypto transaction`,
          {
            level: "warning",
            tags: {
              adminId: req.admin.id.toString(),
              adminLevel: req.admin.adminLevel,
              transactionId: id,
              networkId: networkId.toString(),
              tradeType,
              route: req.path,
            },
            contexts: {
              permissionDenial: {
                requiredPermission: networkPermission,
                transactionNetwork: networkId.toString(),
              },
            },
          },
        );
      } catch (sentryErr) {
        logger.error(
          "[Sentry] Failed to capture network permission denial:",
          sentryErr,
        );
      }

      return sendErrorResponse(
        res,
        "You do not have permission to manage transactions on this network",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // Attach transaction to request so controller doesn't fetch it again
    req.cryptoTransaction = transaction;

    next();
  } catch (error) {
    return sendErrorResponse(
      res,
      "Authorization failed",
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      ERROR_CODES.INTERNAL_ERROR,
    );
  }
};

export const requireCategoryPermission = async (
  req: AuthenticatedAdminRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.admin) {
      return sendErrorResponse(
        res,
        "Admin authentication required",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // Super admin bypasses everything
    if (req.admin.permissions.includes("*")) {
      return next();
    }

    const { id } = req.params;

    // Fetch transaction and populate giftCardId to get categoryId
    const transaction = await GiftCardTransaction.findById(id).populate<{
      giftCardId: { categoryId: { _id: { toString(): string } } };
    }>({
      path: "giftCardId",
      select: "categoryId",
      populate: { path: "categoryId", select: "_id" },
    });

    if (!transaction) {
      return sendErrorResponse(
        res,
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
      );
    }

    // Buy transactions — only check global buy permission, no category filtering
    if (transaction.tradeType === "buy") {
      const hasBuyPermission = req.admin.permissions.includes(
        ADMIN_PERMISSIONS.GIFTCARD.MANAGE_BUY,
      );
      if (!hasBuyPermission) {
        try {
          Sentry.captureMessage(
            `Admin buy permission denied for giftcard transaction`,
            {
              level: "warning",
              tags: {
                adminId: req.admin.id.toString(),
                adminLevel: req.admin.adminLevel,
                transactionId: id,
                tradeType: "buy",
                route: req.path,
              },
            },
          );
        } catch (sentryErr) {
          logger.error(
            "[Sentry] Failed to capture buy permission denial:",
            sentryErr,
          );
        }

        return sendErrorResponse(
          res,
          "You do not have permission to manage buy transactions",
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.UNAUTHORIZED,
        );
      }
      req.giftcardTransaction = transaction;
      return next();
    }

    // Sell transactions — check category-level permission
    const categoryId = transaction.giftCardId?.categoryId?._id?.toString();

    if (!categoryId) {
      return sendErrorResponse(
        res,
        "Could not determine transaction category",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
      );
    }

    const categoryPermission = `${ADMIN_PERMISSIONS.GIFTCARD.MANAGE_SELL}.category:${categoryId}`;

    if (!req.admin.permissions.includes(categoryPermission)) {
      try {
        Sentry.captureMessage(
          `Admin category permission denied for giftcard transaction`,
          {
            level: "warning",
            tags: {
              adminId: req.admin.id.toString(),
              adminLevel: req.admin.adminLevel,
              transactionId: id,
              categoryId,
              tradeType: "sell",
              route: req.path,
            },
            contexts: {
              permissionDenial: {
                requiredPermission: categoryPermission,
                transactionCategory: categoryId,
              },
            },
          },
        );
      } catch (sentryErr) {
        logger.error(
          "[Sentry] Failed to capture category permission denial:",
          sentryErr,
        );
      }

      return sendErrorResponse(
        res,
        "You do not have permission to manage transactions in this category",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // Attach transaction to request so controller doesn't fetch again
    req.giftcardTransaction = transaction;

    next();
  } catch (error) {
    return sendErrorResponse(
      res,
      "Authorization failed",
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      ERROR_CODES.INTERNAL_ERROR,
    );
  }
};

export const requireNetworkAccess = (
  ...globalOverridePermissions: string[]
) => {
  return async (
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (!req.admin) {
        return sendErrorResponse(
          res,
          "Admin authentication required",
          HTTP_STATUS.UNAUTHORIZED,
          ERROR_CODES.UNAUTHORIZED,
        );
      }

      // Super admin bypasses everything
      if (req.admin.permissions.includes("*")) {
        return next();
      }

      // Global override: admin can act on any network
      const hasGlobalOverride = globalOverridePermissions.some((permission) =>
        req.admin.permissions.includes(permission),
      );

      if (hasGlobalOverride) {
        return next();
      }

      // No global override — must be scoped to THIS specific network
      const { id } = req.params;

      const network = await Network.findById(id);
      if (!network) {
        return sendErrorResponse(
          res,
          "Network not found",
          HTTP_STATUS.NOT_FOUND,
          ERROR_CODES.NOT_FOUND,
        );
      }

      const normalizedNetworkId = network.networkId.toLowerCase();
      const buyNetworkPermission = `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_BUY}.network:${normalizedNetworkId}`;
      const sellNetworkPermission = `${ADMIN_PERMISSIONS.CRYPTO.MANAGE_SELL}.network:${normalizedNetworkId}`;

      const hasNetworkScope =
        req.admin.permissions.some(
          (p: string) => p.toLowerCase() === buyNetworkPermission,
        ) ||
        req.admin.permissions.some(
          (p: string) => p.toLowerCase() === sellNetworkPermission,
        );

      if (!hasNetworkScope) {
        return sendErrorResponse(
          res,
          "You do not have permission to manage this network",
          HTTP_STATUS.FORBIDDEN,
          ERROR_CODES.UNAUTHORIZED,
        );
      }

      // Attach so controller doesn't refetch
      // req.network = network;

      next();
    } catch (error) {
      return sendErrorResponse(
        res,
        "Authorization failed",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
      );
    }
  };
};
