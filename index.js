const express = require('express');
const { MongoClient } = require('mongodb');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const DB_NAME = 'whatsapp_bots';

// Collections
const COLLECTIONS = {
  PENDING_SESSIONS: 'wasessions',
  VALID_JIDS: 'wavalidjid',
  EXPIRED_JIDS: 'expiredjid',
  RUNNING_BOTS: 'runningbots'
};

// Bot management
const MAX_BOTS = 15;
const activeBots = new Map();
let db;

// Logger
const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static HTML file for session upload
app.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, 'upload-session.html'));
});

// Initialize MongoDB connection
async function initMongoDB() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    logger.info('Connected to MongoDB successfully');

    // Create indexes for better performance
    await db.collection(COLLECTIONS.RUNNING_BOTS).createIndex({ jid: 1 }, { unique: true });
    await db.collection(COLLECTIONS.VALID_JIDS).createIndex({ Jid: 1 }, { unique: true });

    return true;
  } catch (error) {
    logger.error('MongoDB connection failed:', error);
    return false;
  }
}

// Create WhatsApp connection from session data
async function createWhatsAppBotFromSessionData(sessionData, sessionId) {
  try {
    const authDir = path.join('./sessions', sessionId);

    // Ensure sessions directory exists
    if (!fs.existsSync('./sessions')) {
      fs.mkdirSync('./sessions', { recursive: true });
    }

    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    // Write session data to creds.json
    const credsPath = path.join(authDir, 'creds.json');
    fs.writeFileSync(credsPath, JSON.stringify(sessionData, null, 2));

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['TREKKER-CORE-BOT', 'Chrome', '1.0.0'],
      generateHighQualityLinkPreview: true
    });

    sock.ev.on('creds.update', saveCreds);

    return sock;
  } catch (error) {
    logger.error(`Failed to create WhatsApp bot for session ${sessionId}:`, error);
    throw error;
  }
}

// Send message to WhatsApp number
async function sendMessage(sock, jid, message) {
  try {
    await sock.sendMessage(jid, { text: message });
    logger.info(`Message sent to ${jid}: ${message}`);
    return true;
  } catch (error) {
    logger.error(`Failed to send message to ${jid}:`, error);
    return false;
  }
}

// Extract phone number from JID
function extractPhoneNumber(jid) {
  return jid.split('@')[0];
}

// Check if JID is subscribed
async function isJidSubscribed(jid) {
  try {
    const result = await db.collection(COLLECTIONS.VALID_JIDS).findOne({ Jid: jid });
    return !!result;
  } catch (error) {
    logger.error('Error checking subscription:', error);
    return false;
  }
}

// Add to expired JIDs
async function addToExpiredJids(phoneNumber) {
  try {
    await db.collection(COLLECTIONS.EXPIRED_JIDS).insertOne({
      phoneNumber,
      expiredAt: new Date(),
      reason: 'Invalid or expired session'
    });
    logger.info(`Added ${phoneNumber} to expired JIDs`);
  } catch (error) {
    logger.error('Error adding to expired JIDs:', error);
  }
}

// Add to running bots
async function addToRunningBots(jid, sessionId) {
  try {
    await db.collection(COLLECTIONS.RUNNING_BOTS).insertOne({
      jid,
      sessionId,
      startedAt: new Date(),
      status: 'active'
    });
    logger.info(`Added ${jid} to running bots`);
  } catch (error) {
    logger.error('Error adding to running bots:', error);
  }
}

// Remove from pending sessions
async function removeFromPendingSessions(sessionId) {
  try {
    const { ObjectId } = require('mongodb');
    let query;
    
    // Try to use ObjectId if sessionId looks like one, otherwise use as string
    try {
      query = { _id: new ObjectId(sessionId) };
    } catch {
      query = { sessionId };
    }
    
    await db.collection(COLLECTIONS.PENDING_SESSIONS).deleteOne(query);
    logger.info(`Removed session ${sessionId} from pending sessions`);
  } catch (error) {
    logger.error('Error removing from pending sessions:', error);
  }
}

// Get running bots count
async function getRunningBotsCount() {
  try {
    return await db.collection(COLLECTIONS.RUNNING_BOTS).countDocuments();
  } catch (error) {
    logger.error('Error getting running bots count:', error);
    return 0;
  }
}

