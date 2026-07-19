// @/scripts/updateTatumNetworkChainCodes.ts
//
// One-off fix for Network documents whose `tatumChainCode` was corrupted
// by the (now removed) `uppercase: true` schema option in models/crypto/Network.ts.
// e.g. "ethereum-mainnet" was being saved as "ETHEREUM-MAINNET".
//
// This writes through the RAW MongoDB driver (mongoose.connection.collection),
// not the Mongoose Model — so it bypasses schema setters entirely and works
// correctly whether you run it before or after the schema fix is deployed.
//
// Run with:  npm run update:tatumNetwork

import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";

const CORRECT_CHAIN_CODES: Record<string, string> = {
  BITCOIN: "bitcoin-mainnet",
  ETHEREUM: "ethereum-mainnet",
  TRON: "tron-mainnet",
  SOLANA: "solana-mainnet",
};

async function connectDB() {
  const MONGODB_URI =
    process.env.MONGODB_URI || "mongodb://localhost:27017/your_database";

  try {
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
}

async function updateTatumNetworkChainCodes() {
  console.log(
    "🔄 Fixing corrupted tatumChainCode values on Network documents...",
  );

  // Raw collection access on purpose — bypasses the Network schema's
  // Mongoose setters (specifically the `uppercase: true` bug) entirely.
  const networks = mongoose.connection.collection("networks");

  let updated = 0;
  let alreadyCorrect = 0;
  let notFound = 0;

  for (const [networkId, correctValue] of Object.entries(
    CORRECT_CHAIN_CODES,
  )) {
    const doc = await networks.findOne({ networkId });

    if (!doc) {
      console.warn(
        `⚠️  No network document found for networkId "${networkId}" — skipping`,
      );
      notFound++;
      continue;
    }

    if (doc.tatumChainCode === correctValue) {
      console.log(`✅ ${networkId} already correct ("${correctValue}") — skipping`);
      alreadyCorrect++;
      continue;
    }

    console.log(
      `📝 ${networkId}: "${doc.tatumChainCode}" → "${correctValue}"`,
    );

    const result = await networks.updateOne(
      { _id: doc._id },
      { $set: { tatumChainCode: correctValue } },
    );

    if (result.modifiedCount === 1) {
      updated++;
    } else {
      console.warn(
        `⚠️  Update reported no changes for ${networkId} — check manually`,
      );
    }
  }

  console.log("\n📊 Summary:");
  console.log(`   Updated:         ${updated}`);
  console.log(`   Already correct: ${alreadyCorrect}`);
  console.log(`   Not found:       ${notFound}`);

  // Verification pass — read back exactly what's in the DB now
  console.log("\n🔍 Verifying...");
  for (const networkId of Object.keys(CORRECT_CHAIN_CODES)) {
    const doc = await networks.findOne({ networkId });
    console.log(
      `   ${networkId}: tatumChainCode = "${doc?.tatumChainCode ?? "(not found)"}"`,
    );
  }
}

async function main() {
  try {
    await connectDB();
    await updateTatumNetworkChainCodes();
    console.log("\n✅ Done.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Script failed:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  await mongoose.connection.close();
  console.log("\n👋 Database connection closed");
  process.exit(0);
});

main();
