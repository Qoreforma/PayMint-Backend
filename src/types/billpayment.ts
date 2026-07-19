import { ProviderDTO } from "@/middlewares/shared/checkServiceAvailability";

export interface ProviderResponse {
  success: boolean;
  pending?: boolean;
  reference?: string;
  status?: string;
  providerReference?: string;
  providerCode?: string;
  message: string;
  data?: any;
  token?: string;
  commission?: number;
  convenienceFee?: number;
  providerCost?: number;
  providerFee?: number;
  providerSmsFee?: number;
  providerTotalFee?: number;
  providerDiscount?: number;
  meta?: {
    customerAddress?: string;
    customerName?: string;
    tokenAmount?: number;
    meterNumber?: string;
    units?: string;
    exchangeReference?: string;
  };
  pins?: any[]; // For E-PIN responses
}

export interface ProviderResponseWithCode {
  success: boolean;
  pending: boolean;
  reference: string;
  providerReference?: string;
  providerCode: string;
  status: string;
  message: string;
  data?: any;
  token?: string;
}

export interface AirtimeData {
  phone: string;
  amount: number;
  network: string;
  reference: string;
  provider: ProviderDTO;
  serviceCode?: string;
}

export interface DataDataDTO {
  phone: string;
  amount: number;
  plan: string;
  productCode: string;
  serviceCode?: string;
  variationCode?: string;
  reference: string;
  provider: ProviderDTO;
}

export interface CableTvData {
  smartCardNumber: string;
  amount: number;
  provider: string;
  package: string;
  reference: string;
  phone?: string;
  subscriptionType: "renew" | "change";
  serviceProvider: ProviderDTO;
  serviceCode?: string;
}

export interface ElectricityData {
  reference: string;
  meterNumber: string;
  amount: number;
  meterType: string;
  productCode: string;
  phone: string;
  provider: string;
  serviceProvider: ProviderDTO;
  serviceCode?: string;
}

export interface BettingDtoWithProvider extends BettingData {
  serviceProvider: ProviderDTO;
}
export interface BettingData {
  customerId: string;
  amount: number;
  provider: string;
  reference?: string;
}

export interface AirtimeEPINData {
  network: string;
  value: number;
  quantity: number;
  reference: string;
}

export interface DataEPINData {
  network: string;
  dataPlan: string;
  quantity: number;
  reference: string;
}

export interface EducationEPINData {
  examType: string;
  phone: string;
  reference: string;
  profileId?: string;
}

export interface EducationData {
  profileId: string;
  phone: string;
  variationCode: string;
  amount: number;
  reference: string;
  serviceCode?: string;
  quantity?: number;
  provider: ProviderDTO;
}

export interface InternationalAirtimeData {
  phone: string;
  amount: number;
  countryCode: string;
  operatorId: string;
  variationCode?: string;
  reference: string;
  email?: string;
  provider: ProviderDTO;
}

export interface IntDataWithProvider extends InternationalDataData {
  provider: ProviderDTO;
}
export interface InternationalDataData {
  phone: string;
  amount: number;
  countryCode: string;
  operatorId: string;
  variationCode?: string;
  reference: string;
  email?: string;
}
export interface GiftCardOrderData {
  productId: number;
  quantity: number;
  unitPrice: number;
  customIdentifier: string;
  senderName: string;
  recipientEmail?: string;
  recipientPhoneDetails?: {
    countryCode?: string;
    phoneNumber?: string;
  };
  userId?: string;
}

export interface UtilityPaymentData {
  subscriberAccountNumber: string;
  amount: number;
  amountId?: number;
  billerId: number;
  useLocalAmount?: boolean;
  referenceId: string;
  additionalInfo?: {
    invoiceId?: string;
  };
}

export interface FlightSearchParams {
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
}

export interface FlightOffer {
  type: string;
  id: string;
  source: string;
  itineraries: any[];
  price: {
    currency: string;
    total: string;
    base: string;
    fees?: any[];
  };
  travelerPricings: any[];
}

export interface TravelerInfo {
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
}

export interface FlightBookingData {
  flightOffer: FlightOffer;
  travelers: TravelerInfo[];
  reference: string;
  remarks?: {
    general?: Array<{
      subType: string;
      text: string;
    }>;
  };
  contacts?: Array<{
    addresseeName: {
      firstName: string;
      lastName: string;
    };
    companyName?: string;
    purpose: string;
    phones: Array<{
      deviceType: string;
      countryCallingCode: string;
      number: string;
    }>;
    emailAddress: string;
    address?: {
      lines: string[];
      postalCode: string;
      cityName: string;
      countryCode: string;
    };
  }>;
}

export interface HotelSearchParams {
  cityCode?: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
  checkInDate: string;
  checkOutDate: string;
  adults: number;
  roomQuantity?: number;
  currency?: string;
}

export interface HotelBookingData {
  offerId: string;
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
  reference: string;
}
