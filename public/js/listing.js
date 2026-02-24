/* ============================================================
   GINGER HEALTHCARE — UNIVERSAL LISTING ENGINE  (listing.js)
   Reads window.LISTING config and builds a full WordPress-style
   content listing page for any CPT.

   Each CPT page only needs a small config block:
   window.LISTING = {
       cpt: 'treatment',
       apiEndpoint: '/api/treatments',
       newUrl: '/treatments/new',
       editUrl: (item) => '/treatments/edit/' + item.id,
       viewUrl: (item) => item.specialty_slug
           ? 'https://ginger.healthcare/specialties/' + item.specialty_slug + '/' + item.slug + '/'
           : null,

       // Columns shown in the table
       columns: [
           { key: 'specialty_name', label: 'Specialty', badge: 'purple' },
           { key: 'duration',       label: 'Duration' },
           { key: 'cost_range_usd', label: 'Cost (USD)' },
       ],

       // Filters shown in toolbar (beyond the default search)
       filters: [
           { id: 'specFilter', apiSource: '/api/specialties', placeholder: 'All Specialties',
             filterFn: (item, val) => !val || String(item.specialty_id) === val }
       ],

       // Quick Edit fields (inline row edit)
       quickEditFields: [
           { id: 'name',           label: 'Name',         type: 'text' },
           { id: 'slug',           label: 'Slug',         type: 'text' },
           { id: 'specialty_id',   label: 'Specialty',    type: 'select', source: 'specFilter' },
           { id: 'status',         label: 'Status',       type: 'status' },
           { id: 'duration',       label: 'Duration',     type: 'text' },
           { id: 'cost_range_usd', label: 'Cost (USD)',   type: 'text' },
       ],

       // Extra status tabs beyond All/Published/Draft
       extraTabs: [],

       // What field to show as the image thumbnail (optional)
       imageField: 'image',

       // Default sort
       defaultSort: 'date',
       defaultDir: 'desc',
   }
   ============================================================ */

