import { Types } from "mongoose";
import { BaseRepository } from "@/repositories/BaseRepository";
import {
  IManualWithdrawalRequest,
  ManualWithdrawalRequest,
} from "@/models/banking/Manualwithdrawalrequest";

export class ManualWithdrawalRepository extends BaseRepository<IManualWithdrawalRequest> {
  constructor() {
    super(ManualWithdrawalRequest);
  }

  async findByReference(
    reference: string,
  ): Promise<IManualWithdrawalRequest | null> {
    return this.findOne({ reference });
  }

  async findByTransactionId(
    transactionId: Types.ObjectId,
  ): Promise<IManualWithdrawalRequest | null> {
    return this.findOne({ transactionId });
  }

  async findWithFilters(
    filters: {
      status?: string;
      userId?: string;
      startDate?: Date;
      endDate?: Date;
    },
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: IManualWithdrawalRequest[]; total: number }> {
    const query: any = {};

    if (filters.status) query.status = filters.status;
    if (filters.userId) query.userId = new Types.ObjectId(filters.userId);
    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) query.createdAt.$gte = filters.startDate;
      if (filters.endDate) query.createdAt.$lte = filters.endDate;
    }

    return this.findWithPagination(query, page, limit, { createdAt: -1 }, [
      { path: "userId", select: "firstname lastname email phone" },
      { path: "processedBy", select: "firstname lastname email" },
    ]);
  }

  async updateStatus(
    id: string,
    update: {
      status: "approved" | "rejected";
      processedBy: Types.ObjectId;
      processedAt: Date;
      rejectionReason?: string;
    },
  ): Promise<IManualWithdrawalRequest | null> {
    return this.update(id, update);
  }
}
