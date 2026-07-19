import { Server } from "socket.io";
import logger from "@/logger";

class SocketService {
  private io: Server | null = null;

  public init(ioInstance: Server) {
    this.io = ioInstance;
    logger.info("SocketService initialized with Socket.io Server");
  }

  public emitTransactionUpdate(
    reference: string,
    payload: { status: string; transaction: any }
  ) {
    if (!this.io) {
      logger.warn("SocketService.io is not initialized. Cannot emit update.");
      return;
    }
    this.io.to(reference).emit("transaction_update", payload);
  }
}

export default new SocketService();
