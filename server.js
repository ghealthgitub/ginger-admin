require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { pool, initDB } = require('./config/database');
const { authRequired, roleRequired, apiAuth, logActivity } = require('./middleware/auth');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

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

// View engine (simple HTML serving)
app.set('views', path.join(__dirname, 'views'));

// Helper: serve HTML file with user data injected
function servePage(res, page, user, data = {}) {
    res.sendFile(path.join(__dirname, 'views', 'pages', page + '.html'));
}

// ============== AUTH ROUTES ==============

// Login page
app.get('/login', (req, res) => {
    if (req.cookies?.token) {
        try { jwt.verify(req.cookies.token, process.env.JWT_SECRET); return res.redirect('/'); }
        catch(e) { res.clearCookie('token'); }
    }
    res.sendFile(path.join(__dirname, 'views', 'pages', 'login.html'));
});

// Login API
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign(
            { id: user.id, email: user.email, name: user.name, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
        await logActivity(user.id, 'login', 'user', user.id, 'User logged in');

        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Logout
app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

// Get current user
app.get('/api/auth/me', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, email, role, avatar, last_login FROM users WHERE id = $1', [req.user.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============== DASHBOARD ==============
app.get('/', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'unified-dashboard.html'));
});

// COMBINED init endpoint - returns everything the dashboard needs in ONE call
app.get('/api/dashboard/init', apiAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const [userResult, posts, testimonials, hospitals, doctors, submissions, newSubs, settings] = await Promise.all([
            pool.query('SELECT id, name, email, role, avatar, last_login FROM users WHERE id = $1', [userId]),
            pool.query("SELECT COUNT(*) FROM blog_posts"),
            pool.query("SELECT COUNT(*) FROM testimonials"),
            pool.query("SELECT COUNT(*) FROM hospitals"),
            pool.query("SELECT COUNT(*) FROM doctors"),
            pool.query("SELECT COUNT(*) FROM submissions"),
            pool.query("SELECT COUNT(*) FROM submissions WHERE status = 'new'"),
            pool.query("SELECT * FROM page_content WHERE page = 'master'")
        ]);
        res.json({
            user: userResult.rows[0],
            stats: {
                blog_posts: parseInt(posts.rows[0].count),
                testimonials: parseInt(testimonials.rows[0].count),
                hospitals: parseInt(hospitals.rows[0].count),
                doctors: parseInt(doctors.rows[0].count),
                total_submissions: parseInt(submissions.rows[0].count),
                new_submissions: parseInt(newSubs.rows[0].count)
            },
            settings: settings.rows
        });
    } catch (err) {
        console.error('Dashboard init error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Dashboard stats API
app.get('/api/dashboard/stats', apiAuth, async (req, res) => {
    try {
        const [posts, testimonials, hospitals, doctors, submissions, newSubs] = await Promise.all([
            pool.query("SELECT COUNT(*) FROM blog_posts"),
            pool.query("SELECT COUNT(*) FROM testimonials"),
            pool.query("SELECT COUNT(*) FROM hospitals"),
            pool.query("SELECT COUNT(*) FROM doctors"),
            pool.query("SELECT COUNT(*) FROM submissions"),
            pool.query("SELECT COUNT(*) FROM submissions WHERE status = 'new'")
        ]);
        res.json({
            blog_posts: parseInt(posts.rows[0].count),
            testimonials: parseInt(testimonials.rows[0].count),
            hospitals: parseInt(hospitals.rows[0].count),
            doctors: parseInt(doctors.rows[0].count),
            total_submissions: parseInt(submissions.rows[0].count),
            new_submissions: parseInt(newSubs.rows[0].count)
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Recent activity
app.get('/api/dashboard/activity', apiAuth, async (req, res) => {
    try {
        const { page = 1, limit = 50, user_id, action, entity_type } = req.query;
        const offset = (page - 1) * limit;
        let where = [];
        let params = [];
        let i = 1;
        if (user_id) { where.push(`al.user_id = $${i++}`); params.push(user_id); }
        if (action) { where.push(`al.action = $${i++}`); params.push(action); }
        if (entity_type) { where.push(`al.entity_type = $${i++}`); params.push(entity_type); }
        const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const countResult = await pool.query(`SELECT COUNT(*) FROM activity_log al ${whereClause}`, params);
        const total = parseInt(countResult.rows[0].count);
        params.push(limit, offset);
        const result = await pool.query(
            `SELECT al.*, u.name as user_name, u.email as user_email, u.role as user_role FROM activity_log al
             LEFT JOIN users u ON al.user_id = u.id
             ${whereClause}
             ORDER BY al.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
            params
        );
        res.json({ activities: result.rows, total, page: parseInt(page), pages: Math.ceil(total / limit) });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============== BLOG POSTS CRUD ==============
app.get('/blog', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'blog.html'));
});
app.get('/blog/new', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'blog-studio.html'));
});
app.get('/blog/edit/:id', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'blog-studio.html'));
});
app.get('/blog/claude/:id', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'blog-studio.html'));
});

app.get('/api/blog', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT bp.*, u.name as author_name FROM blog_posts bp
             LEFT JOIN users u ON bp.author_id = u.id
             ORDER BY bp.created_at DESC`
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/blog/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM blog_posts WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/blog', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { title, slug, excerpt, content, cover_image, category, tags, status, read_time, meta_title, meta_description, focus_keywords } = req.body;
        const tagsArray = Array.isArray(tags) ? tags : [];
        const readTimeVal = read_time ? parseInt(read_time) || null : null;
        const result = await pool.query(
            `INSERT INTO blog_posts (title, slug, excerpt, content, cover_image, category, tags, status, read_time, author_id, meta_title, meta_description, focus_keywords, published_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            [title, slug, excerpt || null, content || null, cover_image || null, category || null, tagsArray, status || 'draft', readTimeVal, req.user.id, meta_title || null, meta_description || null, focus_keywords || null, status === 'published' ? new Date() : null]
        );
        await logActivity(req.user.id, 'create', 'blog_post', result.rows[0].id, `Created: ${title}`);
        res.json(result.rows[0]);
    } catch (err) { console.error('Blog POST error:', err.message); res.status(500).json({ error: err.message }); }
});

app.put('/api/blog/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { title, slug, excerpt, content, cover_image, category, tags, status, read_time, meta_title, meta_description, focus_keywords } = req.body;
        const tagsArray = Array.isArray(tags) ? tags : [];
        const readTimeVal = read_time ? parseInt(read_time) || null : null;
        const pubStatus = status || 'draft';
        const result = await pool.query(
            `UPDATE blog_posts SET title=$1, slug=$2, excerpt=$3, content=$4, cover_image=$5, category=$6, tags=$7::text[], status=$8, read_time=$9, meta_title=$10, meta_description=$11, focus_keywords=$12, published_at = CASE WHEN $13='published' AND published_at IS NULL THEN NOW() ELSE published_at END, updated_at=NOW()
             WHERE id=$14 RETURNING *`,
            [title, slug, excerpt || null, content || null, cover_image || null, category || null, tagsArray, pubStatus, readTimeVal, meta_title || null, meta_description || null, focus_keywords || null, pubStatus, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'blog_post', req.params.id, `Updated: ${title}`);
        res.json(result.rows[0]);
    } catch (err) { console.error('Blog PUT error:', err.message); res.status(500).json({ error: err.message }); }
});

app.delete('/api/blog/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM blog_posts WHERE id = $1', [req.params.id]);
        await logActivity(req.user.id, 'delete', 'blog_post', parseInt(req.params.id), 'Deleted blog post');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============== TESTIMONIALS CRUD ==============
app.get('/testimonials', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'testimonials.html'));
});

app.get('/api/testimonials', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM testimonials ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/testimonials', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { patient_name, patient_country, patient_flag, treatment, specialty, destination, rating, quote, avatar_color, is_featured, status } = req.body;
        const result = await pool.query(
            `INSERT INTO testimonials (patient_name, patient_country, patient_flag, treatment, specialty, destination, rating, quote, avatar_color, is_featured, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [patient_name, patient_country, patient_flag, treatment, specialty, destination, rating || 5, quote, avatar_color, is_featured || false, status || 'draft']
        );
        await logActivity(req.user.id, 'create', 'testimonial', result.rows[0].id, `Created testimonial: ${patient_name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/testimonials/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { patient_name, patient_country, patient_flag, treatment, specialty, destination, rating, quote, avatar_color, is_featured, status } = req.body;
        const result = await pool.query(
            `UPDATE testimonials SET patient_name=$1, patient_country=$2, patient_flag=$3, treatment=$4, specialty=$5, destination=$6, rating=$7, quote=$8, avatar_color=$9, is_featured=$10, status=$11, updated_at=NOW()
             WHERE id=$12 RETURNING *`,
            [patient_name, patient_country, patient_flag, treatment, specialty, destination, rating, quote, avatar_color, is_featured, status, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'testimonial', req.params.id, `Updated: ${patient_name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/testimonials/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM testimonials WHERE id = $1', [req.params.id]);
        await logActivity(req.user.id, 'delete', 'testimonial', parseInt(req.params.id), 'Deleted testimonial');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============== HOSPITALS CRUD ==============
app.get('/hospitals', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'hospitals.html'));
});

app.get('/api/hospitals', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hospitals ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/hospitals', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, country, city, address, description, long_description, accreditations, specialties, beds, established, image, rating, is_featured, status } = req.body;
        const result = await pool.query(
            `INSERT INTO hospitals (name, slug, country, city, address, description, long_description, accreditations, specialties, beds, established, image, rating, is_featured, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
            [name, slug, country, city, address, description, long_description, accreditations || [], specialties || [], beds, established, image, rating, is_featured || false, status || 'draft']
        );
        await logActivity(req.user.id, 'create', 'hospital', result.rows[0].id, `Created: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/hospitals/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, country, city, address, description, long_description, accreditations, specialties, beds, established, image, rating, is_featured, status } = req.body;
        const result = await pool.query(
            `UPDATE hospitals SET name=$1, slug=$2, country=$3, city=$4, address=$5, description=$6, long_description=$7, accreditations=$8, specialties=$9, beds=$10, established=$11, image=$12, rating=$13, is_featured=$14, status=$15, updated_at=NOW()
             WHERE id=$16 RETURNING *`,
            [name, slug, country, city, address, description, long_description, accreditations || [], specialties || [], beds, established, image, rating, is_featured, status, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'hospital', req.params.id, `Updated: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/hospitals/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM hospitals WHERE id = $1', [req.params.id]);
        await logActivity(req.user.id, 'delete', 'hospital', parseInt(req.params.id), 'Deleted hospital');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============== DOCTORS CRUD ==============
app.get('/doctors', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'doctors.html'));
});

app.get('/api/doctors', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT d.*, h.name as hospital_name FROM doctors d
             LEFT JOIN hospitals h ON d.hospital_id = h.id
             ORDER BY d.name ASC`
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/doctors', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, title, specialty, hospital_id, country, experience_years, qualifications, description, long_description, image, languages, is_featured, status } = req.body;
        const result = await pool.query(
            `INSERT INTO doctors (name, slug, title, specialty, hospital_id, country, experience_years, qualifications, description, long_description, image, languages, is_featured, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            [name, slug, title, specialty, hospital_id, country, experience_years, qualifications || [], description, long_description, image, languages || [], is_featured || false, status || 'draft']
        );
        await logActivity(req.user.id, 'create', 'doctor', result.rows[0].id, `Created: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/doctors/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, title, specialty, hospital_id, country, experience_years, qualifications, description, long_description, image, languages, is_featured, status } = req.body;
        const result = await pool.query(
            `UPDATE doctors SET name=$1, slug=$2, title=$3, specialty=$4, hospital_id=$5, country=$6, experience_years=$7, qualifications=$8, description=$9, long_description=$10, image=$11, languages=$12, is_featured=$13, status=$14, updated_at=NOW()
             WHERE id=$15 RETURNING *`,
            [name, slug, title, specialty, hospital_id, country, experience_years, qualifications || [], description, long_description, image, languages || [], is_featured, status, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'doctor', req.params.id, `Updated: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/doctors/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM doctors WHERE id = $1', [req.params.id]);
        await logActivity(req.user.id, 'delete', 'doctor', parseInt(req.params.id), 'Deleted doctor');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============== SUBMISSIONS ==============
app.get('/submissions', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'submissions.html'));
});

app.get('/api/submissions', apiAuth, async (req, res) => {
    try {
        const { type, status } = req.query;
        let query = 'SELECT s.*, u.name as assigned_name FROM submissions s LEFT JOIN users u ON s.assigned_to = u.id WHERE 1=1';
        const params = [];
        if (type) { params.push(type); query += ` AND s.form_type = $${params.length}`; }
        if (status) { params.push(status); query += ` AND s.status = $${params.length}`; }
        query += ' ORDER BY s.created_at DESC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/submissions/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { status, notes, assigned_to } = req.body;
        const result = await pool.query(
            'UPDATE submissions SET status=$1, notes=$2, assigned_to=$3, updated_at=NOW() WHERE id=$4 RETURNING *',
            [status, notes, assigned_to, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'submission', req.params.id, `Status: ${status}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Public submission endpoint (for website forms)
app.post('/api/public/submit', async (req, res) => {
    try {
        const { form_type, name, email, phone, country, treatment, message, form_data } = req.body;
        const result = await pool.query(
            `INSERT INTO submissions (form_type, name, email, phone, country, treatment, message, form_data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [form_type, name, email, phone, country, treatment, message, form_data ? JSON.stringify(form_data) : null]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) { res.status(500).json({ error: 'Submission failed' }); }
});

// ============== MAINTENANCE MODE ==============
// Get maintenance status (public - called by website)
app.get('/api/public/maintenance', async (req, res) => {
    try {
        // Set CORS headers so the website can call this
        res.header('Access-Control-Allow-Origin', '*');
        const result = await pool.query("SELECT field_value FROM page_content WHERE page='site' AND section='settings' AND field_key='maintenance_mode'");
        const isEnabled = result.rows.length > 0 && result.rows[0].field_value === 'true';
        res.json({ maintenance: isEnabled });
    } catch (err) {
        res.json({ maintenance: false });
    }
});

// Toggle maintenance mode (admin only)
app.put('/api/maintenance/toggle', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const { enabled } = req.body;
        await pool.query(
            `INSERT INTO page_content (page, section, field_key, field_value, field_type, updated_by)
             VALUES ('site','settings','maintenance_mode',$1,'text',$2)
             ON CONFLICT (page, section, field_key) DO UPDATE SET field_value=$1, updated_by=$2, updated_at=NOW()`,
            [enabled ? 'true' : 'false', req.user.id]
        );
        await logActivity(req.user.id, enabled ? 'enable' : 'disable', 'maintenance', null, 'Maintenance mode ' + (enabled ? 'ON' : 'OFF'));
        res.json({ success: true, maintenance: enabled });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get maintenance status (admin)
app.get('/api/maintenance/status', apiAuth, async (req, res) => {
    try {
        const result = await pool.query("SELECT field_value FROM page_content WHERE page='site' AND section='settings' AND field_key='maintenance_mode'");
        const isEnabled = result.rows.length > 0 && result.rows[0].field_value === 'true';
        res.json({ maintenance: isEnabled });
    } catch (err) { res.json({ maintenance: false }); }
});

// ============== PAGE CONTENT ==============
app.get('/page-content', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'page-content.html'));
});

app.get('/api/page-content', apiAuth, async (req, res) => {
    try {
        const { page } = req.query;
        const query = page ? 'SELECT * FROM page_content WHERE page = $1 ORDER BY section, field_key' : 'SELECT * FROM page_content ORDER BY page, section, field_key';
        const result = await pool.query(query, page ? [page] : []);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/page-content', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { page, section, field_key, field_value, field_type } = req.body;
        const result = await pool.query(
            `INSERT INTO page_content (page, section, field_key, field_value, field_type, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (page, section, field_key) DO UPDATE SET field_value=$4, field_type=$5, updated_by=$6, updated_at=NOW()
             RETURNING *`,
            [page, section, field_key, field_value, field_type || 'text', req.user.id]
        );
        await logActivity(req.user.id, 'update', 'page_content', result.rows[0].id, `${page}/${section}/${field_key}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============== MEDIA UPLOAD ==============
app.get('/media', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'media.html'));
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, unique + ext);
    }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|svg|pdf/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
}});

app.get('/api/media', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM media ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/media/upload', apiAuth, roleRequired('super_admin', 'editor'), upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const url = `/uploads/${req.file.filename}`;
        const result = await pool.query(
            'INSERT INTO media (filename, original_name, mime_type, size, url, folder, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
            [req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, url, req.body.folder || 'general', req.user.id]
        );
        await logActivity(req.user.id, 'upload', 'media', result.rows[0].id, `Uploaded: ${req.file.originalname}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/media/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const file = await pool.query('SELECT * FROM media WHERE id = $1', [req.params.id]);
        if (file.rows.length > 0) {
            const fs = require('fs');
            const filepath = path.join(__dirname, file.rows[0].url);
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
            await pool.query('DELETE FROM media WHERE id = $1', [req.params.id]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============== USERS MANAGEMENT ==============
app.get('/users', authRequired, roleRequired('super_admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'users.html'));
});

app.get('/api/users', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, email, role, is_active, last_login, created_at FROM users ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/users', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        const hashed = await bcrypt.hash(password, 12);
        const result = await pool.query(
            'INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role',
            [name, email, hashed, role || 'editor']
        );
        await logActivity(req.user.id, 'create', 'user', result.rows[0].id, `Created user: ${email}`);
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Email already exists' });
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/users/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const { name, email, role, is_active, password } = req.body;
        if (password) {
            const hashed = await bcrypt.hash(password, 12);
            await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hashed, req.params.id]);
        }
        const result = await pool.query(
            'UPDATE users SET name=$1, email=$2, role=$3, is_active=$4, updated_at=NOW() WHERE id=$5 RETURNING id, name, email, role, is_active',
            [name, email, role, is_active, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============== SPECIALTIES CRUD ==============
app.get('/specialties-mgmt', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'specialties.html'));
});

app.get('/api/specialties', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM specialties ORDER BY display_order ASC, name ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/specialties/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM specialties WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/specialties', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, icon, category, description, long_description, treatment_count, image, is_featured, display_order, meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `INSERT INTO specialties (name, slug, icon, category, description, long_description, treatment_count, image, is_featured, display_order, meta_title, meta_description, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [name, slug, icon, category, description, long_description, treatment_count || 0, image, is_featured || false, display_order || 0, meta_title, meta_description, status || 'draft']
        );
        await logActivity(req.user.id, 'create', 'specialty', result.rows[0].id, `Created: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/specialties/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, icon, category, description, long_description, treatment_count, image, is_featured, display_order, meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `UPDATE specialties SET name=$1, slug=$2, icon=$3, category=$4, description=$5, long_description=$6, treatment_count=$7, image=$8, is_featured=$9, display_order=$10, meta_title=$11, meta_description=$12, status=$13, updated_at=NOW()
             WHERE id=$14 RETURNING *`,
            [name, slug, icon, category, description, long_description, treatment_count, image, is_featured, display_order, meta_title, meta_description, status, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'specialty', req.params.id, `Updated: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/specialties/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM specialties WHERE id = $1', [req.params.id]);
        await logActivity(req.user.id, 'delete', 'specialty', parseInt(req.params.id), 'Deleted specialty');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============== TREATMENTS CRUD ==============
app.get('/treatments', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'treatments.html'));
});

app.get('/api/treatments', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT t.*, s.name as specialty_name FROM treatments t
             LEFT JOIN specialties s ON t.specialty_id = s.id
             ORDER BY s.name ASC, t.name ASC`
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/treatments', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, specialty_id, description, long_description, duration, recovery_time, success_rate, cost_range_usd, image, is_featured, meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `INSERT INTO treatments (name, slug, specialty_id, description, long_description, duration, recovery_time, success_rate, cost_range_usd, image, is_featured, meta_title, meta_description, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            [name, slug, specialty_id, description, long_description, duration, recovery_time, success_rate, cost_range_usd, image, is_featured || false, meta_title, meta_description, status || 'draft']
        );
        await logActivity(req.user.id, 'create', 'treatment', result.rows[0].id, `Created: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/treatments/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, specialty_id, description, long_description, duration, recovery_time, success_rate, cost_range_usd, image, is_featured, meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `UPDATE treatments SET name=$1, slug=$2, specialty_id=$3, description=$4, long_description=$5, duration=$6, recovery_time=$7, success_rate=$8, cost_range_usd=$9, image=$10, is_featured=$11, meta_title=$12, meta_description=$13, status=$14, updated_at=NOW()
             WHERE id=$15 RETURNING *`,
            [name, slug, specialty_id, description, long_description, duration, recovery_time, success_rate, cost_range_usd, image, is_featured, meta_title, meta_description, status, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'treatment', req.params.id, `Updated: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/treatments/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM treatments WHERE id = $1', [req.params.id]);
        await logActivity(req.user.id, 'delete', 'treatment', parseInt(req.params.id), 'Deleted treatment');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============== DESTINATIONS CRUD ==============
app.get('/destinations-mgmt', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'destinations.html'));
});

app.get('/api/destinations', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM destinations ORDER BY display_order ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/destinations', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, flag, tagline, description, long_description, why_choose, image, hospital_count, doctor_count, avg_savings, visa_info, travel_info, language, currency, is_featured, display_order, meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `INSERT INTO destinations (name, slug, flag, tagline, description, long_description, why_choose, image, hospital_count, doctor_count, avg_savings, visa_info, travel_info, language, currency, is_featured, display_order, meta_title, meta_description, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
            [name, slug, flag, tagline, description, long_description, why_choose, image, hospital_count, doctor_count, avg_savings, visa_info, travel_info, language, currency, is_featured || false, display_order || 0, meta_title, meta_description, status || 'draft']
        );
        await logActivity(req.user.id, 'create', 'destination', result.rows[0].id, `Created: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/destinations/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { name, slug, flag, tagline, description, long_description, why_choose, image, hospital_count, doctor_count, avg_savings, visa_info, travel_info, language, currency, is_featured, display_order, meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `UPDATE destinations SET name=$1, slug=$2, flag=$3, tagline=$4, description=$5, long_description=$6, why_choose=$7, image=$8, hospital_count=$9, doctor_count=$10, avg_savings=$11, visa_info=$12, travel_info=$13, language=$14, currency=$15, is_featured=$16, display_order=$17, meta_title=$18, meta_description=$19, status=$20, updated_at=NOW()
             WHERE id=$21 RETURNING *`,
            [name, slug, flag, tagline, description, long_description, why_choose, image, hospital_count, doctor_count, avg_savings, visa_info, travel_info, language, currency, is_featured, display_order, meta_title, meta_description, status, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'destination', req.params.id, `Updated: ${name}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/destinations/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM destinations WHERE id = $1', [req.params.id]);
        await logActivity(req.user.id, 'delete', 'destination', parseInt(req.params.id), 'Deleted destination');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============== TREATMENT COSTS CRUD ==============
app.get('/costs', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'costs.html'));
});

app.get('/api/costs', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT tc.*, t.name as treatment_name, d.name as destination_name, d.flag as destination_flag
             FROM treatment_costs tc
             LEFT JOIN treatments t ON tc.treatment_id = t.id
             LEFT JOIN destinations d ON tc.destination_id = d.id
             ORDER BY t.name, d.display_order`
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/costs', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { treatment_id, destination_id, cost_min_usd, cost_max_usd, cost_local, includes, hospital_stay, notes } = req.body;
        const result = await pool.query(
            `INSERT INTO treatment_costs (treatment_id, destination_id, cost_min_usd, cost_max_usd, cost_local, includes, hospital_stay, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [treatment_id, destination_id, cost_min_usd, cost_max_usd, cost_local, includes, hospital_stay, notes]
        );
        await logActivity(req.user.id, 'create', 'cost', result.rows[0].id, 'Created cost entry');
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/costs/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { treatment_id, destination_id, cost_min_usd, cost_max_usd, cost_local, includes, hospital_stay, notes } = req.body;
        const result = await pool.query(
            `UPDATE treatment_costs SET treatment_id=$1, destination_id=$2, cost_min_usd=$3, cost_max_usd=$4, cost_local=$5, includes=$6, hospital_stay=$7, notes=$8, updated_at=NOW()
             WHERE id=$9 RETURNING *`,
            [treatment_id, destination_id, cost_min_usd, cost_max_usd, cost_local, includes, hospital_stay, notes, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/costs/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM treatment_costs WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============== STATIC PAGES CRUD ==============
app.get('/static-pages', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'static-pages.html'));
});

app.get('/api/static-pages', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM static_pages ORDER BY page_type, title');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/static-pages/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM static_pages WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/static-pages/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { title, hero_title, hero_description, content, meta_title, meta_description, status } = req.body;
        const result = await pool.query(
            `UPDATE static_pages SET title=$1, hero_title=$2, hero_description=$3, content=$4, meta_title=$5, meta_description=$6, status=$7, updated_by=$8, updated_at=NOW()
             WHERE id=$9 RETURNING *`,
            [title, hero_title, hero_description, content, meta_title, meta_description, status, req.user.id, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'static_page', req.params.id, `Updated: ${title}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============== SEED ENDPOINT (run once) ==============

// Simple seed page - just visit /seed in browser
app.get('/seed', authRequired, async (req, res) => {
    res.send(`<html><head><title>Seed Database</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#0B2545;color:#fff;text-align:center}.box{background:#fff;color:#333;padding:40px;border-radius:16px;max-width:500px}h1{color:#F26522}button{background:#F26522;color:#fff;border:none;padding:14px 32px;border-radius:8px;font-size:1rem;cursor:pointer;font-weight:700;margin-top:16px}button:hover{background:#d9531e}#result{margin-top:16px;padding:12px;border-radius:8px;display:none}</style></head><body><div class="box"><h1>🌱 Seed Database</h1><p>This will populate your database with 28 specialties, 23 treatments, 5 destinations, 10 hospitals, 5 doctors, 5 testimonials, and 13 static pages.</p><button onclick="runSeed()">🚀 Seed Now</button><div id="result"></div></div><script>async function runSeed(){const r=document.getElementById('result');r.style.display='block';r.style.background='#FEF3C7';r.textContent='⏳ Seeding... please wait...';try{const res=await fetch('/api/admin/seed',{method:'POST'});const d=await res.json();if(d.success){r.style.background='#D1FAE5';r.innerHTML='✅ '+d.message+'<br><br><a href="/">← Back to Dashboard</a>'}else{r.style.background='#FEE2E2';r.textContent='❌ Error: '+(d.error||'Unknown')}}catch(e){r.style.background='#FEE2E2';r.textContent='❌ '+e}}</script></body></html>`);
});

app.post('/api/admin/seed', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        // Run seed inline
        const { execSync } = require('child_process');
        execSync('node config/seed.js', { cwd: __dirname, env: process.env });
        await logActivity(req.user.id, 'seed', 'database', null, 'Database seeded with initial content');
        res.json({ success: true, message: 'Database seeded successfully!' });
    } catch (err) {
        res.status(500).json({ error: 'Seed failed: ' + err.message });
    }
});

// ============== UPDATED DASHBOARD STATS ==============
// Override the original stats route with expanded version
app.get('/api/dashboard/stats-full', apiAuth, async (req, res) => {
    try {
        const [posts, testimonials, hospitals, doctors, submissions, newSubs, specialties, treatments, destinations, costs, pages] = await Promise.all([
            pool.query("SELECT COUNT(*) FROM blog_posts"),
            pool.query("SELECT COUNT(*) FROM testimonials"),
            pool.query("SELECT COUNT(*) FROM hospitals"),
            pool.query("SELECT COUNT(*) FROM doctors"),
            pool.query("SELECT COUNT(*) FROM submissions"),
            pool.query("SELECT COUNT(*) FROM submissions WHERE status = 'new'"),
            pool.query("SELECT COUNT(*) FROM specialties"),
            pool.query("SELECT COUNT(*) FROM treatments"),
            pool.query("SELECT COUNT(*) FROM destinations"),
            pool.query("SELECT COUNT(*) FROM treatment_costs"),
            pool.query("SELECT COUNT(*) FROM static_pages"),
        ]);
        res.json({
            blog_posts: parseInt(posts.rows[0].count),
            testimonials: parseInt(testimonials.rows[0].count),
            hospitals: parseInt(hospitals.rows[0].count),
            doctors: parseInt(doctors.rows[0].count),
            total_submissions: parseInt(submissions.rows[0].count),
            new_submissions: parseInt(newSubs.rows[0].count),
            specialties: parseInt(specialties.rows[0].count),
            treatments: parseInt(treatments.rows[0].count),
            destinations: parseInt(destinations.rows[0].count),
            treatment_costs: parseInt(costs.rows[0].count),
            static_pages: parseInt(pages.rows[0].count),
        });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ============== CLAUDE AI ASSISTANT ==============
app.get('/ai-assistant', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'ai-assistant.html'));
});

app.post('/api/ai/generate', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { prompt, type, context } = req.body;

        const systemPrompts = {
            blog: "You are a medical tourism content writer for Ginger Healthcare. Write engaging, informative, SEO-friendly blog posts. Use a warm, professional tone. Include relevant medical details but keep language accessible. Format in HTML for a blog post.",
            testimonial: "You are helping create realistic patient testimonial templates for Ginger Healthcare. Make them sound authentic, emotional, and specific about the medical tourism experience. Include details about savings, hospital quality, and care.",
            hospital: "You are writing hospital descriptions for Ginger Healthcare. Focus on accreditations, specialties, facilities, and what makes each hospital stand out for international patients.",
            doctor: "You are writing doctor profiles for Ginger Healthcare. Highlight qualifications, experience, specialties, and patient care philosophy.",
            page: "You are a copywriter for Ginger Healthcare's website. Write compelling, conversion-focused copy for medical tourism pages.",
            general: "You are an AI assistant for Ginger Healthcare's admin team. Help with content creation, editing, SEO optimization, and medical tourism industry knowledge."
        };

        const { Anthropic } = require('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const message = await client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: systemPrompts[type] || systemPrompts.general,
            messages: [
                { role: "user", content: context ? `Context: ${context}\n\nRequest: ${prompt}` : prompt }
            ]
        });

        const responseText = message.content[0].text;
        await logActivity(req.user.id, 'ai_generate', 'ai', null, `Type: ${type}, Prompt: ${prompt.substring(0, 100)}`);
        res.json({ content: responseText });
    } catch (err) {
        console.error('Claude API error:', err);
        res.status(500).json({ error: 'AI generation failed: ' + err.message });
    }
});

// ============== DATABASE BACKUP ==============
app.get('/api/backup/status', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const result = await pool.query("SELECT field_value FROM page_content WHERE page='system' AND section='backup' AND field_key='last_backup'");
        res.json({ last_backup: result.rows.length ? result.rows[0].field_value : null });
    } catch(e) { res.json({ last_backup: null }); }
});

app.get('/api/backup/download', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const tables = [
            'users', 'blog_posts', 'specialties', 'treatments', 'destinations',
            'hospitals', 'doctors', 'testimonials', 'submissions', 'page_content',
            'media', 'activity_log', 'treatment_costs', 'static_pages',
            'hospital_specialties', 'doctor_treatments'
        ];
        const backup = {
            metadata: {
                created_at: new Date().toISOString(),
                created_by: req.user.name,
                version: '1.0',
                tables: tables.length
            }
        };
        for (const table of tables) {
            try {
                const result = await pool.query(`SELECT * FROM ${table} ORDER BY id`);
                backup[table] = {
                    count: result.rows.length,
                    rows: result.rows
                };
            } catch(e) {
                backup[table] = { count: 0, rows: [], error: e.message };
            }
        }
        // Save last backup timestamp
        await pool.query(`
            INSERT INTO page_content (page, section, field_key, field_value, field_type, updated_by)
            VALUES ('system', 'backup', 'last_backup', $1, 'text', $2)
            ON CONFLICT (page, section, field_key)
            DO UPDATE SET field_value = $1, updated_by = $2, updated_at = NOW()
        `, [new Date().toISOString(), req.user.id]);

        const filename = `ginger-backup-${new Date().toISOString().slice(0,10)}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await logActivity(req.user.id, 'download_backup', 'system', null, 'Downloaded full database backup');
        res.json(backup);
    } catch(err) {
        console.error('Backup error:', err.message);
        res.status(500).json({ error: 'Backup failed' });
    }
});

// ============== SETTINGS ==============
app.get('/settings', authRequired, roleRequired('super_admin'), (req, res) => {
    servePage(res, 'settings');
});
app.get('/master-control', authRequired, (req, res) => {
    res.redirect('/');
});

// Settings API - Get all settings
app.get('/api/settings', apiAuth, async (req, res) => {
    try {
        const result = await pool.query("SELECT field_key, field_value FROM page_content WHERE page='site' AND section='settings'");
        res.json(result.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Settings API - Save all settings
app.put('/api/settings', apiAuth, async (req, res) => {
    try {
        const settings = req.body;
        for (const [key, value] of Object.entries(settings)) {
            await pool.query(`
                INSERT INTO page_content (page, section, field_key, field_value, field_type, updated_by)
                VALUES ('site', 'settings', $1, $2, 'text', $3)
                ON CONFLICT (page, section, field_key)
                DO UPDATE SET field_value = $2, updated_by = $3, updated_at = NOW()
            `, [key, value, req.user.id]);
        }
        await logActivity(req.user.id, 'update_settings', 'settings', null, 'Updated site settings');
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============== THEME TEMPLATES ==============
app.get('/theme-templates', authRequired, roleRequired('super_admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'theme-templates.html'));
});

app.get('/api/theme-templates', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM theme_templates ORDER BY category, label');
        res.json(result.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/theme-templates/:key', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM theme_templates WHERE template_key=$1', [req.params.key]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
        res.json(result.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Sample data for template preview
app.get('/api/theme-templates/preview-data/:key', apiAuth, async (req, res) => {
    try {
        const key = req.params.key;
        let data = {};
        if (key === 'blog-detail') {
            const r = await pool.query("SELECT bp.*, u.name as author_name FROM blog_posts bp LEFT JOIN users u ON bp.author_id=u.id WHERE bp.status='published' ORDER BY bp.created_at DESC LIMIT 1");
            data = { post: r.rows[0] || { title:'Sample Blog Post', content:'<p>This is a preview of your blog post template.</p>', author_name:'Ginger Healthcare', read_time:5, category:'Health', excerpt:'Sample excerpt text' } };
        } else if (key === 'destination-detail') {
            const r = await pool.query("SELECT * FROM destinations WHERE status='active' LIMIT 1");
            const dest = r.rows[0] || { name:'India', flag:'🇮🇳', slug:'india', tagline:'World-class healthcare at affordable prices', description:'India is a leading medical tourism destination.', hospital_count:20, doctor_count:40, avg_savings:'60-80%' };
            const h = await pool.query("SELECT * FROM hospitals WHERE status='active' LIMIT 3");
            const d = await pool.query("SELECT d.*, h.name as hospital_name FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id WHERE d.status='active' LIMIT 3");
            data = { destination: dest, hospitals: h.rows, doctors: d.rows };
        } else if (key === 'specialty-detail') {
            const r = await pool.query("SELECT * FROM specialties WHERE status='active' LIMIT 1");
            const spec = r.rows[0] || { name:'Cardiac Surgery', icon:'❤️', slug:'cardiac-surgery', description:'Advanced cardiac procedures' };
            const t = await pool.query("SELECT * FROM treatments WHERE status='active' LIMIT 4");
            data = { specialty: spec, treatments: t.rows };
        } else if (key === 'treatment-detail') {
            const r = await pool.query("SELECT t.*, s.icon as specialty_icon FROM treatments t LEFT JOIN specialties s ON t.specialty_id=s.id WHERE t.status='active' LIMIT 1");
            const treat = r.rows[0] || { name:'Knee Replacement', description:'Total knee replacement surgery', cost_range_usd:'$4,000-$8,000', duration:'2-3 hours', recovery_time:'4-6 weeks', specialty_icon:'🦴' };
            const c = await pool.query("SELECT tc.*, d.name as dest_name, d.flag_emoji as dest_flag FROM treatment_costs tc LEFT JOIN destinations d ON tc.destination_id=d.id LIMIT 3");
            data = { treatment: treat, costs: c.rows };
        } else if (key === 'hospital-detail') {
            const r = await pool.query("SELECT h.*, d.name as country FROM hospitals h LEFT JOIN destinations d ON h.destination_id=d.id WHERE h.status='active' LIMIT 1");
            const hosp = r.rows[0] || { name:'Apollo Hospital', city:'New Delhi', country:'India', beds:700, established:1983, rating:4.8, accreditations:['JCI','NABH'] };
            const docs = await pool.query("SELECT * FROM doctors WHERE status='active' LIMIT 3");
            data = { hospital: hosp, doctors: docs.rows };
        } else if (key === 'doctor-detail') {
            const r = await pool.query("SELECT d.*, h.name as hospital_name, h.slug as hospital_slug FROM doctors d LEFT JOIN hospitals h ON d.hospital_id=h.id WHERE d.status='active' LIMIT 1");
            data = { doctor: r.rows[0] || { name:'Dr. Sharma', title:'Senior Cardiologist', specialty:'Cardiac Surgery', experience_years:20, description:'Leading cardiac surgeon', hospital_name:'Apollo Hospital', hospital_slug:'apollo-hospital' } };
        } else if (key === 'blog-list') {
            const r = await pool.query("SELECT * FROM blog_posts WHERE status='published' ORDER BY created_at DESC LIMIT 6");
            data = { posts: r.rows };
        } else if (key === 'destinations-list') {
            const r = await pool.query("SELECT * FROM destinations WHERE status='active' ORDER BY sort_order");
            data = { destinations: r.rows };
        } else if (key === 'specialties-list') {
            const r = await pool.query("SELECT * FROM specialties WHERE status='active' ORDER BY sort_order");
            data = { specialties: r.rows };
        } else if (key === 'results') {
            const r = await pool.query("SELECT * FROM testimonials WHERE status='published' ORDER BY created_at DESC LIMIT 6");
            data = { testimonials: r.rows };
        }
        res.json(data);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Template Studio page
app.get('/theme-templates/edit/:key', authRequired, roleRequired('super_admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'template-studio.html'));
});

app.put('/api/theme-templates/:key', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const { label, category, description, html_template, css, is_active } = req.body;
        const result = await pool.query(
            `INSERT INTO theme_templates (template_key, label, category, description, html_template, css, is_active, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (template_key) DO UPDATE SET label=$2, category=$3, description=$4, html_template=$5, css=$6, is_active=$7, updated_by=$8, updated_at=NOW()
             RETURNING *`,
            [req.params.key, label, category || 'detail', description, html_template, css, is_active !== false, req.user.id]
        );
        await logActivity(req.user.id, 'update', 'theme_template', result.rows[0].id, `Updated template: ${label}`);
        res.json(result.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/theme-templates/:key', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM theme_templates WHERE template_key=$1', [req.params.key]);
        await logActivity(req.user.id, 'delete', 'theme_template', null, `Deleted template: ${req.params.key}`);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Public API for website to fetch templates
app.get('/api/public/templates', async (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    try {
        const result = await pool.query('SELECT template_key, html_template, css FROM theme_templates WHERE is_active=true');
        const map = {};
        result.rows.forEach(r => { map[r.template_key] = { html: r.html_template, css: r.css }; });
        res.json(map);
    } catch(e) { res.json({}); }
});

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
        });
    } catch (err) {
        console.error('❌ Startup error:', err);
        process.exit(1);
    }
}

startServer();
