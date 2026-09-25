-- REVIEW ONLY. Prepared locally; never executed by the assistant.
-- Scope: the existing AcqDis Acquisitions Manager system role only.
-- Members with an assigned number receive that line; members without one are
-- automatically eligible for shared Acquisition lines. Company and disabled-user
-- checks remain enforced by routing. No unrelated roles or permissions change.
-- An operator must review current membership before any approved application.
-- This transaction defaults to ROLLBACK. Change that only after separate approval.

BEGIN;

SELECT p.id, p.full_name, p.is_disabled,
       CASE WHEN EXISTS (
         SELECT 1 FROM public.phone_numbers pn
         WHERE pn.company_id = p.company_id AND pn.assigned_user_id = p.id
       ) THEN 'Assigned number only' ELSE 'Shared Acquisition' END AS intended_route
FROM public.profiles p
JOIN public.user_roles ur ON ur.user_id = p.id
JOIN public.roles r ON r.id = ur.role_id AND r.company_id = p.company_id
WHERE r.id = 'b0000000-0000-4000-8000-000000000003'::uuid
  AND r.company_id = 'a0000000-0000-4000-8000-000000000001'::uuid
  AND r.name = 'Acquisitions Manager' AND r.is_system = true;

DO $review$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.roles
    WHERE id = 'b0000000-0000-4000-8000-000000000003'::uuid
      AND company_id = 'a0000000-0000-4000-8000-000000000001'::uuid
      AND name = 'Acquisitions Manager' AND is_system = true
  ) THEN RAISE EXCEPTION 'Expected Acquisition role not found; stop and review'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE key = 'receive_calls')
  THEN RAISE EXCEPTION 'receive_calls permission not found; stop and review'; END IF;
END;
$review$;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r CROSS JOIN public.permissions p
WHERE r.id = 'b0000000-0000-4000-8000-000000000003'::uuid
  AND r.company_id = 'a0000000-0000-4000-8000-000000000001'::uuid
  AND r.name = 'Acquisitions Manager' AND r.is_system = true
  AND p.key = 'receive_calls'
ON CONFLICT DO NOTHING;

ROLLBACK;
