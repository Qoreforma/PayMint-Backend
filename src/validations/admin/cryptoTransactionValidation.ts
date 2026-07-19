import Joi from "joi";

export const approveTransactionValidation = Joi.object({
  reviewNote: Joi.string().max(1000).optional().allow(null, ""),
});

export const declineTransactionValidation = Joi.object({
  declineNote: Joi.string().max(500).required().messages({
    "string.empty": "Decline reason is required",
    "any.required": "Decline reason is required",
  }),
  declinePrompt: Joi.string().max(500).optional().allow(""),
  declineProof: Joi.string().uri().optional().messages({
    "string.uri": "Decline proof must be a valid URL",
    "any.required": "Decline proof is required",
  }),
});

export const secondApproveTransactionValidation = Joi.object({
  reviewAmount: Joi.number().min(0.01).required().messages({
    "number.min": "Review amount must be greater than zero",
    "any.required": "Review amount is required",
  }),
  reviewRate: Joi.number().min(0.01).optional().messages({
    "number.min": "Review rate must be greater than zero",
    "any.required": "Review rate is required",
  }),
  reviewNote: Joi.string().max(1000).required().messages({
    "string.empty": "Review note is required",
    "any.required": "Review note is required",
  }),
  reviewProof: Joi.string().uri().optional().allow(null, ""),
});

export const markAsTransferredValidation = Joi.object({
  txHash: Joi.string().required().messages({
    "string.empty": "Transaction hash is required",
    "any.required": "Transaction hash is required",
  }),
  reviewNote: Joi.string().max(1000).optional().allow(null, ""),
});
