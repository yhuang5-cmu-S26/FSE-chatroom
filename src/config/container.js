const { MongoClient } = require('mongodb');
const { Container } = require('../di/container');
const { HelpRequestRepository } = require('../data/helpRequestRepository');
const { HelpRequestService } = require('../services/helpRequestService');
const { PubSubBus } = require('../messaging/pubsub');
const { MessageQueue } = require('../messaging/messageQueue');

async function buildContainer({ mongoUrl, dbName = 'fse_chatroom' }) {
  const container = new Container();

  container.register('mongoClient', () => new MongoClient(mongoUrl));

  container.register('mongoDb', (c) => {
    const client = c.resolve('mongoClient');
    return client.db(dbName);
  });

  container.register('helpRequestCollection', (c) => c.resolve('mongoDb').collection('help_requests'));

  container.register('helpRequestRepository', (c) => new HelpRequestRepository(c.resolve('helpRequestCollection')));

  container.register('helpRequestService', (c) => new HelpRequestService(c.resolve('helpRequestRepository')));

  container.register('pubsub', () => new PubSubBus());
  container.register('messageQueue', () => new MessageQueue({ maxQueueSize: Number(process.env.CHAT_MAX_QUEUE || 1000) }));

  return container;
}

module.exports = { buildContainer };
