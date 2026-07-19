import axios from "axios";
import { whatsappConfig } from "@/config/whatsapp";
import logger from "@/logger";

export class WhatsAppMessengerService {
  private apiUrl = `https://graph.facebook.com/${whatsappConfig.apiVersion}/${whatsappConfig.phoneNumberId}/messages`;

  async sendMessage(to: string, text: string): Promise<void> {
    try {
      await axios.post(
        this.apiUrl,
        { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
        { headers: { Authorization: `Bearer ${whatsappConfig.accessToken}` } },
      );
    } catch (error) {
      logger.error("WhatsApp sendMessage failed", { to, error });
    }
  }
}
