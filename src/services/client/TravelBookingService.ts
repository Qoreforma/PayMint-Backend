import { TransactionRepository } from "@/repositories/client/TransactionRepository";
import { NotificationRepository } from "@/repositories/client/NotificationRepository";
import { WalletService } from "./wallet/WalletService";
import { ProviderService } from "./ProviderService";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { Types } from "mongoose";
import { AppError } from "@/middlewares/shared/errorHandler";
import { generateReference } from "@/utils/helpers";
import { IUser } from "@/models/core/User";
import logger from "@/logger";

export class TravelBookingService {
 constructor(
    private transactionRepository: TransactionRepository,
    private walletService: WalletService,
    private providerService: ProviderService,
    private notificationRepository: NotificationRepository
  ) {}

  // Search cities/airports for flight booking
  async searchFlightCities(keyword: string) {
    return this.providerService.searchFlightCities(keyword);
  }

  // Get all available airlines
  async getAirlines() {
    return this.providerService.getAirlines();
  }

  // Search for available flights
  async searchFlights(params: {
    originLocationCode: string;
    destinationLocationCode: string;
    departureDate: string;
    returnDate?: string;
    adults: number;
    children?: number;
    infants?: number;
    travelClass?: "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";
    nonStop?: boolean;
    max?: number;
  }) {
    return this.providerService.searchFlights(params);
  }

  // Validate flight offer price before booking
  async validateFlightPrice(flightOffer: any) {
    return this.providerService.validateFlightPrice(flightOffer);
  }

