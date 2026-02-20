const bcrypt = require('bcryptjs');

module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage }) {

// ============== USERS MANAGEMENT ==============
app.get('/users', authRequired, roleRequired('super_admin'), (req, res) => {
    servePage(res, 'users');
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


};
