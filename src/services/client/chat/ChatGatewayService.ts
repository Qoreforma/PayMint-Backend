import { ChatSessionService } from './ChatSessionService';
import { ChannelLinkService } from './ChannelLinkService';
import { AirtimeService } from '@/services/client/billPayment/AirtimeService';
import { DataService } from '@/services/client/billPayment/DataService';
import { ElectricityService } from '@/services/client/billPayment/ElectricityService';
import { CableTvService } from '@/services/client/billPayment/CableTvService';
import { BettingService } from '@/services/client/billPayment/BettingService';
import { EducationService } from '@/services/client/billPayment/EducationService';
import { ProviderService } from '@/services/client/ProviderService';
import { ReferenceDataService } from '@/services/client/ReferenceDataService';
import { CacheManager } from '@/services/client/billPayment/shared/CacheManager';
import { WalletService } from '@/services/client/wallet/WalletService';
import { AuthService } from '@/services/client/core/AuthService';
import { IncomingChatMessage, ChatChannel, ChatSessionState } from '@/types/chat';
import logger from '@/logger';

const NETWORKS = ['mtn', 'airtel', 'glo', '9mobile'];

export class ChatGatewayService {
  constructor(
    private sessionService: ChatSessionService,
    private linkService: ChannelLinkService,
    private airtimeService: AirtimeService,
    private dataService: DataService,
    private electricityService: ElectricityService,
    private cableTvService: CableTvService,
    private bettingService: BettingService,
    private educationService: EducationService,
    private providerService: ProviderService,
    private referenceDataService: ReferenceDataService,
    private cacheManager: CacheManager,
    private walletService: WalletService,
    private authService: AuthService,
  ) {}

  async handleMessage(message: IncomingChatMessage): Promise<string> {
    const { channel, externalId } = message;
    const text = (message.text || '').trim();

    const userId = await this.linkService.findLinkedUserId(channel, externalId);
    if (!userId) {
      return this.handleLinking(message);
    }

    const session = await this.sessionService.get(channel, externalId);

    if (session.step === 'idle') {
      if (/^(buy airtime|\/buy_airtime|airtime)/i.test(text)) {
        await this.sessionService.set(channel, externalId, { step: 'airtime:network', flow: 'airtime', data: {} });
        return 'Which network? (' + NETWORKS.join(', ') + ')';
      }
      if (/^(buy data|\/buy_data|data)/i.test(text)) {
        await this.sessionService.set(channel, externalId, { step: 'data:network', flow: 'data', data: {} });
        return 'Which network? (' + NETWORKS.join(', ') + ')';
      }
      if (/^(buy electricity|\/buy_electricity|electricity)/i.test(text)) {
        try {
           const provider = await this.providerService.getActiveApiProvider('electricity');
           const providers = await this.electricityService.getProviders(provider as any);
           if (!providers?.length) return 'No electricity providers available right now.';
           const list = providers.slice(0, 10).map((p: any, i: number) => `${i + 1}. ${p.name}`).join('\n');
           await this.sessionService.set(channel, externalId, { step: 'electricity:provider', flow: 'electricity', data: { providers: providers.slice(0,10) } });
           return 'Pick a provider:\n' + list;
        } catch (e) {
           return 'Electricity service is currently unavailable.';
        }
      }
      if (/^(buy cabletv|\/buy_cabletv|cabletv)/i.test(text)) {
        try {
           const provider = await this.providerService.getActiveApiProvider('cabletv');
           const providers = await this.cableTvService.getProviders();
           if (!providers?.length) return 'No cable providers available right now.';
           const list = providers.slice(0, 10).map((p: any, i: number) => `${i + 1}. ${p.name}`).join('\n');
           await this.sessionService.set(channel, externalId, { step: 'cabletv:provider', flow: 'cabletv', data: { providers: providers.slice(0,10) } });
           return 'Pick a provider:\n' + list;
        } catch(e) {
           return 'CableTV service is currently unavailable.';
        }
      }
      if (/^(buy betting|\/buy_betting|betting)/i.test(text)) {
        try {
           const provider = await this.providerService.getActiveApiProvider('betting');
           const providers = await this.bettingService.getProviders(provider as any);
           if (!providers?.length) return 'No betting providers available right now.';
           const list = providers.slice(0, 10).map((p: any, i: number) => `${i + 1}. ${p.name}`).join('\n');
           await this.sessionService.set(channel, externalId, { step: 'betting:provider', flow: 'betting', data: { providers: providers.slice(0,10) } });
           return 'Pick a provider:\n' + list;
        } catch(e) {
           return 'Betting service is currently unavailable.';
        }
      }
      if (/^(buy education|\/buy_education|education)/i.test(text)) {
        try {
           const provider = await this.providerService.getActiveApiProvider('education');
           const { products } = await this.referenceDataService.getProducts({ serviceId: provider.id.toString() });
           if (!products?.length) return 'No education products available right now.';
           const list = products.slice(0, 10).map((p: any, i: number) => `${i + 1}. ${p.name} — ₦${p.amount}`).join('\n');
           await this.sessionService.set(channel, externalId, { step: 'education:product', flow: 'education', data: { products: products.slice(0,10).map((p:any) => ({id: p._id.toString(), name: p.name, amount: p.amount})) } });
           return 'Pick a product:\n' + list;
        } catch(e) {
           return 'Education service is currently unavailable.';
        }
      }
      return "Send 'buy airtime', 'buy data', 'buy electricity', 'buy cabletv', 'buy betting', or 'buy education' to get started.";
    }

    if (session.flow === 'airtime') return this.handleAirtimeStep(userId, channel, externalId, text, session);
    if (session.flow === 'data') return this.handleDataStep(userId, channel, externalId, text, session);
    if (session.flow === 'electricity') return this.handleElectricityStep(userId, channel, externalId, text, session);
    if (session.flow === 'cabletv') return this.handleCableTvStep(userId, channel, externalId, text, session);
    if (session.flow === 'betting') return this.handleBettingStep(userId, channel, externalId, text, session);
    if (session.flow === 'education') return this.handleEducationStep(userId, channel, externalId, text, session);

    return "Something went wrong with your session. Send 'buy airtime' to restart.";
  }

