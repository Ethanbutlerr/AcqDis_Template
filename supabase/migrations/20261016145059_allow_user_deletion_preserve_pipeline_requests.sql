-- Keep completed pipeline requests when an administrator deletes an account.
-- These rows provide history and idempotency; they must not prevent account
-- deletion or disappear with the account. Match the existing stage-history
-- foreign keys by clearing only the reference to the deleted profile.
SET lock_timeout = '2s';
SET statement_timeout = '60s';

ALTER TABLE public.pipeline_move_requests
  DROP CONSTRAINT pipeline_move_requests_actor_id_fkey,
  ALTER COLUMN actor_id DROP NOT NULL,
  ADD CONSTRAINT pipeline_move_requests_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.opportunity_creation_requests
  DROP CONSTRAINT opportunity_creation_requests_actor_id_fkey,
  ALTER COLUMN actor_id DROP NOT NULL,
  ADD CONSTRAINT opportunity_creation_requests_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_move_requests_actor_id
  ON public.pipeline_move_requests (actor_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_creation_requests_actor_id
  ON public.opportunity_creation_requests (actor_id);
