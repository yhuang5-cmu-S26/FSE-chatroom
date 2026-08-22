const express = require('express');
const Location = require('../models/Location');

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { name, role, latitude, longitude, note } = req.body;
    if (!name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'name, latitude, and longitude are required' });
    }

    const location = await Location.create({
      name,
      role,
      latitude,
      longitude,
      note,
    });

    return res.status(201).json(location);
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (_req, res, next) => {
  try {
    const locations = await Location.find().sort({ createdAt: -1 }).limit(200);
    return res.json(locations);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
