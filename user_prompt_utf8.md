<USER_REQUEST>
# BillPadi ΓÇö Async Provider Flow Changes

**Instructions for AI IDE:** Apply every change in this document exactly as written. Make no other changes to any file. Each section states the file, what to do, and the exact code. Do not reformat, rename variables, or add extra logic.

---

## Background (read before editing)

The provider HTTP call (VTPass, ClubKonnect, etc.) blocks the response to the user for 7ΓÇô15 seconds. The fix is:

- **IMMEDIATE providers** (Coolsub, GiftBills, Bilalsadasub, MyDataPlug, Reloadly) ΓÇö keep synchronous, they return fast.
- **All other providers** (VTPass, ClubKonnect, VTU.ng, MySimHosting) ΓÇö fire the provider call async, return `pending` to the user immediately after debit, let polling/webhooks resolve it in the background.

The polling infrastructure (`TransactionPollingService`, `initializeTransactionHandling`, `handleSuccess`, `handleFailure`, `handleError`) is already built and working. We are only changing when the provider call is awaited.

---

## File 1: `src/services/client/billPayment/AirtimeService.ts`

### Change 1a ΓÇö add import at top of file

Add this line with the other imports (after the last existing import line):

```ts
import { isImmediateResponseProvider } from "@/config/providers";
```

### Change 1b ΓÇö replace the entire block starting at `const transaction = debitResult.transaction;` through the end of the closing `}` of the `purchase` method (just before `async verifyPhone`)

Replace this entire block:

```ts
    const transaction = debitResult.transaction;

    try {
      const providerResponse = await this.providerService.purchaseAirtime({
        phone: data.phone,
        amount: data.amount,
        network: data.network,
        reference,
        provider: data.provider,
        serviceCode: service.code,
      });

      const { status, transaction: updatedTransaction } =
        await this.transactionProcessor.updateTransactionStatus(
          transaction.id,
          providerResponse,
        );

      const context = {
        userId: data.userId,
        walletId: wallet.id,
        transactionId: transaction.id,
        reference,
        amount: data.amount,
        totalAmount: chargeCalculation.totalAmount,
        chargeInfo: chargeCalculation,
        transactionType: TRANSACTION_TYPES.AIRTIME,
        serviceName: service.name,
        providerReference: providerResponse.providerReference,
        phone: data.phone,
        network: data.network,
        serviceCode: service.code,
        logo: service.logo || "",
      };

      if (status === "pending" && providerResponse.providerReference) {
        recordTransactionSuccess(data.userId, TRANSACTION_TYPES.AIRTIME);
        this.transactionProcessor
          .initializeTransactionHandling(
            transaction.id,
            providerResponse.providerReference,
            data.provider.code || providerResponse.providerCode!,
            status,
            data.userId,
          )
          .catch((err) => logger.error("Polling init failed", err));
      }

      if (status === "success") {
        this.transactionProcessor.handleSuccess(context);
        recordTransactionSuccess(data.userId, TRANSACTION_TYPES.AIRTIME);

        this.bonusProcessor
          .processTradeAndBonus(data.userId, {
            transactionId: transaction.id.toString(),
            amount: data.amount,
            serviceType: TRANSACTION_TYPES.AIRTIME,
          })
          .catch((err) =>
            logger.error(
              `Trade bonus processing failed: ${TRANSACTION_TYPES.AIRTIME}`,
              err,
            ),
          );
      }

      if (status === "failed") {
        await this.transactionProcessor.handleFailure(context);
      }

      return {
        result: TransactionMapper.toDTO(updatedTransaction),
        providerStatus: providerResponse.status,
        pending: status === "pending",
        chargeInfo: {
          baseAmount: roundAmount(data.amount),
          discountedAmount,
          amountSaved,
          serviceCharge: chargeCalculation.chargeAmount,
          totalAmount: chargeCalculation.totalAmount,
        },
      };
    } catch (error) {
      await this.transactionProcessor.handleError({
        userId: data.userId,
        walletId: wallet.id,
        transactionId: transaction.id,
        reference,
        amount: data.amount,
        totalAmount: chargeCalculation.totalAmount,
        chargeInfo: chargeCalculation,
        transactionType: TRANSACTION_TYPES.AIRTIME,
        serviceName: service.name,
        phone: data.phone,
        network: data.network,
        serviceCode: service.code,
        logo: service.logo || "",
      });
      recordTransactionFailure(data.userId, TRANSACTION_TYPES.AIRTIME);

      throw error;
    }
```

