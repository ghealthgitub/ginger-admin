module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage }) {

// ============== SUBMISSIONS ==============
app.get('/submissions', authRequired, (req, res) => {
    servePage(res, 'submissions');
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


};
