import Joi from "joi";

export const updateUserStatusSchema = Joi.object({
  status: Joi.string().valid("active", "inactive", "suspended").required(),
});

export const markFraudulentSchema = Joi.object({
  reason: Joi.string().min(10).required(),
});

export const manageUserWalletSchema = Joi.object({
  amount: Joi.number().positive().required(),
  remark: Joi.string().required(),
  type: Joi.string().valid("credit", "debit").required(),
});

export const updateUserTypeSchema = Joi.object({
  userType: Joi.string()
    .valid("regular", "influencer", "influencer")
    .required(),
  referralEarningRate: Joi.number().positive().required(),
});