With this:

```ts
    const transaction = debitResult.transaction;
    const providerCode = data.provider.code;

    // IMMEDIATE providers ΓÇö stay synchronous (fast response, no polling needed)
    if (isImmediateResponseProvider(providerCode)) {
      try {
        const providerResponse = await this.providerService.purchaseAirtime({
          phone: data.phone,
          amount: data.amount,
          network: data.network,
          reference,
          provider: data.provider,
          serviceCode: service.code,
        });

        const { status, transaction: updatedTransaction } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResponse,
          );

        const context = {
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: data.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.AIRTIME,
          serviceName: service.name,
          providerReference: providerResponse.providerReference,
          phone: data.phone,
          network: data.network,
          serviceCode: service.code,
          logo: service.logo || "",
        };

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.AIRTIME);
          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: data.amount,
              serviceType: TRANSACTION_TYPES.AIRTIME,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.AIRTIME}`, err),
            );
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }

        return {
          result: TransactionMapper.toDTO(updatedTransaction),
          providerStatus: providerResponse.status,
          pending: false,
          chargeInfo: {
            baseAmount: roundAmount(data.amount),
            discountedAmount,
            amountSaved,
            serviceCharge: chargeCalculation.chargeAmount,
            totalAmount: chargeCalculation.totalAmount,
          },
        };
      } catch (error) {
        await this.transactionProcessor.handleError({
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: data.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.AIRTIME,
          serviceName: service.name,
          phone: data.phone,
          network: data.network,
          serviceCode: service.code,
          logo: service.logo || "",
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.AIRTIME);
        throw error;
      }
    }

    // ASYNC path ΓÇö VTPass (WEBHOOK), ClubKonnect (POLLING), VTU.ng (POLLING), MySimHosting (WEBHOOK)
    // Stamp polling bootstrap now so the cron can rescue if the process dies mid-flight
    await this.transactionRepository.update(transaction.id, {
      "polling.nextPollAt": new Date(Date.now() + 30000),
      "polling.pollCount": 0,
      "polling.pollingProvider": providerCode,
      "polling.startedAt": new Date(),
    });

    this.providerService
      .purchaseAirtime({
        phone: data.phone,
        amount: data.amount,
        network: data.network,
        reference,
        provider: data.provider,
        serviceCode: service.code,
      })
      .then(async (providerResponse) => {
        const { status } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResponse,
          );

        const context = {
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: data.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.AIRTIME,
          serviceName: service.name,
          providerReference: providerResponse.providerReference,
          phone: data.phone,
          network: data.network,
          serviceCode: service.code,
          logo: service.logo || "",
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.AIRTIME);
          this.transactionProcessor
            .initializeTransactionHandling(
              transaction.id,
              providerResponse.providerReference,
              providerCode || providerResponse.providerCode!,
              status,
              data.userId,
            )
            .catch((err) => logger.error("Polling init failed", err));
          return;
        }

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.AIRTIME);
          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: data.amount,
              serviceType: TRANSACTION_TYPES.AIRTIME,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.AIRTIME}`, err),
            );
          return;
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }
      })
      .catch(async (error) => {
        logger.error(`Airtime provider call failed async [${reference}]:`, error);
        await this.transactionProcessor.handleError({
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: data.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.AIRTIME,
          serviceName: service.name,
          phone: data.phone,
          network: data.network,
          serviceCode: service.code,
          logo: service.logo || "",
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.AIRTIME);
      });

    return {
      result: TransactionMapper.toDTO(transaction),
      providerStatus: "pending",
      pending: true,
      chargeInfo: {
        baseAmount: roundAmount(data.amount),
        discountedAmount,
        amountSaved,
        serviceCharge: chargeCalculation.chargeAmount,
        totalAmount: chargeCalculation.totalAmount,
      },
    };
```

---

## File 2: `src/services/client/billPayment/DataService.ts`

### Change 2a ΓÇö add import at top of file

Add this line with the other imports:

```ts
import { isImmediateResponseProvider } from "@/config/providers";
```

### Change 2b ΓÇö replace the entire block starting at `const transaction = debitResult.transaction;` through the closing `}` of the `purchase` method (just before `async getProviders`)

