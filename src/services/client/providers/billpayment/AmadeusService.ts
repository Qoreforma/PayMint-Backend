import axios, { AxiosInstance } from "axios";
import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import logger from "@/logger";
import { PROVIDERS } from "@/config";
import { FlightBookingData, FlightOffer, FlightSearchParams, HotelBookingData, HotelSearchParams, ProviderResponse } from "@/types"


export class AmadeusService {
  private client: AxiosInstance;
  private provider = PROVIDERS.AMADEUS;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.client = axios.create({
      baseURL: this.provider.baseUrl || "https://test.api.amadeus.com",
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Add request interceptor to ensure valid token
    this.client.interceptors.request.use(async (config) => {
      // Skip token for auth endpoint
      if (config.url?.includes("/security/oauth2/token")) {
        return config;
      }

      await this.ensureValidToken();
      config.headers.Authorization = `Bearer ${this.accessToken}`;
      return config;
    });
  }

  //  AUTHENTICATION 

  private async ensureValidToken(): Promise<void> {
    const now = Date.now();
    
    // Check if token is still valid (with 5 min buffer)
    if (this.accessToken && this.tokenExpiry > now + 300000) {
      return;
    }

    await this.authenticate();
  }

  private async authenticate(): Promise<void> {
    try {
      const response = await axios.post(
        `${this.provider.baseUrl}/v1/security/oauth2/token`,
        new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.provider.apiKey,
          client_secret: this.provider.secretKey,
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      this.accessToken = response.data.access_token;
      // Set expiry (expires_in is in seconds)
      this.tokenExpiry = Date.now() + response.data.expires_in * 1000;

      logger.info("Amadeus authentication successful");
    } catch (error: any) {
      logger.error("Amadeus authentication failed", error.response?.data || error.message);
      throw new AppError(
        "Failed to authenticate with Amadeus",
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        ERROR_CODES.PROVIDER_ERROR
      );
    }
  }

  //  CITY & AIRPORT SEARCH 

  async searchCities(keyword: string): Promise<any> {
    try {
      const response = await this.client.get("/v1/reference-data/locations", {
        params: {
          keyword,
          subType: "CITY,AIRPORT",
        },
      });

      if (response.data.data) {
        return response.data.data.map((location: any) => ({
          type: location.subType,
          iataCode: location.iataCode,
          name: location.name,
          cityName: location.address?.cityName,
          countryCode: location.address?.countryCode,
          countryName: location.address?.countryName,
        }));
      }

      return [];
    } catch (error: any) {
      logger.error("City search failed", error.response?.data || error.message);
      throw new AppError(
        error.response?.data?.errors?.[0]?.detail || "City search failed",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    }
  }

  //  FLIGHT SEARCH 

  async searchFlights(params: FlightSearchParams): Promise<any> {
    try {
      const response = await this.client.get("/v2/shopping/flight-offers", {
        params: {
          originLocationCode: params.originLocationCode,
          destinationLocationCode: params.destinationLocationCode,
          departureDate: params.departureDate,
          returnDate: params.returnDate,
          adults: params.adults,
          children: params.children,
          infants: params.infants,
          travelClass: params.travelClass,
          nonStop: params.nonStop,
          max: params.max || 10,
        },
      });

      if (response.data.data) {
        return {
          offers: response.data.data.map((offer: any) => ({
            id: offer.id,
            source: offer.source,
            price: {
              currency: offer.price.currency,
              total: offer.price.total,
              base: offer.price.base,
            },
            itineraries: offer.itineraries.map((itinerary: any) => ({
              duration: itinerary.duration,
              segments: itinerary.segments.map((segment: any) => ({
                departure: {
                  iataCode: segment.departure.iataCode,
                  at: segment.departure.at,
                },
                arrival: {
                  iataCode: segment.arrival.iataCode,
                  at: segment.arrival.at,
                },
                carrierCode: segment.carrierCode,
                number: segment.number,
                aircraft: segment.aircraft?.code,
                duration: segment.duration,
              })),
            })),
            validatingAirlineCodes: offer.validatingAirlineCodes,
            travelerPricings: offer.travelerPricings,
          })),
          dictionaries: response.data.dictionaries,
        };
      }

      return { offers: [], dictionaries: {} };
    } catch (error: any) {
      return this.handleError(error, "Flight search");
    }
  }

  //  FLIGHT OFFERS PRICE (VALIDATION) 

  async validateFlightPrice(flightOffer: FlightOffer): Promise<any> {
    try {
      const response = await this.client.post(
        "/v1/shopping/flight-offers/pricing",
        {
          data: {
            type: "flight-offers-pricing",
            flightOffers: [flightOffer],
          },
        }
      );

      if (response.data.data) {
        return {
          valid: true,
          flightOffers: response.data.data.flightOffers,
          price: response.data.data.flightOffers[0]?.price,
        };
      }

      throw new AppError(
        "Invalid flight offer",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR
      );
    } catch (error: any) {
      return this.handleError(error, "Flight price validation");
    }
  }

  //  FLIGHT BOOKING 

  async bookFlight(data: FlightBookingData): Promise<ProviderResponse> {
    try {
      const response = await this.client.post("/v1/booking/flight-orders", {
        data: {
          type: "flight-order",
          flightOffers: [data.flightOffer],
          travelers: data.travelers,
          remarks: data.remarks || {
            general: [
              {
                subType: "GENERAL_MISCELLANEOUS",
                text: `Booking reference: ${data.reference}`,
              },
            ],
          },
          contacts: data.contacts || [
            {
              addresseeName: {
                firstName: data.travelers[0].name.firstName,
                lastName: data.travelers[0].name.lastName,
              },
              purpose: "STANDARD",
              phones: data.travelers[0].contact.phones,
              emailAddress: data.travelers[0].contact.emailAddress,
            },
          ],
        },
      });

      if (response.data.data) {
        const bookingData = response.data.data;
        
        return {
          success: true,
          pending: false,
          reference: data.reference,
          providerReference: bookingData.id,
          message: "Flight booking successful",
          data: {
            orderId: bookingData.id,
            bookingReferences: bookingData.associatedRecords,
            flightOffers: bookingData.flightOffers,
            travelers: bookingData.travelers,
          },
        };
      }

      throw new AppError(
        "Flight booking failed",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    } catch (error: any) {
      return this.handleError(error, "Flight booking");
    }
  }

  //  FLIGHT ORDER MANAGEMENT 

  async getFlightOrder(orderId: string): Promise<any> {
    try {
      const response = await this.client.get(
        `/v1/booking/flight-orders/${orderId}`
      );

      if (response.data.data) {
        return {
          success: true,
          data: response.data.data,
        };
      }

      throw new AppError(
        "Flight order not found",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND
      );
    } catch (error: any) {
      return this.handleError(error, "Get flight order");
    }
  }

  async cancelFlightOrder(orderId: string): Promise<ProviderResponse> {
    try {
      const response = await this.client.delete(
        `/v1/booking/flight-orders/${orderId}`
      );

      return {
        success: true,
        pending: false,
        providerReference: orderId,
        message: "Flight order cancelled successfully",
        data: response.data.data,
      };
    } catch (error: any) {
      return this.handleError(error, "Cancel flight order");
    }
  }

  //  HOTEL SEARCH 

  async searchHotels(params: HotelSearchParams): Promise<any> {
    try {
      const queryParams: any = {
        checkInDate: params.checkInDate,
        checkOutDate: params.checkOutDate,
        adults: params.adults,
        roomQuantity: params.roomQuantity || 1,
        currency: params.currency || "USD",
      };

      if (params.cityCode) {
        queryParams.cityCode = params.cityCode;
      } else if (params.latitude && params.longitude) {
        queryParams.latitude = params.latitude;
        queryParams.longitude = params.longitude;
        queryParams.radius = params.radius || 5;
      }

      const response = await this.client.get("/v3/shopping/hotel-offers", {
        params: queryParams,
      });

      if (response.data.data) {
        return response.data.data.map((hotelOffer: any) => ({
          hotelId: hotelOffer.hotel.hotelId,
          name: hotelOffer.hotel.name,
          cityCode: hotelOffer.hotel.cityCode,
          latitude: hotelOffer.hotel.latitude,
          longitude: hotelOffer.hotel.longitude,
          offers: hotelOffer.offers.map((offer: any) => ({
            id: offer.id,
            checkInDate: offer.checkInDate,
            checkOutDate: offer.checkOutDate,
            room: offer.room,
            guests: offer.guests,
            price: {
              currency: offer.price.currency,
              total: offer.price.total,
              base: offer.price.base,
            },
            policies: offer.policies,
          })),
        }));
      }

      return [];
    } catch (error: any) {
      return this.handleError(error, "Hotel search");
    }
  }

  //  HOTEL BOOKING 

  async bookHotel(data: HotelBookingData): Promise<ProviderResponse> {
    try {
      const response = await this.client.post("/v1/booking/hotel-bookings", {
        data: {
          offerId: data.offerId,
          guests: data.guests,
          payments: data.payments,
        },
      });

      if (response.data.data && response.data.data.length > 0) {
        const booking = response.data.data[0];
        
        return {
          success: true,
          pending: false,
          reference: data.reference,
          providerReference: booking.id,
          message: "Hotel booking successful",
          data: {
            bookingId: booking.id,
            providerConfirmationId: booking.providerConfirmationId,
            hotel: booking.hotel,
            guests: booking.guests,
            checkInDate: booking.checkInDate,
            checkOutDate: booking.checkOutDate,
          },
        };
      }

      throw new AppError(
        "Hotel booking failed",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.PROVIDER_ERROR
      );
    } catch (error: any) {
      return this.handleError(error, "Hotel booking");
    }
  }

  //  HOTEL LIST (BY LOCATION) 

  async getHotelsByCity(cityCode: string): Promise<any> {
    try {
      const response = await this.client.get("/v1/reference-data/locations/hotels/by-city", {
        params: {
          cityCode,
        },
      });

      if (response.data.data) {
        return response.data.data.map((hotel: any) => ({
          hotelId: hotel.hotelId,
          name: hotel.name,
          iataCode: hotel.iataCode,
          geoCode: hotel.geoCode,
        }));
      }

      return [];
    } catch (error: any) {
      return this.handleError(error, "Get hotels by city");
    }
  }

  //  AIRLINE CODES LOOKUP 

  async getAirlines(): Promise<any> {
    try {
      const response = await this.client.get("/v1/reference-data/airlines");

      if (response.data.data) {
        return response.data.data.map((airline: any) => ({
          iataCode: airline.iataCode,
          icaoCode: airline.icaoCode,
          businessName: airline.businessName,
          commonName: airline.commonName,
        }));
      }

      return [];
    } catch (error: any) {
      logger.error("Get airlines failed", error.response?.data || error.message);
      return [];
    }
  }

  //  ERROR HANDLING 

  private handleError(error: any, operationType: string): never {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error(`Amadeus ${operationType} error`, {
      status: error.response?.status,
      data: error.response?.data,
    });

    const errorData = error.response?.data;
    const errorMessage = errorData?.errors?.[0]?.detail || 
                        errorData?.errors?.[0]?.title ||
                        error.message ||
                        `${operationType} failed`;

    // Handle specific Amadeus error codes
    const errorCode = errorData?.errors?.[0]?.code;
    
    if (error.response?.status === 401 || errorCode === 38190) {
      throw new AppError(
        "Authentication failed",
        HTTP_STATUS.UNAUTHORIZED,
        ERROR_CODES.UNAUTHORIZED
      );
    }

    if (error.response?.status === 429 || errorCode === 38194) {
      throw new AppError(
        "Rate limit exceeded. Please try again later",
        HTTP_STATUS.TOO_MANY_REQUESTS,
        ERROR_CODES.RATE_LIMIT_EXCEEDED
      );
    }

    if (error.response?.status === 404 || errorCode === 38193) {
      throw new AppError(
        "Resource not found or expired",
        HTTP_STATUS.NOT_FOUND,
        ERROR_CODES.RESOURCE_NOT_FOUND
      );
    }

    throw new AppError(
      errorMessage,
      error.response?.status || HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.PROVIDER_ERROR
    );
  }
}