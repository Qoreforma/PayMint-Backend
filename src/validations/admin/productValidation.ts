import Joi from "joi";

export const createProductValidation = Joi.object({
  // Required fields
  serviceId: Joi.string().required().messages({
    "string.empty": "Service ID is required",
    "any.required": "Service ID is required",
  }),

  providerId: Joi.string().required().messages({
    "string.empty": "Provider ID is required",
    "any.required": "Provider ID is required",
  }),

  name: Joi.string().required().max(200).trim().messages({
    "string.empty": "Product name is required",
    "any.required": "Product name is required",
    "string.max": "Product name cannot exceed 200 characters",
  }),

  code: Joi.string().required().max(100).trim().messages({
    "string.empty": "Product code is required",
    "any.required": "Product code is required",
    "string.max": "Product code cannot exceed 100 characters",
  }),

  providerAmount: Joi.number().positive().required().messages({
    "number.base": "Provider amount must be a number",
    "number.positive": "Provider amount must be greater than 0",
    "any.required": "Provider amount is required",
  }),

  amount: Joi.number()
    .positive()
    .required()
    .min(Joi.ref("providerAmount"))
    .messages({
      "number.base": "Amount must be a number",
      "number.positive": "Amount must be greater than 0",
      "any.required": "Amount is required",
      "number.min": "Amount cannot be less than provider amount",
    }),

  // Optional fields
  logo: Joi.string().allow("").trim().messages({
    "string.base": "Logo must be a string",
  }),

  validity: Joi.string().max(100).trim().messages({
    "string.max": "Validity cannot exceed 100 characters",
  }),
  dataSize: Joi.number().positive().messages({
    "number.base": "Data size must be a number",
    "number.positive": "Data size must be greater than 0",
  }),

  dataSizeDisplay: Joi.string().max(50).trim().messages({
    "string.max": "Data size display cannot exceed 50 characters",
  }),
  description: Joi.string().max(500).trim().messages({
    "string.max": "Description cannot exceed 500 characters",
  }),

  attributes: Joi.object().default({}).messages({
    "object.base": "Attributes must be an object",
  }),

  isActive: Joi.boolean().default(true).messages({
    "boolean.base": "isActive must be a boolean",
  }),
});

export const updateProductValidation = Joi.object({
  // All fields optional for update
  serviceId: Joi.string().messages({
    "string.empty": "Service ID cannot be empty",
  }),

  providerId: Joi.string().messages({
    "string.empty": "Provider ID cannot be empty",
  }),

  name: Joi.string().max(200).trim().messages({
    "string.empty": "Product name cannot be empty",
    "string.max": "Product name cannot exceed 200 characters",
  }),

  code: Joi.string().max(100).trim().messages({
    "string.empty": "Product code cannot be empty",
    "string.max": "Product code cannot exceed 100 characters",
  }),

  providerAmount: Joi.number().positive().messages({
    "number.base": "Provider amount must be a number",
    "number.positive": "Provider amount must be greater than 0",
  }),

  amount: Joi.number().positive().messages({
    "number.base": "Amount must be a number",
    "number.positive": "Amount must be greater than 0",
  }),

  logo: Joi.string().allow("").trim().messages({
    "string.base": "Logo must be a string",
  }),

  validity: Joi.string().max(100).trim().messages({
    "string.max": "Validity cannot exceed 100 characters",
  }),

  description: Joi.string().max(500).trim().messages({
    "string.max": "Description cannot exceed 500 characters",
  }),

  dataSize: Joi.number().positive().messages({
    "number.base": "Data size must be a number",
    "number.positive": "Data size must be greater than 0",
  }),

  dataSizeDisplay: Joi.string().max(50).trim().messages({
    "string.max": "Data size display cannot exceed 50 characters",
  }),

  attributes: Joi.object().messages({
    "object.base": "Attributes must be an object",
  }),

  isActive: Joi.boolean().messages({
    "boolean.base": "isActive must be a boolean",
  }),
})
  .custom((value, helpers) => {
    // If both amounts are provided, validate that amount >= providerAmount
    if (
      value.amount !== undefined &&
      value.providerAmount !== undefined &&
      value.amount < value.providerAmount
    ) {
      return helpers.error("custom.amountValidation");
    }
    return value;
  })
  .messages({
    "custom.amountValidation": "Amount cannot be less than provider amount",
  });

// Validation for status update endpoint
export const updateProductStatusValidation = Joi.object({
  status: Joi.boolean().required().messages({
    "boolean.base": "Status must be a boolean",
    "any.required": "Status is required",
  }),
});

// Validation for fetch provider products endpoint
export const fetchProviderProductsValidation = Joi.object({
  serviceId: Joi.string().required().messages({
    "string.empty": "Service ID is required",
    "any.required": "Service ID is required",
  }),
});
