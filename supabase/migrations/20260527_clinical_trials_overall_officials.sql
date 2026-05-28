-- Add overall_officials to store PI/investigator data from ClinicalTrials.gov.
-- Each element: { name: string, role: string, affiliation: string }
alter table clinical_trials
  add column if not exists overall_officials jsonb not null default '[]'::jsonb;
