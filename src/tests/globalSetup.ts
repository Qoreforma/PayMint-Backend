import { MongoMemoryReplSet } from "mongodb-memory-server";
import * as path from "path";

export default async function globalSetup() {

  // Create a single-node replica set (enables transactions)
  const replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1, // Single node is enough for tests
      storageEngine: "wiredTiger",
    },
    instanceOpts: [
      {
        port: 27017, // Use consistent port
        storageEngine: "wiredTiger",
      },
    ],
  });

  const uri = replSet.getUri();

  // Store URI and instance globally for tests to use
  (global as any).__MONGOINSTANCE__ = replSet;
  process.env.MONGO_URI = uri;

}