  private async handleAirtimeStep(userId: string, channel: ChatChannel, externalId: string, text: string, session: ChatSessionState): Promise<string> {
    switch (session.step) {
      case 'airtime:network': {
        const network = text.toLowerCase();
        if (!NETWORKS.includes(network)) return 'Please choose one of: ' + NETWORKS.join(', ');
        await this.sessionService.set(channel, externalId, { step: 'airtime:phone', flow: 'airtime', data: { network } });
        return 'What phone number should this airtime go to?';
      }
      case 'airtime:phone': {
        if (!/^0\d{10}$/.test(text)) return "That doesn't look like a valid phone number. Try again (e.g. 08012345678).";
        await this.sessionService.set(channel, externalId, { step: 'airtime:amount', flow: 'airtime', data: { ...session.data, phone: text } });
        return 'How much airtime? (enter an amount, e.g. 500)';
      }
      case 'airtime:amount': {
        const amount = Number(text);
        if (!amount || amount < 50) return 'Enter a valid amount (minimum ₦50).';
        await this.sessionService.set(channel, externalId, { step: 'airtime:confirm', flow: 'airtime', data: { ...session.data, amount } });
        return `Confirm: ₦${amount} airtime to ${session.data?.phone} on ${session.data?.network}. Reply YES to confirm or NO to cancel.`;
      }
      case 'airtime:confirm': {
        if (/^no$/i.test(text)) {
          await this.sessionService.clear(channel, externalId);
          return 'Cancelled.';
        }
        if (!/^yes$/i.test(text)) return 'Reply YES to confirm or NO to cancel.';
        await this.sessionService.set(channel, externalId, { step: 'airtime:pin', flow: 'airtime', data: session.data });
        return 'Please enter your transaction PIN to authorize this payment.';
      }
      case 'airtime:pin': {
        const isValid = await this.authService.verifyPin({ pin: text, userId }).catch(() => false);
        if (!isValid) return 'Incorrect PIN. Please try again.';
        await this.sessionService.clear(channel, externalId);
        try {
          const provider = await this.providerService.getActiveApiProvider('airtime');
          const purchase = await this.airtimeService.purchase({
            userId,
            phone: session.data!.phone,
            amount: session.data!.amount,
            network: session.data!.network,
            provider: provider as any,
          });
          return purchase.pending
            ? `Your ₦${session.data!.amount} airtime purchase is processing. We'll confirm shortly.`
            : `Done — ₦${session.data!.amount} airtime sent to ${session.data!.phone}.`;
        } catch (error: any) {
          logger.error('Chat airtime purchase failed', { userId, channel, error });
          return `Sorry, that didn't go through: ${error.message || 'please try again'}.`;
        }
      }
      default:
        return "Send 'buy airtime' to restart.";
    }
  }