  // Book a flight
  async bookFlight(data: {
    userId: string;
    flightOffer: any;
    travelers: Array<{
      id: string;
      dateOfBirth: string;
      gender: "MALE" | "FEMALE";
      name: {
        firstName: string;
        lastName: string;
      };
      contact: {
        emailAddress: string;
        phones: Array<{
          deviceType: "MOBILE" | "LANDLINE";
          countryCallingCode: string;
          number: string;
        }>;
      };
      documents?: Array<{
        documentType: "PASSPORT" | "IDENTITY_CARD";
        number: string;
        expiryDate: string;
        issuanceCountry: string;
        nationality: string;
        holder: boolean;
      }>;
    }>;
  }) {
    const reference = generateReference("FLIGHT_");
    const totalAmount = parseFloat(data.flightOffer.price.total);

    // Get user wallet
    const wallet = await this.walletService.getWallet(data.userId);
    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND
      );
    }

    // Check wallet balance
    if (wallet.balance < totalAmount) {
      throw new AppError(
        "Insufficient wallet balance",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INSUFFICIENT_BALANCE
      );
    }

    // Validate flight price first
    try {
      const priceValidation = await this.providerService.validateFlightPrice(
        data.flightOffer
      );

      if (!priceValidation.valid) {
        throw new AppError(
          "Flight offer is no longer valid or price has changed",
          HTTP_STATUS.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR
        );
      }

      // Use validated offer for booking
      data.flightOffer = priceValidation.flightOffers[0];
    } catch (error: any) {
      logger.error("Flight price validation failed", error);
      throw new AppError(
        "Unable to validate flight price. Please search again.",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    const options = {
      type: "flight",
      provider: "amadeus",
      providerReference: data.flightOffer.id,
      transactableType: "flight",
      transactableId: data.flightOffer.id,
      initiatedBy: new Types.ObjectId(data.userId),
      initiatedByType: "user" as "user" | "system" | "admin",
    };
    // Debit wallet
    const result = await this.walletService.debitWallet(
      data.userId,
      totalAmount,
      "Flight booking",
      options
    );

    const transaction = result.transaction;

    try {
      // Book the flight
      const providerResponse = await this.providerService.bookFlight({
        flightOffer: data.flightOffer,
        travelers: data.travelers,
        reference,
      });

      // Determine transaction status
      let status: "success" | "pending" | "failed";

      if (providerResponse.success) {
        status = "success";
      } else if (providerResponse.pending) {
        status = "pending";
      } else {
        status = "failed";
      }

      // Update transaction
      const result = await this.transactionRepository.update(transaction.id, {
        status,
        providerReference: providerResponse.providerReference,
        meta: {
          ...transaction.meta,
          bookingDetails: providerResponse.data,
        },
      });

      // Send notification based on status
      if (this.notificationRepository) {
        if (status === "success") {
          await this.notificationRepository.create({
            type: "transaction_success",
            notifiableType: "User",
            notifiableId: new Types.ObjectId(data.userId),
            data: {
              transactionType: "Flight",
              amount: totalAmount,
              reference,
              orderId: providerResponse.data?.orderId,
            },
          });
        } else if (status === "pending") {
          await this.notificationRepository.create({
            type: "transaction_pending",
            notifiableType: "User",
            notifiableId: new Types.ObjectId(data.userId),
            data: {
              transactionType: "Flight",
              amount: totalAmount,
              reference,
              message: "Your flight booking is being processed",
            },
          });
        }
      }

      // Note: Webhook will handle failed transaction refunds

      return {
        result,
        providerStatus: providerResponse.status,
        bookingDetails: providerResponse.data,
        pending: status === "pending",
      };
    } catch (error) {
      // Update transaction to failed
      await this.transactionRepository.updateStatus(transaction.id, "failed");

      // Note: Webhook will handle the refund for failed transactions
      throw error;
    }
  }

  // Get flight order details
  async getFlightOrder(orderId: string) {
    return this.providerService.getFlightOrder(orderId);
  }

  // Cancel flight booking
  async cancelFlightBooking(data: {
    userId: string;
    orderId: string;
    transactionId: string;
  }) {
    // Get transaction
    const transaction = await this.transactionRepository.findById(
      data.transactionId
    );

    if (!transaction) {
      throw new AppError(
        "Transaction not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND
      );
    }

    if (transaction.sourceId?.toString() !== data.userId) {
      throw new AppError(
        "Unauthorized to cancel this booking",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.UNAUTHORIZED
      );
    }

    if (transaction.status !== "success") {
      throw new AppError(
        "Only successful bookings can be cancelled",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    try {
      // Cancel with provider
      const providerResponse = await this.providerService.cancelFlightOrder(
        data.orderId
      );

      if (providerResponse.success) {
        // Update transaction status
        await this.transactionRepository.update(data.transactionId, {
          status: "cancelled",
          meta: {
            ...transaction.meta,
            cancelledAt: new Date(),
          },
        });

        // Refund the user (you may want to apply cancellation fees here)
        await this.walletService.creditWallet(
          data.userId,
          transaction.amount,
          "Flight booking cancelled - refund"
        );

        if (this.notificationRepository) {
          await this.notificationRepository.create({
            type: "transaction_cancelled",
            notifiableType: "User",
            notifiableId: new Types.ObjectId(data.userId),
            data: {
              transactionType: "Flight",
              amount: transaction.amount,
              reference: transaction.reference,
            },
          });
        }

        return {
          success: true,
          message: "Flight booking cancelled successfully",
          refundAmount: transaction.amount,
        };
      }

      throw new AppError(
        "Failed to cancel flight booking",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    } catch (error) {
      logger.error("Flight cancellation failed", error);
      throw error;
    }
  }

  // Get flight booking history
  async getFlightHistory(userId: string, page: number = 1, limit: number = 10) {
    return this.transactionRepository.findWithPagination(
      { sourceId: userId, type: "flight" },
      page,
      limit
    );
  }

  //  HOTEL BOOKING METHODS

  // Search for available hotels
  async searchHotels(params: {
    cityCode?: string;
    latitude?: number;
    longitude?: number;
    radius?: number;
    checkInDate: string;
    checkOutDate: string;
    adults: number;
    roomQuantity?: number;
    currency?: string;
  }) {
    return this.providerService.searchHotels(params);
  }

  // Get hotels by city code
  async getHotelsByCity(cityCode: string) {
    return this.providerService.getHotelsByCity(cityCode);
  }

  // Book a hotel
  async bookHotel(data: {
    userId: string;
    offerId: string;
    offerPrice: number;
    currency: string;
    hotelName: string;
    checkInDate: string;
    checkOutDate: string;
    guests: Array<{
      name: {
        title: string;
        firstName: string;
        lastName: string;
      };
      contact: {
        phone: string;
        email: string;
      };
    }>;
    payments: Array<{
      method: "CREDIT_CARD";
      card: {
        vendorCode: string;
        cardNumber: string;
        expiryDate: string;
      };
    }>;
  }) {
    const reference = generateReference("HOTEL_");
    const totalAmount = data.offerPrice;

    // Get user wallet
    const wallet = await this.walletService.getWallet(data.userId);
    if (!wallet) {
      throw new AppError(
        "Wallet not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND
      );
    }

    // Check wallet balance
    if (wallet.balance < totalAmount) {
      throw new AppError(
        "Insufficient wallet balance",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.INSUFFICIENT_BALANCE
      );
    }

    const options = {
      type: "hotel",
      provider: "booking.com",
      providerReference: reference,
      transactableType: "hotel",
      transactableId: new Types.ObjectId(data.offerId),
      initiatedBy: new Types.ObjectId(data.userId),
      initiatedByType: "user" as const,
      meta: {
        offerId: data.offerId,
        hotelName: data.hotelName,
        checkInDate: data.checkInDate,
        checkOutDate: data.checkOutDate,
        guests: data.guests,
        currency: data.currency,
      },
    };

    // Debit wallet
    const result = await this.walletService.debitWallet(
      data.userId,
      totalAmount,
      "Hotel booking",
      options
    );

    const transaction = result.transaction;

    try {
      // Book the hotel
      const providerResponse = await this.providerService.bookHotel({
        offerId: data.offerId,
        guests: data.guests,
        payments: data.payments,
        reference,
      });

      // Determine transaction status
      let status: "success" | "pending" | "failed";

      if (providerResponse.success) {
        status = "success";
      } else if (providerResponse.pending) {
        status = "pending";
      } else {
        status = "failed";
      }

      // Update transaction
      const result = await this.transactionRepository.update(transaction.id, {
        status,
        providerReference: providerResponse.providerReference,
        meta: {
          ...transaction.meta,
          bookingDetails: providerResponse.data,
        },
      });

      // Send notification based on status
      if (this.notificationRepository) {
        if (status === "success") {
          await this.notificationRepository.create({
            type: "transaction_success",
            notifiableType: "User",
            notifiableId: new Types.ObjectId(data.userId),
            data: {
              transactionType: "Hotel",
              amount: totalAmount,
              reference,
              bookingId: providerResponse.data?.bookingId,
            },
          });
        } else if (status === "pending") {
          await this.notificationRepository.create({
            type: "transaction_pending",
            notifiableType: "User",
            notifiableId: new Types.ObjectId(data.userId),
            data: {
              transactionType: "Hotel",
              amount: totalAmount,
              reference,
              message: "Your hotel booking is being processed",
            },
          });
        }
      }

      // Note: Webhook will handle failed transaction refunds

      return {
        result,
        providerStatus: providerResponse.status,
        bookingDetails: providerResponse.data,
        pending: status === "pending",
      };
    } catch (error) {
      // Update transaction to failed
      await this.transactionRepository.updateStatus(transaction.id, "failed");

      // Note: Webhook will handle the refund for failed transactions
      throw error;
    }
  }

  // Get hotel booking history
  async getHotelHistory(userId: string, page: number = 1, limit: number = 10) {
    return this.transactionRepository.findWithPagination(
      { sourceId: userId, type: "hotel" },
      page,
      limit
    );
  }
}
