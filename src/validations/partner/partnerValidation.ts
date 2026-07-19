import { MAX_PARTNER_TRANSACTION_AMOUNT } from "@/utils/constants";
import Joi from "joi";

export const partnerRegistrationValidation = Joi.object({
  firstname: Joi.string().trim().min(2).max(50).required().messages({
    "string.empty": "First name is required",
    "string.min": "First name must be at least 2 characters long",
    "string.max": "First name must not exceed 50 characters",
    "any.required": "First name is required",
  }),

  lastname: Joi.string().trim().min(2).max(50).required().messages({
    "string.empty": "Last name is required",
    "string.min": "Last name must be at least 2 characters long",
    "string.max": "Last name must not exceed 50 characters",
    "any.required": "Last name is required",
  }),

  email: Joi.string().trim().email().lowercase().required().messages({
    "string.empty": "Email is required",
    "string.email": "Please provide a valid email address",
    "any.required": "Email is required",
  }),

  password: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .required()
    .messages({
      "string.empty": "Password is required",
      "string.min": "Password must be at least 8 characters long",
      "string.max": "Password must not exceed 128 characters",
      "string.pattern.base":
        "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
      "any.required": "Password is required",
    }),

  phone: Joi.string()
    .trim()
    .pattern(/^\+?[\d\s\-()]+$/)
    .min(10)
    .max(20)
    .required()
    .messages({
      "string.empty": "Phone number is required",
      "string.pattern.base": "Please provide a valid phone number",
      "string.min": "Phone number must be at least 10 characters long",
      "string.max": "Phone number must not exceed 20 characters",
      "any.required": "Phone number is required",
    }),

  companyName: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Company name is required",
    "string.min": "Company name must be at least 2 characters long",
    "string.max": "Company name must not exceed 100 characters",
    "any.required": "Company name is required",
  }),

  contactPerson: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Contact person is required",
    "string.min": "Contact person must be at least 2 characters long",
    "string.max": "Contact person must not exceed 100 characters",
    "any.required": "Contact person is required",
  }),
});

export const partnerWebhookUrlValidation = Joi.object({
  webhookUrl: Joi.string().uri().required().messages({
    "string.empty": "Webhook URL is required",
    "string.uri": "Please provide a valid URL",
    "any.required": "Webhook URL is required",
  }),
});
export const partnerGiftcardPurchaseValidation = Joi.object({
  giftCardId: Joi.string()
    .required()
    .regex(/^[0-9a-fA-F]{24}$/)
    .messages({
      "string.pattern.base": "Invalid gift card ID format",
      "any.required": "Gift card ID is required",
    }),

  productId: Joi.string()
    .optional()
    .regex(/^[0-9a-fA-F]{24}$/)
    .messages({
      "string.pattern.base": "Invalid product ID format",
      "any.required": "Product ID is required",
    }),

  amount: Joi.number().positive().max(MAX_PARTNER_TRANSACTION_AMOUNT).required().messages({
    "number.positive": "Amount must be a positive number",
    "number.max": `Amount must not exceed ${MAX_PARTNER_TRANSACTION_AMOUNT}`,
    "any.required": "Amount is required",
  }),

  quantity: Joi.number().integer().positive().max(10).required().messages({
    "number.integer": "Quantity must be a whole number",
    "number.positive": "Quantity must be a positive number",
    "number.max": "Quantity must not exceed 10",
    "any.required": "Quantity is required",
  }),

  partnerReference: Joi.string().trim().min(2).max(50).required().messages({
    "string.empty": "Partner reference is required",
    "string.min": "Partner reference must be at least 2 characters long",
    "string.max": "Partner reference must not exceed 50 characters",
    "any.required": "Partner reference is required",
  }),
});

export const partnerSellGiftcardValidation = Joi.object({
  giftCardId: Joi.string()
    .required()
    .regex(/^[0-9a-fA-F]{24}$/)
    .messages({
      "string.pattern.base": "Invalid gift card ID format",
      "any.required": "Gift card ID is required",
    }),

  productId: Joi.string()
    .optional()
    .regex(/^[0-9a-fA-F]{24}$/)
    .messages({
      "string.pattern.base": "Invalid product ID format",
      "any.required": "Product ID is required",
    }),

  amount: Joi.number().positive().max(MAX_PARTNER_TRANSACTION_AMOUNT).required().messages({
    "number.positive": "Amount must be a positive number",
    "number.max": `Amount must not exceed ${MAX_PARTNER_TRANSACTION_AMOUNT}`,
    "any.required": "Amount is required",
  }),

  quantity: Joi.number().integer().positive().max(10).required().messages({
    "number.integer": "Quantity must be a whole number",
    "number.positive": "Quantity must be a positive number",
    "number.max": "Quantity must not exceed 10",
    "any.required": "Quantity is required",
  }),

 cards: Joi.array().items(Joi.string().uri()).min(1).max(10).required().messages({
    "array.min": "At least one card URL must be provided",
    "array.max": "You can only submit up to 10 cards at a time",
    "any.required": "Cards are required",
  }),
  comment: Joi.string().trim().max(500).optional().messages({
    "string.max": "Comment must not exceed 500 characters",
  }),

  partnerReference: Joi.string().trim().min(2).max(50).required().messages({
    "string.empty": "Partner reference is required",
    "string.min": "Partner reference must be at least 2 characters long",
    "string.max": "Partner reference must not exceed 50 characters",
    "any.required": "Partner reference is required",
  }),
});

