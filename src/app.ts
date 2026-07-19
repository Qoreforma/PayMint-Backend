import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import routes from "./routes";
import { AppError, errorHandler } from "./middlewares/shared/errorHandler";
import { devLogger } from "./middlewares/shared/requestLogger";
import { ERROR_CODES, HTTP_STATUS } from "./utils/constants";
import Sentry from "./config/sentry";

const app: Application = express();
// Security middleware
app.use(helmet());
app.use(cors());
app.options("*", cors());
app.set("trust proxy", 1);

// Body parsing middleware
app.use(
  express.json({
    verify: (req: any, res, buf, encoding) => {
      req.rawBody = buf.toString("utf8");
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== "production") {
  app.use(devLogger);
}

// API routes
app.use("/api/v1", routes);

app.use((req, res, next) => {
  const error = new AppError(
    `Cannot ${req.method} ${req.path}`,
    HTTP_STATUS.NOT_FOUND,
    ERROR_CODES.NOT_FOUND,
  );
  next(error);
});

Sentry.setupExpressErrorHandler(app);

// Error handling middleware (must be last)
app.use(errorHandler);

export default app;
