import { Router } from "express";
import { SocialAuthController } from "@/controllers/client/SocialAuthController";
import { authenticate } from "@/middlewares/client/auth";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  googleSignInSchema,
  appleSignInSchema,
  linkAccountSchema,
} from "@/validations/client/socialAuthValidation";

const router = Router();

const socialAuthController = new SocialAuthController();

// Public routes - Sign in with social accounts
router.post(
  "/google/signin",
  validateRequest(googleSignInSchema),
  socialAuthController.googleSignIn
);

router.post(
  "/apple/signin",
  validateRequest(appleSignInSchema),
  socialAuthController.appleSignIn
);

// Protected routes - Link social accounts to existing user
router.post(
  "/google/link",
  authenticate,
  validateRequest(linkAccountSchema),
  socialAuthController.linkGoogleAccount
);

router.post(
  "/apple/link",
  authenticate,
  validateRequest(linkAccountSchema),
  socialAuthController.linkAppleAccount
);

export default router;