export const makeUserPartnerValidation = Joi.object({
  companyName: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Company name is required",
    "string.min": "Company name must be at least 2 characters long",
    "string.max": "Company name must not exceed 100 characters",
    "any.required": "Company name is required",
  }),

  contactPerson: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Contact person is required",
    "string.min": "Contact person must be at least 2 characters long",
    "string.max": "Contact person must not exceed 100 characters",
    "any.required": "Contact person is required",
  }),
});

export const partnerAirtimePurchaseValidation = Joi.object({
  phone: Joi.string().trim().required().messages({
    "string.empty": "Phone number is required",
    "any.required": "Phone number is required",
  }),
  amount: Joi.number().positive().required().messages({
    "number.base": "Amount must be a number",
    "number.positive": "Amount must be greater than 0",
    "any.required": "Amount is required",
  }),
  network: Joi.string().trim().required().messages({
    "string.empty": "Network is required",
    "any.required": "Network is required",
  }),
  partnerReference: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Partner reference is required",
    "string.min": "Partner reference must be at least 2 characters",
    "string.max": "Partner reference must not exceed 100 characters",
    "any.required": "Partner reference is required",
  }),
});

export const partnerElectricityPurchaseValidation = Joi.object({
  meterNumber: Joi.string().trim().required().messages({
    "string.empty": "Meter number is required",
    "any.required": "Meter number is required",
  }),
  providerId: Joi.string().trim().required().messages({
    "string.empty": "Provider ID is required",
    "any.required": "Provider ID is required",
  }),
  amount: Joi.number().positive().required().messages({
    "number.base": "Amount must be a number",
    "number.positive": "Amount must be greater than 0",
    "any.required": "Amount is required",
  }),
  meterType: Joi.string().valid("prepaid", "postpaid").required().messages({
    "any.only": "Meter type must be prepaid or postpaid",
    "any.required": "Meter type is required",
  }),
  phone: Joi.string().trim().required().messages({
    "string.empty": "Phone number is required",
    "any.required": "Phone number is required",
  }),
  partnerReference: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Partner reference is required",
    "string.min": "Partner reference must be at least 2 characters",
    "string.max": "Partner reference must not exceed 100 characters",
    "any.required": "Partner reference is required",
  }),
});

export const partnerCableTvVerifyValidation = Joi.object({
  smartCardNumber: Joi.string().trim().required().messages({
    "string.empty": "Smart card number is required",
    "any.required": "Smart card number is required",
  }),
  serviceCode: Joi.string().trim().required().messages({
    "string.empty": "Service code is required",
    "any.required": "Service code is required",
  }),
  serviceProvider: Joi.object().required().messages({
    "any.required": "Service provider is required",
  }),
});

export const partnerCableTvPurchaseValidation = Joi.object({
  provider: Joi.string().trim().required().messages({
    "string.empty": "Provider is required",
    "any.required": "Provider is required",
  }),
  smartCardNumber: Joi.string().trim().required().messages({
    "string.empty": "Smart card number is required",
    "any.required": "Smart card number is required",
  }),
  productId: Joi.string().trim().required().messages({
    "string.empty": "Product ID is required",
    "any.required": "Product ID is required",
  }),
  type: Joi.string().valid("renew", "change").required().messages({
    "any.only": "Type must be renew or change",
    "any.required": "Type is required",
  }),
  partnerReference: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Partner reference is required",
    "string.min": "Partner reference must be at least 2 characters",
    "string.max": "Partner reference must not exceed 100 characters",
    "any.required": "Partner reference is required",
  }),
});

export const partnerBettingVerifyValidation = Joi.object({
  customerId: Joi.string().trim().required().messages({
    "string.empty": "Customer ID is required",
    "any.required": "Customer ID is required",
  }),
  providerId: Joi.string().trim().required().messages({
    "string.empty": "Provider ID is required",
    "any.required": "Provider ID is required",
  }),
});

