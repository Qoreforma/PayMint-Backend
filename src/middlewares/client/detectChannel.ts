import { Request, Response, NextFunction } from "express";

export const detectChannel = (req: Request, res: Response, next: NextFunction) => {
  const userAgent = req.headers["user-agent"] || "";
  const xChannel = (req.headers["x-channel"] as string || "").toLowerCase();

  let channel = "web";
  if (xChannel && ["ios", "android", "web", "api"].includes(xChannel)) {
    channel = xChannel;
  } else if (userAgent.includes("iPhone") || userAgent.includes("iPad")) {
    channel = "ios";
  } else if (userAgent.includes("Android")) {
    channel = "android";
  }

  (req as any).channel = channel;
  next();
};