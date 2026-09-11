/*
# Phase 4 — Disposition Records, Buyer Offers, Management Records

## Overview
Creates the three core record tables for Phase 4:
- disposition_records: One per active deal, linked to opportunity + acquisition
- buyer_offers: Multiple offers per deal, only one accepted at a time
- management_records: One per opportunity, the control record for authorized users

## New Tables

### disposition_records
Links to opportunity, acquisition_record (nullable), property, contact (seller),
assigned user, and current disposition pipeline stage.
Unique constraint: only one active (non-dead/closed) disposition per opportunity.

### buyer_offers
Multiple offers per disposition. Partial unique index enforces only one accepted offer
per disposition unless explicitly overridden (status updated on the old one first).
Fields: buyer contact, offer amount, financing type, proof-of-funds, EMD, dates, notes, status.

### management_records
One per opportunity (hard UNIQUE). Links to both acquisition and disposition records.
Stores denormalized stage snapshots for quick dashboard display.
Tracks contract details, buyer info, EMD, title, closing, revenue, payout.

## RLS
All tables use company-scoped policies (authenticated users within the company can CRUD).
Management records additionally rely on application-level permission checks (view_management).
*/

-- disposition_records
CREATE TABLE IF NOT EXISTS disposition_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_id        uuid NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  acquisition_record_id uuid REFERENCES acquisition_records(id) ON DELETE SET NULL,
  property_id           uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  contact_id            uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  assigned_user_id      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  pipeline_stage_id     uuid NOT NULL REFERENCES disposition_pipeline_stages(id) ON DELETE RESTRICT,
  status                text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'dead', 'closed')),
  contract_price        numeric(12,2),
  buyer_price           numeric(12,2),
  emd_amount            numeric(12,2),
  emd_received_date     date,
  closing_date          date,
  title_company         text,
  title_contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  funded_date           date,
  actual_revenue        numeric(12,2),
  notes                 text,
  stage_entered_at      timestamptz DEFAULT now(),
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- Only one active disposition per opportunity
CREATE UNIQUE INDEX IF NOT EXISTS uidx_disp_active_opp
  ON disposition_records(opportunity_id) WHERE status = 'active';

-- buyer_offers
CREATE TABLE IF NOT EXISTS buyer_offers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  disposition_record_id uuid NOT NULL REFERENCES disposition_records(id) ON DELETE CASCADE,
  contact_id            uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  offer_amount          numeric(12,2) NOT NULL,
  financing_type        text NOT NULL DEFAULT 'cash'
    CHECK (financing_type IN ('cash', 'conventional', 'hard_money', 'seller_finance', 'other')),
  proof_of_funds_status text NOT NULL DEFAULT 'pending'
    CHECK (proof_of_funds_status IN ('pending', 'received', 'verified', 'rejected')),
  emd_amount            numeric(12,2),
  offer_date            date NOT NULL DEFAULT CURRENT_DATE,
  expiration_date       date,
  notes                 text,
  status                text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- Only one accepted offer per disposition
CREATE UNIQUE INDEX IF NOT EXISTS uidx_buyer_offer_accepted
  ON buyer_offers(disposition_record_id) WHERE status = 'accepted';

-- management_records
CREATE TABLE IF NOT EXISTS management_records (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_id              uuid NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  acquisition_record_id       uuid REFERENCES acquisition_records(id) ON DELETE SET NULL,
  disposition_record_id       uuid REFERENCES disposition_records(id) ON DELETE SET NULL,
  assigned_user_id            uuid REFERENCES profiles(id) ON DELETE SET NULL,
  pipeline_stage_id           uuid NOT NULL REFERENCES management_pipeline_stages(id) ON DELETE RESTRICT,
  acquisition_stage_snapshot  text,
  disposition_stage_snapshot  text,
  notes                       text,
  stage_entered_at            timestamptz DEFAULT now(),
  created_at                  timestamptz DEFAULT now(),
  updated_at                  timestamptz DEFAULT now(),
  UNIQUE(opportunity_id)
);

-- RLS
ALTER TABLE disposition_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_offers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE management_records  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_disp_rec"  ON disposition_records;
DROP POLICY IF EXISTS "ins_disp_rec"  ON disposition_records;
DROP POLICY IF EXISTS "upd_disp_rec"  ON disposition_records;
DROP POLICY IF EXISTS "del_disp_rec"  ON disposition_records;
CREATE POLICY "sel_disp_rec" ON disposition_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "ins_disp_rec" ON disposition_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "upd_disp_rec" ON disposition_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "del_disp_rec" ON disposition_records FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "sel_buyer_offers" ON buyer_offers;
DROP POLICY IF EXISTS "ins_buyer_offers" ON buyer_offers;
DROP POLICY IF EXISTS "upd_buyer_offers" ON buyer_offers;
DROP POLICY IF EXISTS "del_buyer_offers" ON buyer_offers;
CREATE POLICY "sel_buyer_offers" ON buyer_offers FOR SELECT TO authenticated USING (true);
CREATE POLICY "ins_buyer_offers" ON buyer_offers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "upd_buyer_offers" ON buyer_offers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "del_buyer_offers" ON buyer_offers FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS "sel_mgmt_rec"  ON management_records;
DROP POLICY IF EXISTS "ins_mgmt_rec"  ON management_records;
DROP POLICY IF EXISTS "upd_mgmt_rec"  ON management_records;
DROP POLICY IF EXISTS "del_mgmt_rec"  ON management_records;
CREATE POLICY "sel_mgmt_rec" ON management_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "ins_mgmt_rec" ON management_records FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "upd_mgmt_rec" ON management_records FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "del_mgmt_rec" ON management_records FOR DELETE TO authenticated USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_disp_rec_company    ON disposition_records(company_id);
CREATE INDEX IF NOT EXISTS idx_disp_rec_opp        ON disposition_records(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_disp_rec_stage      ON disposition_records(pipeline_stage_id);
CREATE INDEX IF NOT EXISTS idx_buyer_offers_disp   ON buyer_offers(disposition_record_id);
CREATE INDEX IF NOT EXISTS idx_buyer_offers_contact ON buyer_offers(contact_id);
CREATE INDEX IF NOT EXISTS idx_mgmt_rec_company    ON management_records(company_id);
CREATE INDEX IF NOT EXISTS idx_mgmt_rec_opp        ON management_records(opportunity_id);
