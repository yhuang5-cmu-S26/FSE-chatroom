const { createServer } = require('node:http');
const { Server } = require('socket.io');
const { createApp } = require('./app');
const { buildContainer } = require('./config/container');
const { bindChatGateway } = require('./messaging/chatGateway');

async function start() {
  const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
  const port = Number(process.env.PORT || 3000);
  const container = await buildContainer({ mongoUrl, dbName: process.env.MONGO_DB || 'fse_chatroom' });
  const mongoClient = container.resolve('mongoClient');

  await mongoClient.connect();
  await container.resolve('helpRequestService').initialize();

  const app = createApp(container);
  const httpServer = createServer(app);

  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  bindChatGateway(io, {
    pubsub: container.resolve('pubsub'),
    queue: container.resolve('messageQueue'),
  });

  httpServer.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on :${port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}

module.exports = { start };
