import Joi from "joi";

export const pricingRuleRowValidation = Joi.object({
  providerId: Joi.string().required(),
  serviceId: Joi.string().required(),
  name: Joi.string().max(100).trim().required(),
  type: Joi.string().valid("percentage", "flat").required(),
  cashbackValue: Joi.number().min(0),
  partnerDiscountValue: Joi.number().min(0),
  active: Joi.boolean().required(),
}).or("cashbackValue", "partnerDiscountValue");

export const bulkUpsertPricingRuleValidation = Joi.object({
  rows: Joi.array().items(pricingRuleRowValidation).min(1).required(),
});

export const setPricingRuleStatusValidation = Joi.object({
  active: Joi.boolean().required(),
});