  private async handleDataStep(userId: string, channel: ChatChannel, externalId: string, text: string, session: ChatSessionState): Promise<string> {
    switch (session.step) {
      case 'data:network': {
        const network = text.toLowerCase();
        if (!NETWORKS.includes(network)) return 'Please choose one of: ' + NETWORKS.join(', ');
        const service = await this.cacheManager.getServiceByCodeCached(`${network}-data`);
        if (!service) return "That network's data plans aren't available right now.";
        const { products } = await this.referenceDataService.getProducts({ serviceId: service._id.toString() });
        if (!products?.length) return 'No data plans available for that network right now.';
        const list = products.slice(0, 10).map((p: any, i: number) => `${i + 1}. ${p.name} — ₦${p.amount}`).join('\n');
        await this.sessionService.set(channel, externalId, {
          step: 'data:product',
          flow: 'data',
          data: { network, products: products.slice(0, 10).map((p: any) => ({ id: p._id.toString(), name: p.name, amount: p.amount })) },
        });
        return 'Pick a plan:\n' + list;
      }
      case 'data:product': {
        const index = Number(text) - 1;
        const products = session.data?.products || [];
        if (!products[index]) return 'Please reply with a valid number from the list.';
        await this.sessionService.set(channel, externalId, {
          step: 'data:phone',
          flow: 'data',
          data: { ...session.data, selectedProduct: products[index] },
        });
        return 'What phone number should this data go to?';
      }
      case 'data:phone': {
        if (!/^0\d{10}$/.test(text)) return "That doesn't look like a valid phone number. Try again (e.g. 08012345678).";
        const product = session.data?.selectedProduct;
        await this.sessionService.set(channel, externalId, {
          step: 'data:confirm',
          flow: 'data',
          data: { ...session.data, phone: text },
        });
        return `Confirm: ${product?.name} (₦${product?.amount}) to ${text}. Reply YES to confirm or NO to cancel.`;
      }
      case 'data:confirm': {
        if (/^no$/i.test(text)) {
          await this.sessionService.clear(channel, externalId);
          return 'Cancelled.';
        }
        if (!/^yes$/i.test(text)) return 'Reply YES to confirm or NO to cancel.';
        await this.sessionService.set(channel, externalId, { step: 'data:pin', flow: 'data', data: session.data });
        return 'Please enter your transaction PIN to authorize this payment.';
      }
      case 'data:pin': {
        const isValid = await this.authService.verifyPin({ pin: text, userId }).catch(() => false);
        if (!isValid) return 'Incorrect PIN. Please try again.';
        await this.sessionService.clear(channel, externalId);
        try {
          const provider = await this.providerService.getActiveApiProvider('data');
          const purchase = await this.dataService.purchase({
            userId,
            phone: session.data!.phone,
            productId: session.data!.selectedProduct.id,
          });
          return purchase.pending
            ? "Your data purchase is processing. We'll confirm shortly."
            : `Done — ${session.data!.selectedProduct.name} sent to ${session.data!.phone}.`;
        } catch (error: any) {
          logger.error('Chat data purchase failed', { userId, channel, error });
          return `Sorry, that didn't go through: ${error.message || 'please try again'}.`;
        }
      }
      default:
        return "Send 'buy data' to restart.";
    }
  }

