import Joi from "joi";

export const createTradeBonusValidation = Joi.object({
  name: Joi.string().required().max(100).trim(),
  description: Joi.string().max(500).trim().optional(),
  amountRequired: Joi.number().required().min(0).messages({
    "number.base": "amountRequired must be a number",
    "number.min": "amountRequired must be greater than or equal to 0",
  }),
  bonusType: Joi.string()
    .required()
    .valid("flat", "percentage")
    .messages({
      "any.only": "bonusType must be either 'flat' or 'percentage'",
    }),
  value: Joi.number().required().min(0).messages({
    "number.base": "value must be a number",
    "number.min": "value must be greater than or equal to 0",
  }),
  maxCashbackAmount: Joi.number().optional().min(0),
  isActive: Joi.boolean().default(true),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
}).messages({
  "any.required": "{#label} is required",
});

export const updateTradeBonusValidation = Joi.object({
  name: Joi.string().max(100).trim().optional(),
  description: Joi.string().max(500).trim().optional(),
  amountRequired: Joi.number().min(0).optional().messages({
    "number.base": "amountRequired must be a number",
    "number.min": "amountRequired must be greater than or equal to 0",
  }),
  bonusType: Joi.string()
    .valid("flat", "percentage")
    .optional()
    .messages({
      "any.only": "bonusType must be either 'flat' or 'percentage'",
    }),
  value: Joi.number().min(0).optional().messages({
    "number.base": "value must be a number",
    "number.min": "value must be greater than or equal to 0",
  }),
  maxCashbackAmount: Joi.number().optional().min(0),
  isActive: Joi.boolean().optional(),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
})
  .min(1)
  .messages({
    "object.min": "At least one field must be provided for update",
  });