// Extract remoteJid from session data
function extractRemoteJidFromSession(sessionData) {
  try {
    // Try to get from processedHistoryMessages
    if (sessionData.processedHistoryMessages && sessionData.processedHistoryMessages.length > 0) {
      const firstMessage = sessionData.processedHistoryMessages[0];
      if (firstMessage.key && firstMessage.key.remoteJid) {
        return firstMessage.key.remoteJid;
      }
    }
    
    // Try to get from me field
    if (sessionData.me && sessionData.me.id) {
      const phoneNumber = sessionData.me.id.split(':')[0];
      return `${phoneNumber}@s.whatsapp.net`;
    }
    
    return null;
  } catch (error) {
    logger.error('Error extracting remoteJid from session:', error);
    return null;
  }
}

// Process a single session
async function processSession(sessionData) {
  const sessionId = sessionData._id?.toString() || 'unknown';
  const remoteJid = extractRemoteJidFromSession(sessionData);

  try {
    logger.info(`Processing session: ${sessionId}`);
    
    if (!remoteJid) {
      logger.error(`No remoteJid found in session ${sessionId}`);
      await removeFromPendingSessions(sessionId);
      return;
    }

    logger.info(`Extracted remoteJid: ${remoteJid}`);

    // Check if JID is subscribed before creating connection
    const isSubscribed = await isJidSubscribed(remoteJid);
    if (!isSubscribed) {
      logger.warn(`${remoteJid} is not subscribed. Skipping session ${sessionId}`);
      await addToExpiredJids(extractPhoneNumber(remoteJid));
      await removeFromPendingSessions(sessionId);
      return;
    }

    // Check if we've reached the bot limit
    const runningCount = await getRunningBotsCount();
    if (runningCount >= MAX_BOTS) {
      logger.warn(`Bot limit reached (${MAX_BOTS}). Skipping session ${sessionId}`);
      return;
    }

    // Create WhatsApp connection using session data
    const sock = await createWhatsAppBotFromSessionData(sessionData, sessionId);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info(`QR Code generated for session ${sessionId}`);
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

        if (!shouldReconnect) {
          logger.info(`Session ${sessionId} logged out`);
          const phoneNumber = extractPhoneNumber(remoteJid);
          if (phoneNumber) {
            await addToExpiredJids(phoneNumber);
          }
        }

        // Remove from active bots and running bots
        activeBots.delete(sessionId);
        try {
          await db.collection(COLLECTIONS.RUNNING_BOTS).deleteOne({ jid: remoteJid });
        } catch (error) {
          logger.error('Error removing from running bots:', error);
        }
        await removeFromPendingSessions(sessionId);
      }

      if (connection === 'open') {
        logger.info(`Session ${sessionId} connected successfully for ${remoteJid}`);

        activeBots.set(sessionId, sock);

        // Send confirmation message
        await sendMessage(sock, remoteJid, "🤖 Bot is now active and running!");
        await addToRunningBots(remoteJid, sessionId);
        logger.info(`Bot setup completed for ${remoteJid}`);

        await removeFromPendingSessions(sessionId);
      }
    });

    // Handle incoming messages (you can extend this)
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg.key.fromMe && msg.message) {
        const jid = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        logger.info(`Received message from ${jid}: ${text}`);

        // Add your bot logic here
        if (text.toLowerCase() === 'ping') {
          await sendMessage(sock, jid, 'Pong! 🏓');
        }
      }
    });

  } catch (error) {
    logger.error(`Error processing session ${sessionId}:`, error);
    const phoneNumber = extractPhoneNumber(sessionData.phoneNumber || '');
    if (phoneNumber) {
      await addToExpiredJids(phoneNumber);
    }
    await removeFromPendingSessions(sessionId);
  }
}

