-- Contact intent_score is the normalized 0–1 strength of contact-scope signal events only.
-- Default 1.0 implied "neutral intent" and made every lead look signal-hot before real events existed.
-- Use null when there are no contact signal rows so product logic can treat that as "no signal yet".

alter table public.contacts alter column intent_score drop default;

update public.contacts c
set intent_score = null
where not exists (
  select 1
  from public.signals s
  where s.user_id = c.user_id
    and s.contact_id = c.id
    and s.signal_scope = 'contact'
);
