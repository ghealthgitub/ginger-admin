const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = function(app, pool, { authRequired, apiAuth, logActivity, servePage }) {

// Login page
app.get('/login', (req, res) => {
    if (req.cookies?.token) {
        try { jwt.verify(req.cookies.token, process.env.JWT_SECRET); return res.redirect('/'); }
        catch(e) { res.clearCookie('token'); }
    }
    servePage(res, 'login');
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

        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
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

};
