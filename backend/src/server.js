require('dotenv').config();

const fs = require('node:fs');
const http = require('http');
const https = require('https');
const { randomBytes } = require('node:crypto');
const { Server } = require('socket.io');

const app = require('./app');
const connectDB = require('./config/db');
const registerSocketHandlers = require('./socket');
const { loadAgentPrompts } = require('./services/promptRegistry');

async function startServer(options = {}) {
  await loadAgentPrompts();
  await connectDB();

  const tlsKeyPath = process.env.TLS_KEY_PATH;
  const tlsCertPath = process.env.TLS_CERT_PATH;
  const tlsEnabled = Boolean(tlsKeyPath && tlsCertPath);
  const server = tlsEnabled
    ? https.createServer({ key: fs.readFileSync(tlsKeyPath), cert: fs.readFileSync(tlsCertPath) }, app)
    : http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PATCH'],
    },
  });

  app.locals.io = io;
  app.locals.speedTestInternalToken = randomBytes(32).toString('hex');
  registerSocketHandlers(io);

  const port = options.port ?? (Number(process.env.PORT) || 3001);
  const host = options.host ?? process.env.HOST;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  app.locals.speedTestTarget = `${tlsEnabled ? 'https' : 'http'}://127.0.0.1:${server.address().port}/api/health`;
  console.log(`Backend listening on ${tlsEnabled ? 'https' : 'http'} port ${server.address().port}`);
  return { server, io };
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start server', error);
    process.exit(1);
  });
}

module.exports = { startServer };
