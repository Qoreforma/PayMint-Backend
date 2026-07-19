import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { Leaderboard } from "../models/core/Leaderboard";
import { LEADERBOARD_ACTIVE_PERIODS } from "../utils/constants";

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

async function cleanupInactivePeriods(dryRun: boolean) {
  console.log("🔍 Active periods (kept):", LEADERBOARD_ACTIVE_PERIODS);
  const filter = { period: { $nin: LEADERBOARD_ACTIVE_PERIODS } };

  const breakdown = await Leaderboard.aggregate([
    { $match: filter },
    { $group: { _id: "$period", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const totalToRemove = breakdown.reduce((sum, b) => sum + b.count, 0);
  if (totalToRemove === 0) {
    console.log("✅ No stale inactive-period rows found. Nothing to do.");
    return;
  }

  console.log("\n📊 Rows found outside active periods:");
  breakdown.forEach((b) => console.log(`   - ${b._id ?? "(no period set)"}: ${b.count}`));
  console.log(`   TOTAL: ${totalToRemove}\n`);

  if (dryRun) {
    console.log("🧪 Dry run — no rows deleted. Re-run without --dry-run to delete.");
    return;
  }

  const result = await Leaderboard.deleteMany(filter).exec();
  console.log(`🗑️  Deleted ${result.deletedCount ?? 0} stale leaderboard rows.`);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  try {
    console.log("🚀 Leaderboard Inactive-Period Cleanup Tool\n");
    await connectDB();
    await cleanupInactivePeriods(dryRun);
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  await mongoose.connection.close();
  console.log("\n👋 Database connection closed");
  process.exit(0);
});

main();