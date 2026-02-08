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
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
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
    res.sendFile(path.join(__dirname, 'views', 'pages', 'dashboard.html'));
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
        const result = await pool.query(
            `SELECT al.*, u.name as user_name FROM activity_log al
             LEFT JOIN users u ON al.user_id = u.id
             ORDER BY al.created_at DESC LIMIT 20`
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// ============== BLOG POSTS CRUD ==============
app.get('/blog', authRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'blog.html'));
});
app.get('/blog/new', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'blog-editor.html'));
});
app.get('/blog/edit/:id', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'pages', 'blog-editor.html'));
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
        const { title, slug, excerpt, content, cover_image, category, tags, status, read_time, meta_title, meta_description } = req.body;
        const result = await pool.query(
            `INSERT INTO blog_posts (title, slug, excerpt, content, cover_image, category, tags, status, read_time, author_id, meta_title, meta_description, published_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [title, slug, excerpt, content, cover_image, category, tags || [], status || 'draft', read_time, req.user.id, meta_title, meta_description, status === 'published' ? new Date() : null]
        );
        await logActivity(req.user.id, 'create', 'blog_post', result.rows[0].id, `Created: ${title}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/blog/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { title, slug, excerpt, content, cover_image, category, tags, status, read_time, meta_title, meta_description } = req.body;
        const result = await pool.query(
            `UPDATE blog_posts SET title=$1, slug=$2, excerpt=$3, content=$4, cover_image=$5, category=$6, tags=$7, status=$8, read_time=$9, meta_title=$10, meta_description=$11, published_at = CASE WHEN $8='published' AND published_at IS NULL THEN NOW() ELSE published_at END, updated_at=NOW()
             WHERE id=$12 RETURNING *`,
            [title, slug, excerpt, content, cover_image, category, tags || [], status, read_time, meta_title, meta_description, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'blog_post', req.params.id, `Updated: ${title}`);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
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
