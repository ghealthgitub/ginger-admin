module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage }) {

// ============== TREATMENT COSTS CRUD ==============
app.get('/costs', authRequired, (req, res) => {
    servePage(res, 'costs');
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

app.get('/api/treatment-costs', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT tc.*, t.name as treatment_name, t.slug as treatment_slug,
                    d.name as destination_name, d.slug as destination_slug, d.flag as destination_flag
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
        const { treatment_id, destination_id, cost_min_usd, cost_max_usd, cost_local, includes, hospital_stay, notes, usa_cost } = req.body;
        const result = await pool.query(
            `INSERT INTO treatment_costs (treatment_id, destination_id, cost_min_usd, cost_max_usd, cost_local, includes, hospital_stay, notes, usa_cost)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [treatment_id, destination_id, cost_min_usd||null, cost_max_usd||null, cost_local||null, includes||null, hospital_stay||null, notes||null, usa_cost||null]
        );
        await logActivity(req.user.id, 'create', 'cost', result.rows[0].id, 'Created cost entry');
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/treatment-costs', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { treatment_id, destination_id, cost_min_usd, cost_max_usd, usa_cost } = req.body;
        if (!treatment_id || !destination_id) {
            return res.status(400).json({ error: 'treatment_id and destination_id are required' });
        }
        const result = await pool.query(
            `INSERT INTO treatment_costs (treatment_id, destination_id, cost_min_usd, cost_max_usd, usa_cost)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (treatment_id, destination_id) 
             DO UPDATE SET 
                cost_min_usd = COALESCE(EXCLUDED.cost_min_usd, treatment_costs.cost_min_usd),
                cost_max_usd = COALESCE(EXCLUDED.cost_max_usd, treatment_costs.cost_max_usd),
                usa_cost = COALESCE(EXCLUDED.usa_cost, treatment_costs.usa_cost),
                updated_at = NOW()
             RETURNING *`,
            [treatment_id, destination_id, cost_min_usd||null, cost_max_usd||null, usa_cost||null]
        );
        await logActivity(req.user.id, 'upsert', 'cost', result.rows[0].id, `Upsert cost: treatment ${treatment_id}, dest ${destination_id}`);
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[API] POST treatment-costs error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/costs/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { treatment_id, destination_id, cost_min_usd, cost_max_usd, cost_local, includes, hospital_stay, notes, usa_cost } = req.body;
        const result = await pool.query(
            `UPDATE treatment_costs SET treatment_id=$1, destination_id=$2, cost_min_usd=$3, cost_max_usd=$4, cost_local=$5, includes=$6, hospital_stay=$7, notes=$8, usa_cost=$9, updated_at=NOW()
             WHERE id=$10 RETURNING *`,
            [treatment_id, destination_id, cost_min_usd||null, cost_max_usd||null, cost_local||null, includes||null, hospital_stay||null, notes||null, usa_cost||null, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/treatment-costs/:id', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { cost_min_usd, cost_max_usd, usa_cost } = req.body;
        const result = await pool.query(
            `UPDATE treatment_costs SET cost_min_usd=$1, cost_max_usd=$2, usa_cost=$3, updated_at=NOW()
             WHERE id=$4 RETURNING *`,
            [cost_min_usd||null, cost_max_usd||null, usa_cost||null, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Cost entry not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/costs/bulk', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        const { ids, action } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No items selected' });
        if (action === 'delete') {
            const result = await pool.query('DELETE FROM treatment_costs WHERE id = ANY($1) RETURNING id', [ids]);
            await logActivity(req.user.id, 'bulk_delete', 'cost', null, `Bulk deleted ${result.rowCount} cost entries`);
            res.json({ success: true, count: result.rowCount });
        } else { return res.status(400).json({ error: 'Invalid action' }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/costs/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM treatment_costs WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/treatment-costs/:id', apiAuth, roleRequired('super_admin'), async (req, res) => {
    try {
        await pool.query('DELETE FROM treatment_costs WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});


};
