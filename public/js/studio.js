/* ============================================================
   GINGER HEALTHCARE — UNIVERSAL STUDIO ENGINE  (studio.js)
   Reads window.STUDIO config and builds the complete editor.

   Each CPT page only needs a small <script> block with:
   window.STUDIO = {
       cpt, apiEndpoint, aiType, backUrl, titlePlaceholder,
       permalinkBase(item), viewUrl(item),
       metaFields: [ { id, label, type, width, placeholder, source } ],
       // optional:
       galleries:  [ { id, label } ],
       junctions:  [ { id, label, source } ],
       publishValidations: [ { field, message } ]
   }
   ============================================================ */

(function() {
'use strict';

// ── WAIT FOR DOM ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    if (!window.STUDIO) { console.error('studio.js: window.STUDIO config not found.'); return; }
    Studio.init(window.STUDIO);
});

// ── MAIN STUDIO OBJECT ────────────────────────────────────────
const Studio = {
    cfg: null,
    quill: null,
    editId: null,
    slugEdited: false,
    autoSaveTimer: null,
    mpMode: 'insert',
    mpMedia: [],
    mpSelected: null,
    mpSaveTimer: null,
    currentEditImg: null,
    imgOrigW: 0,
    imgOrigH: 0,
    imgAspectLocked: true,
    isDirty: false,        // true only when there are unsaved changes
    isSaving: false,       // true while a save request is in flight
    _preAiHtml: null,      // stores HTML before AI rewrites for one-level undo

    // ── INIT ────────────────────────────────────────────────
    init(cfg) {
        this.cfg = cfg;
        this.editId = this._getEditId();
        this._buildDOM();
        this._initQuill();
        this._initImageHandlers();
        this._initImageResize();
        this._initMediaPicker();
        this._initKeyboard();
        this._loadSelectSources().then(() => {
            if (this.editId) this._loadItem();
        });
        if (cfg.onInit) cfg.onInit(this);
    },

    _getEditId() {
        const parts = window.location.pathname.split('/');
        // pattern: /cpt/edit/123
        const idx = parts.indexOf('edit');
        return idx !== -1 && parts[idx + 1] ? parts[idx + 1] : null;
    },

    // ── BUILD DOM ───────────────────────────────────────────
    _buildDOM() {
        const cfg = this.cfg;
        document.title = (this.editId ? 'Edit' : 'New') + ' ' + this._cptLabel() + ' | Ginger Admin';

        document.body.innerHTML = `
        ${this._tplTopbar()}
        <div class="studio-wrap">
            ${this._tplEditorPanel()}
            ${this._tplSidebar()}
        </div>
        ${this._tplMediaPicker()}
        ${this._tplImgEditModal()}
        <div class="studio-toast" id="studioToast"></div>
        <div class="studio-img-size-badge" id="imgSizeBadge"></div>
        `;

        // Inject CPT custom slot if provided
        const slot = document.getElementById('studio-custom-slot');
        if (slot && cfg.customSlot) slot.innerHTML = cfg.customSlot;
    },

    _cptLabel() {
        const c = this.cfg.cpt || '';
        return c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, ' ');
    },

    _tplTopbar() {
        const cfg = this.cfg;
        return `
        <div class="studio-topbar">
            <a href="${cfg.backUrl || '/' + cfg.cpt + 's'}" class="studio-topbar__back">← Back</a>
            <div class="studio-topbar__title" id="topTitle">New ${this._cptLabel()}</div>
            <span class="studio-topbar__status studio-topbar__status--draft" id="topStatus">DRAFT</span>
            <span class="studio-topbar__saved" id="topSaved">✓ Saved</span>
            <span class="studio-topbar__shortcut" title="Keyboard shortcuts: Ctrl+S = save, Escape = close modals">⌨ Ctrl+S</span>
            <div class="studio-topbar__actions">
                <button class="studio-topbar__btn studio-topbar__btn--save" onclick="Studio.saveItem('draft')">Save Draft</button>
                <button class="studio-topbar__btn studio-topbar__btn--publish" id="topPublishBtn" onclick="Studio.saveItem('published')">🚀 Publish</button>
            </div>
        </div>
        <div class="studio-progress" id="studioProgress">
            <div class="studio-progress__bar" id="studioProgressBar"></div>
        </div>`;
    },

    _tplEditorPanel() {
        const cfg = this.cfg;
        const titlePlaceholder = cfg.titlePlaceholder || (this._cptLabel() + ' name...');

        // Meta fields rendered as a row below the description
        let metaFieldsHtml = '';
        if (cfg.metaFields && cfg.metaFields.length) {
            const fieldsHtml = cfg.metaFields.map(f => this._tplMetaField(f)).join('');
            metaFieldsHtml = `<div class="studio-meta-fields" id="studioMetaFields">${fieldsHtml}</div>`;
        }

        return `
        <div class="studio-editor-panel">
            <div class="studio-title-area">
                <input type="text" class="studio-title-input" id="studioName"
                    placeholder="${titlePlaceholder}"
                    oninput="Studio.autoSlug();Studio.updateTopTitle()">
                <div class="studio-permalink">
                    <span>Permalink:</span>
                    <span id="permalinkBase" style="color:var(--gray-500)">${cfg.permalinkBase ? cfg.permalinkBase({}) : (cfg.cpt + 's/')}...</span>
                    <input type="text" id="studioSlug" placeholder="${cfg.cpt}-slug"
                        oninput="Studio.slugEdited=true;Studio.updatePermalinkSlug()">
                    <button class="studio-permalink__edit" onclick="document.getElementById('studioSlug').focus()">Edit</button>
                </div>
            </div>
            <div class="studio-desc-area">
                <label>Short Description</label>
                <input type="text" id="studioDescription"
                    placeholder="Brief overview shown in listings and search results...">
            </div>
            ${metaFieldsHtml}
            <div id="studio-custom-slot"></div>
            <div class="studio-import-bar">
                <button class="studio-import-btn studio-import-btn--primary" onclick="Studio.openMediaPicker('insert')">🖼 Add Media</button>
                <label class="studio-import-btn">
                    <input type="file" style="display:none" accept=".docx,.doc,.txt,image/*" onchange="Studio.importFile(this)">
                    📄 Import from Word
                </label>
                <span class="studio-import-hint">Tip: Paste images directly into the editor</span>
            </div>
            <div class="studio-editor-toolbar">
                <div class="studio-tabs">
                    <button class="studio-tab active" id="tabWrite" onclick="Studio.showTab('write')">✏ Write</button>
                    <button class="studio-tab" id="tabPreview" onclick="Studio.showTab('preview')">👁 Preview</button>
                </div>
                <div class="studio-editor-stats"><span id="studioWordCount">0 words</span></div>
            </div>
            <div class="studio-editor-wrap" id="studioEditorWrap"><div id="studioEditor"></div></div>
            <div class="studio-preview-pane" id="studioPreviewPane"></div>
        </div>`;
    },

    _tplMetaField(f) {
        const w = f.width ? `style="width:${f.width}"` : '';
        const flex = f.flex ? `style="flex:${f.flex}"` : '';
        if (f.type === 'select') {
            return `<div class="studio-meta-field" ${f.flex ? `style="flex:${f.flex}"` : ''}>
                <label>${f.label}</label>
                <select id="${f.id}" ${w} onchange="Studio.onMetaFieldChange('${f.id}')">
                    <option value="">Select ${f.label.toLowerCase()}...</option>
                </select>
            </div>`;
        }
        if (f.type === 'textarea') {
            return `<div class="studio-meta-field" ${flex}>
                <label>${f.label}</label>
                <textarea id="${f.id}" placeholder="${f.placeholder || ''}" ${w}></textarea>
            </div>`;
        }
        return `<div class="studio-meta-field" ${flex}>
            <label>${f.label}</label>
            <input type="${f.type || 'text'}" id="${f.id}"
                placeholder="${f.placeholder || ''}" ${w}>
        </div>`;
    },

    _tplSidebar() {
        return `
        <div class="studio-sidebar">
            ${this._tplPublishBox()}
            ${this._tplFeaturedImageBox()}
            ${this._tplSeoBox()}
            ${this._tplContentAnalysisBox()}
        </div>`;
    },

    _tplPublishBox() {
        return `
        <div class="sb-box sb-box--publish">
            <div class="sb-box__head" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="sb-box__title">📋 Publish</div>
                <span class="sb-box__toggle">▾</span>
            </div>
            <div class="sb-box__body">
                <div class="publish-row"><span>📌</span><strong>Status:</strong><span id="pubStatus">Draft</span></div>
                <div class="publish-row"><span>⭐</span><strong>Featured:</strong><span id="pubFeatured">No</span></div>
                <div class="publish-row"><span>📊</span><strong>SEO:</strong><span class="seo-badge seo-badge--gray" id="seoBadge">0 / 100</span></div>
                <select class="sb-select" id="studioStatus" onchange="Studio.updatePublishUI()">
                    <option value="draft">📝 Draft</option>
                    <option value="published">✅ Published</option>
                </select>
                <div style="display:flex;gap:10px;margin-bottom:6px">
                    <div style="flex:1">
                        <div class="sb-label">Featured</div>
                        <select class="sb-select" id="studioIsFeatured" style="margin-bottom:0">
                            <option value="false">No</option>
                            <option value="true">Yes ⭐</option>
                        </select>
                    </div>
                    <div style="flex:1">
                        <div class="sb-label">Order</div>
                        <input class="sb-input" type="number" id="studioDisplayOrder" value="0" style="margin-bottom:0">
                    </div>
                </div>
                <div class="publish-btns">
                    <button class="btn-save-draft" onclick="Studio.saveItem('draft')">Save Draft</button>
                    <button class="btn-publish" id="sbPublishBtn" onclick="Studio.saveItem('published')">🚀 Publish</button>
                </div>
            </div>
        </div>`;
    },

    _tplFeaturedImageBox() {
        return `
        <div class="sb-box">
            <div class="sb-box__head" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="sb-box__title">🖼 Featured Image</div>
                <span class="sb-box__toggle">▾</span>
            </div>
            <div class="sb-box__body">
                <div id="featImgBox" style="cursor:pointer" onclick="Studio.openMediaPicker('featured')">
                    <img class="feat-img-preview" id="featImgPreview">
                    <div class="feat-img-empty" id="featImgEmpty">
                        <div style="font-size:1.5rem;margin-bottom:4px">🖼</div>
                        Click to set featured image
                    </div>
                </div>
                <div id="featImgActions" style="display:none;margin-top:6px">
                    <div class="feat-img-btns">
                        <button class="feat-img-btn" onclick="Studio.openMediaPicker('featured')">Change</button>
                        <button class="feat-img-btn" onclick="Studio.removeFeatImage()" style="color:#EF4444">Remove</button>
                    </div>
                </div>
                <input type="hidden" id="studioImage">
            </div>
        </div>`;
    },

    _tplSeoBox() {
        return `
        <div class="sb-box">
            <div class="sb-box__head" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="sb-box__title">🔍 SEO Settings</div>
                <span class="sb-box__toggle">▾</span>
            </div>
            <div class="sb-box__body">
                <div class="sb-label">Meta Title <span class="char-count" id="metaTitleCount">0/60</span></div>
                <input class="sb-input" id="studioMetaTitle" placeholder="SEO title"
                    oninput="Studio.updateCharCount('studioMetaTitle','metaTitleCount',60);Studio.analyzeSEO()">
                <div class="sb-label">Meta Description <span class="char-count" id="metaDescCount">0/160</span></div>
                <textarea class="sb-textarea" id="studioMetaDesc" placeholder="SEO description"
                    oninput="Studio.updateCharCount('studioMetaDesc','metaDescCount',160);Studio.analyzeSEO()"></textarea>
                <div class="ai-helpers">
                    <button class="ai-btn" onclick="Studio.aiAction('seo')">🏷 Auto SEO</button>
                    <button class="ai-btn" onclick="Studio.aiAction('optimize')">🎯 Optimize</button>
                    <button class="ai-btn" onclick="Studio.aiAction('grammar')">✏ Grammar</button>
                    <button class="ai-btn" onclick="Studio.aiAction('headings')">📑 Headings</button>
                    <button class="ai-btn" onclick="Studio.cleanSpacing()">🧹 Clean Spacing</button>
                </div>
            </div>
        </div>`;
    },

    _tplContentAnalysisBox() {
        return `
        <div class="sb-box">
            <div class="sb-box__head" onclick="this.parentElement.classList.toggle('collapsed')">
                <div class="sb-box__title">📊 Content Analysis</div>
                <span class="sb-box__toggle">▾</span>
            </div>
            <div class="sb-box__body" id="contentAnalysis">
                <div class="analysis-item">Start writing to see analysis...</div>
            </div>
        </div>`;
    },

    _tplMediaPicker() {
        return `
        <div class="mp-overlay" id="mediaPicker" onclick="if(event.target===this)Studio.closeMediaPicker()">
        <div class="mp-modal">
            <div class="mp-header">
                <h3 id="mpTitle">Insert Media</h3>
                <button class="mp-close" onclick="Studio.closeMediaPicker()">&times;</button>
            </div>
            <div class="mp-tabs">
                <button class="mp-tab active" onclick="Studio.mpSwitchTab('library',this)">Media Library</button>
                <button class="mp-tab" onclick="Studio.mpSwitchTab('upload',this)">Upload Files</button>
            </div>
            <div class="mp-content">
                <div class="mp-body">
                    <div id="mpLibraryView">
                        <div style="margin-bottom:12px">
                            <input type="text" style="width:100%;padding:7px 12px;border:1px solid var(--gray-200);border-radius:6px;font-size:.82rem;font-family:inherit"
                                id="mpSearch" placeholder="Search media..." oninput="Studio.mpFilter()">
                        </div>
                        <div class="mp-grid" id="mpGrid">
                            <div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--gray-400)">Loading...</div>
                        </div>
                    </div>
                    <div id="mpUploadView" style="display:none">
                        <div class="mp-upload-zone" id="mpUploadZone">
                            <input type="file" id="mpFileInput" style="display:none" accept="image/*" multiple onchange="Studio.mpUploadFiles(this)">
                            <div style="font-size:2.5rem;margin-bottom:8px">📁</div>
                            <p style="color:var(--gray-500);font-weight:600">Click to upload or drag and drop</p>
                            <p style="font-size:.82rem;color:var(--gray-400);margin-top:4px">JPG, PNG, GIF, WebP — Max 10MB</p>
                            <div class="mp-upload-progress" id="mpUploadProgress"></div>
                        </div>
                    </div>
                </div>
                <div class="mp-sidebar" id="mpSidebar">
                    <img class="mp-sidebar__img" id="mpSidebarImg">
                    <div class="mp-sidebar__name" id="mpSidebarName"></div>
                    <div class="mp-sidebar__meta" id="mpSidebarMeta"></div>
                    <label>Alt Text</label>
                    <input type="text" id="mpAltText" placeholder="Describe the image" oninput="Studio.mpSaveMetadata()">
                    <label>Title</label>
                    <input type="text" id="mpTitleField" placeholder="Image title" oninput="Studio.mpSaveMetadata()">
                    <label>Caption</label>
                    <textarea id="mpCaption" rows="2" placeholder="Caption" oninput="Studio.mpSaveMetadata()"></textarea>
                    <label>File URL</label>
                    <div class="url-row">
                        <input type="text" id="mpFileUrl" readonly onclick="Studio.mpCopyUrl()">
                        <button class="copy-btn" onclick="Studio.mpCopyUrl()">Copy</button>
                    </div>
                </div>
            </div>
            <div class="mp-footer">
                <button class="btn btn-danger" id="mpDelBtn" disabled onclick="Studio.mpDelete()">🗑 Delete</button>
                <div class="mp-footer__info" id="mpFooterInfo"></div>
                <button class="btn btn-primary" id="mpConfirmBtn" disabled onclick="Studio.mpConfirm()">Insert into editor</button>
            </div>
        </div>
        </div>`;
    },

    _tplImgEditModal() {
        return `
        <div class="img-edit-overlay" id="imgEditOverlay" onclick="if(event.target===this)Studio.closeImgEdit()">
        <div class="img-edit-modal">
            <div class="img-edit-header">
                <h3>Image Details</h3>
                <button class="mp-close" onclick="Studio.closeImgEdit()">&times;</button>
            </div>
            <div class="img-edit-body">
                <img class="img-edit-preview" id="imgEditPreview">
                <div class="img-edit-field">
                    <label>Alt Text (for SEO &amp; accessibility)</label>
                    <input type="text" id="imgEditAlt" placeholder="Describe the image...">
                    <div class="hint">Leave empty if purely decorative.</div>
                </div>
                <div class="img-edit-field">
                    <label>Caption (shown below image)</label>
                    <input type="text" id="imgEditCaption" placeholder="Optional caption...">
                </div>
                <div class="img-edit-section">
                    <h4>Display Settings</h4>
                    <label style="font-size:.78rem;font-weight:600;color:var(--gray-500);margin-bottom:6px;display:block">Alignment</label>
                    <div class="align-btns">
                        <button class="align-btn" data-align="left"   onclick="Studio.setImgAlign('left',this)">◧ Left</button>
                        <button class="align-btn" data-align="center" onclick="Studio.setImgAlign('center',this)">◻ Center</button>
                        <button class="align-btn" data-align="right"  onclick="Studio.setImgAlign('right',this)">◨ Right</button>
                        <button class="align-btn active" data-align="none" onclick="Studio.setImgAlign('none',this)">▬ None</button>
                    </div>
                    <label style="font-size:.78rem;font-weight:600;color:var(--gray-500);margin-bottom:6px;display:block">Size</label>
                    <div class="size-presets">
                        <button class="size-preset" onclick="Studio.setImgSizePreset(25,this)">25%</button>
                        <button class="size-preset" onclick="Studio.setImgSizePreset(50,this)">50%</button>
                        <button class="size-preset" onclick="Studio.setImgSizePreset(75,this)">75%</button>
                        <button class="size-preset active" onclick="Studio.setImgSizePreset(100,this)">100%</button>
                    </div>
                    <div class="size-inputs">
                        <div>
                            <label style="font-size:.7rem;color:var(--gray-400);display:block;margin-bottom:2px">Width</label>
                            <input type="number" id="imgEditW" min="20" step="1" oninput="Studio.onImgDimChange('w')">
                        </div>
                        <span class="sep" style="margin-top:14px">×</span>
                        <div>
                            <label style="font-size:.7rem;color:var(--gray-400);display:block;margin-bottom:2px">Height</label>
                            <input type="number" id="imgEditH" min="20" step="1" oninput="Studio.onImgDimChange('h')">
                        </div>
                        <button class="lock-btn locked" id="imgAspectLock" onclick="Studio.toggleAspectLock()" title="Lock aspect ratio" style="margin-top:14px">🔗</button>
                        <span style="font-size:.7rem;color:var(--gray-400);margin-top:14px">px</span>
                    </div>
                </div>
                <div class="img-edit-actions">
                    <label class="btn btn-replace">🔄 Replace<input type="file" accept="image/*" onchange="Studio.replaceEditorImage(this)"></label>
                    <button class="btn btn-remove" onclick="Studio.removeEditorImage()">🗑 Remove</button>
                    <button class="btn btn-done"   onclick="Studio.applyImgEdit()">✅ Done</button>
                </div>
            </div>
        </div>
        </div>`;
    },

    // ── QUILL ────────────────────────────────────────────────
    _initQuill() {
        this.quill = new Quill('#studioEditor', {
            theme: 'snow',
            placeholder: 'Write detailed content...',
            modules: {
                toolbar: {
                    container: [
                        [{ header: [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ color: [] }, { background: [] }],
                        [{ list: 'ordered' }, { list: 'bullet' }],
                        ['blockquote', 'code-block'],
                        ['link', 'image'],
                        [{ align: [] }],
                        ['clean']
                    ],
                    handlers: { image: () => this.openMediaPicker('insert') }
                },
                clipboard: { matchVisual: false }
            }
        });
        this.quill.on('text-change', () => {
            this.isDirty = true;
            this.updateStats();
            this.analyzeSEO();
            this._resetAutoSave();
        });
    },

    // ── IMAGE HANDLERS ──────────────────────────────────────
    _initImageHandlers() {
        const q = this.quill;

        // Paste: intercept images, upload them
        q.root.addEventListener('paste', (e) => {
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    e.preventDefault();
                    const file = items[i].getAsFile();
                    this.showToast('📤 Uploading pasted image...');
                    this._uploadImage(file).then(url => {
                        if (url) {
                            const range = q.getSelection(true);
                            const idx = range ? range.index : q.getLength();
                            q.insertEmbed(idx, 'image', url);
                            q.setSelection(idx + 1);
                            this.showToast('✅ Image inserted');
                        }
                    });
                    return;
                }
            }
            setTimeout(() => this._fixPastedImages(), 500);
        });

        // Drop images
        q.root.addEventListener('drop', (e) => {
            const files = e.dataTransfer ? e.dataTransfer.files : [];
            for (let i = 0; i < files.length; i++) {
                if (files[i].type.startsWith('image/')) {
                    e.preventDefault();
                    this.showToast('📤 Uploading...');
                    this._uploadImage(files[i]).then(url => {
                        if (url) {
                            const range = q.getSelection(true);
                            q.insertEmbed(range ? range.index : q.getLength(), 'image', url);
                            this.showToast('✅ Image inserted');
                        }
                    });
                }
            }
        });

        // Click image → native select (enables Ctrl+C/X)
        q.root.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'IMG') {
                if (!e.target.classList.contains('ql-img-selected')) {
                    e.preventDefault();
                    e.stopPropagation();
                    this._clearImgSelection();
                    e.target.classList.add('ql-img-selected');
                    this.currentEditImg = e.target;
                    this._nativeSelectNode(e.target);
                }
            } else {
                this._clearImgSelection();
            }
        });

        // Double-click → image details modal
        q.root.addEventListener('dblclick', (e) => {
            if (e.target.tagName === 'IMG') {
                this.currentEditImg = e.target;
                this.openImgEdit(e.target);
            }
        });

        // Click outside editor clears selection
        document.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.studio-editor-wrap') &&
                !e.target.closest('.img-edit-overlay') &&
                !e.target.closest('.mp-overlay')) {
                this._clearImgSelection();
            }
        });

        // If image removed by Quill, clean up reference
        q.on('text-change', () => {
            if (this.currentEditImg && !document.contains(this.currentEditImg)) {
                this.currentEditImg = null;
            }
        });

        // Prevent native HTML5 drag on images (use manual drag below)
        q.root.addEventListener('dragstart', (e) => {
            if (e.target.tagName === 'IMG') e.preventDefault();
        });

        // Manual image drag-to-reposition
        this._initImageDrag();

        // Delete/Backspace on selected image
        q.root.addEventListener('keydown', (e) => {
            if (!this.currentEditImg) return;
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                e.stopPropagation();
                this.currentEditImg.remove();
                this._clearImgSelection();
                this.showToast('🗑 Image removed');
            }
        });
    },

    _initImageDrag() {
        const q = this.quill;
        let dragImg = null, dropMarker = null, clone = null, isDragging = false;

        q.root.addEventListener('mousedown', (e) => {
            if (e.target.tagName !== 'IMG' || !e.target.classList.contains('ql-img-selected')) return;
            const img = e.target;
            const startX = e.clientX, startY = e.clientY;
            let moved = false;

            const onMove = (ev) => {
                const dx = ev.clientX - startX, dy = ev.clientY - startY;
                if (!moved && Math.abs(dx) + Math.abs(dy) < 8) return;
                if (!moved) {
                    moved = true; isDragging = true; dragImg = img;
                    img.style.opacity = '0.3';
                    clone = img.cloneNode(true);
                    clone.style.cssText = 'position:fixed;pointer-events:none;z-index:99999;opacity:.8;border-radius:6px;box-shadow:0 8px 25px rgba(0,0,0,.3);max-width:200px;max-height:150px;';
                    document.body.appendChild(clone);
                    dropMarker = document.createElement('div');
                    dropMarker.style.cssText = 'height:3px;background:#0EA5A0;border-radius:2px;margin:4px 0;pointer-events:none;';
                }
                if (clone) { clone.style.left = (ev.clientX + 10) + 'px'; clone.style.top = (ev.clientY + 10) + 'px'; }
                const el = document.elementFromPoint(ev.clientX, ev.clientY);
                if (el && el.closest('.ql-editor')) {
                    const block = el.closest('p,h1,h2,h3,h4,li,blockquote') || el;
                    if (block && block.parentNode === q.root && block !== dropMarker) {
                        const rect = block.getBoundingClientRect();
                        if (dropMarker.parentNode) dropMarker.remove();
                        ev.clientY < rect.top + rect.height / 2
                            ? q.root.insertBefore(dropMarker, block)
                            : block.nextSibling
                                ? q.root.insertBefore(dropMarker, block.nextSibling)
                                : q.root.appendChild(dropMarker);
                    }
                }
            };

            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                if (moved && dragImg && dropMarker && dropMarker.parentNode) {
                    const newP = document.createElement('p');
                    const newImg = dragImg.cloneNode(true);
                    newImg.classList.remove('ql-img-selected');
                    newP.appendChild(newImg);
                    dropMarker.parentNode.insertBefore(newP, dropMarker);
                    (dragImg.closest('p,div') || dragImg).remove();
                    dropMarker.remove();
                    setTimeout(() => { newImg.classList.add('ql-img-selected'); this.currentEditImg = newImg; }, 50);
                } else {
                    if (dropMarker && dropMarker.parentNode) dropMarker.remove();
                }
                if (dragImg) dragImg.style.opacity = '1';
                if (clone) clone.remove();
                dragImg = null; clone = null; dropMarker = null;
                setTimeout(() => { isDragging = false; }, 50);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    },

    _initImageResize() {
        const badge = document.getElementById('imgSizeBadge');
        let observing = null;
        const ro = new ResizeObserver(entries => {
            for (const entry of entries) {
                const img = entry.target;
                if (img.tagName !== 'IMG') continue;
                const w = Math.round(entry.contentRect.width);
                const h = Math.round(entry.contentRect.height);
                if (w > 0 && h > 0) {
                    img.setAttribute('width', w);
                    img.setAttribute('height', h);
                    badge.textContent = w + ' × ' + h;
                    badge.style.display = 'block';
                    const rect = img.getBoundingClientRect();
                    badge.style.left = (rect.right - 80) + 'px';
                    badge.style.top  = (rect.bottom + 4) + 'px';
                    clearTimeout(badge._hide);
                    badge._hide = setTimeout(() => { badge.style.display = 'none'; }, 1200);
                }
            }
        });
        new MutationObserver(() => {
            const sel = this.quill.root.querySelector('.ql-img-selected');
            if (sel && sel !== observing) {
                if (observing) ro.unobserve(observing);
                ro.observe(sel); observing = sel;
            } else if (!sel && observing) {
                ro.unobserve(observing); observing = null;
            }
        }).observe(this.quill.root, { attributes: true, subtree: true, attributeFilter: ['class'] });
    },

    _nativeSelectNode(node) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNode(node);
        sel.removeAllRanges();
        sel.addRange(range);
    },

    _clearImgSelection() {
        this.quill.root.querySelectorAll('.ql-img-selected').forEach(i => i.classList.remove('ql-img-selected'));
        this.currentEditImg = null;
    },

    // ── IMAGE UPLOAD ────────────────────────────────────────
    async _uploadImage(file) {
        const fd = new FormData();
        fd.append('file', file);
        try {
            const r = await fetch('/api/media/upload', { method: 'POST', body: fd });
            if (r.ok) { const d = await r.json(); return d.url; }
            const err = await r.text();
            console.error('Upload failed:', r.status, err);
            this.showToast('❌ Upload failed (' + r.status + ')');
        } catch(e) {
            console.error('Upload error:', e);
            this.showToast('❌ Network error');
        }
        return null;
    },

    async _fixPastedImages() {
        const imgs = this.quill.root.querySelectorAll('img[src^="data:"]');
        let count = 0;
        for (const img of imgs) {
            try {
                const blob = this._dataUrlToBlob(img.src);
                const file = new File([blob], 'pasted-' + Date.now() + '.png', { type: blob.type });
                const url = await this._uploadImage(file);
                if (url) { img.src = url; count++; }
            } catch(e) {}
        }
        if (count) this.showToast('✅ ' + count + ' image(s) uploaded');
        this.quill.root.querySelectorAll('img').forEach(img => {
            if (img.src.startsWith('file:///') || img.src === '//:0' || img.src.endsWith(':0')) {
                const p = document.createElement('p');
                p.innerHTML = '<span style="background:#FEF3C7;color:#92400E;padding:6px 12px;border-radius:6px;font-size:.85rem;display:inline-block">⚠️ Image couldn\'t paste from Word. Use "Add Media" to insert it.</span>';
                img.parentNode.replaceChild(p, img);
            }
        });
    },

    _dataUrlToBlob(dataurl) {
        const arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]); let n = bstr.length; const u8 = new Uint8Array(n);
        while (n--) u8[n] = bstr.charCodeAt(n);
        return new Blob([u8], { type: mime });
    },

    // ── IMAGE EDIT MODAL ────────────────────────────────────
    openImgEdit(img) {
        document.getElementById('imgEditPreview').src = img.src;
        document.getElementById('imgEditAlt').value     = img.alt || '';
        document.getElementById('imgEditCaption').value = img.dataset.caption || '';
        this.imgOrigW = img.naturalWidth || img.width;
        this.imgOrigH = img.naturalHeight || img.height;
        document.getElementById('imgEditW').value = img.width  || this.imgOrigW;
        document.getElementById('imgEditH').value = img.height || this.imgOrigH;
        this.imgAspectLocked = true;
        document.getElementById('imgAspectLock').classList.add('locked');
        const align = ['left','center','right'].find(a => img.classList.contains('img-align-' + a)) || 'none';
        document.querySelectorAll('.align-btn').forEach(b => b.classList.toggle('active', b.dataset.align === align));
        const pct = img.width && this.imgOrigW ? Math.round(img.width / this.imgOrigW * 100) : 100;
        document.querySelectorAll('.size-preset').forEach(b => b.classList.remove('active'));
        const match = [25,50,75,100].find(p => Math.abs(p - pct) < 8);
        if (match) { const mb = document.querySelector(`.size-preset[onclick*="${match}"]`); if (mb) mb.classList.add('active'); }
        document.getElementById('imgEditOverlay').classList.add('active');
    },

    closeImgEdit() {
        document.getElementById('imgEditOverlay').classList.remove('active');
        if (this.currentEditImg) this.currentEditImg.classList.remove('ql-img-selected');
        this.currentEditImg = null;
    },

    setImgAlign(align, btn) {
        document.querySelectorAll('.align-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    },

    setImgSizePreset(pct, btn) {
        document.querySelectorAll('.size-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (!this.currentEditImg || !this.imgOrigW) return;
        document.getElementById('imgEditW').value = Math.round(this.imgOrigW * pct / 100);
        document.getElementById('imgEditH').value = Math.round(this.imgOrigH * pct / 100);
    },

    onImgDimChange(which) {
        if (!this.imgAspectLocked || !this.imgOrigW || !this.imgOrigH) return;
        const ratio = this.imgOrigW / this.imgOrigH;
        if (which === 'w') {
            const w = parseInt(document.getElementById('imgEditW').value) || 0;
            document.getElementById('imgEditH').value = Math.round(w / ratio);
        } else {
            const h = parseInt(document.getElementById('imgEditH').value) || 0;
            document.getElementById('imgEditW').value = Math.round(h * ratio);
        }
        const newW = parseInt(document.getElementById('imgEditW').value);
        const pct = this.imgOrigW ? Math.round(newW / this.imgOrigW * 100) : 100;
        document.querySelectorAll('.size-preset').forEach(b => b.classList.remove('active'));
        const m = [25,50,75,100].find(p => Math.abs(p - pct) < 5);
        if (m) { const mb = document.querySelector(`.size-preset[onclick*="${m}"]`); if (mb) mb.classList.add('active'); }
    },

    toggleAspectLock() {
        this.imgAspectLocked = !this.imgAspectLocked;
        const btn = document.getElementById('imgAspectLock');
        btn.classList.toggle('locked', this.imgAspectLocked);
        btn.textContent = this.imgAspectLocked ? '🔗' : '🔓';
    },

    applyImgEdit() {
        if (this.currentEditImg) {
            this.currentEditImg.alt = document.getElementById('imgEditAlt').value;
            this.currentEditImg.dataset.caption = document.getElementById('imgEditCaption').value;
            const w = parseInt(document.getElementById('imgEditW').value);
            const h = parseInt(document.getElementById('imgEditH').value);
            if (w > 0) { this.currentEditImg.style.width = w + 'px'; this.currentEditImg.setAttribute('width', w); }
            if (h > 0) { this.currentEditImg.style.height = h + 'px'; this.currentEditImg.setAttribute('height', h); }
            const activeAlign = document.querySelector('.align-btn.active');
            const align = activeAlign ? activeAlign.dataset.align : 'none';
            this.currentEditImg.classList.remove('img-align-left','img-align-center','img-align-right','img-align-none');
            this.currentEditImg.classList.add('img-align-' + align);
            this.currentEditImg.style.maxWidth = (align === 'left' || align === 'right') ? (this.currentEditImg.style.width || '50%') : '100%';
        }
        this.closeImgEdit();
    },

    async replaceEditorImage(input) {
        const file = input.files[0]; if (!file || !this.currentEditImg) return; input.value = '';
        this.showToast('📤 Uploading replacement...');
        const url = await this._uploadImage(file);
        if (url) { this.currentEditImg.src = url; document.getElementById('imgEditPreview').src = url; this.showToast('✅ Image replaced'); }
        else this.showToast('❌ Upload failed');
    },

    removeEditorImage() {
        if (this.currentEditImg) { this.currentEditImg.remove(); this.closeImgEdit(); this.showToast('🗑 Image removed'); }
    },

    // ── MEDIA PICKER ────────────────────────────────────────
    _initMediaPicker() {
        const zone = document.getElementById('mpUploadZone');
        if (!zone) return;
        zone.addEventListener('click', e => { if (e.target.tagName !== 'INPUT') document.getElementById('mpFileInput').click(); });
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', e => {
            e.preventDefault(); zone.classList.remove('dragover');
            if (e.dataTransfer.files.length) { document.getElementById('mpFileInput').files = e.dataTransfer.files; this.mpUploadFiles(document.getElementById('mpFileInput')); }
        });
    },

    openMediaPicker(mode) {
        this.mpMode = mode;
        this.mpSelected = null;
        document.getElementById('mpConfirmBtn').disabled = true;
        document.getElementById('mpDelBtn').disabled = true;
        document.getElementById('mpSidebar').classList.remove('visible');
        document.getElementById('mpTitle').textContent       = mode === 'featured' ? 'Set Featured Image' : 'Insert Media';
        document.getElementById('mpConfirmBtn').textContent  = mode === 'featured' ? 'Set Featured Image' : 'Insert into editor';
        document.querySelectorAll('.mp-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
        document.getElementById('mpLibraryView').style.display = '';
        document.getElementById('mpUploadView').style.display  = 'none';
        document.getElementById('mediaPicker').classList.add('active');
        this._mpLoadMedia();
    },

    closeMediaPicker() { document.getElementById('mediaPicker').classList.remove('active'); },

    mpSwitchTab(tab, btn) {
        document.querySelectorAll('.mp-tab').forEach(t => t.classList.remove('active')); btn.classList.add('active');
        document.getElementById('mpLibraryView').style.display = tab === 'library' ? '' : 'none';
        document.getElementById('mpUploadView').style.display  = tab === 'upload'  ? '' : 'none';
        if (tab === 'library') this._mpLoadMedia();
    },

    async _mpLoadMedia() {
        try { const r = await fetch('/api/media'); if (r.ok) this.mpMedia = await r.json(); } catch(e) { this.mpMedia = []; }
        this._mpRenderGrid();
    },

    _mpRenderGrid() {
        const search = (document.getElementById('mpSearch').value || '').toLowerCase();
        const imgs = this.mpMedia.filter(m => m.mime_type && m.mime_type.startsWith('image/') && (!search || (m.original_name || '').toLowerCase().includes(search)));
        const grid = document.getElementById('mpGrid');
        if (!imgs.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--gray-400)">No images found.</div>'; return; }
        grid.innerHTML = imgs.map(m => {
            const sel = this.mpSelected && this.mpSelected.id === m.id ? ' selected' : '';
            return `<div class="mp-item${sel}" onclick="Studio.mpSelectItem(${m.id})"><img src="${m.url}" loading="lazy" alt="${m.alt_text || ''}"></div>`;
        }).join('');
    },

    mpFilter() { this._mpRenderGrid(); },

    mpSelectItem(id) {
        this.mpSelected = this.mpMedia.find(m => m.id === id);
        if (!this.mpSelected) return;
        this._mpRenderGrid();
        document.getElementById('mpConfirmBtn').disabled = false;
        document.getElementById('mpDelBtn').disabled = false;
        const sb = document.getElementById('mpSidebar');
        sb.classList.add('visible');
        document.getElementById('mpSidebarImg').src  = this.mpSelected.url;
        document.getElementById('mpSidebarName').textContent = this.mpSelected.original_name || 'Image';
        document.getElementById('mpSidebarMeta').textContent = (this.mpSelected.mime_type || '') + (this.mpSelected.size ? ' • ' + (this.mpSelected.size / 1024).toFixed(0) + ' KB' : '');
        document.getElementById('mpAltText').value   = this.mpSelected.alt_text || '';
        document.getElementById('mpTitleField').value = this.mpSelected.title   || '';
        document.getElementById('mpCaption').value   = this.mpSelected.caption  || '';
        document.getElementById('mpFileUrl').value   = this.mpSelected.url      || '';
        document.getElementById('mpFooterInfo').textContent = this.mpSelected.original_name || '';
    },

    mpSaveMetadata() {
        clearTimeout(this.mpSaveTimer);
        this.mpSaveTimer = setTimeout(() => {
            if (!this.mpSelected) return;
            fetch('/api/media/' + this.mpSelected.id, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alt_text: document.getElementById('mpAltText').value, title: document.getElementById('mpTitleField').value, caption: document.getElementById('mpCaption').value })
            }).then(r => r.json()).then(d => {
                if (this.mpSelected) { this.mpSelected.alt_text = d.alt_text; this.mpSelected.title = d.title; this.mpSelected.caption = d.caption; }
            }).catch(() => {});
        }, 1000);
    },

    mpCopyUrl() {
        navigator.clipboard.writeText(document.getElementById('mpFileUrl').value)
            .then(() => this.showToast('✅ URL copied'))
            .catch(() => document.getElementById('mpFileUrl').select());
    },

    mpConfirm() {
        if (!this.mpSelected) return;
        if (this.mpMode === 'featured') {
            document.getElementById('studioImage').value = this.mpSelected.url;
            this._setFeatImage(this.mpSelected.url);
        } else {
            const range = this.quill.getSelection(true);
            const idx = range ? range.index : this.quill.getLength();
            this.quill.insertEmbed(idx, 'image', this.mpSelected.url);
            this.quill.setSelection(idx + 1);
            setTimeout(() => {
                const imgs = this.quill.root.querySelectorAll(`img[src="${this.mpSelected.url}"]`);
                if (imgs.length && this.mpSelected.alt_text) imgs[imgs.length - 1].alt = this.mpSelected.alt_text;
            }, 100);
        }
        this.closeMediaPicker();
    },

    async mpDelete() {
        if (!this.mpSelected) return;
        if (!confirm('Delete this image permanently?')) return;
        try {
            const r = await fetch('/api/media/' + this.mpSelected.id, { method: 'DELETE' });
            if (r.ok) {
                this.mpSelected = null;
                document.getElementById('mpConfirmBtn').disabled = true;
                document.getElementById('mpDelBtn').disabled = true;
                document.getElementById('mpSidebar').classList.remove('visible');
                this._mpLoadMedia();
            } else { const e = await r.json(); alert(e.error || 'Delete failed'); }
        } catch(e) { alert('Delete failed'); }
    },

    async mpUploadFiles(input) {
        const files = input.files; if (!files.length) return;
        const prog = document.getElementById('mpUploadProgress'); prog.style.display = 'block';
        for (let i = 0; i < files.length; i++) {
            prog.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + '...';
            const fd = new FormData(); fd.append('file', files[i]);
            try { await fetch('/api/media/upload', { method: 'POST', body: fd }); } catch(e) {}
        }
        prog.textContent = '✅ Done!'; input.value = '';
        setTimeout(() => {
            prog.style.display = 'none';
            document.querySelectorAll('.mp-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
            document.getElementById('mpLibraryView').style.display = '';
            document.getElementById('mpUploadView').style.display  = 'none';
            this._mpLoadMedia();
        }, 800);
    },

    // ── FEATURED IMAGE ──────────────────────────────────────
    _setFeatImage(url) {
        const src = url.startsWith('http') ? url : 'https://enter.ginger.healthcare' + url;
        const img = document.getElementById('featImgPreview');
        img.src = src; img.style.display = 'block';
        document.getElementById('featImgEmpty').style.display   = 'none';
        document.getElementById('featImgActions').style.display = 'block';
    },

    removeFeatImage() {
        document.getElementById('studioImage').value = '';
        document.getElementById('featImgPreview').style.display = 'none';
        document.getElementById('featImgEmpty').style.display   = 'block';
        document.getElementById('featImgActions').style.display = 'none';
    },

    // ── WORD/FILE IMPORT ────────────────────────────────────
    async importFile(input) {
        const file = input.files[0]; if (!file) return; input.value = '';
        if (file.type.startsWith('image/')) {
            this.showToast('📤 Uploading...'); const url = await this._uploadImage(file);
            if (url) { const idx = this.quill.getSelection(true)?.index || this.quill.getLength(); this.quill.insertEmbed(idx, 'image', url); this.quill.insertText(idx + 1, '\n'); this.showToast('✅ Inserted'); }
            else this.showToast('❌ Failed'); return;
        }
        if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
            this.showToast('📄 Importing...');
            const fd = new FormData(); fd.append('file', file);
            try {
                const r = await fetch('/api/import/docx', { method: 'POST', body: fd });
                if (r.ok) { const d = await r.json(); if (d.html) { this.quill.root.innerHTML = d.html; this.updateStats(); this.analyzeSEO(); } this.showToast('✅ Imported'); }
                else this.showToast('❌ Failed');
            } catch(e) { this.showToast('❌ Failed'); }
            return;
        }
        if (file.name.endsWith('.txt') || file.name.endsWith('.md')) {
            const reader = new FileReader();
            reader.onload = e => { this.quill.root.innerHTML += e.target.result.replace(/\n/g, '<br>'); this.updateStats(); this.analyzeSEO(); this.showToast('✅ Imported'); };
            reader.readAsText(file); return;
        }
        alert('Supported: .docx, .txt, images');
    },

    // ── SELECT SOURCES (load dropdown options from API) ─────
    async _loadSelectSources() {
        const cfg = this.cfg;
        if (!cfg.metaFields) return;
        const selects = cfg.metaFields.filter(f => f.type === 'select' && f.source);
        await Promise.all(selects.map(async f => {
            try {
                const r = await fetch(f.source);
                if (!r.ok) return;
                const items = await r.json();
                const el = document.getElementById(f.id);
                if (!el) return;
                items.forEach(item => {
                    const o = document.createElement('option');
                    o.value = item.id;
                    o.textContent = (item.icon || '') + ' ' + (item.name || item.title || item.code || item.id);
                    o.dataset.slug = item.slug || '';
                    el.appendChild(o);
                });
            } catch(e) { console.error('Failed to load options for', f.id, e); }
        }));
    },

    // ── PERMALINK ───────────────────────────────────────────
    autoSlug() {
        if (!this.slugEdited && !this.editId) {
            const n = document.getElementById('studioName').value;
            document.getElementById('studioSlug').value = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        }
        this.updatePermalinkSlug();
    },

    updatePermalinkSlug() {
        const cfg = this.cfg;
        if (cfg.onPermalinkChange) {
            cfg.onPermalinkChange(this);
        }
    },

    onMetaFieldChange(id) {
        this.updatePermalinkSlug();
        if (this.cfg.onMetaFieldChange) this.cfg.onMetaFieldChange(id, this);
    },

    // ── LOAD & SAVE ─────────────────────────────────────────
    async _loadItem() {
        const cfg = this.cfg;
        try {
            const r = await fetch(cfg.apiEndpoint + '/' + this.editId);
            if (!r.ok) return;
            const item = await r.json();

            // Suppress dirty-marking while we populate fields programmatically
            this._loading = true;
            document.getElementById('studioName').value        = item.name || item.title || '';
            document.getElementById('studioSlug').value        = item.slug || '';
            this.slugEdited = true;
            document.getElementById('studioDescription').value = item.description || '';
            this.quill.root.innerHTML                          = item.long_description || '';
            document.getElementById('studioStatus').value      = item.status || 'draft';
            document.getElementById('studioIsFeatured').value  = item.is_featured ? 'true' : 'false';
            document.getElementById('studioDisplayOrder').value = item.display_order || 0;
            document.getElementById('studioMetaTitle').value   = item.meta_title || '';
            document.getElementById('studioMetaDesc').value    = item.meta_description || '';
            document.getElementById('studioImage').value       = item.image || '';

            // Fill meta fields
            if (cfg.metaFields) {
                cfg.metaFields.forEach(f => {
                    const el = document.getElementById(f.id);
                    if (el && item[f.id] !== undefined) el.value = item[f.id] || '';
                });
            }

            this.updateTopTitle();
            this.updatePublishUI();
            this.updateStats();
            this.analyzeSEO();
            document.getElementById('pubFeatured').textContent = item.is_featured ? 'Yes ⭐' : 'No';
            if (item.image) this._setFeatImage(item.image);
            this.updateCharCount('studioMetaTitle', 'metaTitleCount', 60);
            this.updateCharCount('studioMetaDesc',  'metaDescCount',  160);
            this.updatePermalinkSlug();

            // Let CPT handle anything custom (junction tables, galleries, etc.)
            if (cfg.onLoad) cfg.onLoad(item, this);

            // Show View link for any published item (on load or after redirect)
            if (item.status === 'published') {
                const viewUrl = cfg.viewUrl ? cfg.viewUrl(item) : '';
                if (viewUrl) this._setTopbarViewLink(viewUrl);
            }
            // Clean up ?published=1 from URL if present
            if (new URLSearchParams(window.location.search).get('published') === '1') {
                window.history.replaceState({}, '', window.location.pathname);
            }

            // Page just loaded — not dirty yet
            this._loading = false;
            this.isDirty = false;
        } catch(e) { console.error('Load error:', e); this._loading = false; }
    },

    _collectData(status) {
        const cfg = this.cfg;
        const data = {
            name:             document.getElementById('studioName').value,
            slug:             document.getElementById('studioSlug').value,
            description:      document.getElementById('studioDescription').value,
            long_description: this.quill.root.innerHTML === '<p><br></p>' ? '' : this.quill.root.innerHTML,
            image:            document.getElementById('studioImage').value,
            is_featured:      document.getElementById('studioIsFeatured').value === 'true',
            display_order:    parseInt(document.getElementById('studioDisplayOrder').value) || 0,
            meta_title:       document.getElementById('studioMetaTitle').value,
            meta_description: document.getElementById('studioMetaDesc').value,
            status:           status
        };
        // Auto-generate slug if empty
        if (!data.slug) data.slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        // Collect metaFields
        if (cfg.metaFields) {
            cfg.metaFields.forEach(f => {
                const el = document.getElementById(f.id);
                if (el) data[f.id] = el.value || null;
            });
        }
        // Let CPT add/override anything
        if (cfg.collectData) cfg.collectData(data, this);
        return data;
    },

    async saveItem(status) {
        const isAuto = status === 'auto';
        if (isAuto) status = document.getElementById('studioStatus').value;
        if (!status) status = document.getElementById('studioStatus').value || 'draft';

        // Prevent concurrent saves
        if (this.isSaving) return;
        this.isSaving = true;
        if (!isAuto) this._setSaveButtonState(true, status);

        const data = this._collectData(status);

        if (!data.name) {
            if (!isAuto) { alert('Name is required'); }
            this.isSaving = false;
            this._setSaveButtonState(false, status);
            return;
        }

        // Run publish validations from config
        if (!isAuto && status === 'published' && this.cfg.publishValidations) {
            for (const v of this.cfg.publishValidations) {
                const val = data[v.field];
                if (!val || val === '' || val === null) {
                    const el = document.getElementById(v.fieldId || v.field);
                    if (el) { el.focus(); el.style.border = '2px solid #EF4444'; setTimeout(() => el.style.border = '', 3000); }
                    alert(v.message); return;
                }
            }
        }
        // Featured image validation (opt-in via requireImage: true in config)
        if (!isAuto && status === 'published' && !data.image && this.cfg.requireImage !== false) {
            document.getElementById('featImgEmpty').style.borderColor = '#EF4444';
            setTimeout(() => document.getElementById('featImgEmpty').style.borderColor = '', 3000);
            alert('⚠️ Featured Image is required to publish.'); return;
        }

        try {
            const url    = this.editId ? this.cfg.apiEndpoint + '/' + this.editId : this.cfg.apiEndpoint;
            const method = this.editId ? 'PUT' : 'POST';
            const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            if (r.ok) {
                const result = await r.json();
                this.isDirty = false; // clear dirty flag — changes are saved

                // After first create, redirect to edit URL (preserves the new ID)
                if (!this.editId && result.id) {
                    // Build the edit URL, append ?published=1 so the edit page
                    // knows to show the View link immediately on load
                    const editUrl = this.cfg.editUrl
                        ? this.cfg.editUrl(result)
                        : '/' + this.cfg.cpt + 's/edit/' + result.id;
                    const sep = editUrl.includes('?') ? '&' : '?';
                    const flag = result.status === 'published' ? sep + 'published=1&slug=' + encodeURIComponent(result.slug || '') : '';
                    window.location.href = editUrl + flag;
                    return;
                }

                document.getElementById('studioStatus').value = result.status || status;
                this.updatePublishUI();

                if (isAuto) {
                    this.isDirty = false;
                    this.showToast('✓ Auto-saved');
                } else {
                    this._showSavedBanner(result);
                }
                if (this.cfg.onSave) this.cfg.onSave(result, this);
            } else {
                const e = await r.json(); if (!isAuto) alert(e.error || 'Save failed');
            }
        } catch(e) {
            if (!isAuto) alert('Save failed: ' + e.message);
        } finally {
            this.isSaving = false;
            this._setSaveButtonState(false, status);
        }
    },

    // ── AI ACTIONS ──────────────────────────────────────────
    async aiAction(type) {
        const btns = document.querySelectorAll('.ai-btn');
        const clickedBtn = document.querySelector(`.ai-btn[onclick*="'${type}'"]`) || document.querySelector(`.ai-btn[onclick*='"${type}"']`);
        const labels = { seo: '🏷 Auto SEO', optimize: '🎯 Optimize', grammar: '✏ Grammar', headings: '📑 Headings' };
        const workingLabels = { seo: '🏷 Generating...', optimize: '🎯 Optimising...', grammar: '✏ Fixing...', headings: '📑 Assigning...' };

        // Disable all buttons, transform clicked one
        btns.forEach(b => { b.disabled = true; b.style.opacity = '0.45'; });
        if (clickedBtn) {
            clickedBtn.style.opacity = '1';
            clickedBtn.innerHTML = '<span class="ai-spinner"></span>' + (workingLabels[type] || '🤖 Working...');
            clickedBtn.style.background = 'var(--teal)';
            clickedBtn.style.color = '#fff';
            clickedBtn.style.borderColor = 'var(--teal)';
        }

        // Start progress bar
        this._progressStart();
        this.showToast(workingLabels[type] || '🤖 Working...', 0); // 0 = stay until dismissed

        const name = document.getElementById('studioName').value || ('this ' + this._cptLabel().toLowerCase());
        const html = this.quill.root.innerHTML;
        const text = this.quill.getText().trim();
        const aiType = this.cfg.aiType || this.cfg.cpt || 'general';
        let prompt = '';

        if (type === 'seo') {
            prompt = `Generate meta title (max 60 chars), meta description (max 160 chars), and short description (max 200 chars) for "${name}". Return ONLY these three plain text lines:\nMeta Title: ...\nMeta Description: ...\nShort Description: ...`;
        } else if (type === 'optimize') {
            prompt = `Improve and expand this medical content about "${name}". Make it more detailed and engaging for international patients. Keep all HTML formatting. Return clean HTML only:\n\n${text.substring(0, 4000)}`;
        } else if (type === 'grammar') {
            prompt = `Fix grammar and improve readability. Keep all HTML structure. Return clean HTML only:\n\n${html.substring(0, 6000)}`;
        } else if (type === 'headings') {
            prompt = `Analyse this HTML content about "${name}" and assign correct heading levels (h2 for major sections, h3 for sub-sections). Rules: no h1 tags, don't change body text or lists, wrap plain section-title lines in the right heading tag. Return the COMPLETE corrected HTML only, no markdown:\n\n${html.substring(0, 8000)}`;
        }

        try {
            const r = await fetch('/api/ai/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, type: aiType, context: `${this._cptLabel()}: ${name}` })
            });
            if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Request failed (' + r.status + ')'); }
            const data = await r.json();
            const result = data.content || '';

            if (type === 'seo') {
                result.split('\n').forEach(line => {
                    if (line.toLowerCase().startsWith('meta title:'))       { const v = line.replace(/.*?:\s*/i,'').trim(); if (v) { document.getElementById('studioMetaTitle').value = v; this.updateCharCount('studioMetaTitle','metaTitleCount',60); } }
                    if (line.toLowerCase().startsWith('meta description:')) { const v = line.replace(/.*?:\s*/i,'').trim(); if (v) { document.getElementById('studioMetaDesc').value   = v; this.updateCharCount('studioMetaDesc','metaDescCount',160); } }
                    if (line.toLowerCase().startsWith('short description:')){ const v = line.replace(/.*?:\s*/i,'').trim(); if (v && v.length < 250) document.getElementById('studioDescription').value = v; }
                });
                this.analyzeSEO();
                this.showToast('✅ SEO tags generated!');
            } else {
                const cleaned = result.replace(/^```html?\n?/i,'').replace(/```$/m,'').trim();
                this._preAiHtml = html; // save for undo
                this.quill.root.innerHTML = cleaned;
                this.updateStats(); this.analyzeSEO();
                const msg = type === 'headings' ? '✅ Headings assigned!' : '✅ Content updated!';
                this._showUndoToast(msg);
            }
        } catch(e) {
            this.showToast('❌ ' + e.message);
            console.error('AI error:', e);
        } finally {
            // Always restore buttons and stop progress
            this._progressDone();
            btns.forEach(b => {
                b.disabled = false;
                b.style.opacity = '';
                b.style.background = '';
                b.style.color = '';
                b.style.borderColor = '';
            });
            if (clickedBtn) clickedBtn.innerHTML = labels[type] || type;
        }
    },

    // ── CLEAN SPACING ────────────────────────────────────────
    cleanSpacing() {
        const editor = this.quill.root;
        let changed = 0;

        // 1. Remove <br> tags that are the sole child of a <p> (empty paragraphs)
        editor.querySelectorAll('p').forEach(p => {
            const kids = Array.from(p.childNodes).filter(n => !(n.nodeType === 3 && n.textContent.trim() === ''));
            if (kids.length === 1 && kids[0].nodeName === 'BR') {
                p.remove(); changed++;
            }
        });

        // 2. Remove completely empty <p> tags (no text, no meaningful children)
        editor.querySelectorAll('p').forEach(p => {
            if (p.textContent.trim() === '' && !p.querySelector('img, iframe, video')) {
                p.remove(); changed++;
            }
        });

        // 3. Collapse runs of 3+ consecutive <br> tags anywhere in the editor
        editor.querySelectorAll('br').forEach(br => {
            let next = br.nextSibling;
            let count = 0;
            while (next && next.nodeName === 'BR') {
                const toRemove = next;
                next = next.nextSibling;
                toRemove.remove();
                count++; changed++;
            }
        });

        // 4. Remove blank paragraphs that appear between headings and their content
        //    i.e. h2/h3 immediately followed by an empty <p> before the real content
        editor.querySelectorAll('h1, h2, h3, h4').forEach(h => {
            let next = h.nextElementSibling;
            while (next && next.tagName === 'P' && next.textContent.trim() === '' && !next.querySelector('img')) {
                const toRemove = next;
                next = next.nextElementSibling;
                toRemove.remove(); changed++;
            }
        });

        // 5. Trim leading/trailing whitespace-only text nodes inside paragraphs
        editor.querySelectorAll('p, li, h1, h2, h3, h4').forEach(el => {
            // Trim leading whitespace text nodes
            while (el.firstChild && el.firstChild.nodeType === 3 && el.firstChild.textContent.trim() === '') {
                el.removeChild(el.firstChild);
            }
            // Trim trailing whitespace text nodes
            while (el.lastChild && el.lastChild.nodeType === 3 && el.lastChild.textContent.trim() === '') {
                el.removeChild(el.lastChild);
            }
        });

        this.updateStats();
        this.analyzeSEO();

        if (changed > 0) {
            this.showToast('🧹 Cleaned ' + changed + ' spacing issue(s)');
        } else {
            this.showToast('✅ Spacing already clean');
        }
    },

    // ── SAVED BANNER ────────────────────────────────────────
    _showSavedBanner(result) {
        const sv = document.getElementById('topSaved');
        sv.style.display = 'inline';
        if (result.status === 'published' && result.slug) {
            const viewUrl = this.cfg.viewUrl ? this.cfg.viewUrl(result) : '';
            sv.innerHTML = '✅ Saved!' + (viewUrl
                ? ' <a href="' + viewUrl + '" target="_blank" style="color:var(--teal);font-weight:700;margin-left:8px">View →</a>'
                : '');
            // Also update the persistent View link in topbar
            this._setTopbarViewLink(viewUrl);
            setTimeout(() => { sv.style.display = 'none'; }, 10000);
        } else {
            sv.innerHTML = '✅ Saved!';
            setTimeout(() => { sv.style.display = 'none'; }, 3000);
        }
    },

    // Sets (or updates) a permanent View link next to the title in the topbar
    _setTopbarViewLink(viewUrl) {
        if (!viewUrl) return;
        let existing = document.getElementById('topViewLink');
        if (!existing) {
            existing = document.createElement('a');
            existing.id = 'topViewLink';
            existing.target = '_blank';
            existing.style.cssText = 'font-size:.78rem;font-weight:700;color:var(--teal);text-decoration:none;white-space:nowrap;padding:4px 10px;border:1px solid var(--teal);border-radius:6px;margin-left:4px;';
            existing.textContent = 'View →';
            // Insert after topSaved span
            const saved = document.getElementById('topSaved');
            if (saved && saved.parentNode) saved.parentNode.insertBefore(existing, saved.nextSibling);
        }
        existing.href = viewUrl;
    },

    // ── UI HELPERS ──────────────────────────────────────────

    // Disable/enable save buttons during in-flight save
    _setSaveButtonState(saving, status) {
        const isPublish = status === 'published';
        const topBtn = document.getElementById('topPublishBtn');
        const topSave = document.querySelector('.studio-topbar__btn--save');
        const sbBtn  = document.getElementById('sbPublishBtn');
        const sbSave = document.querySelector('.btn-save-draft');

        if (saving) {
            [topBtn, topSave, sbBtn, sbSave].forEach(b => { if (b) { b.disabled = true; b.style.opacity = '0.6'; } });
            if (isPublish) {
                if (topBtn) topBtn.innerHTML = '<span class="ai-spinner"></span> Saving...';
                if (sbBtn)  sbBtn.innerHTML  = '<span class="ai-spinner"></span> Saving...';
            } else {
                if (topSave) topSave.innerHTML = '<span class="ai-spinner"></span> Saving...';
                if (sbSave)  sbSave.innerHTML  = '<span class="ai-spinner"></span> Saving...';
            }
        } else {
            [topBtn, topSave, sbBtn, sbSave].forEach(b => { if (b) { b.disabled = false; b.style.opacity = ''; } });
            this.updatePublishUI(); // restores correct labels
        }
    },

    // Show undo toast with action button
    _showUndoToast(msg) {
        const t = document.getElementById('studioToast');
        t.innerHTML = msg + ' <button onclick="Studio._undoAi()" style="margin-left:10px;padding:2px 10px;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.5);border-radius:4px;color:#fff;cursor:pointer;font-size:.78rem;font-weight:700;font-family:inherit;">↩ Undo</button>';
        t.style.display = 'block';
        clearTimeout(t._hide);
        t._hide = setTimeout(() => { t.style.display = 'none'; t.innerHTML = ''; }, 8000);
    },

    _undoAi() {
        if (this._preAiHtml !== null) {
            this.quill.root.innerHTML = this._preAiHtml;
            this._preAiHtml = null;
            this.updateStats(); this.analyzeSEO();
            this.showToast('↩ Undone — original content restored');
        }
    },

    updateTopTitle() {
        const n = document.getElementById('studioName').value;
        document.getElementById('topTitle').textContent = n || ('New ' + this._cptLabel());
    },

    updatePublishUI() {
        const s   = document.getElementById('studioStatus').value;
        const pub = s === 'published';
        document.getElementById('pubStatus').textContent = pub ? 'Published' : 'Draft';
        document.getElementById('topStatus').className   = 'studio-topbar__status studio-topbar__status--' + s;
        document.getElementById('topStatus').textContent = s.toUpperCase();
        const label = pub ? '✅ Update' : '🚀 Publish';
        document.querySelectorAll('#sbPublishBtn, #topPublishBtn').forEach(b => { if (b) b.textContent = label; });
        // Keep Save Draft button label correct
        document.querySelectorAll('.btn-save-draft, .studio-topbar__btn--save').forEach(b => { if (b) b.textContent = 'Save Draft'; });
        // Sync featured display
        const featEl = document.getElementById('pubFeatured');
        if (featEl) {
            const isFeat = document.getElementById('studioIsFeatured') && document.getElementById('studioIsFeatured').value === 'true';
            featEl.textContent = isFeat ? 'Yes ⭐' : 'No';
        }
    },

    showTab(t) {
        document.getElementById('tabWrite').classList.toggle('active',   t === 'write');
        document.getElementById('tabPreview').classList.toggle('active', t === 'preview');
        document.getElementById('studioEditorWrap').style.display  = t === 'write'   ? 'flex'  : 'none';
        const pp = document.getElementById('studioPreviewPane');
        pp.style.display = t === 'preview' ? 'block' : 'none';
        if (t === 'preview') pp.innerHTML = this.quill.root.innerHTML;
    },

    updateStats() {
        const text  = this.quill.getText().trim();
        const words = text ? text.split(/\s+/).filter(w => w).length : 0;
        const readMins = Math.max(1, Math.round(words / 200));
        document.getElementById('studioWordCount').textContent = words + ' words · ' + readMins + ' min read';
        const html = this.quill.root.innerHTML;
        const h2   = (html.match(/<h2/g)  || []).length;
        const h3   = (html.match(/<h3/g)  || []).length;
        const imgs  = (html.match(/<img/g) || []).length;
        const links = (html.match(/<a /g)  || []).length;
        const imgsNoAlt = (html.match(/<img(?![^>]*alt=)[^>]*>/g) || []).length;

        const a = [];

        // Word count
        if      (words === 0)    a.push('<div class="analysis-item">📝 Start writing...</div>');
        else if (words < 300)    a.push(`<div class="analysis-item">⚠️ Too short — ${words} words (aim 600+)</div>`);
        else if (words < 600)    a.push(`<div class="analysis-item">📝 ${words} words — getting there (aim 600+)</div>`);
        else                     a.push(`<div class="analysis-item">✅ ${words} words — good length</div>`);

        // Headings
        if      (h2 === 0)       a.push('<div class="analysis-item">⚠️ No H2 headings — add section headings</div>');
        else if (h2 >= 2)        a.push(`<div class="analysis-item">✅ ${h2} H2 + ${h3} H3 headings</div>`);
        else                     a.push(`<div class="analysis-item">📝 ${h2} H2 heading (add more sections)</div>`);

        // Images
        if      (imgs === 0)     a.push('<div class="analysis-item">💡 No images — add at least one</div>');
        else if (imgsNoAlt > 0)  a.push(`<div class="analysis-item">⚠️ ${imgs} image(s) — ${imgsNoAlt} missing alt text</div>`);
        else                     a.push(`<div class="analysis-item">✅ ${imgs} image(s) with alt text</div>`);

        // Links
        if (links > 0) a.push(`<div class="analysis-item">🔗 ${links} internal link(s)</div>`);

        // SEO fields
        const mt = (document.getElementById('studioMetaTitle')  || {}).value || '';
        const md = (document.getElementById('studioMetaDesc')   || {}).value || '';
        const desc = (document.getElementById('studioDescription') || {}).value || '';
        if (!mt)   a.push('<div class="analysis-item">⚠️ Missing meta title</div>');
        if (!md)   a.push('<div class="analysis-item">⚠️ Missing meta description</div>');
        if (!desc) a.push('<div class="analysis-item">⚠️ Missing short description</div>');

        document.getElementById('contentAnalysis').innerHTML = a.join('');
    },

    analyzeSEO() {
        let s = 0;
        const name = document.getElementById('studioName').value;
        const mt   = document.getElementById('studioMetaTitle').value;
        const md   = document.getElementById('studioMetaDesc').value;
        const desc = document.getElementById('studioDescription').value;
        const w    = this.quill.getText().split(/\s+/).length;
        if (name)                                    s += 15;
        if (mt  && mt.length  >= 30 && mt.length  <= 60)  s += 20;
        if (md  && md.length  >= 80 && md.length  <= 160) s += 20;
        if (w   >= 600)                              s += 15;
        else if (w >= 300)                           s += 10;
        if ((this.quill.root.innerHTML.match(/<h2/g) || []).length) s += 10;
        if (desc && desc.length > 20)                s += 10;
        const b = document.getElementById('seoBadge');
        b.textContent  = s + ' / 100';
        b.className    = 'seo-badge ' + (s >= 70 ? 'seo-badge--green' : s >= 40 ? 'seo-badge--yellow' : s > 0 ? 'seo-badge--red' : 'seo-badge--gray');
    },

    updateCharCount(id, cid, max) {
        const input = document.getElementById(id);
        if (!input) return;
        const l = input.value.length;
        const e = document.getElementById(cid);
        if (e) {
            e.textContent = l + '/' + max;
            e.style.color = l > max ? '#EF4444' : l > max * .8 ? '#F59E0B' : '';
        }
        // Highlight the input itself when over limit
        input.style.borderColor = l > max ? '#EF4444' : l > max * .8 ? '#F59E0B' : '';
    },

    showToast(msg, duration) {
        const t = document.getElementById('studioToast');
        t.textContent = msg; t.style.display = 'block';
        clearTimeout(t._hide);
        // duration=0 means stay visible until explicitly hidden
        if (duration !== 0) {
            t._hide = setTimeout(() => t.style.display = 'none', duration || 2800);
        }
    },

    hideToast() {
        const t = document.getElementById('studioToast');
        clearTimeout(t._hide);
        t.style.display = 'none';
    },

    // ── PROGRESS BAR ────────────────────────────────────────
    _progressStart() {
        const bar = document.getElementById('studioProgressBar');
        const wrap = document.getElementById('studioProgress');
        if (!bar || !wrap) return;
        wrap.style.display = 'block';
        bar.style.transition = 'none';
        bar.style.width = '0%';
        // Fake progress: animate to 85% over ~25s (covers most AI responses)
        requestAnimationFrame(() => {
            bar.style.transition = 'width 25s cubic-bezier(0.1, 0.4, 0.6, 1)';
            bar.style.width = '85%';
        });
    },

    _progressDone() {
        const bar = document.getElementById('studioProgressBar');
        const wrap = document.getElementById('studioProgress');
        if (!bar || !wrap) return;
        // Snap to 100% then fade out
        bar.style.transition = 'width 0.2s ease';
        bar.style.width = '100%';
        setTimeout(() => {
            wrap.style.opacity = '0';
            wrap.style.transition = 'opacity 0.4s ease';
            setTimeout(() => {
                wrap.style.display = 'none';
                wrap.style.opacity = '1';
                wrap.style.transition = '';
                bar.style.width = '0%';
            }, 400);
        }, 200);
        this.hideToast();
    },

    _resetAutoSave() {
        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = setTimeout(() => { if (this.editId) this.saveItem('auto'); }, 15000);
    },

    // ── KEYBOARD SHORTCUTS ──────────────────────────────────
    _initKeyboard() {
        // Mark dirty when any form field changes (but not while loading)
        document.addEventListener('input', () => { if (!this._loading) this.isDirty = true; });
        document.addEventListener('change', () => { if (!this._loading) this.isDirty = true; });

        // Only warn about unsaved changes if there are actually unsaved changes
        window.addEventListener('beforeunload', e => {
            if (this.isDirty) { e.preventDefault(); e.returnValue = ''; }
        });
        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); this.saveItem(this.editId ? 'auto' : null); }
            if (e.key === 'Escape') { this._clearImgSelection(); this.closeImgEdit(); this.closeMediaPicker(); }
        });
    }
};

// Expose globally so onclick handlers work
window.Studio = Studio;

})();
