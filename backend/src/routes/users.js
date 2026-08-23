const express = require('express');
const User = require('../models/User');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const validRoles = new Set(['user', 'dispatcher', 'admin']);

router.get('/', authenticate, authorize('admin', 'dispatcher'), async (_req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).limit(200).select('-passwordHash');
    res.json(users);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/role', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!validRoles.has(role)) return res.status(400).json({ error: 'invalid role' });
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'user not found' });
    res.json(user);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/active', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { active } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { active: Boolean(active) }, { new: true }).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'user not found' });
    res.json(user);
  } catch (error) {
    next(error);
  }
});

module.exports = router;