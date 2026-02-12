// ========================================
// PRODUCTION CONFIG - SUPABASE
// ========================================
// Config này sẽ được embed vào build, không cần .env file

module.exports = {
    // Supabase Database Connection
    DATABASE_URL: "postgresql://[REDACTED]@supabase/postgres-direct?pgbouncer=true",
    DIRECT_URL: "postgresql://[REDACTED]@supabase/postgres-direct",
    
    // App Metadata
    APP_NAME: "QuanLyPOS",
    APP_VERSION: "1.0.6",
    ENVIRONMENT: "production"
};
