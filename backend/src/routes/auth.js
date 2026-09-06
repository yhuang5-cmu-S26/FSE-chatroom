const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Relationship = require('../models/Relationship');
const { authenticate } = require('../middleware/auth');
const { signToken } = require('../utils/jwt');

const router = express.Router();

function normalizeEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}
function normalizeUsername(name) {
    return typeof name === 'string' ? name.trim() : '';
}
function usernameKey(name) {
    return normalizeUsername(name).toLowerCase();
}

async function findUserByUsername(name) {
    const normalized = usernameKey(name);
    if (!normalized) return null;
    const indexed = await User.findOne({ usernameKey: normalized });
    if (indexed) return indexed;
    const users = await User.find().select('name email passwordHash role active').lean();
    const found = users.find((user) => String(user.name || '').trim().toLowerCase() === normalized);
    return found ? await User.findById(found._id) : null;
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

router.post('/enter', async (req, res, next) => {
    try {
        const name = normalizeUsername(req.body.name);
        const email = normalizeEmail(req.body.email);
        const password = typeof req.body.password === 'string' ? req.body.password : '';

        if (!name || password.length < 6) return res.status(400).json({ error: 'username and password(min 6 chars) are required' });
        const existing = await findUserByUsername(name);
        if (existing) {
            const ok = await bcrypt.compare(password, existing.passwordHash);
            if (!ok || !existing.active) return res.status(401).json({ error: 'invalid credentials' });
            return res.json({ token: signToken(existing), user: toPublicUser(existing), created: false });
        }

        if (!email) return res.status(400).json({ error: 'email is required for a new username' });
        const emailOwner = await User.findOne({ email });
        if (emailOwner) return res.status(409).json({ error: 'email already belongs to another username' });

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await User.create({ name, usernameKey: usernameKey(name), email, passwordHash, role: 'user', active: true });
        const others = await User.find({ _id: { $ne: user._id } }).select('_id').lean();
        if (others.length) {
            const userId = String(user._id);
            await Relationship.bulkWrite(others.map((other) => {
                const otherId = String(other._id);
                return { updateOne: { filter: { userLow: userId < otherId ? user._id : other._id, userHigh: userId < otherId ? other._id : user._id }, update: { $setOnInsert: { status: 'accepted' } }, upsert: true } };
            }));
        }
        const token = signToken(user);
        req.app.locals.io?.emit('network:user-added', { user: toPublicUser(user) });
        return res.status(201).json({ token, user: toPublicUser(user), created: true });
    } catch (error) {
        return next(error);
    }
});

router.post('/register', (req, res, next) => { req.url = '/enter'; router.handle(req, res, next); });

router.post('/login', async (req, res, next) => {
    try {
        const name = normalizeUsername(req.body.name);
        const password = typeof req.body.password === 'string' ? req.body.password : '';

        if (!name || !password) {
            return res.status(400).json({ error: 'username and password are required' });
        }

        const user = await findUserByUsername(name);
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
