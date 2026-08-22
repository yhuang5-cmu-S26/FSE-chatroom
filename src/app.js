const express = require('express');

function createApp(container) {
  const app = express();
  app.use(express.json());
  app.use(express.static('src/public'));

  app.get('/health', (_, res) => {
    res.json({ ok: true });
  });

  app.get('/api/help-requests/hot', async (req, res, next) => {
    try {
      const service = container.resolve('helpRequestService');
      const limit = Number(req.query.limit || 20);
      const requests = await service.getHotRequests(limit);
      res.json({ requests });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/help-requests', async (req, res, next) => {
    try {
      const service = container.resolve('helpRequestService');
      const request = await service.create(req.body);
      res.status(201).json(request);
    } catch (error) {
      next(error);
    }
  });

  app.use((err, _, res, __) => {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ error: err.issues });
    }

    return res.status(500).json({ error: err.message || 'internal_error' });
  });

  return app;
}

module.exports = { createApp };
