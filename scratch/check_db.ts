import mongoose from "mongoose";

async function run() {
  await mongoose.connect("mongodb+srv://qoreformasolutionlimited_db_user:t2fCJFVYXvdP6w2e@qoreforma.wudmrrg.mongodb.net/paymint");
  
  const walletsWithBalances = await mongoose.connection.db!.collection("wallets").find({
    $or: [
      { bonusBalance: { $ne: 0 } },
      { commissionBalance: { $ne: 0 } }
    ]
  }).toArray();
  
  console.log("Wallets with non-zero bonus/commission:", walletsWithBalances.length);

  const collections = await mongoose.connection.db!.listCollections().toArray();
  console.log("Collections:", collections.map(c => c.name).join(", "));
  
  const bonuses = await mongoose.connection.db!.collection("referralbonus").find({}).toArray();
  console.log("Referral bonuses (referralbonus):", bonuses.length);
  bonuses.forEach(b => {
    console.log(`- type: ${b.bonusType}, value: ${b.value}, threshold: ${b.threshold}`);
  });

  await mongoose.disconnect();
}

run().catch(console.error);