Replace this entire block:

```ts
    const transaction = debitResult.transaction;

    try {
      const providerResponse = await this.providerService.purchaseData({
```

...all the way through to:

```ts
      recordTransactionFailure(data.userId, TRANSACTION_TYPES.DATA);
      throw error;
    }
  }
```

With this:

```ts
    const transaction = debitResult.transaction;
    const providerCode = provider.code;

    if (isImmediateResponseProvider(providerCode)) {
      try {
        const providerResponse = await this.providerService.purchaseData({
          phone: data.phone,
          amount: product.amount,
          plan: product.name,
          serviceCode: service.code,
          productCode: product.code,
          reference,
          provider,
        });

        const { status, transaction: updatedTransaction } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResponse,
          );

        const context = {
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.DATA,
          serviceName: service.name,
          serviceCode: service.code,
          phone: data.phone,
          logo: service.logo || "",
          providerReference: providerResponse.providerReference,
          productName: product.name,
          meta: { productName: product.name },
        };

        if (status === "success") {
          setImmediate(() => {
            this.transactionProcessor.handleSuccess(context);
            recordTransactionSuccess(data.userId, TRANSACTION_TYPES.DATA);
            this.bonusProcessor
              .processTradeAndBonus(data.userId, {
                transactionId: transaction.id.toString(),
                amount: product.amount,
                serviceType: TRANSACTION_TYPES.DATA,
              })
              .catch((err) =>
                logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.DATA}`, err),
              );
          });
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }

        return {
          result: TransactionMapper.toDTO(updatedTransaction),
          providerStatus: providerResponse.status,
          pending: false,
          chargeInfo: {
            baseAmount: roundAmount(product.amount),
            discountedAmount,
            amountSaved,
            serviceCharge: chargeCalculation.chargeAmount,
            totalAmount: chargeCalculation.totalAmount,
          },
        };
      } catch (error) {
        await this.transactionProcessor.handleError({
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.DATA,
          serviceName: service.name,
          serviceCode: service.code,
          phone: data.phone,
          logo: service.logo || "",
          meta: { productName: product.name },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.DATA);
        throw error;
      }
    }

    // ASYNC path
    await this.transactionRepository.update(transaction.id, {
      "polling.nextPollAt": new Date(Date.now() + 30000),
      "polling.pollCount": 0,
      "polling.pollingProvider": providerCode,
      "polling.startedAt": new Date(),
    });

    this.providerService
      .purchaseData({
        phone: data.phone,
        amount: product.amount,
        plan: product.name,
        serviceCode: service.code,
        productCode: product.code,
        reference,
        provider,
      })
      .then(async (providerResponse) => {
        const { status } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResponse,
          );

        const context = {
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.DATA,
          serviceName: service.name,
          serviceCode: service.code,
          phone: data.phone,
          logo: service.logo || "",
          providerReference: providerResponse.providerReference,
          productName: product.name,
          meta: { productName: product.name },
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.DATA);
          setImmediate(() => {
            this.transactionProcessor
              .initializeTransactionHandling(
                transaction.id,
                providerResponse.providerReference!,
                providerCode,
                status,
                data.userId,
              )
              .catch((err) => logger.error("Transaction handling init failed", err));
          });
          return;
        }

        if (status === "success") {
          setImmediate(() => {
            this.transactionProcessor.handleSuccess(context);
            recordTransactionSuccess(data.userId, TRANSACTION_TYPES.DATA);
            this.bonusProcessor
              .processTradeAndBonus(data.userId, {
                transactionId: transaction.id.toString(),
                amount: product.amount,
                serviceType: TRANSACTION_TYPES.DATA,
              })
              .catch((err) =>
                logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.DATA}`, err),
              );
          });
          return;
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }
      })
      .catch(async (error) => {
        logger.error(`Data provider call failed async [${reference}]:`, error);
        await this.transactionProcessor.handleError({
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.DATA,
          serviceName: service.name,
          serviceCode: service.code,
          phone: data.phone,
          logo: service.logo || "",
          meta: { productName: product.name },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.DATA);
      });

    return {
      result: TransactionMapper.toDTO(transaction),
      providerStatus: "pending",
      pending: true,
      chargeInfo: {
        baseAmount: roundAmount(product.amount),
        discountedAmount,
        amountSaved,
        serviceCharge: chargeCalculation.chargeAmount,
        totalAmount: chargeCalculation.totalAmount,
      },
    };
  }
```

---

## File 3: `src/services/client/billPayment/CableTvService.ts`

### Change 3a ΓÇö add import at top of file

```ts
import { isImmediateResponseProvider } from "@/config/providers";
```

Also remove this unused import if present:
```ts
import { stat } from "fs";
```

### Change 3b ΓÇö replace the entire block from `const transaction = debitResult.transaction;` through the closing `}` of the `purchase` method (just before `async verifySmartCard`)

Replace this entire block:

```ts
    const transaction = debitResult.transaction;

    try {
      const providerResponse = await this.providerService.purchaseCableTv({
```

...through to:

```ts
      recordTransactionFailure(data.userId, TRANSACTION_TYPES.CABLE);

      throw error;
    }
  }
```

With this:

```ts
    const transaction = debitResult.transaction;
    const providerCode = data.serviceProvider.code;

    if (isImmediateResponseProvider(providerCode)) {
      try {
        const providerResponse = await this.providerService.purchaseCableTv({
          reference,
          provider: data.provider || service.code,
          smartCardNumber: data.smartCardNumber,
          amount: product.amount,
          phone: data.user.phone || "",
          package: product.code,
          subscriptionType: data.type,
          serviceProvider: data.serviceProvider,
          serviceCode: service.code,
        });

        const { status, transaction: updatedTransaction } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResponse,
          );

        const context = {
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.CABLE,
          serviceName: service.name,
          meta: {
            smartCardNumber: data.smartCardNumber,
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            subscriptionType: data.type,
          },
          providerReference: providerResponse.providerReference,
        };

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.CABLE);
          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: product.amount,
              serviceType: TRANSACTION_TYPES.CABLE,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.CABLE}`, err),
            );
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }

        return {
          result: TransactionMapper.toDTO(updatedTransaction),
          providerStatus: providerResponse.status,
          status,
          pending: false,
          chargeInfo: {
            baseAmount: roundAmount(product.amount),
            discountedAmount,
            amountSaved,
            serviceCharge: chargeCalculation.chargeAmount,
            totalAmount: chargeCalculation.totalAmount,
          },
        };
      } catch (error) {
        await this.transactionProcessor.handleError({
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.CABLE,
          serviceName: service.name,
          meta: {
            smartCardNumber: data.smartCardNumber,
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            subscriptionType: data.type,
          },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.CABLE);
        throw error;
      }
    }

    // ASYNC path
    await this.transactionRepository.update(transaction.id, {
      "polling.nextPollAt": new Date(Date.now() + 30000),
      "polling.pollCount": 0,
      "polling.pollingProvider": providerCode,
      "polling.startedAt": new Date(),
    });

    this.providerService
      .purchaseCableTv({
        reference,
        provider: data.provider || service.code,
        smartCardNumber: data.smartCardNumber,
        amount: product.amount,
        phone: data.user.phone || "",
        package: product.code,
        subscriptionType: data.type,
        serviceProvider: data.serviceProvider,
        serviceCode: service.code,
      })
      .then(async (providerResponse) => {
        const { status } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResponse,
          );

        const context = {
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.CABLE,
          serviceName: service.name,
          meta: {
            smartCardNumber: data.smartCardNumber,
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            subscriptionType: data.type,
          },
          providerReference: providerResponse.providerReference,
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.CABLE);
          this.transactionProcessor
            .initializeTransactionHandling(
              transaction.id,
              providerResponse.providerReference,
              providerCode || providerResponse.providerCode!,
              status,
              data.userId,
            )
            .catch((err) => logger.error("Transaction handling init failed", err));
          return;
        }

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.CABLE);
          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: product.amount,
              serviceType: TRANSACTION_TYPES.CABLE,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.CABLE}`, err),
            );
          return;
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }
      })
      .catch(async (error) => {
        logger.error(`CableTV provider call failed async [${reference}]:`, error);
        await this.transactionProcessor.handleError({
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.CABLE,
          serviceName: service.name,
          meta: {
            smartCardNumber: data.smartCardNumber,
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            subscriptionType: data.type,
          },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.CABLE);
      });

    return {
      result: TransactionMapper.toDTO(transaction),
      providerStatus: "pending",
      status: "pending",
      pending: true,
      chargeInfo: {
        baseAmount: roundAmount(product.amount),
        discountedAmount,
        amountSaved,
        serviceCharge: chargeCalculation.chargeAmount,
        totalAmount: chargeCalculation.totalAmount,
      },
    };
  }
```

