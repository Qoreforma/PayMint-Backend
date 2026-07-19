import Joi from 'joi';

export const declineDepositSchema = Joi.object({
  reason: Joi.string().min(10).required(),
});
