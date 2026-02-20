module.exports = function(app, pool, { authRequired, apiAuth, roleRequired, logActivity, servePage }) {

// ============== BLOG POSTS CRUD ==============
app.get('/blog', authRequired, (req, res) => {
    servePage(res, 'blog');
});
app.get('/blog/new', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    servePage(res, 'blog-studio');
});
app.get('/blog/edit/:id', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    servePage(res, 'blog-studio');
});
app.get('/blog/claude/:id', authRequired, roleRequired('super_admin', 'editor'), (req, res) => {
    servePage(res, 'blog-studio');
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

// Slug uniqueness check
app.get('/api/blog-slug-check/:slug', apiAuth, async (req, res) => {
    try {
        const excludeId = req.query.exclude || 0;
        const result = await pool.query('SELECT id, title FROM blog_posts WHERE slug = $1 AND id != $2', [req.params.slug, excludeId]);
        res.json({ available: result.rows.length === 0, existing: result.rows[0] || null });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/blog', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        let { title, slug, excerpt, content, cover_image, category, tags, status, read_time, meta_title, meta_description, focus_keywords } = req.body;
        const tagsArray = Array.isArray(tags) ? tags : [];
        const readTimeVal = read_time ? parseInt(read_time) || null : null;
        // Ensure slug uniqueness
        const existing = await pool.query('SELECT id FROM blog_posts WHERE slug = $1', [slug]);
        if (existing.rows.length) {
            let suffix = 2;
            while (true) {
                const candidate = slug + '-' + suffix;
                const check = await pool.query('SELECT id FROM blog_posts WHERE slug = $1', [candidate]);
                if (!check.rows.length) { slug = candidate; break; }
                suffix++;
                if (suffix > 50) break;
            }
        }
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
        let { title, slug, excerpt, content, cover_image, category, tags, status, read_time, meta_title, meta_description, focus_keywords } = req.body;
        const tagsArray = Array.isArray(tags) ? tags : [];
        const readTimeVal = read_time ? parseInt(read_time) || null : null;
        const pubStatus = status || 'draft';
        // Ensure slug uniqueness (exclude current post)
        const slugCheck = await pool.query('SELECT id FROM blog_posts WHERE slug = $1 AND id != $2', [slug, req.params.id]);
        if (slugCheck.rows.length) {
            let suffix = 2;
            while (true) {
                const candidate = slug + '-' + suffix;
                const check = await pool.query('SELECT id FROM blog_posts WHERE slug = $1 AND id != $2', [candidate, req.params.id]);
                if (!check.rows.length) { slug = candidate; break; }
                suffix++;
                if (suffix > 50) break;
            }
        }
        // Save revision before updating
        const revType = req.body._autoSave ? 'autosave' : 'manual';
        try {
            const existing = await pool.query('SELECT title, content, excerpt, meta_title, meta_description, focus_keywords, category, cover_image FROM blog_posts WHERE id=$1', [req.params.id]);
            if (existing.rows.length) {
                const old = existing.rows[0];
                await pool.query(
                    'INSERT INTO revisions (entity_type, entity_id, title, content, meta, user_id, revision_type) VALUES ($1,$2,$3,$4,$5,$6,$7)',
                    ['blog_post', req.params.id, old.title, old.content, JSON.stringify({ excerpt: old.excerpt, meta_title: old.meta_title, meta_description: old.meta_description, focus_keywords: old.focus_keywords, category: old.category, cover_image: old.cover_image }), req.user.id, revType]
                );
                await pool.query('DELETE FROM revisions WHERE entity_type=$1 AND entity_id=$2 AND id NOT IN (SELECT id FROM revisions WHERE entity_type=$1 AND entity_id=$2 ORDER BY created_at DESC LIMIT 30)', ['blog_post', req.params.id]);
            }
        } catch(revErr) { console.error('Revision save error:', revErr.message); }
        const result = await pool.query(
            `UPDATE blog_posts SET title=$1, slug=$2, excerpt=$3, content=$4, cover_image=$5, category=$6, tags=$7::text[], status=$8, read_time=$9, meta_title=$10, meta_description=$11, focus_keywords=$12, published_at = CASE WHEN $13='published' AND published_at IS NULL THEN NOW() ELSE published_at END, updated_at=NOW()
             WHERE id=$14 RETURNING *`,
            [title, slug, excerpt || null, content || null, cover_image || null, category || null, tagsArray, pubStatus, readTimeVal, meta_title || null, meta_description || null, focus_keywords || null, pubStatus, req.params.id]
        );
        await logActivity(req.user.id, 'update', 'blog_post', req.params.id, `Updated: ${title}`);
        res.json(result.rows[0]);
    } catch (err) { console.error('Blog PUT error:', err.message); res.status(500).json({ error: err.message }); }
});

// Revisions API
app.get('/api/revisions/:type/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT r.*, u.name as user_name FROM revisions r LEFT JOIN users u ON r.user_id = u.id WHERE r.entity_type=$1 AND r.entity_id=$2 ORDER BY r.created_at DESC LIMIT 30',
            [req.params.type, req.params.id]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/revisions/detail/:id', apiAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM revisions WHERE id=$1', [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ error: 'Revision not found' });
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

// Bulk actions for blog posts
app.post('/api/blog/bulk', apiAuth, roleRequired('super_admin', 'editor'), async (req, res) => {
    try {
        const { ids, action } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No posts selected' });
        let count = 0;
        if (action === 'delete') {
            if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only admins can delete' });
            const result = await pool.query('DELETE FROM blog_posts WHERE id = ANY($1) RETURNING id', [ids]);
            count = result.rowCount;
            await logActivity(req.user.id, 'bulk_delete', 'blog_post', null, `Bulk deleted ${count} posts`);
        } else if (action === 'publish') {
            const result = await pool.query("UPDATE blog_posts SET status='published', published_at=COALESCE(published_at, NOW()), updated_at=NOW() WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount;
            await logActivity(req.user.id, 'bulk_publish', 'blog_post', null, `Bulk published ${count} posts`);
        } else if (action === 'draft') {
            const result = await pool.query("UPDATE blog_posts SET status='draft', updated_at=NOW() WHERE id = ANY($1) RETURNING id", [ids]);
            count = result.rowCount;
            await logActivity(req.user.id, 'bulk_draft', 'blog_post', null, `Bulk set ${count} posts to draft`);
        } else {
            return res.status(400).json({ error: 'Invalid action' });
        }
        res.json({ success: true, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


};
