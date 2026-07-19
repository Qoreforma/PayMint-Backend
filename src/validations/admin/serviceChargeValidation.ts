import Joi from "joi";

export const updateServiceChargeValidationSchema = Joi.object({
  type: Joi.string().valid("percentage", "flat"),
  name: Joi.string().max(100).trim(),
  value: Joi.number().min(0).max(100).required(),
  details: Joi.string().max(500).allow(null, "").trim(),
});

export const bulkUpdateServiceChargeValidation = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required(),
  data: Joi.object({
    type: Joi.string().valid("percentage", "flat"),
    value: Joi.number().min(0).max(100),
    details: Joi.string().max(500).allow(null, ""),
    // code intentionally excluded — bulk payload can't set one code across many charges
  }).min(1).required(),
});