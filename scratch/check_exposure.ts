import mongoose from "mongoose";

async function run() {
  await mongoose.connect("mongodb+srv://qoreformasolutionlimited_db_user:t2fCJFVYXvdP6w2e@qoreforma.wudmrrg.mongodb.net/paymint");

  const db = mongoose.connection.db!;

  // 1. Pull ReferralBonus configs for reference
  const configs = await db.collection("referralbonus").find({}).toArray();
  const configMap = new Map();
  configs.forEach(c => configMap.set(c._id.toString(), c));

  console.log("=== CONFIGS ===");
  configs.forEach(c => {
    console.log(`Config ID: ${c._id}, Type: ${c.bonusType}, Value: ${c.value}, Threshold: ${c.threshold}, CreatedAt: ${c.createdAt}`);
  });
  console.log("\n");

  const allReferrals = await db.collection("referrals").find({}).toArray();
  
  const typeCounts: Record<string, number> = {};
  allReferrals.forEach(r => {
    typeCounts[r.userType] = (typeCounts[r.userType] || 0) + 1;
  });
  console.log("=== REFERRAL COUNTS BY USERTYPE ===");
  console.log(typeCounts);
  console.log("\n");

  const referralsWithMilestones = allReferrals.filter(r => r.bonusMilestones && r.bonusMilestones.length > 0);

  let totalMoneyPaid = 0;
  let totalMoneyEarned = 0;

  console.log(`=== REGULAR BONUS MILESTONES (${referralsWithMilestones.length} referrals) ===`);
  for (const ref of referralsWithMilestones) {
    for (const milestone of ref.bonusMilestones) {
      if (milestone.status === "earned" || milestone.status === "paid") {
        const configId = milestone.bonusConfigId.toString();
        const config = configMap.get(configId);
        
        let valueAsReward = 0;
        let thresholdAsReward = 0;
        
        // Wait, how did the amount get calculated?
        // the code did: if flat, bonusAmount = bonus.threshold
        // if value was reward: bonusAmount = bonus.value
        if (config) {
            if (config.bonusType === "flat") {
                valueAsReward = config.value;
                thresholdAsReward = config.threshold;
            } else if (config.bonusType === "percentage") {
                // We'd need totalAmountTraded to know the exact %, but we can't easily get it here without UserTradeMetrics
                valueAsReward = -1; // Indicate percentage
                thresholdAsReward = -1;
            }
        }

        console.log(`Milestone - Status: ${milestone.status}, BonusConfigId: ${configId}, Actual Recorded Amount: ${milestone.bonusAmount}`);
        if (config) {
            console.log(`  -> Config: Type: ${config.bonusType}, Value: ${config.value}, Threshold: ${config.threshold}`);
            console.log(`  -> If Value was Reward: ${valueAsReward}, If Threshold was Reward: ${thresholdAsReward}`);
        } else {
            console.log(`  -> Config missing for ID: ${configId}`);
        }
        
        if (milestone.status === "paid") {
            totalMoneyPaid += milestone.bonusAmount;
        } else if (milestone.status === "earned") {
            totalMoneyEarned += milestone.bonusAmount;
        }
      }
    }
  }

  console.log(`\nTotals: Paid = ${totalMoneyPaid}, Earned (Pending) = ${totalMoneyEarned}\n`);

  const referralsWithInfluencer = allReferrals.filter(r => r.influencerBonus && r.influencerBonus.status);

  console.log(`=== INFLUENCER BONUSES (${referralsWithInfluencer.length} referrals) ===`);
  for (const ref of referralsWithInfluencer) {
    const ib = ref.influencerBonus;
    if (ib.status === "earned" || ib.status === "paid") {
        console.log(`Influencer Bonus - Status: ${ib.status}, Recorded Amount: ${ib.amount}`);
    }
  }

  await mongoose.disconnect();
}

run().catch(console.error);
