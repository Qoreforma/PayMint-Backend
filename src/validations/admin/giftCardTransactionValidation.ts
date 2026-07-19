import Joi from "joi";

// Direct approval - no amount change
export const approveTransactionValidation = Joi.object({
  reviewNote: Joi.string().max(500).optional().allow(""),
});

// Decline transaction
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

// Second approval
export const secondApprovalValidation = Joi.object({
  reviewProof: Joi.string().uri().optional().messages({
    "string.uri": "Review proof must be a valid URL",
    "any.required": "Review proof is required for second approval",
  }),
  reviewedAmount: Joi.number().positive().required().messages({
    "number.positive": "Reviewed amount must be positive",
    "any.required": "Reviewed amount is required when changing payout",
  }),
  reviewNote: Joi.string().max(500).required().allow(""),
});