---

## File 4: `src/services/client/billPayment/BettingService.ts`

### Change 4a ΓÇö add import at top of file

```ts
import { isImmediateResponseProvider } from "@/config/providers";
```

### Change 4b ΓÇö replace the entire block from `const transaction = debitResult.transaction;` through the closing `}` of the `fundAccount` method (just before `async verifyAccount`)

Replace this entire block:

```ts
    const transaction = debitResult.transaction;

    try {
      const providerResult = await this.providerService.fundBetting({
```

...through to:

```ts
      recordTransactionFailure(data.userId, TRANSACTION_TYPES.BETTING);

      throw error;
    }
  }
```

With this:

```ts
    const transaction = debitResult.transaction;
    const providerCode = data.serviceProvider.code;

    if (isImmediateResponseProvider(providerCode)) {
      try {
        const providerResult = await this.providerService.fundBetting({
          customerId: customerId!,
          amount,
          provider: serviceCode,
          reference,
          serviceProvider: data.serviceProvider,
        });

        const { status, transaction: updatedTransaction } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResult,
          );

        const context = {
          userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.BETTING,
          serviceName: serviceCode,
          meta: { customerId },
          providerReference: providerResult.providerReference,
        };

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.BETTING);
          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: data.amount,
              serviceType: TRANSACTION_TYPES.BETTING,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.BETTING}`, err),
            );
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }

        return {
          result: TransactionMapper.toDTO(updatedTransaction),
          providerStatus: providerResult.status,
          pending: false,
          chargeInfo: {
            baseAmount: roundAmount(amount),
            discountedAmount,
            amountSaved,
            serviceCharge: chargeCalculation.chargeAmount,
            totalAmount: chargeCalculation.totalAmount,
          },
        };
      } catch (error: any) {
        await this.transactionProcessor.handleError({
          userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.BETTING,
          serviceName: serviceCode,
          meta: { customerId },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.BETTING);
        throw error;
      }
    }

    // ASYNC path
    await this.transactionRepository.update(transaction.id, {
      "polling.nextPollAt": new Date(Date.now() + 30000),
      "polling.pollCount": 0,
      "polling.pollingProvider": providerCode,
      "polling.startedAt": new Date(),
    });

    this.providerService
      .fundBetting({
        customerId: customerId!,
        amount,
        provider: serviceCode,
        reference,
        serviceProvider: data.serviceProvider,
      })
      .then(async (providerResult) => {
        const { status } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResult,
          );

        const context = {
          userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.BETTING,
          serviceName: serviceCode,
          meta: { customerId },
          providerReference: providerResult.providerReference,
        };

        if (status === "pending" && providerResult.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.BETTING);
          this.transactionProcessor
            .initializeTransactionHandling(
              transaction.id,
              providerResult.providerReference,
              providerCode || providerResult.providerCode!,
              status,
              data.userId,
            )
            .catch((err) => logger.error("Polling init failed", err));
          return;
        }

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.BETTING);
          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: data.amount,
              serviceType: TRANSACTION_TYPES.BETTING,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.BETTING}`, err),
            );
          return;
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }
      })
      .catch(async (error) => {
        logger.error(`Betting provider call failed async [${reference}]:`, error);
        await this.transactionProcessor.handleError({
          userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.BETTING,
          serviceName: serviceCode,
          meta: { customerId },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.BETTING);
      });

    return {
      result: TransactionMapper.toDTO(transaction),
      providerStatus: "pending",
      pending: true,
      chargeInfo: {
        baseAmount: roundAmount(amount),
        discountedAmount,
        amountSaved,
        serviceCharge: chargeCalculation.chargeAmount,
        totalAmount: chargeCalculation.totalAmount,
      },
    };
  }
```

