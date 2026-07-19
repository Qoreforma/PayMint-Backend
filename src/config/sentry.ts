import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import {
  expressIntegration,
  httpIntegration,
  onUncaughtExceptionIntegration,
  onUnhandledRejectionIntegration,
} from "@sentry/node";
import logger from "@/logger";
import { config } from "dotenv";

config();

// Guard: Only init if DSN exists
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

    integrations: [
      nodeProfilingIntegration(),
      expressIntegration(),
      httpIntegration(),
      onUncaughtExceptionIntegration(),
      onUnhandledRejectionIntegration(),
    ],

    ignoreErrors: [
      "NetworkError when attempting to fetch resource",
      "timeout of",
    ],

    beforeSend(event, hint) {
      if (
        event.request &&
        typeof event.request.data === "object" &&
        event.request.data !== null
      ) {
        const sensitiveFields = [
          "password",
          "pin",
          "pinToken",
          "otp",
          "creditcardnumber",
          "cvv",
          "accesstoken",
          "refreshtoken",
        ];

        const data = event.request.data as Record<string, unknown>;
        Object.keys(data).forEach((key) => {
          if (sensitiveFields.includes(key.toLowerCase())) {
            data[key] = "[REDACTED]";
          }
        });
      }
      return event;
    },
  });

  logger.info("✓ Sentry initialized");
} else {
  logger.warn("Sentry DSN not found - error monitoring disabled");
}

export default Sentry;