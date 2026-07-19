export type ChatChannel = "telegram" | "whatsapp";

export type ChatFlow =
  | "airtime"
  | "data"
  | "electricity"
  | "cabletv"
  | "betting"
  | "education";

export interface IncomingChatMessage {
  channel: ChatChannel;
  externalId: string;
  text: string;
}

export interface ChatSessionState {
  step: string; // see per-flow step names in section 8
  flow?: ChatFlow;
  data?: Record<string, any>;
}
