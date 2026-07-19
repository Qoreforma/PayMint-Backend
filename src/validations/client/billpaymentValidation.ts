import Joi, { number } from "joi";

export const airtimePurchaseSchema = Joi.object({
  phone: Joi.string().required().messages({
    "any.required": "Phone number is required",
    "string.empty": "Phone number is required",
  }),
  amount: Joi.number().positive().required().messages({
    "any.required": "Amount is required",
  }),
  provider: Joi.string().required().messages({
    "any.required": "Provider is required",
  }),
  discountCode: Joi.string().optional(),
  useCashback: Joi.boolean().optional().default(false),
  pin: Joi.string(),
  pinToken: Joi.string(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });

export const dataPurchaseSchema = Joi.object({
  phone: Joi.string().required().messages({
    "any.required": "Phone number is required",
    "string.empty": "Phone number is required",
  }),
  productId: Joi.string().required(),
  discountCode: Joi.string().optional(),
  useCashback: Joi.boolean().optional().default(false),
  pin: Joi.string(),
  pinToken: Joi.string(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });

export const purchaseInternationAirtimeSchema = Joi.object({
  phone: Joi.string().required().messages({
    "any.required": "Phone number is required",
    "string.empty": "Phone number is required",
  }),
  productCode: Joi.string().optional().messages({
    "any.required": "Product code is required",
    "string.empty": "Product code is not allowed to be empty",
  }),
  operatorId: Joi.string().required().messages({
    "any.required": "Operator is required",
    "string.empty": "Operator is not allowed to be empty",
  }),
  countryCode: Joi.string().required().messages({
    "any.required": "Country code is required",
    "string.empty": "Country code is not allowed to be empty",
  }),
  countryName: Joi.string().optional(),
  variationCode: Joi.string().optional(),
  amount: Joi.number().positive().required().messages({
    "any.required": "Amount is required",
    "string.empty": "Amount is not allowed to be empty",
  }),
  discountCode: Joi.string().optional(),
  useCashback: Joi.boolean().optional().default(false),
  pin: Joi.number(),
  pinToken: Joi.string(),
  flag: Joi.string().optional(),
  phoneCode: Joi.string().optional(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });

export const purchaseInternationDataSchema = Joi.object({
  phone: Joi.string().required().messages({
    "any.required": "Phone number is required",
    "string.empty": "Phone number is required",
  }),
  productCode: Joi.string().required().messages({
    "any.required": "Provider is required",
    "string.empty": "Provider is not allowed to be empty",
  }),
  discountCode: Joi.string().optional(),
  useCashback: Joi.boolean().optional().default(false),
  operatorId: Joi.string().required().messages({
    "any.required": "Operator is required",
    "string.empty": "Operator is not allowed to be empty",
  }),
  countryCode: Joi.string().required().messages({
    "any.required": "Country code is required",
    "string.empty": "Country code is not allowed to be empty",
  }),
  countryName: Joi.string().optional(),
  amount: Joi.number().positive().required().messages({
    "any.required": "Amount is required",
    "string.empty": "Amount is not allowed to be empty",
  }),
  flag: Joi.string().optional(),
  phoneCode: Joi.string().optional(),
  pin: Joi.number(),
  pinToken: Joi.string(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });

export const cableTvSchema = Joi.object({
  number: Joi.string().required(),
  productId: Joi.string().required(),
  provider: Joi.string().required().messages({
    "any.required": "Provider is required",
  }),
  discountCode: Joi.string().optional(),
  useCashback: Joi.boolean().optional().default(false),
  type: Joi.string().valid("renew", "change").required(),
  pin: Joi.number(),
  pinToken: Joi.string(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });

export const purchaseEducationSchema = Joi.object({
  number: Joi.number().optional().messages({
    "any.required": "Number is required",
    "string.empty": "Number is not allowed to be empty",
  }),
  productId: Joi.string().required().messages({
    "any.required": "ProuctId is required",
    "string.empty": "ProductId is not allowed to be empty",
  }),
  discountCode: Joi.string().optional(),
  useCashback: Joi.boolean().optional().default(false),
  pin: Joi.string(),
  pinToken: Joi.string(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });

export const electricitySchema = Joi.object({
  providerId: Joi.string().required().messages({
    "any.required": "Provider is required",
    "string.empty": "Provider is not allowed to be empty",
  }),
  type: Joi.string().required().valid("prepaid", "postpaid").messages({
    "any.required": "Type is required",
    "string.empty": "Type is not allowed to be empty",
    "any.only": "Type must be either 'prepaid' or 'postpaid'",
  }),
  discountCode: Joi.string().optional(),
  useCashback: Joi.boolean().optional().default(false),
  number: Joi.string().required().messages({
    "any.required": "Number is required",
    "string.empty": "Number is not allowed to be empty",
  }),
  amount: Joi.number().positive().required().messages({
    "any.required": "Amount is required",
    "string.empty": "Amount is not allowed to be empty",
  }),
  pin: Joi.number(),
  pinToken: Joi.string(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });

export const bettingPurchaseSchema = Joi.object({
  providerId: Joi.string().required().messages({
    "any.required": "ProviderId is required",
    "string.empty": "ProviderId is required",
  }),
  amount: Joi.number().positive().required().messages({
    "any.required": "Amount is required",
  }),
  number: Joi.string().required().messages({
    "any.required": "Number is required",
    "string.empty": "Number is not allowed to be empty",
  }),
  discountCode: Joi.string().optional(),
  useCashback: Joi.boolean().optional().default(false),
  pin: Joi.string(),
  pinToken: Joi.string(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });

export const verifyEducationSchema = Joi.object({
  number: Joi.number().required().messages({
    "any.required": "Number is required",
    "string.empty": "Number is not allowed to be empty",
  }),
  type: Joi.string().required().messages({
    "any.required": "Type is required",
    "string.empty": "Type is not allowed to be empty",
  }),
});

export const verifySmartCardNumberSchema = Joi.object({
  number: Joi.number().required().messages({
    "any:required": "Number is required",
    "string.empty": "Number is not allowed to be empty",
  }),
  provider: Joi.string().required().messages({
    "any.required": "Provider is required",
    "string.empty": "Provider is not allowed to be empty",
  }),
});

export const verifyElectricitySchema = Joi.object({
  providerCode: Joi.string().required().messages({
    "any.required": "Provider is required",
    "string.empty": "Provider is not allowed to be empty",
  }),
  type: Joi.string().required().valid("prepaid", "postpaid").messages({
    "any.required": "Type is required",
    "string.empty": "Type is not allowed to be empty",
    "any.only": "Type must be either 'prepaid' or 'postpaid'",
  }),
  number: Joi.string().required().messages({
    "any.required": "Number is required",
    "string.empty": "Number is not allowed to be empty",
  }),
});

export const transactionQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  type: Joi.string().optional(),
  status: Joi.string()
    .valid("pending", "success", "failed", "reversed")
    .optional(),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
});

export const verifyPhoneNumberSchema = Joi.object({
  phone: Joi.string()
    .pattern(/^0\d{10}$/)
    .required()
    .messages({
      "any.required": "Phone number is required",
      "string.pattern.base": "Invalid phone number",
    }),
  network: Joi.string().optional(),
});

export const airtimeEpinPurchaseSchema = Joi.object({
  network: Joi.string().required().messages({
    "any.required": "Network is required",
    "string.empty": "Network is required",
  }),
  denomination: Joi.number().valid(100, 200, 500).required().messages({
    "any.required": "Denomination is required",
    "any.only": "Denomination must be 100, 200, or 500",
  }),
  quantity: Joi.number().integer().min(1).max(100).required().messages({
    "any.required": "Quantity is required",
    "number.min": "Minimum quantity is 1",
    "number.max": "Maximum quantity is 100",
  }),
  pin: Joi.string(),
  pinToken: Joi.string(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });

  export const dataEpinPurchaseSchema = Joi.object({
  productId: Joi.string().required().messages({
    "any.required": "Product is required",
    "string.empty": "Product is required",
  }),
  quantity: Joi.number().integer().min(1).max(100).required().messages({
    "any.required": "Quantity is required",
    "number.min": "Minimum quantity is 1",
    "number.max": "Maximum quantity is 100",
  }),
  pin: Joi.string(),
  pinToken: Joi.string(),
})
  .or("pin", "pinToken")
  .messages({
    "object.missing": "Either pin or pinToken is required",
  });