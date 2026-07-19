import Joi from "joi";

export const createGiftCardValidation = Joi.object({
  countryId: Joi.string().optional().allow(null, ""),
  categoryId: Joi.string().required().messages({
    "string.empty": "Category ID is required",
    "any.required": "Category ID is required",
  }),
  name: Joi.string().min(2).max(200).required().messages({
    "string.empty": "Gift card name is required",
    "string.min": "Gift card name must be at least 2 characters",
    "string.max": "Gift card name cannot exceed 200 characters",
    "any.required": "Gift card name is required",
  }),
  sellRate: Joi.number().min(0).optional(),

  // Range-based fields
  sellMinAmount: Joi.number().min(0),

  sellMaxAmount: Joi.number().min(Joi.ref("sellMinAmount")),

  isActive: Joi.boolean().optional(),
  commissionType: Joi.string().valid("flat", "percentage").optional(),
  commisionValue: Joi.number().min(0).optional(),
});

export const updateGiftCardValidation = Joi.object({
  countryId: Joi.string().optional().allow(null, ""),
  categoryId: Joi.string().optional(),
  name: Joi.string().min(2).max(200).optional().messages({
    "string.min": "Gift card name must be at least 2 characters",
    "string.max": "Gift card name cannot exceed 200 characters",
  }),
  logo: Joi.string().uri().optional().allow(null, ""),
  currency: Joi.string().length(3).uppercase().optional(),
  senderCurrency: Joi.string().length(3).uppercase().optional(),
  exchangeRate: Joi.number().min(0).optional(),
  sellRate: Joi.number().min(0).optional(),
  // Range-based fields
  sellMinAmount: Joi.number().min(0),
  sellMaxAmount: Joi.number().min(Joi.ref("sellMinAmount")),
  senderFeePercentage: Joi.number().min(0).max(100).optional(),
  discountPercentage: Joi.number().min(0).max(100).optional(),
  isActive: Joi.boolean().optional(),
  commissionType: Joi.string().valid("flat", "percentage").optional(),
  commisionValue: Joi.number().min(0).optional(),
});

export const updateGiftCardStatusValidation = Joi.object({
  isActive: Joi.boolean().required().messages({
    "any.required": "isActive field is required",
  }),
});

export const updateGiftCardPurchaseStatusValidation = Joi.object({
  purchaseActivated: Joi.boolean().required().messages({
    "any.required": "purchaseActivated field is required",
  }),
});

export const updateGiftCardSaleStatusValidation = Joi.object({
  saleActivated: Joi.boolean().required().messages({
    "any.required": "saleActivated field is required",
  }),
});

export const bulkUpdateStatusValidation = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required().messages({
    "array.min": "At least one gift card ID is required",
    "any.required": "Gift card IDs are required",
  }),
  isActive: Joi.boolean().required().messages({
    "any.required": "isActive field is required",
  }),
});

export const bulkUpdateCommissionValidation = Joi.object({
  ids: Joi.array().items(Joi.string()).min(1).required(),
  commissionType: Joi.string().valid("flat", "percentage").required(),
  commisionValue: Joi.number().min(0).required(),
});

export const bulkDeleteValidation = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required().messages({
    "array.min": "At least one gift card ID is required",
    "any.required": "Gift card IDs are required",
  }),
});

export const bulkUpdateSaleActivationStatusValidation = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required().messages({
    "array.min": "At least one gift card ID is required",
    "any.required": "Gift card IDs are required",
  }),
  saleActivated: Joi.boolean().required().messages({
    "any.required": "saleActivated field is required",
  }),
});

export const bulkUpdateSaleRateValidation = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required().messages({
    "array.min": "At least one gift card ID is required",
    "any.required": "Gift card IDs are required",
  }),
  sellRate: Joi.number().min(0).required().messages({
    "any.required": "sellRate field is required",
  }),
});

export const toggleHottestValidation = Joi.object({
  isHottest: Joi.boolean().required().messages({
    "any.required": "isHottest field is required",
  }),
});

export const bulkToggleHottestValidation = Joi.object({
  ids: Joi.array().items(Joi.string().required()).min(1).required().messages({
    "array.min": "At least one gift card ID is required",
    "any.required": "Gift card IDs are required",
  }),
  isHottest: Joi.boolean().required().messages({
    "any.required": "isHottest field is required",
  }),
});