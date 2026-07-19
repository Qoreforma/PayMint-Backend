import Joi from "joi";

export const createCashbackRuleValidation = Joi.object({
  serviceId: Joi.string().required(),
  type: Joi.string().valid("flat", "percentage").required(),
  value: Joi.number().min(0).required(),
  active: Joi.boolean().default(true),
});

export const updateCashbackRuleValidation = Joi.object({
  serviceId: Joi.string().allow(null, ""),
  type: Joi.string().valid("flat", "percentage"),
  value: Joi.number().min(0),
  active: Joi.boolean(),
});
