const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');
const { signToken } = require('../utils/jwt');

const router = express.Router();

function normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function toPublicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active,
    };
}

router.post('/register', async (req, res, next) => {
    try {
        const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        const email = normalizeEmail(req.body.email);
        const password = typeof req.body.password === 'string' ? req.body.password : '';

        if (!name || !email || password.length < 6) {
            return res.status(400).json({ error: 'name, email and password(min 6 chars) are required' });
        }

        const existing = await User.findOne({ email }).lean();
        if (existing) {
            return res.status(409).json({ error: 'email already exists' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await User.create({ name, email, passwordHash, role: 'user', active: true });
        const token = signToken(user);

        return res.status(201).json({ token, user: toPublicUser(user) });
    } catch (error) {
        return next(error);
    }
});

router.post('/login', async (req, res, next) => {
    try {
        const email = normalizeEmail(req.body.email);
        const password = typeof req.body.password === 'string' ? req.body.password : '';

        if (!email || !password) {
            return res.status(400).json({ error: 'email and password are required' });
        }

        const user = await User.findOne({ email });
        if (!user || !user.active) {
            return res.status(401).json({ error: 'invalid credentials' });
        }

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
            return res.status(401).json({ error: 'invalid credentials' });
        }

        const token = signToken(user);
        return res.json({ token, user: toPublicUser(user) });
    } catch (error) {
        return next(error);
    }
});

router.get('/me', authenticate, async (req, res) => {
    return res.json({ user: toPublicUser(req.user) });
});

module.exports = router;
