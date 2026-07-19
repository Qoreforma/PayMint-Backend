import Joi from "joi";

export const createNetworkValidation = Joi.object({
  name: Joi.string().min(2).max(100).required().messages({
    "string.empty": "Network name is required",
    "string.min": "Network name must be at least 2 characters",
    "string.max": "Network name cannot exceed 100 characters",
    "any.required": "Network name is required",
  }),
  code: Joi.string().min(2).max(10).uppercase().required().messages({
    "string.empty": "Network code is required",
    "string.min": "Network code must be at least 2 characters",
    "string.max": "Network code cannot exceed 10 characters",
    "any.required": "Network code is required",
  }),
  confirmationsRequired: Joi.number().integer().min(1).optional().messages({
    "number.min": "Confirmations required must be at least 1",
  }),
  addressPattern: Joi.string().optional().allow(null, ""),
  explorerUrl: Joi.string().uri().optional().allow(null, ""),
  platformDepositAddress: Joi.string().optional().allow(null, ""),
  isActive: Joi.boolean().optional(),
  priority: Joi.number().integer().optional(),
  description: Joi.string().max(1000).optional().allow(null, ""),
});

export const updateNetworkValidation = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  code: Joi.string().min(2).max(10).uppercase().optional(),

  confirmationsRequired: Joi.number().integer().min(1).optional(),
  addressPattern: Joi.string().optional().allow(null, ""),
  explorerUrl: Joi.string().uri().optional().allow(null, ""),
  platformDepositAddress: Joi.string().optional().allow(null, ""),
  isActive: Joi.boolean().optional(),
  priority: Joi.number().integer().optional(),
  description: Joi.string().max(1000).optional().allow(null, ""),
});

export const updateNetworkStatusValidation = Joi.object({
  isActive: Joi.boolean().required().messages({
    "any.required": "isActive field is required",
  }),
});

export const bulkUpdateStatusValidation = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required().messages({
    "array.min": "At least one network ID is required",
    "any.required": "Network IDs are required",
  }),
  isActive: Joi.boolean().required().messages({
    "any.required": "isActive field is required",
  }),
});

export const bulkDeleteValidation = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required().messages({
    "array.min": "At least one network ID is required",
    "any.required": "Network IDs are required",
  }),
});
