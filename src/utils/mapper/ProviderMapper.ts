export class ProviderMapper {
  static mapOperators(operators: any[]): any[] {
    return operators.map((operator) => {
      // VTPass format — has operatorId + name + logo directly, no logoUrls array
      const isVTPass = !operator.logoUrls;

      if (isVTPass) {
        return {
          operatorId: operator.operatorId,
          name: operator.name,
          logoUrl: operator.logo || null,
        };
      }

      // Reloadly format
      return {
        operatorId: operator.operatorId,
        name: operator.name,
        country: operator.country,
        logoUrl: operator.logoUrls?.[0] || null,
        denominationType: operator.denominationType,
        hasDataBundles: operator.data || operator.bundle,
        pricing: {
          senderCurrency: {
            code: operator.senderCurrencyCode,
            symbol: operator.senderCurrencySymbol,
          },
          destinationCurrency: {
            code: operator.destinationCurrencyCode,
            symbol: operator.destinationCurrencySymbol,
          },
          minAmount: operator.minAmount,
          maxAmount: operator.maxAmount,
          localMinAmount: operator.localMinAmount,
          localMaxAmount: operator.localMaxAmount,
        },
        fixedAmounts: operator.fixedAmounts || [],
      };
    });
  }

  // Transform single operator for detail view
  static mapOperator(operator: any): any {
    const isVTPass = !operator.logoUrls;

    if (isVTPass) {
      return {
        operatorId: operator.operatorId,
        name: operator.name,
        logoUrl: operator.logo || null,
      };
    }

    return {
      operatorId: operator.operatorId,
      name: operator.name,
      country: operator.country,
      logoUrl: operator.logoUrls?.[0] || null,
      denominationType: operator.denominationType,
      hasDataBundles: operator.data || operator.bundle,
      pricing: {
        senderCurrency: {
          code: operator.senderCurrencyCode,
          symbol: operator.senderCurrencySymbol,
        },
        destinationCurrency: {
          code: operator.destinationCurrencyCode,
          symbol: operator.destinationCurrencySymbol,
        },
        minAmount: operator.minAmount,
        maxAmount: operator.maxAmount,
        localMinAmount: operator.localMinAmount,
        localMaxAmount: operator.localMaxAmount,
      },
      fixedAmounts: operator.fixedAmounts || [],
      commission: operator.commission,
    };
  }

  // Transform countries list for frontend — handles both VTPass and Reloadly
  static mapCountries(countries: any[]): any[] {
    return countries.map((country) => {
      // Reloadly uses isoName, VTPass uses code
      const isReloadly = !!country.isoName;

      return {
        iso2: country.iso2 || country.isoName || country.code || null,
        iso3: country.iso3 || null,
        name: country.name,
        flag: country.flag || null,
        phoneCode: country.phoneCode || country.callingCodes?.[0] || country.prefix ? `+${country.prefix}` : null,

        // Currency info (Reloadly specific)
        ...(isReloadly && {
          currencyCode: country.currencyCode || null,
          currencySymbol: country.currencySymbol || null,
          callingCodes: country.callingCodes || [],
        }),

        // VTPass specific
        ...(!isReloadly && {
          currencyCode: country.currency || null,
        }),
      };
    });
  }

  // Transform data products — handles both VTPass and Reloadly
  static mapDataProducts(product: any): any {
    // VTPass format — has 'variations' array directly
    const isVTPass = !!product.variations;

    if (isVTPass) {
      return {
        serviceName: product.serviceName,
        serviceId: product.serviceId,
        convenienceFee: product.convenienceFee,
        variations: product.variations.map((v: any) => ({
          variationCode: v.variationCode,
          name: v.name,
          amount: v.amount,
          fixedPrice: v.fixedPrice,
        })),
        totalVariations: product.variations.length,
      };
    }

    // Reloadly format
    const variations: {
      variationCode: string;
      name: any;
      amount: any;
      fixedPrice: string;
      localAmount?: string;
    }[] = [];

    if (product.fixedAmounts && product.fixedAmountsDescriptions) {
      product.fixedAmounts.forEach((amount: number) => {
        const amountStr = amount.toFixed(2);
        const description = product.fixedAmountsDescriptions[amountStr];

        variations.push({
          variationCode: `data_${amount}`,
          name: description || `${amount} ${product.senderCurrencyCode} Data`,
          amount: amount.toString(),
          fixedPrice: "Yes",
        });
      });
    }

    if (
      product.supportsLocalAmounts &&
      product.localFixedAmounts &&
      product.localFixedAmountsDescriptions
    ) {
      product.localFixedAmounts.forEach((localAmount: number) => {
        const localAmountStr = localAmount.toFixed(2);
        const description =
          product.localFixedAmountsDescriptions[localAmountStr];
        const index = product.localFixedAmounts.indexOf(localAmount);
        const senderAmount = product.fixedAmounts[index];

        variations.push({
          variationCode: `data_local_${localAmount}`,
          name:
            description ||
            `${localAmount} ${product.destinationCurrencyCode} Data`,
          amount: senderAmount ? senderAmount.toString() : "0.00",
          localAmount: localAmount.toString(),
          fixedPrice: "Yes",
        });
      });
    }

    return {
      serviceName: `${product.name} - International Data`,
      serviceId: `data-${product.operatorId}`,
      operatorId: product.operatorId,
      convenienceFee: `${product.commission} %`,
      country: {
        isoCode: product.country?.isoName,
        name: product.country?.name,
      },
      logo: product.logoUrls?.[0] || null,
      pricing: {
        senderCurrency: {
          code: product.senderCurrencyCode,
          symbol: product.senderCurrencySymbol,
        },
        destinationCurrency: {
          code: product.destinationCurrencyCode,
          symbol: product.destinationCurrencySymbol,
        },
        fx: product.fx,
        mostPopularAmount: product.mostPopularAmount,
        mostPopularLocalAmount: product.mostPopularLocalAmount,
      },
      features: {
        supportsLocalAmounts: product.supportsLocalAmounts,
        denominationType: product.denominationType,
        isDataBundle: product.data,
        isComboProduct: product.comboProduct,
      },
      variations,
      totalVariations: variations.length,
    };
  }

  // Transform multiple data products for listing
  static mapDataProductsList(products: any[]): any[] {
    return products.map((product) => ({
      operatorId: product.operatorId,
      name: product.name,
      country: product.country,
      logoUrl: product.logoUrls?.[0] || null,
      denominationType: product.denominationType,
      isDataBundle: product.data,
      isComboProduct: product.comboProduct,
      pricing: {
        senderCurrency: {
          code: product.senderCurrencyCode,
          symbol: product.senderCurrencySymbol,
        },
        destinationCurrency: {
          code: product.destinationCurrencyCode,
          symbol: product.destinationCurrencySymbol,
        },
        mostPopularAmount: product.mostPopularAmount,
        mostPopularLocalAmount: product.mostPopularLocalAmount,
      },
      commission: product.commission,
      supportsLocalAmounts: product.supportsLocalAmounts,
      totalProducts: product.fixedAmounts?.length || 0,
    }));
  }

  // Transform purchase response
  static mapPurchaseResponse(response: any): any {
    return {
      transactionId: response.transactionId,
      status: response.status,
      amount: response.amount,
      discount: response.discount || 0,
      resultCode: response.resultCode,
      message: response.message || this.getStatusMessage(response.status),
      timestamp: response.timestamp,
    };
  }

  // Transform gift card products
  static mapGiftCardProducts(products: any[]): any[] {
    return products.map((product) => ({
      productId: product.productId,
      productName: product.productName,
      category: product.category,
      country: product.country,
      logo: product.logo || null,
      minAmount: product.minAmount,
      maxAmount: product.maxAmount,
      fixedAmounts: product.fixedAmounts || [],
      currencyCode: product.currencyCode,
      currencySymbol: product.currencySymbol,
    }));
  }

  // Transform utility billers
  static mapUtilityBillers(billers: any[]): any[] {
    return billers.map((biller) => ({
      billerId: biller.billerId,
      name: biller.name,
      type: biller.type,
      serviceType: biller.serviceType,
      country: biller.country,
      logo: biller.logo || null,
      amountTypes: biller.amountTypes || [],
      fixedAmounts: biller.fixedAmounts || [],
      variableAmountMin: biller.variableAmountMin,
      variableAmountMax: biller.variableAmountMax,
      currencyCode: biller.currencyCode,
      currencySymbol: biller.currencySymbol,
    }));
  }

  // Helper to get readable status message
  private static getStatusMessage(status: string): string {
    const messages: { [key: string]: string } = {
      SUCCESSFUL: "Transaction completed successfully",
      PENDING: "Transaction is pending",
      PROCESSING: "Transaction is being processed",
      FAILED: "Transaction failed",
      REFUNDED: "Transaction was refunded",
    };
    return messages[status] || "Transaction status unknown";
  }

  // Helper to format data bundle descriptions
  static formatDataDescription(
    amount: number,
    currency: string,
    dataSize: string,
  ): string {
    return `${dataSize} Data - ${amount} ${currency}`;
  }

  // Helper to extract data size from description
  static extractDataSize(description: string): string {
    const match = description.match(/(\d+(?:\.\d+)?(?:MB|GB))/i);
    return match ? match[1] : description;
  }
}