(function () {
'use strict';

document.addEventListener('DOMContentLoaded', function () {
    if (!window.LISTING) { console.error('listing.js: window.LISTING config not found.'); return; }
    Listing.init(window.LISTING);
});

const Listing = {
    cfg: null,
    items: [],
    filterData: {},   // { filterId: [{id, name}, ...] }
    sel: new Set(),
    curPage: 1,
    perPageVal: 20,
    sortField: 'date',
    sortDir: 'desc',
    activeTab: '',
    activeFilters: {},

    // ── INIT ──────────────────────────────────────────────
    init(cfg) {
        this.cfg = cfg;
        this.sortField = cfg.defaultSort || 'date';
        this.sortDir   = cfg.defaultDir  || 'desc';
        this._buildDOM();
        this._initKeyboard();
        this._loadFilters().then(() => this.load());
    },

    // ── BUILD DOM ─────────────────────────────────────────
    _buildDOM() {
        const cfg = this.cfg;
        const label = this._label();
        document.title = label + 's | Ginger Admin';

        document.querySelector('.topbar__title').textContent = label + 's';
        document.querySelector('.topbar__actions').innerHTML =
            `<a href="${cfg.newUrl}" class="btn-new" target="_blank">+ Add ${label}</a>`;

        // Status tabs
        const tabsEl = document.getElementById('statusTabs');
        tabsEl.innerHTML = this._tplTabs();

        // Filter toolbar
        document.getElementById('filterToolbar').innerHTML = this._tplFilterToolbar();

        // Table header
        document.querySelector('#listTable thead tr').innerHTML = this._tplThead();
    },

    _label() {
        const c = this.cfg.cpt || '';
        return c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, ' ');
    },

    _tplTabs() {
        const base = [
            { key: '', label: 'All', countId: 'cAll' },
            { key: 'published', label: 'Published', countId: 'cPub' },
            { key: 'draft', label: 'Drafts', countId: 'cDra' },
        ];
        const extra = this.cfg.extraTabs || [];
        return [...base, ...extra].map((t, i) =>
            (i > 0 ? '<span class="tab-sep">|</span>' : '') +
            `<button class="status-tab${t.key === '' ? ' active' : ''}" 
                onclick="Listing.setTab('${t.key}')" data-status="${t.key}">
                ${t.label} <span class="tab-count" id="${t.countId}"></span>
             </button>`
        ).join('');
    },

    _tplFilterToolbar() {
        const cfg = this.cfg;
        let filterSelects = (cfg.filters || []).map(f =>
            `<select id="${f.id}" class="filter-select" onchange="Listing.onFilterChange('${f.id}')">
                <option value="">${f.placeholder || 'All'}</option>
             </select>`
        ).join('');

        return `
        <div class="bulk-bar">
            <select id="bulkAction" class="bulk-select">
                <option value="">Bulk Actions</option>
                <option value="publish">Set Published</option>
                <option value="draft">Set Draft</option>
                <option value="delete">Move to Trash</option>
            </select>
            <button class="btn-apply" id="bulkApplyBtn" onclick="Listing.applyBulk()" disabled>Apply</button>
        </div>
        ${filterSelects}
        <div class="search-wrap">
            <input type="text" placeholder="Search ${this._label().toLowerCase()}s..." 
                   id="searchInput" oninput="Listing.doFilter()">
        </div>
        <div class="pagination-info">
            <span id="pageInfo"></span>
            <button class="pag-btn" id="prevBtn" onclick="Listing.changePage(-1)" disabled>‹</button>
            <button class="pag-btn" id="nextBtn" onclick="Listing.changePage(1)" disabled>›</button>
            <select class="per-page-select" id="perPageSel" 
                    onchange="Listing.perPageVal=+this.value;Listing.curPage=1;Listing.doFilter()">
                <option value="20">20 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
            </select>
        </div>`;
    },

    _tplThead() {
        const cols = this.cfg.columns || [];
        const imgCol = this.cfg.imageField
            ? '<th class="img-col"></th>'
            : '';
        const extraCols = cols.map(c =>
            `<th onclick="Listing.sortBy('${c.sortKey || c.key}')" class="sortable">
                ${c.label} <span class="sort-icon" data-col="${c.sortKey || c.key}">↕</span>
             </th>`
        ).join('');

        return `
            <th class="cb-cell"><input type="checkbox" id="selAll" onchange="Listing.toggleAll(this.checked)"></th>
            ${imgCol}
            <th onclick="Listing.sortBy('name')" class="sortable">
                ${this._label()} <span class="sort-icon" data-col="name">↕</span>
            </th>
            ${extraCols}
            <th onclick="Listing.sortBy('status')" class="sortable">
                Status <span class="sort-icon" data-col="status">↕</span>
            </th>
            <th onclick="Listing.sortBy('date')" class="sortable">
                Date <span class="sort-icon" data-col="date">↕</span>
            </th>`;
    },

    // ── LOAD FILTER SOURCES ───────────────────────────────
    async _loadFilters() {
        const filters = this.cfg.filters || [];
        await Promise.all(filters.map(async f => {
            if (!f.apiSource) return;
            try {
                const r = await fetch(f.apiSource);
                if (!r.ok) return;
                const data = await r.json();
                this.filterData[f.id] = data;
                const el = document.getElementById(f.id);
                if (!el) return;
                data.forEach(item => {
                    const o = document.createElement('option');
                    o.value = item.id;
                    o.textContent = (item.icon || '') + ' ' + (item.name || item.title || item.code || item.id);
                    o.dataset.slug = item.slug || '';
                    el.appendChild(o);
                });
            } catch (e) { console.error('Filter load failed:', f.id, e); }
        }));
    },

    // ── LOAD DATA ─────────────────────────────────────────
    async load() {
        const tbody = document.getElementById('list');
        tbody.innerHTML = `<tr><td colspan="20" class="empty-state loading-state">
            <div class="loading-spinner"></div> Loading...
        </td></tr>`;
        try {
            const r = await this._safeFetch(this.cfg.apiEndpoint);
            if (!r || !r.ok) {
                tbody.innerHTML = `<tr><td colspan="20" class="empty-state">
                    ⚠️ Error loading data. <button onclick="Listing.load()" class="retry-btn">Retry</button>
                </td></tr>`;
                return;
            }
            this.items = await r.json();
            this._updateCounts();
            this.doFilter();
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="20" class="empty-state">
                ⚠️ Network error. <button onclick="Listing.load()" class="retry-btn">Retry</button>
            </td></tr>`;
        }
    },

    async _safeFetch(url, opts) {
        for (let i = 0; i < 3; i++) {
            try {
                const r = await fetch(url, opts);
                if (r.status === 429) {
                    await new Promise(ok => setTimeout(ok, 1000 * (i + 1)));
                    continue;
                }
                return r;
            } catch (e) {
                if (i === 2) throw e;
                await new Promise(ok => setTimeout(ok, 1000));
            }
        }
    },

    // ── COUNTS & TABS ─────────────────────────────────────
    _updateCounts() {
        const pub = this.items.filter(i => i.status === 'published').length;
        const dra = this.items.filter(i => i.status === 'draft').length;
        const el = id => document.getElementById(id);
        if (el('cAll')) el('cAll').textContent = '(' + this.items.length + ')';
        if (el('cPub')) el('cPub').textContent = '(' + pub + ')';
        if (el('cDra')) el('cDra').textContent = '(' + dra + ')';
        document.querySelector('.topbar__title').textContent =
            this._label() + 's (' + this.items.length + ')';

        // Extra tab counts
        (this.cfg.extraTabs || []).forEach(t => {
            const countEl = document.getElementById(t.countId);
            if (countEl && t.countFn) countEl.textContent = '(' + t.countFn(this.items) + ')';
        });
    },

    setTab(s) {
        this.activeTab = s;
        this.curPage = 1;
        // Reset specialty filter when switching tabs (prevents empty page confusion)
        document.querySelectorAll('.status-tab').forEach(t =>
            t.classList.toggle('active', t.dataset.status === s)
        );
        this.doFilter();
    },

    // ── FILTER & SORT ─────────────────────────────────────
    onFilterChange(id) {
        const el = document.getElementById(id);
        this.activeFilters[id] = el ? el.value : '';
        this.curPage = 1;
        this.doFilter();
    },

    doFilter() {
        const q = (document.getElementById('searchInput').value || '').toLowerCase();
        const cfg = this.cfg;

        let f = this.items.filter(item => {
            // Tab filter
            if (this.activeTab && item.status !== this.activeTab) return false;
            // Search: name, description, slug, and any string column
            if (q) {
                const searchable = [
                    item.name, item.slug, item.description,
                    ...(cfg.columns || []).map(c => item[c.key])
                ].map(v => (v || '').toLowerCase()).join(' ');
                if (!searchable.includes(q)) return false;
            }
            // Custom filters
            if (cfg.filters) {
                for (const flt of cfg.filters) {
                    const val = this.activeFilters[flt.id] || '';
                    if (flt.filterFn && !flt.filterFn(item, val)) return false;
                }
            }
            return true;
        });

        // Sort
        f.sort((a, b) => {
            let va, vb;
            if (this.sortField === 'name')   { va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); }
            else if (this.sortField === 'status') { va = a.status || ''; vb = b.status || ''; }
            else if (this.sortField === 'date')   { va = a.updated_at || a.created_at || ''; vb = b.updated_at || b.created_at || ''; }
            else {
                // Try to sort by any column key
                va = (a[this.sortField] || '').toString().toLowerCase();
                vb = (b[this.sortField] || '').toString().toLowerCase();
            }
            const cmp = va < vb ? -1 : va > vb ? 1 : 0;
            return this.sortDir === 'asc' ? cmp : -cmp;
        });

        // Paginate
        const total = f.length;
        const tp = Math.max(1, Math.ceil(total / this.perPageVal));
        if (this.curPage > tp) this.curPage = tp;
        const start = (this.curPage - 1) * this.perPageVal;
        const page = f.slice(start, start + this.perPageVal);

        document.getElementById('pageInfo').textContent =
            total + ' item' + (total !== 1 ? 's' : '') +
            (tp > 1 ? ' · page ' + this.curPage + ' of ' + tp : '');
        document.getElementById('prevBtn').disabled = this.curPage <= 1;
        document.getElementById('nextBtn').disabled = this.curPage >= tp;

        this._render(page, total);
    },

    sortBy(field) {
        if (this.sortField === field) {
            this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortField = field;
            this.sortDir = field === 'date' ? 'desc' : 'asc';
        }
        // Update sort indicators
        document.querySelectorAll('.sort-icon').forEach(el => {
            const col = el.dataset.col;
            if (col === field) {
                el.textContent = this.sortDir === 'asc' ? '↑' : '↓';
                el.style.opacity = '1';
                el.style.color = 'var(--teal)';
            } else {
                el.textContent = '↕';
                el.style.opacity = '0.4';
                el.style.color = '';
            }
        });
        this.doFilter();
    },

    changePage(d) {
        this.curPage += d;
        this.doFilter();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // ── RENDER ────────────────────────────────────────────
    _render(list, total) {
        const tbody = document.getElementById('list');
        const cfg = this.cfg;
        const colCount = 4 + (cfg.columns || []).length + (cfg.imageField ? 1 : 0);

        if (!list.length) {
            const isFiltered = this.activeTab || this.activeFilters ||
                document.getElementById('searchInput').value;
            tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty-state">
                ${isFiltered
                    ? '🔍 No results match your filters. <button onclick="Listing._clearAllFilters()" class="retry-btn">Clear filters</button>'
                    : `📋 No ${this._label().toLowerCase()}s yet. <a href="${cfg.newUrl}" target="_blank" class="retry-btn">Create the first one →</a>`
                }
            </td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(item => this._tplRow(item)).join('');
    },

    _tplRow(item) {
        const cfg = this.cfg;
        const checked = this.sel.has(item.id) ? 'checked' : '';
        const rowClass = this.sel.has(item.id) ? ' selected' : '';

        // Thumbnail
        const imgCell = cfg.imageField
            ? `<td class="img-col">${item[cfg.imageField]
                ? `<img src="${this._adminUrl(item[cfg.imageField])}" class="row-thumb" loading="lazy">`
                : '<div class="row-thumb-empty">—</div>'}</td>`
            : '';

        // Title cell
        const viewUrl = cfg.viewUrl ? cfg.viewUrl(item) : null;
        const isPublished = item.status === 'published';
        const slugDisplay = cfg.slugDisplay ? cfg.slugDisplay(item) : ('/' + cfg.cpt + 's/' + (item.slug || ''));

        const rowActions = `
            <div class="row-actions">
                <a href="${cfg.editUrl(item)}" target="_blank">Edit</a>
                <span class="sep">|</span>
                <button onclick="Listing.toggleQE(${item.id})">Quick Edit</button>
                <span class="sep">|</span>
                ${isPublished && viewUrl
                    ? `<a href="${viewUrl}" target="_blank" class="act-view">View</a>`
                    : `<span style="color:var(--gray-300);cursor:default">View</span>`
                }
                <span class="sep">|</span>
                <button class="act-del" onclick="Listing.deleteItem(${item.id})">Trash</button>
            </div>`;

        // Date: show updated_at for drafts, published_at or created_at for published
        const dateVal = isPublished
            ? (item.published_at || item.updated_at || item.created_at)
            : (item.updated_at || item.created_at);
        const dateLabel = isPublished ? 'Published' : 'Modified';
        const dateStr = dateVal
            ? new Date(dateVal).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
            : '—';

        // Extra columns
        const extraCols = (cfg.columns || []).map(c => {
            const val = item[c.key];
            if (c.badge) {
                return `<td>${val
                    ? `<span class="col-badge col-badge--${c.badge}">${this._esc(val)}</span>`
                    : '—'}</td>`;
            }
            if (c.render) return `<td>${c.render(item)}</td>`;
            return `<td class="col-val">${this._esc(val || '—')}</td>`;
        }).join('');

        // Status badge — clickable to toggle
        const statusBadge = `
            <span class="badge badge--${item.status} badge--clickable" 
                  onclick="Listing.toggleStatus(${item.id})" 
                  title="Click to toggle status">
                ${item.status}
            </span>`;

        return `
        <tr id="row-${item.id}" class="${rowClass}">
            <td class="cb-cell">
                <input type="checkbox" ${checked} onchange="Listing.toggleSel(${item.id}, this.checked)">
            </td>
            ${imgCell}
            <td class="item-title-cell">
                <strong><a href="${cfg.editUrl(item)}" target="_blank">${this._esc(item.name || item.title || '')}</a></strong>
                <span class="item-slug">${this._esc(slugDisplay)}</span>
                ${rowActions}
            </td>
            ${extraCols}
            <td>${statusBadge}</td>
            <td class="date-cell">
                <span class="date-label">${dateLabel}</span><br>
                ${dateStr}
            </td>
        </tr>
        <tr class="quick-edit-row" id="qe-${item.id}" style="display:none">
            <td colspan="20" style="padding:0;border:none">
                ${this._tplQuickEdit(item)}
            </td>
        </tr>`;
    },

    _tplQuickEdit(item) {
        const fields = this.cfg.quickEditFields || [];
        const cols = Math.min(3, Math.max(2, Math.ceil(fields.length / 2)));

        const fieldHtml = fields.map(f => {
            let input = '';
            const val = item[f.id] || '';

            if (f.type === 'text' || !f.type) {
                input = `<input class="form-input" id="qe_${f.id}_${item.id}" value="${this._esc(String(val))}">`;
            } else if (f.type === 'status') {
                input = `<select class="form-select" id="qe_${f.id}_${item.id}">
                    <option value="draft"${item.status === 'draft' ? ' selected' : ''}>📝 Draft</option>
                    <option value="published"${item.status === 'published' ? ' selected' : ''}>✅ Published</option>
                </select>`;
            } else if (f.type === 'select' && f.source) {
                const srcData = this.filterData[f.source] || [];
                const opts = srcData.map(o =>
                    `<option value="${o.id}"${item[f.id] === o.id ? ' selected' : ''}>${this._esc((o.icon || '') + ' ' + (o.name || o.title || ''))}</option>`
                ).join('');
                input = `<select class="form-select" id="qe_${f.id}_${item.id}">
                    <option value="">— None —</option>${opts}
                </select>`;
            } else if (f.type === 'boolean') {
                input = `<select class="form-select" id="qe_${f.id}_${item.id}">
                    <option value="false"${!item[f.id] ? ' selected' : ''}>No</option>
                    <option value="true"${item[f.id] ? ' selected' : ''}>Yes</option>
                </select>`;
            }

            return `<div class="form-group">
                <label class="form-label">${f.label}</label>
                ${input}
            </div>`;
        }).join('');

        return `<div class="quick-edit">
            <div class="quick-edit__title">⚡ Quick Edit — ${this._esc(item.name || item.title || '')}</div>
            <div class="quick-edit__grid" style="grid-template-columns:repeat(${cols},1fr)">
                ${fieldHtml}
            </div>
            <div class="quick-edit__actions">
                <button class="btn btn--primary btn--sm" onclick="Listing.quickSave(${item.id})">💾 Update</button>
                <button class="btn btn--outline btn--sm" onclick="Listing.toggleQE(${item.id})">Cancel</button>
            </div>
        </div>`;
    },

    // ── ACTIONS ───────────────────────────────────────────
    toggleQE(id) {
        const r = document.getElementById('qe-' + id);
        if (!r) return;
        const isOpen = r.style.display !== 'none';
        // Close all others first
        document.querySelectorAll('.quick-edit-row').forEach(el => el.style.display = 'none');
        if (!isOpen) r.style.display = '';
    },

    async quickSave(id) {
        const cfg = this.cfg;
        const fields = cfg.quickEditFields || [];

        // CRITICAL: Fetch existing record first to avoid wiping unedited fields
        let existing = {};
        try {
            const r = await fetch(cfg.apiEndpoint + '/' + id);
            if (r.ok) existing = await r.json();
        } catch (e) {}

        // Merge quick edit values over the existing record
        const data = { ...existing };
        fields.forEach(f => {
            const el = document.getElementById('qe_' + f.id + '_' + id);
            if (!el) return;
            if (f.type === 'boolean') {
                data[f.id] = el.value === 'true';
            } else if (f.type === 'select' || f.id.endsWith('_id')) {
                data[f.id] = el.value ? (+el.value || el.value) : null;
            } else {
                data[f.id] = el.value;
            }
        });

        const btn = document.querySelector(`#qe-${id} .btn--primary`);
        if (btn) { btn.disabled = true; btn.textContent = '💾 Saving...'; }

        try {
            const r = await this._safeFetch(cfg.apiEndpoint + '/' + id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (r.ok) {
                this.load();
                this._toast('✅ Saved');
            } else {
                const e = await r.json().catch(() => ({}));
                this._toast('❌ ' + (e.error || 'Save failed'));
                if (btn) { btn.disabled = false; btn.textContent = '💾 Update'; }
            }
        } catch (e) {
            this._toast('❌ Network error');
            if (btn) { btn.disabled = false; btn.textContent = '💾 Update'; }
        }
    },

    async toggleStatus(id) {
        const item = this.items.find(i => i.id === id);
        if (!item) return;
        const newStatus = item.status === 'published' ? 'draft' : 'published';
        if (newStatus === 'published') {
            if (!confirm(`Publish "${item.name || item.title}"?`)) return;
        }
        try {
            // Fetch full record, update only status
            const r = await fetch(this.cfg.apiEndpoint + '/' + id);
            if (!r.ok) return;
            const existing = await r.json();
            const updated = { ...existing, status: newStatus };
            const r2 = await this._safeFetch(this.cfg.apiEndpoint + '/' + id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated)
            });
            if (r2.ok) {
                item.status = newStatus;
                this._updateCounts();
                this.doFilter();
                this._toast(newStatus === 'published' ? '✅ Published' : '📝 Set to Draft');
            }
        } catch (e) { this._toast('❌ Failed'); }
    },

    async deleteItem(id) {
        const item = this.items.find(i => i.id === id);
        const name = item ? (item.name || item.title || 'this item') : 'this item';
        if (!confirm(`Move "${name}" to trash?\n\nThis cannot be undone.`)) return;
        try {
            const r = await this._safeFetch(this.cfg.apiEndpoint + '/' + id, { method: 'DELETE' });
            if (r.ok) {
                this.sel.delete(id);
                this._updateSelUI();
                this.load();
                this._toast('🗑️ Deleted');
            } else {
                const e = await r.json().catch(() => ({}));
                // Show dependency error clearly
                alert('⚠️ Cannot delete\n\n' + (e.error || e.message || 'This item has linked content. Remove dependencies first.'));
            }
        } catch (e) { this._toast('❌ Delete failed'); }
    },

    async applyBulk() {
        const action = document.getElementById('bulkAction').value;
        if (!action) return;
        if (!this.sel.size) return;
        const count = this.sel.size;
        if (!confirm(`Apply "${action}" to ${count} item(s)?`)) return;

        const btn = document.getElementById('bulkApplyBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Applying...'; }

        try {
            const r = await this._safeFetch(this.cfg.apiEndpoint + '/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [...this.sel], action })
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok) {
                this._toast(`✅ ${d.count || count} item(s) updated`);
                this.sel.clear();
                document.getElementById('bulkAction').value = '';
                this.load();
            } else {
                // Some may have failed (dependency conflicts) — show details
                const msg = d.error || d.message || 'Some items could not be updated';
                alert('⚠️ Bulk action partially failed:\n\n' + msg);
                this.load(); // reload to show current state
            }
        } catch (e) {
            this._toast('❌ Bulk action failed');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Apply'; }
            this._updateSelUI();
        }
    },

    // ── SELECTION ─────────────────────────────────────────
    toggleSel(id, checked) {
        if (checked) this.sel.add(id); else this.sel.delete(id);
        const row = document.getElementById('row-' + id);
        if (row) row.classList.toggle('selected', checked);
        this._updateSelUI();
    },

    toggleAll(checked) {
        document.querySelectorAll('#list input[type="checkbox"]').forEach(cb => {
            cb.checked = checked;
            const tr = cb.closest('tr');
            const id = tr ? +(tr.id.replace('row-', '') || 0) : 0;
            if (id) {
                if (checked) this.sel.add(id); else this.sel.delete(id);
                tr.classList.toggle('selected', checked);
            }
        });
        this._updateSelUI();
    },

    _updateSelUI() {
        const bar = document.getElementById('selectedBar');
        const count = document.getElementById('selectedCount');
        const applyBtn = document.getElementById('bulkApplyBtn');
        if (this.sel.size) {
            bar.style.display = 'flex';
            count.textContent = this.sel.size + ' selected';
            if (applyBtn) applyBtn.disabled = false;
        } else {
            bar.style.display = 'none';
            if (applyBtn) applyBtn.disabled = true;
        }
        // Sync header checkbox
        const selAll = document.getElementById('selAll');
        if (selAll) {
            const allIds = [...document.querySelectorAll('#list input[type="checkbox"]')]
                .map(cb => +(cb.closest('tr')?.id.replace('row-', '') || 0))
                .filter(Boolean);
            selAll.indeterminate = this.sel.size > 0 && this.sel.size < allIds.length;
            selAll.checked = allIds.length > 0 && allIds.every(id => this.sel.has(id));
        }
    },

    clearSel() {
        this.sel.clear();
        document.querySelectorAll('#list input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
            const tr = cb.closest('tr');
            if (tr) tr.classList.remove('selected');
        });
        document.getElementById('selAll').checked = false;
        this._updateSelUI();
    },

    // ── HELPERS ───────────────────────────────────────────
    _clearAllFilters() {
        document.getElementById('searchInput').value = '';
        (this.cfg.filters || []).forEach(f => {
            const el = document.getElementById(f.id);
            if (el) el.value = '';
            this.activeFilters[f.id] = '';
        });
        this.activeTab = '';
        document.querySelectorAll('.status-tab').forEach(t =>
            t.classList.toggle('active', t.dataset.status === '')
        );
        this.curPage = 1;
        this.doFilter();
    },

    _adminUrl(url) {
        if (!url) return '';
        if (url.startsWith('http')) return url;
        return 'https://enter.ginger.healthcare' + url;
    },

    _esc(s) {
        const d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    },

    _toast(msg, duration) {
        const t = document.getElementById('listingToast');
        if (!t) return;
        t.textContent = msg;
        t.className = 'listing-toast listing-toast--visible';
        clearTimeout(t._hide);
        t._hide = setTimeout(() => { t.className = 'listing-toast'; }, duration || 2800);
    },

    // ── KEYBOARD ──────────────────────────────────────────
    _initKeyboard() {
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                this.clearSel();
                document.querySelectorAll('.quick-edit-row').forEach(r => r.style.display = 'none');
            }
        });
    }
};

window.Listing = Listing;

})();