  private async handleElectricityStep(userId: string, channel: ChatChannel, externalId: string, text: string, session: ChatSessionState): Promise<string> {
    switch(session.step) {
      case 'electricity:provider': {
        const index = Number(text) - 1;
        const providers = session.data?.providers || [];
        if (!providers[index]) return 'Please reply with a valid number from the list.';
        await this.sessionService.set(channel, externalId, { step: 'electricity:metertype', flow: 'electricity', data: { ...session.data, selectedProvider: providers[index] } });
        return 'Meter Type? (1. Prepaid, 2. Postpaid)';
      }
      case 'electricity:metertype': {
        const typeStr = text.trim();
        const meterType = typeStr === '1' ? 'prepaid' : typeStr === '2' ? 'postpaid' : null;
        if (!meterType) return 'Reply 1 for Prepaid or 2 for Postpaid.';
        await this.sessionService.set(channel, externalId, { step: 'electricity:meter', flow: 'electricity', data: { ...session.data, meterType } });
        return 'What is the meter number?';
      }
      case 'electricity:meter': {
        const meterNumber = text.trim();
        await this.sessionService.set(channel, externalId, { step: 'electricity:amount', flow: 'electricity', data: { ...session.data, meterNumber } });
        return 'How much electricity? (e.g. 1000)';
      }
      case 'electricity:amount': {
        const amount = Number(text);
        if (!amount || amount < 100) return 'Enter a valid amount (minimum ₦100).';
        await this.sessionService.set(channel, externalId, { step: 'electricity:phone', flow: 'electricity', data: { ...session.data, amount } });
        return 'What is the customer phone number?';
      }
      case 'electricity:phone': {
        const phone = text.trim();
        if (!/^0\d{10}$/.test(phone)) return "Invalid phone number. Try again.";
        try {
           const serviceProvider = await this.providerService.getActiveApiProvider('electricity');
           const customerInfo = await this.electricityService.verifyMeterNumber({
               meterNumber: session.data!.meterNumber,
               serviceCode: session.data!.selectedProvider.id, // using provider ID
               meterType: session.data!.meterType,
               serviceProvider: serviceProvider as any,
           });
           await this.sessionService.set(channel, externalId, { step: 'electricity:confirm', flow: 'electricity', data: { ...session.data, phone, customerName: customerInfo.name } });
           return `Verify: ${customerInfo.name} (${session.data!.meterNumber}). Confirm ₦${session.data!.amount}? Reply YES or NO.`;
        } catch(e: any) {
           return `Verification failed: ${e.message || 'Check meter number.'} Send 'buy electricity' to restart.`;
        }
      }
      case 'electricity:confirm': {
        if (/^no$/i.test(text)) { await this.sessionService.clear(channel, externalId); return 'Cancelled.'; }
        if (!/^yes$/i.test(text)) return 'Reply YES to confirm or NO to cancel.';
        await this.sessionService.set(channel, externalId, { step: 'electricity:pin', flow: 'electricity', data: session.data });
        return 'Please enter your transaction PIN to authorize this payment.';
      }
      case 'electricity:pin': {
        const isValid = await this.authService.verifyPin({ pin: text, userId }).catch(() => false);
        if (!isValid) return 'Incorrect PIN. Please try again.';
        await this.sessionService.clear(channel, externalId);
        try {
          const serviceProvider = await this.providerService.getActiveApiProvider('electricity');
          const purchase = await this.electricityService.purchase({
            userId,
            meterNumber: session.data!.meterNumber,
            providerId: session.data!.selectedProvider.id,
            amount: session.data!.amount,
            meterType: session.data!.meterType,
            phone: session.data!.phone,
            serviceProvider: serviceProvider as any,
          });
          return purchase.pending ? 'Your electricity purchase is processing.' : `Done — ₦${session.data!.amount} electricity token purchased for ${session.data!.meterNumber}.`;
        } catch(e: any) {
          logger.error('Chat electricity purchase failed', { userId, channel, error: e });
          return `Sorry, that didn't go through: ${e.message || 'please try again'}.`;
        }
      }
      default: return "Send 'buy electricity' to restart.";
    }
  }

