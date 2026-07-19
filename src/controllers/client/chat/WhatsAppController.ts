import { Request, Response } from "express";
import ServiceContainer from "@/services/client/container";
import { whatsappConfig } from "@/config/whatsapp";
import logger from "@/logger";

export class WhatsAppController {
  private gateway = ServiceContainer.getChatGatewayService();
  private messenger = ServiceContainer.getWhatsAppMessengerService();

  verifyWebhook = (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === whatsappConfig.verifyToken) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  };

  handleWebhook = async (req: Request, res: Response) => {
    const { body } = req;

    if (body.object !== "whatsapp_business_account") {
      return res.sendStatus(404);
    }

    // Acknowledge receipt immediately
    res.sendStatus(200);

    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0]?.value;
      const messages = changes?.messages;

      if (messages && messages[0]) {
        const message = messages[0];
        const externalId = message.from; // User's phone number
        const text = message.text?.body;

        if (text) {
          const responseText = await this.gateway.handleMessage({
            channel: "whatsapp",
            externalId,
            text,
          });

          if (responseText) {
            await this.messenger.sendMessage(externalId, responseText);
          }
        }
      }
    } catch (error) {
      logger.error("WhatsApp webhook error", { error });
    }
  };
}
