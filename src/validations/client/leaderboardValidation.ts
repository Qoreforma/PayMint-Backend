import Joi from "joi";
import { LEADERBOARD_TYPES, LEADERBOARD_PERIODS } from "@/utils/constants";

export const leaderboardQuerySchema = Joi.object({
  type: Joi.string()
    .valid(...LEADERBOARD_TYPES)
    .default("general")
    .messages({
      "any.only": `Type must be one of: ${LEADERBOARD_TYPES.join(", ")}`,
    }),
  multiples: Joi.string().optional(),
  period: Joi.string()
    .valid(...Object.values(LEADERBOARD_PERIODS))
    .default("all_time")
    .messages({
      "any.only": `Period must be one of: ${Object.values(LEADERBOARD_PERIODS).join(", ")}`,
    }),
  limit: Joi.number().integer().min(1).max(100).default(50).messages({
    "number.min": "Limit must be at least 1",
    "number.max": "Limit cannot exceed 100",
  }),
});
