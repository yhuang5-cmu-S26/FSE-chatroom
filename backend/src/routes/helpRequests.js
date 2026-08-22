const express = require('express');
const HelpRequest = require('../models/HelpRequest');

const router = express.Router();

const validPriorities = new Set(['low', 'medium', 'high', 'critical']);
const validStatuses = new Set(['open', 'assigned', 'in_progress', 'resolved']);

router.post('/', async (req, res, next) => {
  try {
    const { description, priority = 'medium', location } = req.body;

    if (!description || !location || location.latitude === undefined || location.longitude === undefined) {
      return res
        .status(400)
        .json({ error: 'description and location(latitude, longitude) are required' });
    }

    if (!validPriorities.has(priority)) {
      return res.status(400).json({ error: 'invalid priority value' });
    }

    const helpRequest = await HelpRequest.create({ description, priority, location });
    return res.status(201).json(helpRequest);
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (_req, res, next) => {
  try {
    const requests = await HelpRequest.find().sort({ createdAt: -1 }).limit(200);
    return res.json(requests);
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status || !validStatuses.has(status)) {
      return res.status(400).json({ error: 'valid status is required' });
    }

    const updated = await HelpRequest.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({ error: 'help request not found' });
    }

    const io = req.app.locals.io;
    if (io) {
      io.emit('help:status-updated', {
        id: updated.id,
        status: updated.status,
        updatedAt: updated.updatedAt,
      });
    }

    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
