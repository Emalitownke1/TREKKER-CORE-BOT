
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const DB_NAME = 'whatsapp_bots';

async function checkMongoData() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);

    console.log('=== CHECKING MONGODB DATA ===\n');

    // Check wasessions collection
    console.log('📁 WASESSIONS COLLECTION:');
    const sessions = await db.collection('wasessions').find({}).toArray();
    console.log(`Found ${sessions.length} sessions`);
    if (sessions.length > 0) {
      console.log('Sample session structure:');
      const sample = { ...sessions[0] };
      // Hide sensitive data
      if (sample.noiseKey) sample.noiseKey = '[HIDDEN]';
      if (sample.pairingEphemeralKeyPair) sample.pairingEphemeralKeyPair = '[HIDDEN]';
      if (sample.signedIdentityKey) sample.signedIdentityKey = '[HIDDEN]';
      if (sample.signedPreKey) sample.signedPreKey = '[HIDDEN]';
      console.log(JSON.stringify(sample, null, 2));
    }
    console.log('\n');

    // Check wavalidjid collection
    console.log('📁 WAVALIDJID COLLECTION:');
    const validJids = await db.collection('wavalidjid').find({}).toArray();
    console.log(`Found ${validJids.length} valid JIDs`);
    validJids.forEach(jid => console.log(`- ${jid.Jid}`));
    console.log('\n');

    // Check runningbots collection
    console.log('📁 RUNNINGBOTS COLLECTION:');
    const runningBots = await db.collection('runningbots').find({}).toArray();
    console.log(`Found ${runningBots.length} running bots`);
    runningBots.forEach(bot => console.log(`- ${bot.jid} (Session: ${bot.sessionId})`));
    console.log('\n');

    // Check expiredjid collection
    console.log('📁 EXPIREDJID COLLECTION:');
    const expiredJids = await db.collection('expiredjid').find({}).toArray();
    console.log(`Found ${expiredJids.length} expired JIDs`);
    expiredJids.forEach(jid => console.log(`- ${jid.phoneNumber} (Reason: ${jid.reason})`));
    console.log('\n');

    await client.close();
    console.log('✅ MongoDB data check completed');

  } catch (error) {
    console.error('❌ Error checking MongoDB data:', error);
  }
}

checkMongoData();
