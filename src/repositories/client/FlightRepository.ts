import { BaseRepository } from '../BaseRepository';
import { FlightBooking, IFlightBooking } from '@/models/flight/FlightBooking';

export class FlightRepository extends BaseRepository<IFlightBooking> {
  constructor() {
    super(FlightBooking);
  }

  async findByReference(reference: string): Promise<IFlightBooking | null> {
    return this.model.findOne({ reference }).exec();
  }

  async findByBookingId(bookingId: string): Promise<IFlightBooking | null> {
    return this.model.findOne({ bookingId }).exec();
  }

  async findByUserId(userId: string, filters: any = {}, page: number = 1, limit: number = 10) {
    const query: any = { userId, ...filters };
    return this.findWithPagination(query, page, limit, { createdAt: -1 });
  }

  async updateStatus(bookingId: string, status: string): Promise<IFlightBooking | null> {
    return this.model.findByIdAndUpdate(
      bookingId,
      { status },
      { new: true }
    ).exec();
  }
}
