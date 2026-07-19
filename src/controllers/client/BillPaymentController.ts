import { Response, NextFunction } from "express";
import { AuthRequest } from "@/middlewares/client/auth";
import { BillPaymentService } from "@/services/client/BillPaymentService";
import { sendSuccessResponse, sendPaginatedResponse } from "@/utils/helpers";
import { HTTP_STATUS } from "@/utils/constants";
import { ProviderMapper } from "@/utils/mapper/ProviderMapper";
import ServiceContainer from "@/services/client/container";

export class BillPaymentController {
  private billPaymentService: BillPaymentService;
  constructor() {
    this.billPaymentService = ServiceContainer.getBillPaymentService();
  }

  purchaseAirtime = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { phone, amount, provider, discountCode } = req.body;
      const result = await this.billPaymentService.purchaseAirtime({
        phone,
        network: provider,
        amount,
        userId,
        provider: req.serviceProvider,
        discountCode,
      });
      return sendSuccessResponse(
        res,
        result,
        "Airtime purchase initiated",
        HTTP_STATUS.CREATED,
      );
    } catch (error) {
      next(error);
    }
  };

  purchaseData = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { phone, productId } = req.body;
      const result = await this.billPaymentService.purchaseData({
        phone,
        productId,
        userId,
        serviceProvider: req.serviceProvider,
      });
      return sendSuccessResponse(
        res,
        result,
        "Data purchase initiated",
        HTTP_STATUS.CREATED,
      );
    } catch (error) {
      next(error);
    }
  };

  purchaseCableTv = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const user = req.userData!;
      const { provider, number, type, productId, discountCode } = req.body;
      const result = await this.billPaymentService.purchaseCableTv({
        userId,
        user,
        provider,
        smartCardNumber: number,
        type,
        productId,
        serviceProvider: req.serviceProvider,
        discountCode,
      });
      return sendSuccessResponse(
        res,
        result,
        "Cable TV subscription initiated",
        HTTP_STATUS.CREATED,
      );
    } catch (error) {
      next(error);
    }
  };

  purchaseElectricity = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const phone = req.userData?.phone;

      if (!phone) {
        return sendSuccessResponse(
          res,
          null,
          "Kindly Update your Phone Number",
          HTTP_STATUS.NOT_FOUND,
        );
      }
      const { providerId, type, number, amount, discountCode } = req.body;
      const result = await this.billPaymentService.purchaseElectricity({
        providerId,
        meterType: type,
        meterNumber: number,
        amount,
        userId,
        phone,
        serviceProvider: req.serviceProvider,
        discountCode,
      });
      return sendSuccessResponse(
        res,
        result,
        "Electricity payment initiated",
        HTTP_STATUS.CREATED,
      );
    } catch (error) {
      next(error);
    }
  };

  //epin
  purchaseAirtimeEPIN = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { network, denomination, quantity } = req.body;
      const result = await this.billPaymentService.purchaseAirtimeEPIN({
        userId,
        network,
        denomination,
        quantity,
        provider: req.serviceProvider,
      });
      return sendSuccessResponse(
        res,
        result,
        "Airtime E-PIN purchase successful",
        HTTP_STATUS.CREATED,
      );
    } catch (error) {
      next(error);
    }
  };

  getAirtimeEPIN = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { reference } = req.params;
      const result = await this.billPaymentService.getAirtimeEPIN(
        reference,
        userId,
      );
      return sendSuccessResponse(res, result, "E-PIN transaction retrieved");
    } catch (error) {
      next(error);
    }
  };

  getDataEPINProducts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { serviceId } = req.params;

    if (!serviceId) {
      return sendSuccessResponse(
        res,
        null,
        "Service not found",
        HTTP_STATUS.NOT_FOUND,
      );
    }
    const providerId = req.serviceProvider._id.toString();
    const result = await this.billPaymentService.getDataEPINProducts(
      serviceId,
      providerId,
    );
    return sendSuccessResponse(res, result, "Data E-PIN products retrieved");
  } catch (error) {
    next(error);
  }
};
  purchaseDataEPIN = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { productId, quantity } = req.body;
      const result = await this.billPaymentService.purchaseDataEPIN({
        userId,
        productId,
        quantity,
        provider: req.serviceProvider,
      });
      return sendSuccessResponse(
        res,
        result,
        result.pending
          ? "Data E-PIN order received and processing"
          : "Data E-PIN purchase successful",
        HTTP_STATUS.CREATED,
      );
    } catch (error) {
      next(error);
    }
  };

  getDataEPIN = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { reference } = req.params;
      const result = await this.billPaymentService.getDataEPIN(
        reference,
        userId,
      );
      return sendSuccessResponse(
        res,
        result,
        "Data E-PIN transaction retrieved",
      );
    } catch (error) {
      next(error);
    }
  };

  // Airtime methods
  getAirtimeProviders = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const providers = await this.billPaymentService.getAirtimeProviders();
      return sendSuccessResponse(
        res,
        providers,
        "Airtime providers retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  verifyPhone = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.billPaymentService.verifyPhone(req.body.phone);
      return sendSuccessResponse(res, result, "Phone verified successfully");
    } catch (error) {
      next(error);
    }
  };

  verifyPhoneWithNetwork = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { phone, network } = req.body;
      const isValid = await this.billPaymentService.verifyPhoneWithNetwork(
        phone,
        network,
      );
      return sendSuccessResponse(
        res,
        { isValid },
        "Phone and network verification completed",
      );
    } catch (error) {
      next(error);
    }
  };

  getInternationalAirtimeCountries = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const countries =
        await this.billPaymentService.getInternationalAirtimeCountries();

      // Transform data with mapper
      const cleanedCountries = ProviderMapper.mapCountries(countries);

      return sendSuccessResponse(
        res,
        cleanedCountries,
        "International airtime countries retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getInternationalAirtimeProviders = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { countryCode } = req.params;
      const providers =
        await this.billPaymentService.getInternationalAirtimeProviders(
          countryCode,
        );

      // Transform data with mapper - clean up unnecessary fields
      const cleanedProviders = ProviderMapper.mapOperators(providers);

      return sendSuccessResponse(
        res,
        cleanedProviders,
        "International airtime providers retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getInternationalAirtimeProducts = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { providerId } = req.params;
      const productTypeId = 1;
      const products =
        await this.billPaymentService.getInternationalAirtimeProducts(
          providerId,
          productTypeId,
        );
      return sendSuccessResponse(
        res,
        products,
        "International airtime products retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  purchaseInternationalAirtime = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const {
        phone,
        amount,
        productCode,
        countryCode,
        operatorId,
        discountCode,
        countryName,
        variationCode,
        flag,
        phoneCode,
      } = req.body;
      const email = req.user!.email;

      const result = await this.billPaymentService.purchaseInternationalAirtime(
        {
          userId,
          phone,
          amount,
          countryCode,
          productCode,
          operatorId,
          email,
          provider: req.serviceProvider,
          discountCode,
          countryName,
          variationCode,
          flag,
          phoneCode,
        },
      );

      return sendSuccessResponse(
        res,
        result,
        "International airtime purchase initiated",
        HTTP_STATUS.CREATED,
      );
    } catch (error) {
      next(error);
    }
  };

  // INTERNATIONAL DATA METHODS

  getInternationalDataCountries = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const countries =
        await this.billPaymentService.getInternationalDataCountries();

      // Transform data with mapper
      const cleanedCountries = ProviderMapper.mapCountries(countries);

      return sendSuccessResponse(
        res,
        cleanedCountries,
        "International data countries retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getInternationalDataProviders = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { countryCode } = req.params;
      const providers =
        await this.billPaymentService.getInternationalDataProviders(
          countryCode,
        );

      // Transform data with mapper - clean up unnecessary fields
      const cleanedProviders = ProviderMapper.mapOperators(providers);

      return sendSuccessResponse(
        res,
        cleanedProviders,
        "International data providers retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getInternationalDataProducts = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { providerId } = req.params;
      const products =
        await this.billPaymentService.getInternationalDataProducts(providerId);
      const formattedProduct = ProviderMapper.mapDataProducts(products);
      return sendSuccessResponse(
        res,
        formattedProduct,
        "International data products retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  purchaseInternationalData = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const {
        phone,
        amount,
        productCode,
        countryCode,
        countryName,
        operatorId,
        discountCode,
          flag,
        phoneCode
      } = req.body;
      const email = req.user!.email;

      const result = await this.billPaymentService.purchaseInternationalData({
        userId,
        phone,
        amount,
        countryCode,
        countryName,
        productCode,
        operatorId,
        email,
        provider: req.serviceProvider,
        discountCode,
          flag,
        phoneCode
      });

      return sendSuccessResponse(
        res,
        result,
        "International data purchase initiated",
        HTTP_STATUS.CREATED,
      );
    } catch (error) {
      next(error);
    }
  };

  //Data methods
  getDataProducts = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { providerId, dataType } = req.params;
      const products = await this.billPaymentService.getDataProducts(
        providerId,
        dataType,
      );
      return sendSuccessResponse(
        res,
        products,
        "Data products retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getDataTypesByServiceCode = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { serviceCode } = req.params;
      const types =
        await this.billPaymentService.getDataTypesByServiceCode(serviceCode);
      return sendSuccessResponse(
        res,
        types,
        "Data types retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getDataProviders = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const providers = await this.billPaymentService.getDataProviders();
      return sendSuccessResponse(
        res,
        providers,
        "Data providers retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getData = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const data = await this.billPaymentService.getData();
      return sendSuccessResponse(res, data, "Data retrieved successfully");
    } catch (error) {
      next(error);
    }
  };

  // TV methods
  getTvPackages = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { providerId } = req.params;
      const serviceProvider = req.serviceProvider;
      const products =
        await this.billPaymentService.getCableTvProducts(providerId);
      return sendSuccessResponse(
        res,
        products,
        "Tv Packages retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getTvProviders = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const providers = await this.billPaymentService.getCableTvProviders();
      return sendSuccessResponse(
        res,
        providers,
        "Tv providers retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  verifySmartCardNumber = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { number, provider } = req.body;
      const serviceProvider = req.serviceProvider;

      const result = await this.billPaymentService.verifyCableSmartCard(
        number,
        provider,
        serviceProvider,
      );

      return sendSuccessResponse(
        res,
        result,
        "Smart card Number Verified Successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  // Betting methods
  getBettingProviders = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const provider = req.serviceProvider;
      const providers =
        await this.billPaymentService.getBettingProviders(provider);
      return sendSuccessResponse(
        res,
        providers,
        "Betting providers retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  verifyBettingAccount = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { number, providerId } = req.body;
      const serviceProvider = req.serviceProvider;

      const result = await this.billPaymentService.verifyBettingAccount({
        customerId: number,
        providerId,
        serviceProvider,
      });
      return sendSuccessResponse(
        res,
        result,
        "Betting account verified successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  fundBetting = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { providerId, amount, number, discountCode } = req.body;
      const result = await this.billPaymentService.fundBetting({
        userId,
        customerId: number,
        providerId,
        amount,
        serviceProvider: req.serviceProvider,
        discountCode,
      });
      return sendSuccessResponse(
        res,
        result,
        "Betting account funded successfully",
        HTTP_STATUS.CREATED,
      );
    } catch (error) {
      next(error);
    }
  };

  // E-Pin methods
  getEducationServices = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const services = await this.billPaymentService.getEducationServices();
      return sendSuccessResponse(
        res,
        services,
        "E-Pin services retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  getEducationProducts = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { service } = req.params;
      const products =
        await this.billPaymentService.getEducationProducts(service);
      return sendSuccessResponse(
        res,
        products,
        "E-Pin products retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  verifyEducationMerchant = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { number, type } = req.body;
      const result = await this.billPaymentService.verifyEducationProfile({
        number,
        type,
      });
      return sendSuccessResponse(
        res,
        result,
        "E-Pin merchant verified successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  purchaseEducation = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user!.id;
      const { productId, number, discountCode } = req.body;
      const user = req.userData!;
      const result = await this.billPaymentService.purchaseEducation({
        productId,
        profileId: number,
        user,
        userId,
        provider: req.serviceProvider,
        discountCode,
      });
      return sendSuccessResponse(
        res,
        result,
        "E-Pin purchase initiated",
        HTTP_STATUS.CREATED,
      );
    } catch (error) {
      next(error);
    }
  };

  // Electricity methods
  getElectricityProviders = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const provider = req.serviceProvider;
      const providers =
        await this.billPaymentService.getElectricityProviders(provider);
      return sendSuccessResponse(
        res,
        providers,
        "Electricity providers retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  };

  verifyMeterNumber = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { providerCode, type, number } = req.body;
      const serviceProvider = req.serviceProvider;

      const result = await this.billPaymentService.verifyMeterNumber({
        serviceCode: providerCode,
        meterType: type,
        meterNumber: number,
        serviceProvider,
      });
      return sendSuccessResponse(
        res,
        result,
        "Meter number verified successfully",
      );
    } catch (error) {
      next(error);
    }
  };
}