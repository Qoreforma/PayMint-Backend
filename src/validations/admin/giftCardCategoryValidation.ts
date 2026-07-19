import Joi from "joi";

export const createGiftCardCategoryValidation = Joi.object({
  providerId: Joi.string().trim().optional().messages({
    "string.empty": "Provider ID is required",
    "any.required": "Provider ID is required",
  }),
  name: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Category name is required",
    "string.min": "Category name must be at least 2 characters long",
    "string.max": "Category name cannot exceed 100 characters",
    "any.required": "Category name is required",
  }),
  icon: Joi.string().trim().uri().optional().allow("").messages({
    "string.uri": "Icon must be a valid URL",
  }),
  saleTerm: Joi.string().trim().max(1000).optional().allow("").messages({
    "string.max": "Sale term cannot exceed 1000 characters",
  }),
  saleActivated: Joi.boolean().optional().messages({
    "boolean.base": "Sale activated must be a boolean",
  }),
  isActive: Joi.boolean().optional().messages({
    "boolean.base": "isActive must be a boolean",
  }),
  countries: Joi.array().items(Joi.string()).min(1).required().messages({
    "array.min": "At least one country is required",
  }),
});

export const updateGiftCardCategoryValidation = Joi.object({
  name: Joi.string().trim().min(2).max(100).optional().messages({
    "string.min": "Category name must be at least 2 characters long",
    "string.max": "Category name cannot exceed 100 characters",
  }),
  icon: Joi.string().trim().uri().optional().allow("").messages({
    "string.uri": "Icon must be a valid URL",
  }),
  transactionType: Joi.string()
    .valid("buy", "sell", "both")
    .optional()
    .messages({
      "any.only": "Transaction type must be either 'buy', 'sell', or 'both'",
    }),
  saleTerm: Joi.string().trim().max(1000).optional().allow("").messages({
    "string.max": "Sale term cannot exceed 1000 characters",
  }),
  saleActivated: Joi.boolean().optional().messages({
    "boolean.base": "Sale activated must be a boolean",
  }),
  isActive: Joi.boolean().optional().messages({
    "boolean.base": "isActive must be a boolean",
  }),
  countries: Joi.array().items(Joi.string()).min(1).required().messages({
    "array.min": "At least one country is required",
  }),
})
  .min(1)
  .messages({
    "object.min": "At least one field must be provided for update",
  });

export const updateGiftCardCategoryStatusValidation = Joi.object({
  isActive: Joi.boolean().required().messages({
    "boolean.base": "isActive must be a boolean",
  }),
});

export const updateGiftCardPurchaseStatusValidation = Joi.object({
  purchaseActivated: Joi.boolean().required().messages({
    "boolean.base": "isActive must be a boolean",
  }),
});

export const updateGiftCardSaleStatusValidation = Joi.object({
  saleActivated: Joi.boolean().required().messages({
    "boolean.base": "isActive must be a boolean",
  }),
});
