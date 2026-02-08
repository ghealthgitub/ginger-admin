const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize all tables
async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`

            -- USERS & ROLES
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'editor' CHECK (role IN ('super_admin', 'editor', 'viewer')),
                avatar VARCHAR(500),
                is_active BOOLEAN DEFAULT true,
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- BLOG POSTS
            CREATE TABLE IF NOT EXISTS blog_posts (
                id SERIAL PRIMARY KEY,
                title VARCHAR(500) NOT NULL,
                slug VARCHAR(500) UNIQUE NOT NULL,
                excerpt TEXT,
                content TEXT,
                cover_image VARCHAR(500),
                category VARCHAR(100),
                tags TEXT[],
                status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
                read_time INTEGER,
                author_id INTEGER REFERENCES users(id),
                meta_title VARCHAR(500),
                meta_description TEXT,
                published_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- TESTIMONIALS
            CREATE TABLE IF NOT EXISTS testimonials (
                id SERIAL PRIMARY KEY,
                patient_name VARCHAR(200) NOT NULL,
                patient_country VARCHAR(100),
                patient_flag VARCHAR(10),
                treatment VARCHAR(200),
                specialty VARCHAR(200),
                destination VARCHAR(100),
                rating INTEGER DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
                quote TEXT NOT NULL,
                avatar_color VARCHAR(50),
                is_featured BOOLEAN DEFAULT false,
                status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- HOSPITALS
            CREATE TABLE IF NOT EXISTS hospitals (
                id SERIAL PRIMARY KEY,
                name VARCHAR(300) NOT NULL,
                slug VARCHAR(300) UNIQUE NOT NULL,
                country VARCHAR(100) NOT NULL,
                city VARCHAR(100),
                address TEXT,
                description TEXT,
                long_description TEXT,
                accreditations TEXT[],
                specialties TEXT[],
                beds INTEGER,
                established INTEGER,
                image VARCHAR(500),
                gallery TEXT[],
                rating DECIMAL(2,1),
                is_featured BOOLEAN DEFAULT false,
                status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- DOCTORS
            CREATE TABLE IF NOT EXISTS doctors (
                id SERIAL PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                slug VARCHAR(200) UNIQUE NOT NULL,
                title VARCHAR(100),
                specialty VARCHAR(200),
                hospital_id INTEGER REFERENCES hospitals(id),
                country VARCHAR(100),
                experience_years INTEGER,
                qualifications TEXT[],
                description TEXT,
                long_description TEXT,
                image VARCHAR(500),
                languages TEXT[],
                is_featured BOOLEAN DEFAULT false,
                status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- FORM SUBMISSIONS
            CREATE TABLE IF NOT EXISTS submissions (
                id SERIAL PRIMARY KEY,
                form_type VARCHAR(50) NOT NULL CHECK (form_type IN ('quote', 'consultation', 'contact', 'partner', 'career')),
                name VARCHAR(200),
                email VARCHAR(255),
                phone VARCHAR(50),
                country VARCHAR(100),
                treatment VARCHAR(200),
                message TEXT,
                form_data JSONB,
                status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'responded', 'closed')),
                notes TEXT,
                assigned_to INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- PAGE CONTENT (key-value store for editable content)
            CREATE TABLE IF NOT EXISTS page_content (
                id SERIAL PRIMARY KEY,
                page VARCHAR(100) NOT NULL,
                section VARCHAR(100) NOT NULL,
                field_key VARCHAR(100) NOT NULL,
                field_value TEXT,
                field_type VARCHAR(50) DEFAULT 'text' CHECK (field_type IN ('text', 'number', 'html', 'image', 'json')),
                updated_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(page, section, field_key)
            );

            -- MEDIA LIBRARY
            CREATE TABLE IF NOT EXISTS media (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(500) NOT NULL,
                original_name VARCHAR(500),
                mime_type VARCHAR(100),
                size INTEGER,
                url VARCHAR(1000) NOT NULL,
                alt_text VARCHAR(500),
                folder VARCHAR(200) DEFAULT 'general',
                uploaded_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW()
            );

            -- ACTIVITY LOG
            CREATE TABLE IF NOT EXISTS activity_log (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                action VARCHAR(100) NOT NULL,
                entity_type VARCHAR(50),
                entity_id INTEGER,
                details TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log('✅ Database tables initialized');
    } catch (err) {
        console.error('❌ Database init error:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, initDB };