export const partnerBettingFundValidation = Joi.object({
  customerId: Joi.string().trim().required().messages({
    "string.empty": "Customer ID is required",
    "any.required": "Customer ID is required",
  }),
  amount: Joi.number().positive().required().messages({
    "number.base": "Amount must be a number",
    "number.positive": "Amount must be greater than 0",
    "any.required": "Amount is required",
  }),
  providerId: Joi.string().trim().required().messages({
    "string.empty": "Provider ID is required",
    "any.required": "Provider ID is required",
  }),
  partnerReference: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Partner reference is required",
    "string.min": "Partner reference must be at least 2 characters",
    "string.max": "Partner reference must not exceed 100 characters",
    "any.required": "Partner reference is required",
  }),
});

export const partnerEducationVerifyValidation = Joi.object({
  number: Joi.string().trim().required().messages({
    "string.empty": "Profile number is required",
    "any.required": "Profile number is required",
  }),
  type: Joi.string().trim().required().messages({
    "string.empty": "Profile type is required",
    "any.required": "Profile type is required",
  }),
});

export const partnerEducationPurchaseValidation = Joi.object({
  productId: Joi.string().trim().required().messages({
    "string.empty": "Product ID is required",
    "any.required": "Product ID is required",
  }),
  profileId: Joi.string().trim().required().messages({
    "string.empty": "Profile ID is required",
    "any.required": "Profile ID is required",
  }),
  partnerReference: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Partner reference is required",
    "string.min": "Partner reference must be at least 2 characters",
    "string.max": "Partner reference must not exceed 100 characters",
    "any.required": "Partner reference is required",
  }),
});

export const partnerIntlAirtimePurchaseValidation = Joi.object({
  phone: Joi.string().trim().required().messages({
    "string.empty": "Phone number is required",
    "any.required": "Phone number is required",
  }),
  amount: Joi.number().positive().required().messages({
    "number.base": "Amount must be a number",
    "number.positive": "Amount must be greater than 0",
    "any.required": "Amount is required",
  }),
  countryCode: Joi.string().trim().required().messages({
    "string.empty": "Country code is required",
    "any.required": "Country code is required",
  }),
  operatorId: Joi.string().trim().required().messages({
    "string.empty": "Operator ID is required",
    "any.required": "Operator ID is required",
  }),
  productCode: Joi.string().trim().required().messages({
    "string.empty": "Product code is required",
    "any.required": "Product code is required",
  }),
  countryName: Joi.string().trim().optional(),
  variationCode: Joi.string().trim().optional(),
  partnerReference: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Partner reference is required",
    "string.min": "Partner reference must be at least 2 characters",
    "string.max": "Partner reference must not exceed 100 characters",
    "any.required": "Partner reference is required",
  }),
});

export const partnerIntlDataPurchaseValidation = Joi.object({
  phone: Joi.string().trim().required().messages({
    "string.empty": "Phone number is required",
    "any.required": "Phone number is required",
  }),
  productCode: Joi.string().trim().required().messages({
    "string.empty": "Product code is required",
    "any.required": "Product code is required",
  }),
  operatorId: Joi.string().trim().required().messages({
    "string.empty": "Operator ID is required",
    "any.required": "Operator ID is required",
  }),
  countryCode: Joi.string().trim().required().messages({
    "string.empty": "Country code is required",
    "any.required": "Country code is required",
  }),
  countryName: Joi.string().trim().required().messages({
    "string.empty": "Country name is required",
    "any.required": "Country name is required",
  }),
  amount: Joi.number().positive().required().messages({
    "number.base": "Amount must be a number",
    "number.positive": "Amount must be greater than 0",
    "any.required": "Amount is required",
  }),
  partnerReference: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Partner reference is required",
    "string.min": "Partner reference must be at least 2 characters",
    "string.max": "Partner reference must not exceed 100 characters",
    "any.required": "Partner reference is required",
  }),
});

export const partnerDataPurchaseValidation = Joi.object({
  phone: Joi.string().trim().required().messages({
    "string.empty": "Phone number is required",
    "any.required": "Phone number is required",
  }),
  productId: Joi.string().trim().required().messages({
    "string.empty": "Product ID is required",
    "any.required": "Product ID is required",
  }),
  partnerReference: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Partner reference is required",
    "string.min": "Partner reference must be at least 2 characters",
    "string.max": "Partner reference must not exceed 100 characters",
    "any.required": "Partner reference is required",
  }),
});
