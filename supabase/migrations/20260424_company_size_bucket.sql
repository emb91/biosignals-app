-- Add canonical employee-size bucket to companies table for ICP matching.
-- Values mirror COMPANY_SIZE_OPTIONS in lib/arcova-taxonomy.ts:
--   '1–10' | '11–50' | '51–200' | '201–500' | '500+'
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS company_size_bucket text;

-- Back-fill from existing employee_count where available
UPDATE public.companies
SET company_size_bucket = CASE
  WHEN employee_count BETWEEN 1   AND 10  THEN '1–10'
  WHEN employee_count BETWEEN 11  AND 50  THEN '11–50'
  WHEN employee_count BETWEEN 51  AND 200 THEN '51–200'
  WHEN employee_count BETWEEN 201 AND 500 THEN '201–500'
  WHEN employee_count > 500               THEN '500+'
END
WHERE employee_count IS NOT NULL AND company_size_bucket IS NULL;
