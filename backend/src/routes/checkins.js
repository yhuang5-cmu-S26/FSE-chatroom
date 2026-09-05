const express = require('express');
const mongoose = require('mongoose');
const UserCheckin = require('../models/UserCheckin');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
const validIds = (ids) => Array.isArray(ids) && ids.every((id) => mongoose.Types.ObjectId.isValid(id));
const payload = (task) => ({ ...(task.toObject?.() || task), id: String(task._id || task.id) });
const emit = (req, event, value) => req.app.locals.io?.emit(event, value);

router.get('/', async (_req, res, next) => {
  try { res.json((await UserCheckin.find().sort({ createdAt: -1 }).limit(100).lean()).map(payload)); }
  catch (error) { next(error); }
});

router.post('/', authorize('admin'), async (req, res, next) => {
  try {
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    const assigneeIds = req.body.assigneeIds || [];
    if (!title || !validIds(assigneeIds)) return res.status(400).json({ error: 'title and valid assigneeIds are required' });
    const task = await UserCheckin.create({ title, description, assigneeIds, createdBy: req.user.id, dueAt: req.body.dueAt || null });
    const value = payload(task); emit(req, 'checkin:created', value); res.status(201).json(value);
  } catch (error) { next(error); }
});

router.post('/:id/check-in', async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'invalid task id' });
    const task = await UserCheckin.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'check-in task not found' });
    if (!task.assigneeIds.some((id) => String(id) === req.user.id)) return res.status(403).json({ error: 'you are not assigned to this task' });
    if (!task.checkedInUserIds.some((id) => String(id) === req.user.id)) task.checkedInUserIds.push(req.user.id);
    await task.save(); const value = payload(task); emit(req, 'checkin:updated', value); res.json(value);
  } catch (error) { next(error); }
});

router.delete('/:id', authorize('admin'), async (req, res, next) => {
  try {
    const task = await UserCheckin.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ error: 'check-in task not found' });
    emit(req, 'checkin:deleted', { id: req.params.id }); res.status(204).send();
  } catch (error) { next(error); }
});
module.exports = router;
