-- Add products_services and technologies to company_analyses
-- products_services: what the seller actually sells (key input for buying team inference)
-- technologies: technology platforms/tools used or sold (ICP signal for tech stack matching)

ALTER TABLE public.company_analyses
  ADD COLUMN IF NOT EXISTS products_services text[],
  ADD COLUMN IF NOT EXISTS technologies text[];
