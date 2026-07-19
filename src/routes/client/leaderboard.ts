import { Router } from "express";
import { authenticate } from "@/middlewares/client/auth";
import { validateQuery } from "@/middlewares/shared/validation";
import { leaderboardQuerySchema } from "@/validations/client/leaderboardValidation";
import { LeaderboardController } from "../../controllers/client/LeaderboardController";

const router = Router();
const leaderboardController = new LeaderboardController();

router.use(authenticate);

router.get(
  "/",
  validateQuery(leaderboardQuerySchema),
  leaderboardController.getLeaderboard
);

router.get(
  "/my-rank",
  validateQuery(leaderboardQuerySchema),
  leaderboardController.getUserRank
);

router.get("/my-ranks", leaderboardController.getUserAllRanks);

export default router;
