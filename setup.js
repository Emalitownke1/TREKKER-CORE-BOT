
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const DB_NAME = 'whatsapp_bots';

async function setupDatabase() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db(DB_NAME);

    // Create collections if they don't exist
    const collections = ['wasessions', 'wavalidjid', 'expiredjid', 'runningbots'];
    
    for (const collection of collections) {
      try {
        await db.createCollection(collection);
        console.log(`Created collection: ${collection}`);
      } catch (error) {
        if (error.codeName === 'NamespaceExists') {
          console.log(`Collection ${collection} already exists`);
        } else {
          throw error;
        }
      }
    }

    // Create indexes
    await db.collection('runningbots').createIndex({ jid: 1 }, { unique: true });
    await db.collection('wavalidjid').createIndex({ Jid: 1 }, { unique: true });
    await db.collection('wasessions').createIndex({ sessionId: 1 }, { unique: true });

    console.log('Database setup completed successfully!');
    
    // Add a sample valid JID for testing
    await db.collection('wavalidjid').insertOne({
      Jid: '254704897825@s.whatsapp.net',
      subscribedAt: new Date(),
      status: 'active',
      note: 'Owner account'
    });

    console.log('Added sample valid JID');
    
    await client.close();
  } catch (error) {
    console.error('Database setup failed:', error);
  }
}

setupDatabase();
