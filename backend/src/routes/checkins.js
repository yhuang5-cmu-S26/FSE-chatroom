const express = require('express');
const mongoose = require('mongoose');
const UserCheckin = require('../models/UserCheckin');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const validStatuses = new Set(['pending', 'in_progress', 'blocked', 'resolved']);
const validPriorities = new Set(['low', 'medium', 'high', 'critical']);

router.use(authenticate);

function emitCheckinEvent(req, event, payload) {
  const io = req.app.locals.io;
  if (io) {
    io.emit(event, payload);
  }
}

function normalizeTask(checkin) {
  const id = checkin.id || checkin._id;
  return {
    id: typeof id === 'string' ? id : String(id),
    task: checkin.task,
    note: checkin.note,
    role: checkin.role,
    priority: checkin.priority,
    status: checkin.status,
    reporterId: checkin.reporterId,
    reporterName: checkin.reporterName,
    assignedTo: checkin.assignedTo,
    completedAt: checkin.completedAt,
    createdAt: checkin.createdAt,
    updatedAt: checkin.updatedAt,
  };
}

router.post('/', async (req, res, next) => {
  try {
    const task = typeof req.body.task === 'string' ? req.body.task.trim() : '';
    const role = typeof req.body.role === 'string' ? req.body.role.trim() : '';
    const note = typeof req.body.note === 'string' ? req.body.note.trim() : '';
    const priority = typeof req.body.priority === 'string' ? req.body.priority : 'medium';
    const assignedTo = typeof req.body.assignedTo === 'string' ? req.body.assignedTo.trim() : '';

    if (!task || !role) {
      return res.status(400).json({ error: 'task and role are required' });
    }

    if (!validPriorities.has(priority)) {
      return res.status(400).json({ error: 'invalid priority value' });
    }

    const checkin = await UserCheckin.create({
      task,
      role,
      note,
      priority,
      assignedTo,
      reporterId: req.user.id,
      reporterName: req.user.name,
    });

    const payload = normalizeTask(checkin);
    emitCheckinEvent(req, 'checkin:created', payload);
    emitCheckinEvent(req, 'checkin:updated', payload);

    return res.status(201).json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (_req, res, next) => {
  try {
    const checkins = await UserCheckin.find().sort({ updatedAt: -1 }).limit(200).lean();
    return res.json(checkins.map((item) => normalizeTask(item)));
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'invalid checkin task id' });
    }

    const status = typeof req.body.status === 'string' ? req.body.status : '';
    if (!validStatuses.has(status)) {
      return res.status(400).json({ error: 'invalid status value' });
    }

    const updated = await UserCheckin.findById(req.params.id);
    if (!updated) {
      return res.status(404).json({ error: 'checkin task not found' });
    }

    updated.status = status;
    updated.completedAt = status === 'resolved' ? new Date() : null;
    await updated.save();

    const payload = normalizeTask(updated);
    emitCheckinEvent(req, 'checkin:updated', payload);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/admin', authorize('admin'), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'invalid checkin task id' });
    }

    const updates = {};
    if (typeof req.body.assignedTo === 'string') updates.assignedTo = req.body.assignedTo.trim();
    if (typeof req.body.note === 'string') updates.note = req.body.note.trim();
    if (typeof req.body.priority === 'string') {
      if (!validPriorities.has(req.body.priority)) {
        return res.status(400).json({ error: 'invalid priority value' });
      }
      updates.priority = req.body.priority;
    }
    if (typeof req.body.status === 'string') {
      if (!validStatuses.has(req.body.status)) {
        return res.status(400).json({ error: 'invalid status value' });
      }
      updates.status = req.body.status;
      updates.completedAt = req.body.status === 'resolved' ? new Date() : null;
    }

    const updated = await UserCheckin.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!updated) {
      return res.status(404).json({ error: 'checkin task not found' });
    }

    const payload = normalizeTask(updated);
    emitCheckinEvent(req, 'checkin:updated', payload);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', authorize('admin'), async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'invalid checkin task id' });
    }

    const removed = await UserCheckin.findByIdAndDelete(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'checkin task not found' });
    }

    emitCheckinEvent(req, 'checkin:deleted', { id: req.params.id });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
