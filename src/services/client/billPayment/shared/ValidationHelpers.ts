import { AppError } from "@/middlewares/shared/errorHandler";
import { HTTP_STATUS, ERROR_CODES } from "@/utils/constants";
import { CacheService } from "@/services/core/CacheService";
import { PhonePrefixConfigRepository } from "@/repositories/admin/Phoneprefixconfigrepository";

const NETWORK_CODE_MAP: { [key: string]: string } = {
  "mtn-airtime": "mtn",
  "glo-airtime": "glo",
  "9mobile-airtime": "9mobile",
  "etisalat-airtime": "etisalat",
  "airtel-airtime": "airtel",

  "mtn-data": "mtn",
  "glo-data": "glo",
  "9mobile-data": "9mobile",
  "etisalat-data": "etisalat",
  "airtel-data": "airtel",
};

const PREFIX_MAP_CACHE_KEY = "phone_prefix_map";
const PREFIX_MAP_TTL_MS = 5 * 60 * 1000; // 60// 1000; // 5 minutes

let prefixMapCache: {
  map: Record<string, string>;
  fetchedAt: number;
} | null = null;

const phonePrefixRepo = new PhonePrefixConfigRepository();
const cacheService = new CacheService();

async function getPrefixMap(): Promise<Record<string, string>> {
  const now = Date.now();

  // In-process cache check (avoids Redis/Mongo round-trip on every call)
  if (prefixMapCache && now - prefixMapCache.fetchedAt < PREFIX_MAP_TTL_MS) {
    return prefixMapCache.map;
  }

  // Try Redis/external cache first
  const cached = await cacheService.get(PREFIX_MAP_CACHE_KEY);
  if (cached) {
    prefixMapCache = { map: cached as Record<string, string>, fetchedAt: now };
    return prefixMapCache.map;
  }

  // Fall back to DB
  const map = await phonePrefixRepo.getPrefixMap();

  // Store in both caches
  await cacheService.set(PREFIX_MAP_CACHE_KEY, map, 300); // 5 min TTL in Redis
  prefixMapCache = { map, fetchedAt: now };

  return map;
}

// Call this whenever the admin updates phone prefix config so the
// in-process cache is invalidated immediately without waiting for TTL.
export function invalidatePrefixMapCache(): void {
  prefixMapCache = null;
}

export class ValidationHelpers {
  // Verify phone number and detect network.
  // Reads prefix→network map from DB (cached).

  static async verifyPhone(phone: string): Promise<{
    valid: boolean;
    phone: string;
    network: string;
  }> {
    const prefixMap = await getPrefixMap();

    const cleaned = phone.replace(/\D/g, "");
    const prefix = cleaned.substring(0, 4);
    const network = prefixMap[prefix] || "UNKNOWN";
    const isValid = cleaned.length === 11 && cleaned.startsWith("0");

    return {
      valid: isValid,
      phone: cleaned,
      network,
    };
  }

  // Verify phone number matches the specified network.
  // Reads prefix→network map from DB (cached).

  static async verifyPhoneWithNetwork(
    phone: string,
    network: string,
  ): Promise<boolean> {
    const prefixMap = await getPrefixMap();

    const networkCode = ValidationHelpers.getNetworkCode(network);
    const cleaned = phone.replace(/\D/g, "");
    const prefix = cleaned.substring(0, 4);
    const detectedNetwork = prefixMap[prefix] || "UNKNOWN";
    const isValid = cleaned.length === 11 && cleaned.startsWith("0");
    const networkMatches =
      detectedNetwork.toUpperCase() === networkCode.toUpperCase();

    if (!networkMatches) {
      throw new AppError(
        `Phone number does not match network: ${network}`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    return isValid && networkMatches;
  }

  // Get network code from service code — still hardcoded, no DB needed.

  static getNetworkCode(network: string | undefined): string {
    if (!network) {
      throw new AppError(
        "Network is required",
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    const code = NETWORK_CODE_MAP[network.toLowerCase()];

    if (!code) {
      throw new AppError(
        `Unsupported network: ${network}`,
        HTTP_STATUS.BAD_REQUEST,
        ERROR_CODES.VALIDATION_ERROR,
      );
    }

    return code;
  }
}
