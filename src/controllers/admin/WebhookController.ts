import { Request, Response, NextFunction } from "express";
import { WebhookService } from "@/services/WebhookService";
import { sendSuccessResponse } from "@/utils/helpers";
import logger from "@/logger";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES, CACHE_KEYS } from "@/utils/constants";
import { VTPassService } from "@/services/client/providers/billpayment/VtpassService";
import { SafeHavenWebhookProcessor } from "@/services/client/webhooks/SafeHavenWebhookProcessor";
import { MonnifyWebhookProcessor } from "@/services/client/webhooks/MonnifyWebhookProcessor";
import { MonnifyWebhookService } from "@/services/client/webhooks/MonnifyWebhookService";
import { FlutterwaveWebhookProcessor } from "@/services/client/webhooks/FlutterwaveWebhookProcessor";
import { FlutterwaveWebhookService } from "@/services/client/webhooks/FlutterwaveWebhookService";
import { SaveHavenWebhookService } from "@/services/client/webhooks/SaveHavenWebhookService";
import ServiceContainer from "@/services/client/container";
import { NowPaymentsWebhookProcessor } from "@/services/client/webhooks/Nowpaymentswebhookprocessor";
import { NowPaymentsWebhookService } from "@/services/client/webhooks/Nowpaymentswebhookservice";
import ClubKonnectWebhook from "@/services/client/webhooks/ClubKonnectWebhook";
import { BreetWebhookService } from "@/services/client/webhooks/BreetWebhookService";
import { TatumWebhookService } from "@/services/client/webhooks/Tatumwebhookservice";
import redisConfig from "@/config/redis";
import { XixapayWebhookProcessor } from "@/services/client/webhooks/Xixapaywebhookprocessor";
import { XixapayWebhookService } from "@/services/client/webhooks/Xixapaywebhookservice";

// Routes to appropriate processor → WebhookService
export class WebhookController {
  private webhookService: WebhookService;
  private vtpassService: VTPassService;
  private saveHavenProcessor: SafeHavenWebhookProcessor;
  private saveHavenService: SaveHavenWebhookService;
  private monnifyProcessor: MonnifyWebhookProcessor;
  private monnifyService: MonnifyWebhookService;
  private flutterwaveProcessor: FlutterwaveWebhookProcessor;
  private flutterwaveService: FlutterwaveWebhookService;
  private nowPaymentsProcessor: NowPaymentsWebhookProcessor;
  private nowPaymentsService: NowPaymentsWebhookService;
  private clubkonnectWebhook: ClubKonnectWebhook;
  private tatumWebhookService: TatumWebhookService;
  private breetWebhookService: BreetWebhookService;
  private xixapayProcessor: XixapayWebhookProcessor;
  private xixapayService: XixapayWebhookService;

  constructor() {
    this.webhookService = new WebhookService();
    this.vtpassService = new VTPassService();
    this.saveHavenProcessor = new SafeHavenWebhookProcessor();
    this.saveHavenService = new SaveHavenWebhookService(
      ServiceContainer.getNotificationService(),
    );
    this.monnifyProcessor = new MonnifyWebhookProcessor();
    this.monnifyService = new MonnifyWebhookService();
    this.flutterwaveProcessor = new FlutterwaveWebhookProcessor();
    this.flutterwaveService = new FlutterwaveWebhookService();
    this.nowPaymentsProcessor = new NowPaymentsWebhookProcessor();
    this.nowPaymentsService = new NowPaymentsWebhookService();
    this.clubkonnectWebhook = new ClubKonnectWebhook(
      ServiceContainer.getWalletService(),
      ServiceContainer.getNotificationService(),
    );
    this.tatumWebhookService = new TatumWebhookService(
      ServiceContainer.getTatumService(),
      ServiceContainer.getCryptoTransactionRepository(),
      ServiceContainer.getCryptoRepository(),
      ServiceContainer.getNetworkRepository(),
      ServiceContainer.getWalletService(),
      ServiceContainer.getNotificationService(),
      ServiceContainer.getHelperService(),
      ServiceContainer.getProviderRateConfigRepository(),
      ServiceContainer.getUserRepository(),
    );
    this.breetWebhookService = new BreetWebhookService(
      ServiceContainer.getCryptoTransactionRepository(),
      ServiceContainer.getCryptoRepository(),
      ServiceContainer.getNetworkRepository(),
      ServiceContainer.getWalletService(),
      ServiceContainer.getNotificationService(),
      ServiceContainer.getHelperService(),
      ServiceContainer.getUserRepository(),
      ServiceContainer.getBankAccountRepository(),
    );
    this.xixapayProcessor = new XixapayWebhookProcessor();
    this.xixapayService = new XixapayWebhookService(
      ServiceContainer.getNotificationService(),
    );
  }

