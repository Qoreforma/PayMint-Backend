import { Request, Response } from "express";
import ServiceContainer from "@/services/client/container";
import { telegramConfig } from "@/config/telegram";
import logger from "@/logger";

export class TelegramController {
  private gateway = ServiceContainer.getChatGatewayService();
  private messenger = ServiceContainer.getTelegramMessengerService();

  handleWebhook = async (req: Request, res: Response) => {
    // Secret token check (set up via Telegram API setWebhook)
    const secret = req.headers["x-telegram-bot-api-secret-token"];
    if (telegramConfig.webhookSecret && secret !== telegramConfig.webhookSecret) {
      return res.status(401).send("Unauthorized");
    }

    const { message } = req.body;
    if (!message || !message.text) {
      return res.sendStatus(200); // Ignore non-text messages silently
    }

    const chatId = message.chat.id.toString();
    const text = message.text;

    try {
      const responseText = await this.gateway.handleMessage({
        channel: "telegram",
        externalId: chatId,
        text,
      });

      if (responseText) {
        await this.messenger.sendMessage(chatId, responseText);
      }
    } catch (error) {
      logger.error("Telegram webhook error", { error });
    }

    return res.sendStatus(200);
  };
}
