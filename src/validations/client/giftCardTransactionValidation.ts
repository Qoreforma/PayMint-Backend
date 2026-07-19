import Joi from "joi";

export const giftCardTransactionaginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  tradeType: Joi.string().valid("buy", "sell").optional(),
  status: Joi.string()
    .valid(
      "pending",
      "processing",
      "success",
      "failed",
      "approved",
      "declined",
      "multiple",
      "s.approved"
    )
    .optional(),
  cardType: Joi.string().valid("physical", "e-code").optional(),
  giftCardType: Joi.string().optional(),
  giftCardId: Joi.string().optional(),
  reference: Joi.string().optional(),
  groupTag: Joi.string().optional(),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
  startAmount: Joi.number().positive().optional(),
  endAmount: Joi.number().positive().optional(),
  startRate: Joi.number().positive().optional(),
  endRate: Joi.number().positive().optional(),
  search: Joi.string().optional().min(1).max(50).messages({
    "string.min": "Search query must be at least 1 character",
    "string.max": "Search query cannot exceed 50 characters",
  }),
});

export const createBuyTransactionSchema = Joi.object({
  giftCardId: Joi.string().required(),
  amount: Joi.number().positive().required(),
  quantity: Joi.number().integer().min(1).required(),
  meta: Joi.object({
    recipientEmail: Joi.string().email().optional(),
    recipientPhone: Joi.string().optional(),
  }).optional(),
});

export const createSellTransactionSchema = Joi.object({
  giftCardId: Joi.string().required(),
  amount: Joi.number().positive().required(),
  quantity: Joi.number().integer().min(1).required(),
  cardType: Joi.string().valid("physical", "e-code").required(),
  cards: Joi.array().items(Joi.string()).min(1).required(),
  comment: Joi.string().optional(),
  bankAccountId: Joi.string().required(),
});