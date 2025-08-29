
const { MongoClient } = require('mongodb');

class DatabaseManager {
  constructor(uri, dbName) {
    this.uri = uri;
    this.dbName = dbName;
    this.client = null;
    this.db = null;
  }

  async connect() {
    try {
      this.client = new MongoClient(this.uri);
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      console.log('Connected to MongoDB successfully');
      return true;
    } catch (error) {
      console.error('MongoDB connection failed:', error);
      return false;
    }
  }

  async addPendingSession(sessionId, phoneNumber) {
    return await this.db.collection('wasessions').insertOne({
      sessionId,
      phoneNumber,
      addedAt: new Date(),
      status: 'pending'
    });
  }

  async getPendingSessions() {
    return await this.db.collection('wasessions').find({}).toArray();
  }

  async removePendingSession(sessionId) {
    return await this.db.collection('wasessions').deleteOne({ sessionId });
  }

  async isJidValid(jid) {
    const result = await this.db.collection('wavalidjid').findOne({ jid });
    return !!result;
  }

  async addValidJid(jid) {
    return await this.db.collection('wavalidjid').insertOne({
      jid,
      subscribedAt: new Date(),
      status: 'active'
    });
  }

  async addExpiredJid(phoneNumber, reason = 'Invalid session') {
    return await this.db.collection('expiredjid').insertOne({
      phoneNumber,
      expiredAt: new Date(),
      reason
    });
  }

  async addRunningBot(jid, sessionId) {
    return await this.db.collection('runningbots').insertOne({
      jid,
      sessionId,
      startedAt: new Date(),
      status: 'active'
    });
  }

  async removeRunningBot(jid) {
    return await this.db.collection('runningbots').deleteOne({ jid });
  }

  async getRunningBotsCount() {
    return await this.db.collection('runningbots').countDocuments();
  }

  async getRunningBots() {
    return await this.db.collection('runningbots').find({}).toArray();
  }
}

module.exports = DatabaseManager;
