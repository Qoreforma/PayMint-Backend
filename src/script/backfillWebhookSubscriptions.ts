/**
 * backfillWebhookSubscriptions.ts
 *
 * Finds every userCryptoAddresses entry that was cached without ever getting
 * a confirmed Tatum subscription (webhookSubscriptionStatus missing, or
 * "failed", or "pending"), and re-attempts the subscription now that the
 * Network.tatumChainCode values are corrected.
 *
 * IMPORTANT CAVEAT: Tatum subscriptions watch an address going forward from
 * the moment they're created. This script fixes things for FUTURE deposits
 * to these addresses. It cannot retroactively notify you about deposits that
 * already happened while the address was unsubscribed (like the one that
 * started this investigation) — those need to be found and credited
 * separately, e.g. by checking on-chain balances for every affected address
 * against what's recorded in your DB.
 *
 * Run with: npx ts-node backfillWebhookSubscriptions.ts --dry-run
 * Then without --dry-run once you've reviewed the output.
 */

import "dotenv/config";
import mongoose from "mongoose";
import axios from "axios";

const MONGODB_URI = process.env.MONGODB_URI!;
const API_KEY = process.env.TATUM_API_KEY!;
const BASE_URL = "https://api.tatum.io";
const IS_TESTNET = process.env.TATUM_ENVIRONMENT !== "mainnet";
const WEBHOOK_URL = `${process.env.BASE_URL}/api/v1/webhooks/tatum`;

const DRY_RUN = process.argv.includes("--dry-run");

async function createSubscription(address: string, chain: string) {
  const typeParam = IS_TESTNET ? "?type=testnet" : "?type=mainnet";
  const res = await axios.post(
    `${BASE_URL}/v4/subscription${typeParam}`,
    {
      type: "ADDRESS_EVENT",
      attr: { address, chain, url: WEBHOOK_URL },
    },
    { headers: { "x-api-key": API_KEY, "Content-Type": "application/json" } },
  );
  return res.data.id as string;
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection;

  const users = await db
    .collection("users")
    .find({
      userCryptoAddresses: { $exists: true, $ne: [] },
    })
    .toArray();

  const networksById = new Map<string, any>();
  const allNetworks = await db.collection("networks").find({}).toArray();
  for (const n of allNetworks) networksById.set(String(n._id), n);

  let total = 0;
  let needsRetry = 0;
  let fixed = 0;
  let stillFailing = 0;
  const stillFailingList: any[] = [];

  for (const user of users) {
    let userChanged = false;

    for (const entry of user.userCryptoAddresses || []) {
      total++;

      const status = entry.webhookSubscriptionStatus; // undefined for pre-migration records
      if (status === "subscribed") continue;

      needsRetry++;

      const network = networksById.get(String(entry.networkId));
      if (!network) {
        console.warn(
          `  Skipping ${entry.depositAddress} — network ${entry.networkId} not found`,
        );
        continue;
      }

      console.log(
        `[${DRY_RUN ? "DRY-RUN" : "LIVE"}] ${entry.depositAddress} (${network.code}, chain=${network.tatumChainCode}) — current status: ${status ?? "none (pre-migration record)"}`,
      );

      if (DRY_RUN) continue;

      try {
        const subscriptionId = await createSubscription(
          entry.depositAddress,
          network.tatumChainCode,
        );
        entry.webhookSubscriptionId = subscriptionId;
        entry.webhookSubscriptionStatus = "subscribed";
        entry.webhookLastAttemptAt = new Date();
        userChanged = true;
        fixed++;
        console.log(`  -> subscribed (id: ${subscriptionId})`);
      } catch (err: any) {
        const msg = err?.response?.data?.message || err.message;
        entry.webhookSubscriptionStatus = "failed";
        entry.webhookLastAttemptAt = new Date();
        userChanged = true;
        stillFailing++;
        stillFailingList.push({
          address: entry.depositAddress,
          chain: network.tatumChainCode,
          error: msg,
        });
        console.log(`  -> STILL FAILING: ${msg}`);
      }

      // gentle pacing to avoid hammering Tatum's rate limits
      await new Promise((r) => setTimeout(r, 150));
    }

    if (userChanged) {
      await db
        .collection("users")
        .updateOne(
          { _id: user._id },
          { $set: { userCryptoAddresses: user.userCryptoAddresses } },
        );
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Total addresses scanned: ${total}`);
  console.log(`Needed retry (not already subscribed): ${needsRetry}`);
  if (!DRY_RUN) {
    console.log(`Newly subscribed successfully: ${fixed}`);
    console.log(`Still failing: ${stillFailing}`);
    if (stillFailingList.length) {
      console.log(
        "Addresses still failing (needs manual investigation):",
        JSON.stringify(stillFailingList, null, 2),
      );
    }
  } else {
    console.log("Dry run — no changes made, no Tatum calls made.");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Backfill script failed:", err);
  process.exit(1);
});
