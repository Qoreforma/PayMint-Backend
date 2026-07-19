import Joi from "joi";

export const createProviderValidation = Joi.object({
  name: Joi.string().required().max(100).trim(),
  logo: Joi.string().max(200).trim(),
  isActive: Joi.boolean().default(true),
  hasSync: Joi.boolean().default(false),
  serviceTypes: Joi.array().items(Joi.string()).default([]),
});

export const updateProviderValidation = Joi.object({
  name: Joi.string().max(100).trim(),
  logo: Joi.string().max(200).trim(),
  isActive: Joi.boolean(),
  hasSync: Joi.boolean(),
  serviceTypes: Joi.array().items(Joi.string()),
});

export const syncProductsValidation = Joi.object({
  serviceTypeId: Joi.string().optional(),
  forceUpdate: Joi.boolean().default(false),
});

export const toggleProductsValidation = Joi.object({
  isActive: Joi.boolean().required(),
});