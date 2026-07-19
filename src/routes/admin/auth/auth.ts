import { Router } from "express";
import { validateRequest } from "@/middlewares/shared/validation";
import {
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  resetPasswordSchema,
  verify2FA,
} from "@/validations/admin/authValidation";
import { AuthController } from "@/controllers/admin/auth/AuthController";
AuthController;
const router = Router();
const authController = new AuthController();

// Login
router.post("/login", validateRequest(loginSchema), authController.login);

// Logout
router.post("/logout", authController.logout as any);

// Refresh token
router.post(
  "/refresh",
  validateRequest(refreshTokenSchema),
  authController.refreshToken
);

// Forgot password
router.post(
  "/forgot-password",
  validateRequest(forgotPasswordSchema),
  authController.forgotPassword
);

// Reset password
router.post(
  "/reset-password",
  validateRequest(resetPasswordSchema),
  authController.resetPassword
);

router.post(
  "/verify-2fa",
//   rateLimiter.otp,
  validateRequest(verify2FA),
  authController.verify2FA
);

router.post(
  "/resend-2fa-otp",
//   rateLimiter.otp,
  validateRequest(forgotPasswordSchema),
  authController.resendOtp
);

export default router;
