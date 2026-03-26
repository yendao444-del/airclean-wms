// ========================================
// PRODUCTION CONFIG - SUPABASE
// ========================================
// Config này sẽ được embed vào build, không cần .env file

module.exports = {
    // Supabase Database Connection
    DATABASE_URL: "postgresql://[REDACTED]@supabase/postgres",
    DIRECT_URL: "postgresql://[REDACTED]@supabase/postgres-direct",

    // Telegram Bot
    TELEGRAM_BOT_TOKEN: '***REDACTED_TELEGRAM_TOKEN***',
    TELEGRAM_CHAT_ID: '1397184795',

    // Google OAuth2
    OAUTH_CLIENT_ID: '470025984975-s63vgvnb1ds58fmagk9iqq0f9ufhkktr.apps.googleusercontent.com',
    OAUTH_CLIENT_SECRET: '***REDACTED_OAUTH_SECRET***',
    GDRIVE_FOLDER_ID: '1pEblyEPQjwluSEHIAS-kOkSohrw_Efsv',

    // App Metadata
    APP_NAME: "DBY POS",
    APP_VERSION: "1.0.6",
    ENVIRONMENT: "production"
};
