-- Exact migration recorded by Supabase on 2026-09-14.
-- Linked acquisition history must survive an attempted opportunity deletion.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';
ALTER TABLE public.acquisition_records
  DROP CONSTRAINT acquisition_records_opportunity_id_fkey,
  ADD CONSTRAINT acquisition_records_opportunity_id_fkey
    FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE RESTRICT;
