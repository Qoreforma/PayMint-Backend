import Joi from "joi";

export const buyCryptoAutomatedSchema = Joi.object({
  cryptoId: Joi.string()
    .required()
    .regex(/^[0-9a-fA-F]{24}$/)
    .messages({
      "string.pattern.base": "Invalid crypto ID format",
      "any.required": "Crypto ID is required",
    }),
  cryptoAmount: Joi.number().positive().required().messages({
    "number.positive": "Crypto amount must be a positive number",
    "any.required": "Crypto amount is required",
  }),
  walletAddress: Joi.string().required().trim().min(10).max(100).messages({
    "string.empty": "Wallet address is required",
    "string.min": "Wallet address is too short",
    "string.max": "Wallet address is too long",
    "any.required": "Wallet address is required",
  }),
  networkId: Joi.string().required().messages({
    "string.empty": "Network selection is required",
    "any.required": "Network is required",
  }),
  pin: Joi.string().messages({
    "string.empty": "Pin is required",
  }),
  pinToken: Joi.string(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });

export const sellCryptoAutomatedSchema = Joi.object({
  cryptoId: Joi.string()
    .required()
    .regex(/^[0-9a-fA-F]{24}$/)
    .messages({
      "string.pattern.base": "Invalid crypto ID format",
      "any.required": "Crypto ID is required",
    }),
  cryptoAmount: Joi.number().positive().optional().messages({
    "number.positive": "Crypto amount must be a positive number",
    "any.required": "Crypto amount is required",
  }),
  networkId: Joi.string().required().messages({
    "string.empty": "Network selection is required",
    "any.required": "Network is required",
  }),
  bankAccountId: Joi.string()
    .optional()
    .regex(/^[0-9a-fA-F]{24}$/)
    .messages({
      "string.pattern.base": "Invalid bank account ID format",
      "any.required": "Bank account is required",
    }),
  proof: Joi.string().optional().uri().messages({
    "string.uri": "Proof must be a valid URL",
    "any.required": "Transaction proof is required",
  }),
  comment: Joi.string().optional().max(500).messages({
    "string.max": "Comment cannot exceed 500 characters",
  }),
  pin: Joi.string().messages({
    "string.empty": "Pin cannot be empty",
  }),
  pinToken: Joi.string(),
})

export const buyCryptoSchema = Joi.object({
  cryptoId: Joi.string()
    .required()
    .regex(/^[0-9a-fA-F]{24}$/)
    .messages({
      "string.pattern.base": "Invalid crypto ID format",
      "any.required": "Crypto ID is required",
    }),
  cryptoAmount: Joi.number().positive().required().messages({
    "number.positive": "Crypto amount must be a positive number",
    "any.required": "Crypto amount is required",
  }),
  walletAddress: Joi.string().required().trim().min(10).max(100).messages({
    "string.empty": "Wallet address is required",
    "string.min": "Wallet address is too short",
    "string.max": "Wallet address is too long",
    "any.required": "Wallet address is required",
  }),
  networkId: Joi.string().required().messages({
    "string.empty": "Network selection is required",
    "any.required": "Network is required",
  }),
   proof: Joi.string().optional().uri().messages({
    "string.uri": "Proof must be a valid URL",
    "any.required": "Transaction proof is required",
  }),
  comment: Joi.string().optional().max(500).messages({
    "string.max": "Comment cannot exceed 500 characters",
  }),
  pin: Joi.string().messages({
    "string.empty": "Pin is required",
  }),
  pinToken: Joi.string(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });

export const sellCryptoSchema = Joi.object({
  cryptoId: Joi.string()
    .required()
    .regex(/^[0-9a-fA-F]{24}$/)
    .messages({
      "string.pattern.base": "Invalid crypto ID format",
      "any.required": "Crypto ID is required",
    }),
  cryptoAmount: Joi.number().positive().required().messages({
    "number.positive": "Crypto amount must be a positive number",
    "any.required": "Crypto amount is required",
  }),
  networkId: Joi.string().required().messages({
    "string.empty": "Network selection is required",
    "any.required": "Network is required",
  }),
  bankAccountId: Joi.string()
    .optional()
    .regex(/^[0-9a-fA-F]{24}$/)
    .messages({
      "string.pattern.base": "Invalid bank account ID format",
      "any.required": "Bank account is required",
    }),
  proof: Joi.string().optional().uri().messages({
    "string.uri": "Proof must be a valid URL",
    "any.required": "Transaction proof is required",
  }),
  comment: Joi.string().optional().max(500).messages({
    "string.max": "Comment cannot exceed 500 characters",
  }),
  pin: Joi.string().messages({
    "string.empty": "Pin cannot be empty",
  }),
  pinToken: Joi.string().messages({
    "string.empty": "PinToken cannot be empty",
  }),
})

export const calculateBreakdownSchema = Joi.object({
  cryptoId: Joi.string()
    .required()
    .regex(/^[0-9a-fA-F]{24}$/)
    .messages({
      "string.pattern.base": "Invalid crypto ID format",
      "any.required": "Crypto ID is required",
    }),

  cryptoAmount: Joi.number().positive().required().messages({
    "number.positive": "Crypto amount must be a positive number",
    "any.required": "Crypto amount is required",
  }),

  tradeType: Joi.string().valid("buy", "sell").required().messages({
    "any.only": 'Trade type must be either "buy" or "sell"',
    "any.required": "Trade type is required",
  }),

  networkId: Joi.string().required().messages({
    "string.empty": "Network selection is required",
    "any.required": "Network is required",
  }),
});

export const cryptoQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),

  limit: Joi.number().integer().min(1).max(100).optional().default(10),

  search: Joi.string().optional().min(1).max(50),

  saleActivated: Joi.boolean().optional(),

  purchaseActivated: Joi.boolean().optional(),
});

