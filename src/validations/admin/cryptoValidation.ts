import Joi from "joi";

export const createCryptoValidation = Joi.object({
  providerId: Joi.string().optional().allow(null, ""),
  assetId: Joi.string().optional(),
  name: Joi.string().min(2).max(100).required().messages({
    "string.empty": "Crypto name is required",
    "string.min": "Crypto name must be at least 2 characters",
    "string.max": "Crypto name cannot exceed 100 characters",
    "any.required": "Crypto name is required",
  }),
  code: Joi.string().min(2).max(10).uppercase().required().messages({
    "string.empty": "Crypto code is required",
    "string.min": "Crypto code must be at least 2 characters",
    "string.max": "Crypto code cannot exceed 10 characters",
    "any.required": "Crypto code is required",
  }),
  icon: Joi.string().uri().optional().allow(null, ""),
  description: Joi.string().max(1000).optional().allow(null, ""),
  sellRate: Joi.number().min(0).optional(),
  buyRate: Joi.number().min(0).optional(),
  sellMinAmount: Joi.number().min(0).optional(),
  sellMaxAmount: Joi.number().min(Joi.ref("sellMinAmount")).optional(),
  buyMinAmount: Joi.number().min(0).optional(),
  buyMaxAmount: Joi.number().min(Joi.ref("buyMinAmount")).optional(),
  saleTerm: Joi.string().max(5000).optional().allow(null, ""),
  purchaseTerm: Joi.string().max(5000).optional().allow(null, ""),
  saleActivated: Joi.boolean().optional(),
  purchaseActivated: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
  priority: Joi.number().integer().optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  networks: Joi.array().items(Joi.string().required()).optional().messages({
    "array.base": "Networks must be an array of network IDs",
  }),
});

export const updateCryptoValidation = Joi.object({
  providerId: Joi.string().optional().allow(null, ""),
  assetId: Joi.string().optional(),
  name: Joi.string().min(2).max(100).required().messages({
    "string.empty": "Crypto name is required",
    "string.min": "Crypto name must be at least 2 characters",
    "string.max": "Crypto name cannot exceed 100 characters",
    "any.required": "Crypto name is required",
  }),
  code: Joi.string().min(2).max(10).uppercase().required().messages({
    "string.empty": "Crypto code is required",
    "string.min": "Crypto code must be at least 2 characters",
    "string.max": "Crypto code cannot exceed 10 characters",
    "any.required": "Crypto code is required",
  }),

  icon: Joi.string().uri().optional().allow(null, ""),
  description: Joi.string().max(1000).optional().allow(null, ""),
  sellRate: Joi.number().min(0).optional(),
  buyRate: Joi.number().min(0).optional(),
  sellMinAmount: Joi.number().min(0).optional(),
  sellMaxAmount: Joi.number().min(Joi.ref("sellMinAmount")).optional(),
  buyMinAmount: Joi.number().min(0).optional(),
  buyMaxAmount: Joi.number().min(Joi.ref("buyMinAmount")).optional(),
  saleTerm: Joi.string().max(5000).optional().allow(null, ""),
  purchaseTerm: Joi.string().max(5000).optional().allow(null, ""),
  saleActivated: Joi.boolean().optional(),
  purchaseActivated: Joi.boolean().optional(),
  isActive: Joi.boolean().optional(),
  priority: Joi.number().integer().optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  networks: Joi.array().items(Joi.string().required()).optional().messages({
    "array.base": "Networks must be an array of network IDs",
  }),
});

export const updateCryptoStatusValidation = Joi.object({
  isActive: Joi.boolean().required().messages({
    "any.required": "isActive field is required",
  }),
});

export const updateCryptoPurchaseStatusValidation = Joi.object({
  purchaseActivated: Joi.boolean().required().messages({
    "any.required": "purchaseActivated field is required",
  }),
});

export const updateCryptoSaleStatusValidation = Joi.object({
  saleActivated: Joi.boolean().required().messages({
    "any.required": "saleActivated field is required",
  }),
});

export const bulkUpdateStatusValidation = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required().messages({
    "array.min": "At least one crypto ID is required",
    "any.required": "Crypto IDs are required",
  }),
  isActive: Joi.boolean().required().messages({
    "any.required": "isActive field is required",
  }),
});

export const bulkDeleteValidation = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required().messages({
    "array.min": "At least one crypto ID is required",
    "any.required": "Crypto IDs are required",
  }),
});

// Validation for adding network to crypto
export const addNetworkToCryptoValidation = Joi.object({
  networkId: Joi.string().required().messages({
    "string.empty": "Network ID is required",
    "any.required": "Network ID is required",
  }),
});

// VALIDATION SCHEMAS (Joi)
export const bulkUpdateSellRateValidation = Joi.object({
  ids: Joi.array()
    .items(Joi.string().required())
    .min(1)
    .required()
    .messages({
      "array.min": "At least one ID is required",
      "array.base": "IDs must be an array",
    }),
  sellRate: Joi.number()
    .positive()
    .required()
    .messages({
      "number.positive": "Sell rate must be a positive number",
      "number.base": "Sell rate must be a number",
    }),
});

export const bulkUpdateBuyRateValidation = Joi.object({
  ids: Joi.array()
    .items(Joi.string().required())
    .min(1)
    .required()
    .messages({
      "array.min": "At least one ID is required",
      "array.base": "IDs must be an array",
    }),
  buyRate: Joi.number()
    .positive()
    .required()
    .messages({
      "number.positive": "Buy rate must be a positive number",
      "number.base": "Buy rate must be a number",
    }),
});

export const bulkUpdateSaleActivationValidation = Joi.object({
  ids: Joi.array()
    .items(Joi.string().required())
    .min(1)
    .required()
    .messages({
      "array.min": "At least one ID is required",
      "array.base": "IDs must be an array",
    }),
  saleActivated: Joi.boolean()
    .required()
    .messages({
      "boolean.base": "saleActivated must be a boolean",
    }),
});

export const bulkUpdatePurchaseActivationValidation = Joi.object({
  ids: Joi.array()
    .items(Joi.string().required())
    .min(1)
    .required()
    .messages({
      "array.min": "At least one ID is required",
      "array.base": "IDs must be an array",
    }),
  purchaseActivated: Joi.boolean()
    .required()
    .messages({
      "boolean.base": "purchaseActivated must be a boolean",
    }),
});
