require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');

const app = require('./app');
const connectDB = require('./config/db');
const registerSocketHandlers = require('./socket');
const { loadAgentPrompts } = require('./services/promptRegistry');

async function startServer(options = {}) {
  await loadAgentPrompts();
  await connectDB();

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PATCH'],
    },
  });

  app.locals.io = io;
  registerSocketHandlers(io);

  const port = options.port ?? (Number(process.env.PORT) || 3001);
  const host = options.host ?? process.env.HOST;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  console.log(`Backend listening on port ${server.address().port}`);
  return { server, io };
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start server', error);
    process.exit(1);
  });
}

module.exports = { startServer };