  private async handleCableTvStep(userId: string, channel: ChatChannel, externalId: string, text: string, session: ChatSessionState): Promise<string> {
    switch(session.step) {
      case 'cabletv:provider': {
        const index = Number(text) - 1;
        const providers = session.data?.providers || [];
        if (!providers[index]) return 'Please reply with a valid number from the list.';
        try {
            const { products } = await this.referenceDataService.getProducts({ serviceId: providers[index].id.toString() });
            if (!products?.length) return 'No packages available.';
            const list = products.slice(0, 10).map((p: any, i: number) => `${i + 1}. ${p.name} — ₦${p.amount}`).join('\n');
            await this.sessionService.set(channel, externalId, { step: 'cabletv:product', flow: 'cabletv', data: { ...session.data, selectedProvider: providers[index], products: products.slice(0,10).map((p:any) => ({ id: p._id.toString(), name: p.name, amount: p.amount })) } });
            return 'Pick a package:\n' + list;
        } catch(e) {
            return 'Failed to load packages. Send buy cabletv to restart.';
        }
      }
      case 'cabletv:product': {
        const index = Number(text) - 1;
        const products = session.data?.products || [];
        if (!products[index]) return 'Please reply with a valid number from the list.';
        await this.sessionService.set(channel, externalId, { step: 'cabletv:smartcard', flow: 'cabletv', data: { ...session.data, selectedProduct: products[index] } });
        return 'What is the SmartCard / IUC number?';
      }
      case 'cabletv:smartcard': {
        const smartCardNumber = text.trim();
        try {
           const serviceProvider = await this.providerService.getActiveApiProvider('cabletv');
           const customerInfo = await this.cableTvService.verifySmartCard(
               smartCardNumber,
               session.data!.selectedProvider.id,
               serviceProvider as any
           );
           await this.sessionService.set(channel, externalId, { step: 'cabletv:confirm', flow: 'cabletv', data: { ...session.data, smartCardNumber, customerName: customerInfo.name } });
           return `Verify: ${customerInfo.name} (${smartCardNumber}). Confirm ${session.data!.selectedProduct.name} (₦${session.data!.selectedProduct.amount})? Reply YES or NO.`;
        } catch(e: any) {
           return `Verification failed: ${e.message || 'Check smartcard number.'} Send 'buy cabletv' to restart.`;
        }
      }
      case 'cabletv:confirm': {
        if (/^no$/i.test(text)) { await this.sessionService.clear(channel, externalId); return 'Cancelled.'; }
        if (!/^yes$/i.test(text)) return 'Reply YES to confirm or NO to cancel.';
        await this.sessionService.set(channel, externalId, { step: 'cabletv:pin', flow: 'cabletv', data: session.data });
        return 'Please enter your transaction PIN to authorize this payment.';
      }
      case 'cabletv:pin': {
        const isValid = await this.authService.verifyPin({ pin: text, userId }).catch(() => false);
        if (!isValid) return 'Incorrect PIN. Please try again.';
        await this.sessionService.clear(channel, externalId);
        try {
          const serviceProvider = await this.providerService.getActiveApiProvider('cabletv');
          const purchase = await this.cableTvService.purchase({
            userId,
            user: { id: userId } as any,
            provider: session.data!.selectedProvider.id,
            smartCardNumber: session.data!.smartCardNumber,
            productId: session.data!.selectedProduct.id,
            type: "change",
            serviceProvider: serviceProvider as any,
          });
          return purchase.pending ? 'Your CableTV purchase is processing.' : `Done — ${session.data!.selectedProduct.name} activated for ${session.data!.smartCardNumber}.`;
        } catch(e: any) {
          logger.error('Chat cabletv purchase failed', { userId, channel, error: e });
          return `Sorry, that didn't go through: ${e.message || 'please try again'}.`;
        }
      }
      default: return "Send 'buy cabletv' to restart.";
    }
  }

  private async handleBettingStep(userId: string, channel: ChatChannel, externalId: string, text: string, session: ChatSessionState): Promise<string> {
    switch(session.step) {
      case 'betting:provider': {
        const index = Number(text) - 1;
        const providers = session.data?.providers || [];
        if (!providers[index]) return 'Please reply with a valid number from the list.';
        await this.sessionService.set(channel, externalId, { step: 'betting:customerId', flow: 'betting', data: { ...session.data, selectedProvider: providers[index] } });
        return 'What is the betting Customer ID?';
      }
      case 'betting:customerId': {
        const customerId = text.trim();
        await this.sessionService.set(channel, externalId, { step: 'betting:amount', flow: 'betting', data: { ...session.data, customerId } });
        return 'How much to fund? (e.g. 500)';
      }
      case 'betting:amount': {
        const amount = Number(text);
        if (!amount || amount < 100) return 'Enter a valid amount (minimum ₦100).';
        try {
           const serviceProvider = await this.providerService.getActiveApiProvider('betting');
           const customerInfo = await this.bettingService.verifyAccount({
               customerId: session.data!.customerId,
               providerId: session.data!.selectedProvider.id,
               serviceProvider: serviceProvider as any,
           });
           await this.sessionService.set(channel, externalId, { step: 'betting:confirm', flow: 'betting', data: { ...session.data, amount, customerName: (customerInfo as any).customerName || (customerInfo as any).name } });
           return `Verify: ${(customerInfo as any).customerName || (customerInfo as any).name} (${session.data!.customerId}). Confirm ₦${amount}? Reply YES or NO.`;
        } catch(e: any) {
           return `Verification failed: ${e.message || 'Check customer ID.'} Send 'buy betting' to restart.`;
        }
      }
      case 'betting:confirm': {
        if (/^no$/i.test(text)) { await this.sessionService.clear(channel, externalId); return 'Cancelled.'; }
        if (!/^yes$/i.test(text)) return 'Reply YES to confirm or NO to cancel.';
        await this.sessionService.set(channel, externalId, { step: 'betting:pin', flow: 'betting', data: session.data });
        return 'Please enter your transaction PIN to authorize this payment.';
      }
      case 'betting:pin': {
        const isValid = await this.authService.verifyPin({ pin: text, userId }).catch(() => false);
        if (!isValid) return 'Incorrect PIN. Please try again.';
        await this.sessionService.clear(channel, externalId);
        try {
          const serviceProvider = await this.providerService.getActiveApiProvider('betting');
          const purchase = await this.bettingService.fundAccount({
            userId,
            customerId: session.data!.customerId,
            amount: session.data!.amount,
            providerId: session.data!.selectedProvider.id,
            serviceProvider: serviceProvider as any,
          });
          return purchase.pending ? 'Your betting funding is processing.' : `Done — ₦${session.data!.amount} funded for ${session.data!.customerId}.`;
        } catch(e: any) {
          logger.error('Chat betting purchase failed', { userId, channel, error: e });
          return `Sorry, that didn't go through: ${e.message || 'please try again'}.`;
        }
      }
      default: return "Send 'buy betting' to restart.";
    }
  }

