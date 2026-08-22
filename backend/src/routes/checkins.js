const express = require('express');
const UserCheckin = require('../models/UserCheckin');

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { name, role, status } = req.body;
    if (!name || !role || !status) {
      return res.status(400).json({ error: 'name, role, and status are required' });
    }

    const checkin = await UserCheckin.create({ name, role, status });
    return res.status(201).json(checkin);
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (_req, res, next) => {
  try {
    const checkins = await UserCheckin.find().sort({ createdAt: -1 }).limit(100);
    return res.json(checkins);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