---

## File 5: `src/services/client/billPayment/EducationService.ts`

### Change 5a ΓÇö add import at top of file

```ts
import { isImmediateResponseProvider } from "@/config/providers";
```

### Change 5b ΓÇö replace the entire block from `const transaction = debitResult.transaction;` through the closing `}` of the `purchase` method (just before `async verifyProfile`)

Replace this entire block:

```ts
    const transaction = debitResult.transaction;

    try {
      const providerResponse = await this.providerService.purchaseEducation({
```

...through to:

```ts
      recordTransactionFailure(data.userId, TRANSACTION_TYPES.EDUCATION);

      throw error;
    }
  }
```

With this:

```ts
    const transaction = debitResult.transaction;
    const providerCode = data.provider.code;

    if (isImmediateResponseProvider(providerCode)) {
      try {
        const providerResponse = await this.providerService.purchaseEducation({
          profileId: data.profileId,
          variationCode: product.code,
          phone: data.user.phone!,
          amount: product.amount,
          reference,
          serviceCode: service.code,
          provider: data.provider,
        });

        const { status, transaction: updatedTransaction } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResponse,
          );

        const context = {
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.EDUCATION,
          serviceName: service.name,
          meta: {
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            profileId: data.profileId,
            phone: data.user.phone,
          },
          providerReference: providerResponse.providerReference,
        };

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.EDUCATION);
          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: product.amount,
              serviceType: TRANSACTION_TYPES.EDUCATION,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.EDUCATION}`, err),
            );
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }

        return {
          result: TransactionMapper.toDTO(updatedTransaction),
          status,
          providerStatus: providerResponse.status,
          pin: providerResponse.token,
          pending: false,
          chargeInfo: {
            baseAmount: roundAmount(product.amount),
            discountedAmount,
            amountSaved,
            serviceCharge: chargeCalculation.chargeAmount,
            totalAmount: chargeCalculation.totalAmount,
          },
        };
      } catch (error) {
        await this.transactionProcessor.handleError({
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.EDUCATION,
          serviceName: service.name,
          meta: {
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            profileId: data.profileId,
            phone: data.user.phone,
          },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.EDUCATION);
        throw error;
      }
    }

    // ASYNC path
    await this.transactionRepository.update(transaction.id, {
      "polling.nextPollAt": new Date(Date.now() + 30000),
      "polling.pollCount": 0,
      "polling.pollingProvider": providerCode,
      "polling.startedAt": new Date(),
    });

    this.providerService
      .purchaseEducation({
        profileId: data.profileId,
        variationCode: product.code,
        phone: data.user.phone!,
        amount: product.amount,
        reference,
        serviceCode: service.code,
        provider: data.provider,
      })
      .then(async (providerResponse) => {
        const { status } =
          await this.transactionProcessor.updateTransactionStatus(
            transaction.id,
            providerResponse,
          );

        const context = {
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.EDUCATION,
          serviceName: service.name,
          meta: {
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            profileId: data.profileId,
            phone: data.user.phone,
          },
          providerReference: providerResponse.providerReference,
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.EDUCATION);
          this.transactionProcessor
            .initializeTransactionHandling(
              transaction.id,
              providerResponse.providerReference,
              providerCode || providerResponse.providerCode!,
              status,
              data.userId,
            )
            .catch((err) => logger.error("Transaction handling init failed", err));
          return;
        }

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.EDUCATION);
          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: product.amount,
              serviceType: TRANSACTION_TYPES.EDUCATION,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.EDUCATION}`, err),
            );
          return;
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }
      })
      .catch(async (error) => {
        logger.error(`Education provider call failed async [${reference}]:`, error);
        await this.transactionProcessor.handleError({
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: product.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.EDUCATION,
          serviceName: service.name,
          meta: {
            productName: product.name,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
            profileId: data.profileId,
            phone: data.user.phone,
          },
        });
        recordTransactionFailure(data.userId, TRANSACTION_TYPES.EDUCATION);
      });

    return {
      result: TransactionMapper.toDTO(transaction),
      status: "pending",
      providerStatus: "pending",
      pin: undefined,
      pending: true,
      chargeInfo: {
        baseAmount: roundAmount(product.amount),
        discountedAmount,
        amountSaved,
        serviceCharge: chargeCalculation.chargeAmount,
        totalAmount: chargeCalculation.totalAmount,
      },
    };
  }
```

