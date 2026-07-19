import logger from "@/logger";
import {
  IpnPaymentPayload,
  IpnPayoutPayload,
  NowPaymentsService,
} from "../providers/crypto/Nowpaymentsservice";

//Normalised webhook event

export type NowPaymentsWebhookEventType = "payment" | "payout";

export interface NowPaymentsWebhookData {
  eventType: NowPaymentsWebhookEventType;
  //NowPayments payment_id or payout id
  nowPaymentsId: string;
  //Your internal reference (order_id for payments)
  reference: string;
  status: string; // raw NowPayments status string
  rawPayload: IpnPaymentPayload | IpnPayoutPayload;
  // Payment-specific
  payAddress?: string;
  payAmount?: number;
  actuallyPaid?: number;
  payCurrency?: string;
  txHash?: string;
  // Payout-specific─
  payoutAddress?: string;
  payoutAmount?: number;
  payoutCurrency?: string;
  fee?: {
    currency: string;
    depositFee: number;
    withdrawalFee: number;
    serviceFee: number;
  };
  errorMessage?: string;
}

export class NowPaymentsWebhookProcessor {
  // Signature

  validateSignature(rawBody: string, signature: string): boolean {
    if (!signature) {
      logger.warn("NowPayments IPN: missing x-nowpayments-sig header");
      return false;
    }

    // Pass the raw string here
    const valid = NowPaymentsService.verifyIpnSignature(rawBody, signature);

    if (!valid) {
      logger.warn("NowPayments IPN: signature mismatch");
    }
    return valid;
  }

  // A payload is a PAYMENT if it has payment_id + payment_status.
  // A payload is a PAYOUT  if it has a top-level id + status (no payment_id).
  validatePayload(body: any): boolean {
    if (!body || typeof body !== "object") return false;

    const isPayment = Boolean(body.payment_id && body.payment_status);
    const isPayout = Boolean(!body.payment_id && body.id && body.status);

    if (!isPayment && !isPayout) {
      logger.warn("NowPayments IPN: unrecognisable payload shape", {
        keys: Object.keys(body),
      });
      return false;
    }

    return true;
  }

  async process(body: any): Promise<NowPaymentsWebhookData> {
    if (body.payment_id) {
      return this.processPayment(body as IpnPaymentPayload);
    }
    return this.processPayout(body as IpnPayoutPayload);
  }

  private processPayment(payload: IpnPaymentPayload): NowPaymentsWebhookData {
    return {
      eventType: "payment",
      nowPaymentsId: String(payload.payment_id),
      reference: payload.order_id || "",
      status: payload.payment_status,
      rawPayload: payload,
      payAddress: payload.pay_address,
      payAmount: payload.pay_amount,
      actuallyPaid: payload.actually_paid,
      payCurrency: payload.pay_currency,
      txHash: payload.hash,
      fee: payload.fee,

    };
  }

  private processPayout(payload: IpnPayoutPayload): NowPaymentsWebhookData {
    return {
      eventType: "payout",
      nowPaymentsId: String(payload.id),
      // For payouts the reference lives in withdrawal_id or batch_withdrawal_id
      // You should store the NP payout id on the CryptoTransaction; we match by that.
      reference: String(
        payload.withdrawal_id || payload.batch_withdrawal_id || payload.id,
      ),
      status: payload.status,
      rawPayload: payload,
      payoutAddress: payload.address,
      payoutAmount: payload.amount,
      payoutCurrency: payload.currency,
      txHash: payload.hash,
      errorMessage: payload.error,
      fee: payload.fee
    };
  }
}
