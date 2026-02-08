const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

// Verify JWT token from cookie
function authRequired(req, res, next) {
    const token = req.cookies?.token;
    if (!token) return res.redirect('/login');

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.clearCookie('token');
        return res.redirect('/login');
    }
}

// Role-based access
function roleRequired(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).send('Access denied');
        }
        next();
    };
}

// API auth (returns JSON instead of redirect)
function apiAuth(req, res, next) {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// Log activity
async function logActivity(userId, action, entityType, entityId, details) {
    try {
        await pool.query(
            'INSERT INTO activity_log (user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
            [userId, action, entityType, entityId, details]
        );
    } catch (err) {
        console.error('Activity log error:', err.message);
    }
}

module.exports = { authRequired, roleRequired, apiAuth, logActivity };
