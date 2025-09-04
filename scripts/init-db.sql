-- Initialize ATS Fit Database
-- This script runs when the PostgreSQL container starts for the first time

-- Create extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create indexes for better performance (will be created by migrations)
-- This is just a placeholder for any initial setup needed

-- Log initialization
SELECT 'ATS Fit database initialized successfully' as message;