// Main session processing loop
async function processPendingSessions() {
  try {
    const pendingSessions = await db.collection(COLLECTIONS.PENDING_SESSIONS).find({}).toArray();

    if (pendingSessions.length === 0) {
      logger.info('No pending sessions to process');
      return;
    }

    logger.info(`Found ${pendingSessions.length} pending sessions`);

    for (const session of pendingSessions) {
      const runningCount = await getRunningBotsCount();
      if (runningCount >= MAX_BOTS) {
        logger.warn(`Bot limit reached (${MAX_BOTS}). Stopping session processing.`);
        break;
      }

      await processSession(session);

      // Add delay between sessions to avoid overwhelming
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (error) {
    logger.error('Error processing pending sessions:', error);
  }
}

// API Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'TREKKER-CORE-BOT Multi-Bot Manager',
    status: 'active',
    activeBots: activeBots.size,
    maxBots: MAX_BOTS
  });
});

app.get('/status', async (req, res) => {
  try {
    const runningCount = await getRunningBotsCount();
    const pendingCount = await db.collection(COLLECTIONS.PENDING_SESSIONS).countDocuments();
    const expiredCount = await db.collection(COLLECTIONS.EXPIRED_JIDS).countDocuments();

    res.json({
      runningBots: runningCount,
      pendingSessions: pendingCount,
      expiredSessions: expiredCount,
      activeBots: activeBots.size,
      maxBots: MAX_BOTS
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/add-session', async (req, res) => {
  try {
    const { sessionId, phoneNumber } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    await db.collection(COLLECTIONS.PENDING_SESSIONS).insertOne({
      sessionId,
      phoneNumber,
      addedAt: new Date(),
      status: 'pending'
    });

    res.json({ message: 'Session added to queue', sessionId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/add-subscription', async (req, res) => {
  try {
    const { jid } = req.body;

    if (!jid) {
      return res.status(400).json({ error: 'JID is required' });
    }

    await db.collection(COLLECTIONS.VALID_JIDS).insertOne({
      Jid: jid,
      subscribedAt: new Date(),
      status: 'active'
    });

    res.json({ message: 'Subscription added', jid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/upload-session', async (req, res) => {
  try {
    const { sessionId, phoneNumber, sessionData } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    if (!sessionData) {
      return res.status(400).json({ error: 'Session data is required' });
    }

    // Validate that sessionData is an object
    if (typeof sessionData !== 'object') {
      return res.status(400).json({ error: 'Session data must be valid JSON object' });
    }

    // Check if session with this ID already exists
    const existingSession = await db.collection(COLLECTIONS.PENDING_SESSIONS).findOne({ sessionId });
    if (existingSession) {
      return res.status(400).json({ error: 'Session ID already exists' });
    }

    // Insert session data into wasessions collection
    const sessionDoc = {
      sessionId,
      phoneNumber: phoneNumber || null,
      uploadedAt: new Date(),
      status: 'pending',
      ...sessionData  // Spread the session data
    };

    await db.collection(COLLECTIONS.PENDING_SESSIONS).insertOne(sessionDoc);

    logger.info(`New session uploaded: ${sessionId} ${phoneNumber ? `(${phoneNumber})` : ''}`);

    res.json({ 
      message: 'Session uploaded successfully and added to processing queue', 
      sessionId,
      phoneNumber 
    });

  } catch (error) {
    logger.error('Error uploading session:', error);
    res.status(500).json({ error: 'Failed to upload session: ' + error.message });
  }
});

// Initialize and start the application
async function startApplication() {
  const mongoConnected = await initMongoDB();

  if (!mongoConnected) {
    logger.error('Failed to connect to MongoDB. Exiting...');
    process.exit(1);
  }

  // Start processing sessions every 30 seconds
  setInterval(processPendingSessions, 30000);

  // Process initial sessions
  setTimeout(processPendingSessions, 5000);

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`TREKKER-CORE-BOT Multi-Bot Manager running on port ${PORT}`);
    logger.info(`Maximum concurrent bots: ${MAX_BOTS}`);
  });
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');

  // Close all active bot connections
  for (const [sessionId, sock] of activeBots) {
    try {
      sock.end();
      logger.info(`Closed connection for session ${sessionId}`);
    } catch (error) {
      logger.error(`Error closing session ${sessionId}:`, error);
    }
  }

  process.exit(0);
});

// Start the application
startApplication().catch(error => {
  logger.error('Failed to start application:', error);
  process.exit(1);
});