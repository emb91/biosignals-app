-- Add headquarters_state column to companies table
ALTER TABLE companies ADD COLUMN IF NOT EXISTS headquarters_state text;
