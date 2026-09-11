/*
# SMS Blasts — Unified Audience Support

## What this does
Adds an `audience_type` column to `lead_campaigns` so a single drip campaign
can target either sellers or buyers. This enables the unified "SMS Blasts"
page that replaces the separate Campaigns, Sellers, and Buyers tabs.

## Changes
1. `lead_campaigns` — new column:
   - `audience_type` text NOT NULL DEFAULT 'seller' — 'seller' | 'buyer'
2. Index on (company_id, audience_type) for filtered listing.
3. No RLS changes — existing policies already scope by company_id via
   the helper functions, and the new column is covered by those policies.

## Notes
- Backfill: existing campaigns default to 'seller' (the original use case).
- The column is NOT a foreign key; it's a simple discriminator.
*/

ALTER TABLE public.lead_campaigns
  ADD COLUMN IF NOT EXISTS audience_type text NOT NULL DEFAULT 'seller'
  CHECK (audience_type IN ('seller', 'buyer'));

CREATE INDEX IF NOT EXISTS idx_lead_campaigns_company_audience
  ON public.lead_campaigns (company_id, audience_type);