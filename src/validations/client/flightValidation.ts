import Joi from 'joi';

export const searchFlightsSchema = Joi.object({
  origin: Joi.string().length(3).required(),
  destination: Joi.string().length(3).required(),
  departureDate: Joi.date().iso().required(),
  returnDate: Joi.date().iso().optional(),
  adults: Joi.number().integer().min(1).default(1),
  children: Joi.number().integer().min(0).default(0),
  infants: Joi.number().integer().min(0).default(0),
  travelClass: Joi.string().valid('ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST').default('ECONOMY'),
});

export const createFlightBookingSchema = Joi.object({
  offerId: Joi.string().required(),
  passengers: Joi.array().items(Joi.object({
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    dateOfBirth: Joi.date().required(),
    gender: Joi.string().valid('MALE', 'FEMALE').required(),
    email: Joi.string().email().required(),
    phone: Joi.string().required(),
  })).min(1).required(),
  ticketingAgreement: Joi.object().optional(),
});

export const flightBookingQuerySchema = Joi.object({
  status: Joi.string().valid('pending', 'confirmed', 'cancelled', 'failed').optional(),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
});