export const cryptoTransactionQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1).messages({
    "number.base": "Page must be a number",
    "number.min": "Page must be at least 1",
  }),

  limit: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .optional()
    .default(10)
    .messages({
      "number.base": "Limit must be a number",
      "number.min": "Limit must be at least 1",
      "number.max": "Limit cannot exceed 100",
    }),

  tradeType: Joi.string().valid("buy", "sell").optional().messages({
    "any.only": 'Trade type must be either "buy" or "sell"',
  }),

  status: Joi.string()
    .valid(
      "pending",
      "processing",
      "approved",
      "success",
      "failed",
      "declined",
      "refunded",
    )
    .optional()
    .messages({
      "any.only": "Invalid status value",
    }),

  cryptoId: Joi.string()
    .optional()
    .regex(/^[0-9a-fA-F]{24}$/)
    .messages({
      "string.pattern.base": "Invalid crypto ID format",
    }),

  startDate: Joi.date().optional().messages({
    "date.base": "Start date must be a valid date",
  }),

  endDate: Joi.date().optional().min(Joi.ref("startDate")).messages({
    "date.base": "End date must be a valid date",
    "date.min": "End date must be after start date",
  }),
  reference: Joi.string().optional().min(10).max(50).messages({
    "string.min": "Invalid reference format",
    "string.max": "Invalid reference format",
  }),
  search: Joi.string().optional().min(1).max(50).messages({
    "string.min": "Search query must be at least 1 character",
    "string.max": "Search query cannot exceed 50 characters",
  }),
});

export const transactionIdParamSchema = Joi.object({
  transactionId: Joi.string()
    .required()
    .regex(/^[0-9a-fA-F]{24}$/)
    .messages({
      "string.pattern.base": "Invalid transaction ID format",
      "any.required": "Transaction ID is required",
    }),
});

export const transactionReferenceParamSchema = Joi.object({
  reference: Joi.string().required().min(10).max(50).messages({
    "string.empty": "Transaction reference is required",
    "string.min": "Invalid reference format",
    "string.max": "Invalid reference format",
    "any.required": "Transaction reference is required",
  }),
});

export const cryptoIdParamSchema = Joi.object({
  cryptoId: Joi.string()
    .required()
    .regex(/^[0-9a-fA-F]{24}$/)
    .messages({
      "string.pattern.base": "Invalid crypto ID format",
      "any.required": "Crypto ID is required",
    }),
});

export const uploadProofSchema = Joi.object({
  proof: Joi.string().required().uri().messages({
    "string.uri": "Proof must be a valid URL",
    "string.empty": "Proof is required",
    "any.required": "Proof is required",
  }),
});
