-- Retire the old "request interest in coming-soon contact signals" table.
--
-- Signal selection/request UI was removed when Arcova moved to universal signal
-- monitoring via signal_source_events / normalized_signals. The only remaining
-- writer was the now-deleted /api/contact-premium-signal-interest route, and
-- there are no readers.

drop table if exists public.contact_premium_signal_interest;
