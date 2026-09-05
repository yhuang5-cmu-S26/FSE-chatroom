const express = require('express');
const Post = require('../models/Post');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.post('/', async (req, res, next) => {
  try {
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    if (!content || content.length > 2000) return res.status(400).json({ error: 'content must be 1-2000 characters' });
    const post = await Post.create({ authorId: req.user.id, authorName: req.user.name, content });
    const payload = post.toObject();
    req.app.locals.io?.emit('post:created', payload);
    res.status(201).json(payload);
  } catch (error) { next(error); }
});

router.get('/', async (_req, res, next) => {
  try { res.json(await Post.find().sort({ createdAt: -1 }).limit(100).lean()); }
  catch (error) { next(error); }
});
module.exports = router;
