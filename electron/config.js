// ========================================
// PRODUCTION CONFIG - SUPABASE
// ========================================
// Config này sẽ được embed vào build, không cần .env file

module.exports = {
    // Supabase Database Connection
    DATABASE_URL: "postgresql://postgres.xhfemsbqqtvkjtmtsten:mid%26p%3F%7BS%3Eb5c2ibC@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?pgbouncer=true",
    DIRECT_URL: "postgresql://postgres.xhfemsbqqtvkjtmtsten:mid%26p%3F%7BS%3Eb5c2ibC@aws-1-ap-south-1.pooler.supabase.com:5432/postgres",
    
    // App Metadata
    APP_NAME: "QuanLyPOS",
    APP_VERSION: "1.0.6",
    ENVIRONMENT: "production"
};
