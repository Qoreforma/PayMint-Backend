import { BaseRepository } from "../BaseRepository";
import { Notification, INotification } from "@/models/core/Notification";
import { Types } from "mongoose";

export class NotificationRepository extends BaseRepository<INotification> {
  constructor() {
    super(Notification);
  }

  async findByNotifiableId(
    notifiableId: string | Types.ObjectId,
    page: number = 1,
    limit: number = 10
  ) {
    return this.findWithPagination({ notifiableId }, page, limit);
  }

  async findUnreadByNotifiableId(
    notifiableId: string | Types.ObjectId
  ): Promise<INotification[]> {
    return this.model
      .find({ notifiableId, read: false })
      .sort({ createdAt: -1 })
      .exec();
  }

  async markAsRead(notificationId: string): Promise<INotification | null> {
    return this.model
      .findByIdAndUpdate(
        notificationId,
        { readAt: new Date(), read: true },
        { new: true }
      )
      .exec();
  }

  async markAllAsRead(notifiableId: string | Types.ObjectId): Promise<void> {
    await this.model
      .updateMany(
        { notifiableId, read: false },
        { readAt: new Date(), read: true }
      )
      .exec();
  }

  async countUnread(notifiableId: string | Types.ObjectId): Promise<number> {
    return this.model.countDocuments({ notifiableId, read: false }).exec();
  }

  async deleteManyNotifications(notifiableId: string | Types.ObjectId): Promise<void> {
    await this.model.deleteMany({ notifiableId }).exec();
  }

    async bulkInsert(notifications: Partial<INotification>[]): Promise<void> {
    if (notifications.length === 0) return;
    await this.model.insertMany(notifications, { ordered: false });
  }
}
