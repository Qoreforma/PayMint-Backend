import axios from "axios";
import { telegramConfig } from "@/config/telegram";
import logger from "@/logger";

export class TelegramMessengerService {
  private apiUrl = `${telegramConfig.apiBaseUrl}/bot${telegramConfig.botToken}`;

  async sendMessage(chatId: string | number, text: string): Promise<void> {
    try {
      await axios.post(`${this.apiUrl}/sendMessage`, { chat_id: chatId, text });
    } catch (error) {
      logger.error("Telegram sendMessage failed", { chatId, error });
    }
  }
}