---

## File 6: `src/services/client/billPayment/ElectricityService.ts`

**Note:** ElectricityService is different from the others. The provider response contains token/meter data that must be saved before returning. For the async path, we write those fields in the `.then()` handler. For the sync path (IMMEDIATE providers) the existing logic is kept as-is.

### Change 6a ΓÇö add import at top of file

```ts
import { isImmediateResponseProvider } from "@/config/providers";
```

### Change 6b ΓÇö replace the entire block from `const transaction = debitResult.transaction;` through the closing `}` of the `purchase` method (just before `async verifyMeterNumber`)

Replace this entire block (from `const transaction = debitResult.transaction;` through the last `throw error;\n    }\n  }\n`):

With this:

```ts
    const transaction = debitResult.transaction;
    const providerCode = data.serviceProvider.code;

    if (isImmediateResponseProvider(providerCode)) {
      try {
        const providerResponse = await this.providerService.purchaseElectricity({
          reference,
          meterNumber: data.meterNumber,
          amount: data.amount,
          provider: service.code,
          meterType: data.meterType,
          productCode: service.code,
          phone: data.phone,
          serviceProvider: data.serviceProvider,
          serviceCode: service.code,
        });

        let finalTransaction = transaction;

        const { status, transaction: updatedTransaction } =
          await this.transactionProcessor.updateTransactionStatus(
            finalTransaction.id,
            providerResponse,
          );

        finalTransaction = updatedTransaction;

        const updated = await this.transactionRepository.update(finalTransaction.id, {
          meta: {
            ...finalTransaction.meta,
            token: providerResponse.token || "",
            customerName: providerResponse.meta?.customerName || "",
            customerAddress: providerResponse.meta?.customerAddress || "",
            meterNumber: providerResponse.meta?.meterNumber || "",
            ...(providerResponse.meta?.units && { units: providerResponse.meta.units }),
            ...(providerResponse.meta?.tokenAmount && { tokenAmount: providerResponse.meta.tokenAmount }),
            ...(providerResponse.meta?.exchangeReference && { exchangeReference: providerResponse.meta.exchangeReference }),
          },
        });
        if (updated) finalTransaction = updated;

        const context = {
          userId: data.userId,
          walletId: wallet.id,
          transactionId: transaction.id,
          reference,
          amount: data.amount,
          totalAmount: chargeCalculation.totalAmount,
          chargeInfo: chargeCalculation,
          transactionType: TRANSACTION_TYPES.ELECTRICITY,
          serviceName: service.code,
          meta: {
            meterNumber: data.meterNumber,
            meterType: data.meterType,
            serviceCode: service.code,
            serviceName: service.name,
            logo: service.logo || "",
          },
          providerReference: providerResponse.providerReference,
          providerResponse,
        };

        if (status === "pending" && providerResponse.providerReference) {
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.ELECTRICITY);
          this.transactionProcessor
            .initializeTransactionHandling(
              transaction.id,
              providerResponse.providerReference,
              data.serviceProvider.code,
              status,
              data.userId,
            )
            .catch((err) => logger.error("Transaction handling init failed", err));
        }

        if (status === "success") {
          this.transactionProcessor.handleSuccess(context);
          recordTransactionSuccess(data.userId, TRANSACTION_TYPES.ELECTRICITY);
          this.bonusProcessor
            .processTradeAndBonus(data.userId, {
              transactionId: transaction.id.toString(),
              amount: data.amount,
              serviceType: TRANSACTION_TYPES.ELECTRICITY,
            })
            .catch((err) =>
              logger.error(`Trade bonus processing failed: ${TRANSACTION_TYPES.ELECTRICITY}`, err),
            );
        }

        if (status === "failed") {
          await this.transactionProcessor.handleFailure(context);
        }

        return {
          result: TransactionMapper.toDTO(finalTransaction),
          status,
          providerStatus: providerResponse.status,
          token: providerResponse.token,
          pending: status === "pending",
          chargeInfo: {
            baseAmount: roundAmount(data.amount),
            discountedAmount,
            amountSaved,
            serviceCharge: chargeCalculation.chargeAmount,
            totalAmount: chargeCalculation.totalAmount,
          },
        };
      } catch (error) {
        let verifiedCustomerName = "";
        let verifiedCustomerAddress = "";
        try {
          const verification = await this.providerService.verifyMeterNumber(
            data.meterNumber,
            service.code,
            data.meterType,
            data.serviceProvider,
     
<truncated 6951 bytes>

NOTE: The output was truncated because it was too long. Use a more targeted query or a smaller range to get the information you need.