  private async handleEducationStep(userId: string, channel: ChatChannel, externalId: string, text: string, session: ChatSessionState): Promise<string> {
    switch(session.step) {
      case 'education:product': {
        const index = Number(text) - 1;
        const products = session.data?.products || [];
        if (!products[index]) return 'Please reply with a valid number from the list.';
        await this.sessionService.set(channel, externalId, { step: 'education:profileId', flow: 'education', data: { ...session.data, selectedProduct: products[index] } });
        return 'What is the phone number or profile ID to receive the PIN?';
      }
      case 'education:profileId': {
        const profileId = text.trim();
        await this.sessionService.set(channel, externalId, { step: 'education:confirm', flow: 'education', data: { ...session.data, profileId } });
        return `Confirm: ${session.data!.selectedProduct.name} (₦${session.data!.selectedProduct.amount}) for ${profileId}? Reply YES or NO.`;
      }
      case 'education:confirm': {
        if (/^no$/i.test(text)) { await this.sessionService.clear(channel, externalId); return 'Cancelled.'; }
        if (!/^yes$/i.test(text)) return 'Reply YES to confirm or NO to cancel.';
        await this.sessionService.set(channel, externalId, { step: 'education:pin', flow: 'education', data: session.data });
        return 'Please enter your transaction PIN to authorize this payment.';
      }
      case 'education:pin': {
        const isValid = await this.authService.verifyPin({ pin: text, userId }).catch(() => false);
        if (!isValid) return 'Incorrect PIN. Please try again.';
        await this.sessionService.clear(channel, externalId);
        try {
          const provider = await this.providerService.getActiveApiProvider('education');
          const purchase = await this.educationService.purchase({
            userId,
            user: { id: userId } as any,
            productId: session.data!.selectedProduct.id,
            profileId: session.data!.profileId,
            provider: provider as any,
          });
          return purchase.pending ? 'Your education PIN purchase is processing.' : `Done — ${session.data!.selectedProduct.name} purchased successfully.`;
        } catch(e: any) {
          logger.error('Chat education purchase failed', { userId, channel, error: e });
          return `Sorry, that didn't go through: ${e.message || 'please try again'}.`;
        }
      }
      default: return "Send 'buy education' to restart.";
    }
  }

  private async handleLinking(message: IncomingChatMessage): Promise<string> {
    const { channel, externalId, text } = message;
    const session = await this.sessionService.get(channel, externalId);

    if (session.step === 'awaiting_link_otp' && session.data?.pendingUserId) {
      const confirmed = await this.linkService.confirmLink(channel, externalId, session.data.pendingUserId, text.trim());
      if (confirmed) {
        await this.sessionService.clear(channel, externalId);
        return "Account linked! Send 'buy airtime' or 'buy data' to get started.";
      }
      return "That code didn't match. Try again, or send your phone number to restart.";
    }

    if (/^\d{10,15}$/.test(text.trim())) {
      try {
        const { userId } = await this.linkService.requestLink(text.trim(), channel, externalId);
        await this.sessionService.set(channel, externalId, { step: 'awaiting_link_otp', data: { pendingUserId: userId } });
        return "We've texted you a code. Reply with it here to link your account.";
      } catch (e: any) {
        if (e.statusCode === 429) {
           return e.message;
        }
        return "We couldn't find an account with that phone number.";
      }
    }

    return "To get started, send the phone number linked to your account.";
  }
}