  // Handle VTPass webhook callbacks
  handleVTPassWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      logger.info("VTPass webhook endpoint hit", {
        body: req.body,
        ip: req.ip,
      });

      // Optional: Validate webhook IP
      // const clientIP = req.ip || req.connection.remoteAddress;
      // if (!this.vtpassProcessor.validateIP(clientIP)) {
      //   logger.warn("VTPass webhook from unauthorized IP", { ip: clientIP });
      //   throw new AppError(
      //     "Unauthorized",
      //     HTTP_STATUS.UNAUTHORIZED,
      //     ERROR_CODES.UNAUTHORIZED
      //   );
      // }

      // Optional: Validate webhook signature
      // const signature = req.headers["x-vtpass-signature"] as string;
      // const secret = process.env.VTPASS_WEBHOOK_SECRET || "";
      // if (!this.vtpassProcessor.validateSignature(JSON.stringify(req.body), signature, secret)) {
      //   logger.warn("VTPass webhook invalid signature");
      //   throw new AppError(
      //     "Invalid signature",
      //     HTTP_STATUS.UNAUTHORIZED,
      //     ERROR_CODES.UNAUTHORIZED
      //   );
      // }

      // Process webhook through VTPass processor
      const webhookData = await this.vtpassService.process(req.body);

      // Pass to unified webhook service
      await this.webhookService.processWebhook("VTPass", webhookData);

