require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { pool, initDB } = require('./config/database');
const { authRequired, roleRequired, apiAuth, logActivity } = require('./middleware/auth');
const bcrypt = require('bcryptjs');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Security headers
app.use(helmet({
    contentSecurityPolicy: false,         // Admin uses inline scripts/styles
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false      // Allow website to load images from /uploads/
}));

// Explicitly set CORP header for uploads to allow cross-origin access
app.use('/uploads', (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
});

// Middleware
app.use(express.json({ limit: '10mb' }));

// CORS for public API endpoints (maintenance check from website)
app.use('/api/public', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// View engine
app.set('views', path.join(__dirname, 'views'));

// Helper: serve HTML page file
function servePage(res, page) {
    res.sendFile(path.join(__dirname, 'views', 'pages', page + '.html'));
}

// Helper: serve universal studio with injected CPT config
let _studioHtml = null;
function serveStudio(res, config) {
    const studioPath = path.join(__dirname, 'views', 'pages', 'studio.html');
    try {
        if (!_studioHtml || process.env.NODE_ENV !== 'production') {
            _studioHtml = fs.readFileSync(studioPath, 'utf8');
        }
        const adminUrl = process.env.ADMIN_URL || 'https://enter.ginger.healthcare';
        const injection = `<script>\nwindow.CPT_CONFIG = ${JSON.stringify(config)};\nwindow.ADMIN_URL = ${JSON.stringify(adminUrl)};\n</script>`;
        const html = _studioHtml.replace('</head>', injection + '\n</head>');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch(err) {
        console.error('[serveStudio] Failed to read studio.html:', err.message);
        res.status(500).send('Studio template not found. Make sure views/pages/studio.html exists.');
    }
}

// Shared context passed to all route modules
const ctx = { authRequired, apiAuth, roleRequired, logActivity, servePage, serveStudio, rootDir: __dirname };

// ============== ROUTE MODULES ==============
// Each file is independent — editing one cannot break another

require('./routes/auth')(app, pool, ctx);
require('./routes/dashboard')(app, pool, ctx);
require('./routes/blog')(app, pool, ctx);
require('./routes/testimonials')(app, pool, ctx);
require('./routes/videos')(app, pool, ctx);
require('./routes/hospitals')(app, pool, ctx);
require('./routes/airports')(app, pool, ctx);
require('./routes/doctors')(app, pool, ctx);
require('./routes/submissions')(app, pool, ctx);
require('./routes/pages')(app, pool, ctx);
require('./routes/media')(app, pool, ctx);
require('./routes/users')(app, pool, ctx);
require('./routes/specialties')(app, pool, ctx);
require('./routes/treatments')(app, pool, ctx);
require('./routes/destinations')(app, pool, ctx);
require('./routes/d-specialties')(app, pool, ctx);
require('./routes/d-treatments')(app, pool, ctx);
require('./routes/costs')(app, pool, ctx);
require('./routes/ai')(app, pool, ctx);
require('./routes/settings')(app, pool, ctx);

// ============== STARTUP ==============
async function startServer() {
    try {
        await initDB();

        // Create default super admin if no users exist
        const users = await pool.query('SELECT COUNT(*) FROM users');
        if (parseInt(users.rows[0].count) === 0) {
            const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 12);
            await pool.query(
                'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)',
                ['Super Admin', process.env.ADMIN_EMAIL || 'admin@ginger.healthcare', hashed, 'super_admin']
            );
            console.log('✅ Default super admin created');
        }

        app.listen(PORT, () => {
            console.log(`🚀 Ginger Admin Dashboard running on port ${PORT}`);
            console.log(`📁 20 route modules loaded`);
        });
    } catch (err) {
        console.error('❌ Startup error:', err);
        process.exit(1);
    }
}

startServer();