      return res.status(HTTP_STATUS.OK).json({
        response: "success",
      });
    } catch (error) {
      logger.error("VTPass webhook processing error", error);

      return res.status(HTTP_STATUS.OK).json({
        response: "success",
      });

      // Alternative: If you want to return errors to VTPass
      // next(error);
    }
  };

  // Flow: SafeHaven → Controller → saveHavenProcessor → safeHavenService
  handleSafeHavenWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      logger.info("SafeHaven webhook endpoint hit", {
        body: req.body,
        ip: req.ip,
        type: req.body?.type,
        transactionId: req.body?.data?._id,
      });

      // Optional: Validate webhook IP
      // const clientIP = req.ip || req.connection.remoteAddress;
      // if (!this.saveHavenProcessor.validateIP(clientIP)) {
      //   logger.warn("SafeHaven webhook from unauthorized IP", { ip: clientIP });
      //   throw new AppError(
      //     "Unauthorized",
      //     HTTP_STATUS.UNAUTHORIZED,
      //     ERROR_CODES.UNAUTHORIZED
      //   );
      // }

      // Optional: Validate webhook signature
      // const signature = req.headers["x-safehaven-signature"] as string;
      // const secret = process.env.SAFEHAVEN_WEBHOOK_SECRET || "";
      // if (!this.saveHavenProcessor.validateSignature(JSON.stringify(req.body), signature, secret)) {
      //   logger.warn("SafeHaven webhook invalid signature");
      //   throw new AppError(
      //     "Invalid signature",
      //     HTTP_STATUS.UNAUTHORIZED,
      //     ERROR_CODES.UNAUTHORIZED
      //   );
      // }

      // Validate payload structure
      if (!this.saveHavenProcessor.validatePayload(req.body)) {
        logger.error("SafeHaven webhook: Invalid payload structure", {
          body: req.body,
        });
        // Still return success to prevent retries
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      // Process webhook through SafeHaven processor
      const webhookData = await this.saveHavenProcessor.process(req.body);

      // Pass to SafeHaven-specific webhook service
      await this.saveHavenService.processWebhook(webhookData);

      logger.info("SafeHaven webhook processed successfully", {
        transactionId: req.body?.data?._id,
        type: req.body?.type,
        status: webhookData.status,
      });

      // Return 200 OK to acknowledge receipt
      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    } catch (error: any) {
      logger.error("SafeHaven webhook processing error", {
        error: error.message,
        stack: error.stack,
        body: req.body,
      });

      // Return 200 to prevent SafeHaven from retrying
      // Log the error but acknowledge receipt
      return res.status(HTTP_STATUS.OK).json({ status: "success" });

      // Alternative: If you want to return errors to SafeHaven
      // next(error);
    }
  };

  // Handle Monnify webhook callbacks
  // Flow: Monnify → Controller → monnifyProcessor → monnifyService

  // Supported Event Types:
  // - SUCCESSFUL_TRANSACTION (wallet funding)
  // - SUCCESSFUL_DISBURSEMENT (withdrawal success)
  // - FAILED_DISBURSEMENT (withdrawal failed)
  // - REVERSED_DISBURSEMENT (withdrawal reversed)

  handleMonnifyWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      logger.info("Monnify webhook endpoint hit", {
        body: req.body,
        ip: req.ip,
        eventType: req.body?.eventType,
        reference:
          req.body?.eventType === "SUCCESSFUL_TRANSACTION"
            ? req.body?.eventData?.product?.reference
            : req.body?.eventData?.reference,
      });

      //  Validate Webhook IP (Optional but Recommended)
      // Monnify webhook IP: 35.242.133.146

      const clientIP = req.ip || req.connection.remoteAddress;
      if (process.env.MONNIFY_VALIDATE_IP === "true") {
        if (!this.monnifyProcessor.validateIP(clientIP || "")) {
          logger.warn("Monnify webhook from unauthorized IP", {
            ip: clientIP,
          });
          // Still return success to prevent retries
          return res.status(HTTP_STATUS.OK).json({ status: "success" });
        }
      }

      //  Validate Webhook Signature (CRITICAL)
      // Monnify sends HMAC-SHA512 hash in 'monnify-signature' header

      //TODO: validate signature before moving to production
      // const signature = req.headers["monnify-signature"] as string;
      // const requestBody = JSON.stringify(req.body);

      // if (process.env.MONNIFY_VALIDATE_SIGNATURE !== "false") {
      //   if (!signature) {
      //     logger.warn("Monnify webhook: Missing signature header");
      //     return res.status(HTTP_STATUS.OK).json({ status: "success" });
      //   }

      //   const isValidSignature = this.monnifyProcessor.validateSignature(
      //     requestBody,
      //     signature
      //   );

      //   if (!isValidSignature) {
      //     logger.error("Monnify webhook: Invalid signature", {
      //       signature,
      //       body: req.body,
      //     });
      //     // Still return success to prevent retries
      //     return res.status(HTTP_STATUS.OK).json({ status: "success" });
      //   }

      //   logger.info("Monnify webhook: Signature validated successfully");
      // }

      // Validate Payload Structure

      if (!this.monnifyProcessor.validatePayload(req.body)) {
        logger.error("Monnify webhook: Invalid payload structure", {
          body: req.body,
        });
        // Still return success to prevent retries
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      // Process Webhook through Monnify Processor

      const webhookData = await this.monnifyProcessor.process(req.body);

      // Pass to Monnify-Specific Webhook Service

      await this.monnifyService.processWebhook(webhookData);

      logger.info("Monnify webhook processed successfully", {
        eventType: req.body?.eventType,
        reference: webhookData.reference,
        status: webhookData.status,
      });

      // Return 200 OK to Acknowledge Receipt
      // Monnify expects 200 status code to prevent retries

      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    } catch (error: any) {
      logger.error("Monnify webhook processing error", {
        error: error.message,
        stack: error.stack,
        body: req.body,
      });

      // Return 200 to prevent Monnify from retrying
      // Log the error but acknowledge receipt
      return res.status(HTTP_STATUS.OK).json({ status: "success" });

      // Alternative: If you want to return errors to Monnify
      // next(error);
    }
  };

  handleMonnifyCallback = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const { paymentReference } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    res.redirect(`${frontendUrl}/payment/status?ref=${paymentReference}`);
  };

  // Flow: Xixapay → Controller → xixapayProcessor → xixapayService
  // NOTE: this covers virtual-account (collection) webhooks only. Xixapay's
  // payout/transfer endpoint is synchronous and has no documented webhook —
  // see WithdrawalService for how payout status is finalized instead.
  handleXixapayWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      logger.info("Xixapay webhook endpoint hit", {
        body: req.body,
        ip: req.ip,
        transactionId: req.body?.transaction_id,
        status: req.body?.transaction_status,
      });

      // Signature verification is live (not commented out) — Xixapay's docs
      // make HMAC-SHA256 verification a first-class requirement.
      const signature = req.headers["xixapay"] as string;
      const rawBody = (req as any).rawBody;

      if (!this.xixapayProcessor.validateSignature(rawBody, signature)) {
        logger.warn("Xixapay webhook: invalid or missing signature", {
          signature: signature ? signature.substring(0, 16) + "..." : "missing",
          transactionId: req.body?.transaction_id,
        });
        // Still return 200 to prevent retries — same pattern as every other
        // provider handler in this controller.
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      logger.info("Xixapay webhook: signature validated");

      if (!this.xixapayProcessor.validatePayload(req.body)) {
        logger.error("Xixapay webhook: invalid payload structure", {
          body: req.body,
        });
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      const webhookData = await this.xixapayProcessor.process(req.body);
      await this.xixapayService.processWebhook(webhookData);

      logger.info("Xixapay webhook processed successfully", {
        transactionId: req.body?.transaction_id,
        status: webhookData.status,
      });

      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    } catch (error: any) {
      logger.error("Xixapay webhook processing error", {
        error: error.message,
        stack: error.stack,
        body: req.body,
      });

      // Return 200 to prevent Xixapay from retrying — log the error but
      // acknowledge receipt, same pattern as every other handler here.
      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    }
  };

  // Handle Flutterwave webhook callbacks
  // Flow: Flutterwave → Controller → flutterwaveProcessor → flutterwaveService

  // Supported Event Types:
  // - charge.completed (wallet funding via virtual account, card, mobile money)
  // - transfer.completed (withdrawal success/failure)

  // Security:
  // - Validates signature using HMAC-SHA256
  // - Signature sent in 'flutterwave-signature' header

  handleFlutterwaveWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      logger.info("Flutterwave webhook endpoint hit", {
        body: req.body,
        ip: req.ip,
        eventType: req.body?.type,
        webhookId: req.body?.id,
        transactionId: req.body?.data?.id,
      });

      // Validate Webhook IP (Optional)
      // Flutterwave doesn't publish official IPs
      // Skip IP validation unless you have specific IPs

      // const clientIP = req.ip || req.connection.remoteAddress;
      // if (process.env.FLUTTERWAVE_VALIDATE_IP === "true") {
      //   if (!this.flutterwaveProcessor.validateIP(clientIP || "")) {
      //     logger.warn("Flutterwave webhook from unauthorized IP", {
      //       ip: clientIP,
      //     });
      //     return res.status(HTTP_STATUS.OK).json({ status: "success" });
      //   }
      // }

      // Validate Webhook Signature (CRITICAL)
      // Flutterwave sends HMAC-SHA256 hash in 'flutterwave-signature' header

      // const signature = req.headers["flutterwave-signature"] as string;
      // const requestBody = JSON.stringify(req.body);

      //TODO: validate signature
      // if (process.env.FLUTTERWAVE_VALIDATE_SIGNATURE !== "false") {
      //   if (!signature) {
      //     logger.warn("Flutterwave webhook: Missing signature header");
      //     return res.status(HTTP_STATUS.OK).json({ status: "success" });
      //   }

      //   const isValidSignature = this.flutterwaveProcessor.validateSignature(
      //     requestBody,
      //     signature
      //   );

      //   if (!isValidSignature) {
      //     logger.error("Flutterwave webhook: Invalid signature", {
      //       signature: signature.substring(0, 10) + "...",
      //       body: req.body,
      //     });
      //     // Still return success to prevent retries
      //     return res.status(HTTP_STATUS.OK).json({ status: "success" });
      //   }

      //   logger.info("Flutterwave webhook: Signature validated successfully");
      // }

      // Validate Payload Structure

      if (!this.flutterwaveProcessor.validatePayload(req.body)) {
        logger.error("Flutterwave webhook: Invalid payload structure", {
          body: req.body,
        });
        // Still return success to prevent retries
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      // Process Webhook through Flutterwave Processor

      const webhookData = await this.flutterwaveProcessor.process(req.body);

      // Pass to Flutterwave-Specific Webhook Service

      await this.flutterwaveService.processWebhook(webhookData);

      logger.info("Flutterwave webhook processed successfully", {
        eventType: req.body?.type,
        reference: webhookData.reference,
        status: webhookData.status,
        transactionId: webhookData.providerTransactionId,
      });

      // Return 200 OK to Acknowledge Receipt
      // Flutterwave expects 200 status code to prevent retries

      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    } catch (error: any) {
      logger.error("Flutterwave webhook processing error", {
        error: error.message,
        stack: error.stack,
        body: req.body,
      });

      // Return 200 to prevent Flutterwave from retrying
      // Log the error but acknowledge receipt
      return res.status(HTTP_STATUS.OK).json({ status: "success" });

      // Alternative: If you want to return errors to Flutterwave
      // next(error);
    }
  };

  handleFlutterwaveCallback = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const { status, tx_ref, transaction_id } = req.query;

    // Redirect to your frontend payment status page
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    res.redirect(
      `${frontendUrl}/payment/status?ref=${tx_ref}&status=${status}&txId=${transaction_id}`,
    );
  };

  handleNowPaymentsWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      logger.info("NowPayments IPN endpoint hit", {
        body: req.body,
        ip: req.ip,
        status: req.body?.payment_status || req.body?.status,
        id: req.body?.payment_id || req.body?.id,
      });

      const signature = req.headers["x-nowpayments-sig"] as string;

      if (process.env.NOWPAYMENTS_VALIDATE_SIGNATURE !== "false") {
        const rawBody = (req as any).rawBody;
        if (!this.nowPaymentsProcessor.validateSignature(rawBody, signature)) {
          logger.warn("NowPayments IPN: invalid or missing signature", {
            sig: signature ? signature.substring(0, 16) + "…" : "missing",
            body: req.body,
          });
          return res.status(HTTP_STATUS.OK).json({ status: "success" });
        }
        logger.info("NowPayments IPN: signature validated");
      }

      if (!this.nowPaymentsProcessor.validatePayload(req.body)) {
        logger.error("NowPayments IPN: invalid payload structure", {
          body: req.body,
        });
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      const webhookData = await this.nowPaymentsProcessor.process(req.body);
      await this.nowPaymentsService.processWebhook(webhookData);

      logger.info("NowPayments IPN processed successfully", {
        eventType: webhookData.eventType,
        nowPaymentsId: webhookData.nowPaymentsId,
        reference: webhookData.reference,
        status: webhookData.status,
      });

      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    } catch (error: any) {
      logger.error("NowPayments IPN processing error", {
        error: error.message,
        stack: error.stack,
        body: req.body,
      });
      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    }
  };

  handleClubKonnectWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const payload =
        Object.keys(req.body).length > 0 ? req.body : (req.query as any);

      logger.info("ClubKonnect webhook endpoint hit", {
        orderId: payload.orderid,
        statusCode: payload.statuscode,
        status: payload.orderstatus,
        source: Object.keys(req.body).length > 0 ? "JSON" : "Query String",
      });

      await this.clubkonnectWebhook.handleWebhook(payload);

      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    } catch (error: any) {
      logger.error("ClubKonnect webhook error", {
        error: error.message,
        body: req.body,
        query: req.query,
      });

      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    }
  };

  // TATUM WEBHOOK
  handleTatumWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      logger.info("Tatum webhook endpoint hit", {
        ip: req.ip,
        type: req.body?.type,
        subscriptionType: req.body?.subscriptionType,
        txId: req.body?.txId,
        address: req.body?.address,
        chain: req.body?.chain,
      });

      // Extract signature from header
      const signature = req.headers["x-payload-hash"] as string;

      // Verify signature
      if (!this.tatumWebhookService.verifySignature(req.body, signature)) {
        logger.warn("Tatum webhook: invalid signature — discarding silently", {
          signature: signature ? signature.substring(0, 16) + "..." : "missing",
          webhookId: req.body?.id,
        });
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      logger.info("Tatum webhook: signature verified");

      // Validate payload structure
      if (!this.tatumWebhookService.validatePayload(req.body)) {
        logger.error("Tatum webhook: invalid payload structure", {
          body: req.body,
        });
        // Still return 200 OK to prevent retries
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      const SUPPORTED_TYPES = ["native", "token"];

      if (!SUPPORTED_TYPES.includes(req.body.type)) {
        logger.info("Tatum webhook: ignoring unsupported event type", {
          type: req.body.type,
          asset: req.body.asset,
          address: req.body.address,
          amount: req.body.amount,
          txId: req.body.txId,
        });
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      logger.info("Tatum webhook: payload validated");

      // Route by event type
      const webhookType = req.body.subscriptionType;

      if (webhookType === "ADDRESS_EVENT") {
        await redisConfig.client.lPush(
          CACHE_KEYS.TATUM_WEBHOOK_QUEUE,
          JSON.stringify({
            payload: req.body,
            receivedAt: new Date().toISOString(),
          }),
        );
        logger.info("Tatum webhook: queued for processing", {
          webhookId: req.body?.txId,
          address: req.body?.address,
        });
      }

      logger.info("Tatum webhook: acknowledged", {
        webhookId: req.body?.id,
        type: webhookType,
      });

      // Processing happens async above
      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    } catch (error: any) {
      logger.error("Tatum webhook error", {
        error: error.message,
        stack: error.stack,
        body: req.body,
      });

      // Always return 200 OK (webhook must acknowledge receipt)
      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    }
  };

  handleBreetWebhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      logger.info("Breet webhook endpoint hit", {
        body: req.body,
        ip: req.ip,
        event: req.body?.event,
        tradeId: req.body?.id,
      });

      // Verify webhook secret
      const secret = req.headers["x-webhook-secret"] as string;
      if (!this.breetWebhookService.verifySecret(secret)) {
        logger.warn("Breet webhook: invalid secret", {
          secret: secret?.substring(0, 16) + "...",
        });
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      // Validate payload
      if (!this.breetWebhookService.validatePayload(req.body)) {
        logger.error("Breet webhook: invalid payload", { body: req.body });
        return res.status(HTTP_STATUS.OK).json({ status: "success" });
      }

      logger.info("Breet webhook: verified and valid");

      // Route by event type
      const event = req.body.event;

      if (
        ["trade.pending", "trade.completed", "trade.flagged"].includes(event)
      ) {
        this.breetWebhookService.processWebhook(req.body).catch((err) => {
          logger.error("Breet webhook: processing error", {
            error: err.message,
            tradeId: req.body?.id,
          });
        });
      } else {
        logger.warn("Breet webhook: unknown event type", {
          event,
          tradeId: req.body?.id,
        });
      }

      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    } catch (error: any) {
      logger.error("Breet webhook error", {
        error: error.message,
        body: req.body,
      });
      return res.status(HTTP_STATUS.OK).json({ status: "success" });
    }
  };

  // TODO: Add other provider webhook handlers below
  // Each will follow the same pattern: Processor → WebhookService

  // handleClubKonnectWebhook = async (
  //   req: Request,
  //   res: Response,
  //   next: NextFunction
  // ) => {
  //   try {
  //     logger.info("ClubKonnect webhook endpoint hit", { body: req.body });
  //
  //     const webhookData = await this.clubkonnectProcessor.process(req.body);
  //     await this.webhookService.processWebhook("ClubKonnect", webhookData);
  //
  //     return sendSuccessResponse(res, null, "Webhook processed", HTTP_STATUS.OK);
  //   } catch (error) {
  //     logger.error("ClubKonnect webhook error", error);
  //     return sendSuccessResponse(res, null, "Webhook received", HTTP_STATUS.OK);
  //   }
  // };

  // handleCoolSubWebhook = async (
  //   req: Request,
  //   res: Response,
  //   next: NextFunction
  // ) => {
  //   try {
  //     logger.info("CoolSub webhook endpoint hit", { body: req.body });
  //
  //     const webhookData = await this.coolsubProcessor.process(req.body);
  //     await this.webhookService.processWebhook("CoolSub", webhookData);
  //
  //     return sendSuccessResponse(res, null, "Webhook processed", HTTP_STATUS.OK);
  //   } catch (error) {
  //     logger.error("CoolSub webhook error", error);
  //     return sendSuccessResponse(res, null, "Webhook received", HTTP_STATUS.OK);
  //   }
  // };

  // Add more providers as needed...
}
