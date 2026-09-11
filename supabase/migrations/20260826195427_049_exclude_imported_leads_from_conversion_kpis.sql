/*
# Exclude imported leads from conversion KPI metrics

## Changes
- Drops and recreates `get_conversion_metrics` function
- Adds `AND lead_source != 'csv_import'` filter to all queries counting leads, contracts, and timing averages
- Imported leads (from CSV import) will no longer inflate or deflect conversion percentages and timing metrics

## Affected KPIs
- Lead to Contract %
- Contract to Closing %
- Avg Lead to Contract time
- Avg Contract to Closing time

## Security
- No changes to RLS or permissions
- Function remains SECURITY INVOKER
*/

CREATE OR REPLACE FUNCTION get_conversion_metrics(
  p_company_id uuid,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_total_leads int;
  v_contracts int;
  v_closings int;
  v_lead_to_contract_pct numeric;
  v_contract_to_closing_pct numeric;
  v_avg_lead_to_contract_days numeric;
  v_avg_contract_to_closing_days numeric;
BEGIN
  -- Count total leads (EXCLUDING csv_import)
  SELECT count(*) INTO v_total_leads FROM acquisition_records
  WHERE company_id = p_company_id AND archived_at IS NULL
  AND (lead_source IS NULL OR lead_source != 'csv_import')
  AND created_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
  AND created_at <= COALESCE(p_end_date, now());

  -- Count contracts (EXCLUDING csv_import)
  SELECT count(*) INTO v_contracts FROM acquisition_records
  WHERE company_id = p_company_id AND contract_executed_at IS NOT NULL
  AND (lead_source IS NULL OR lead_source != 'csv_import')
  AND contract_executed_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
  AND contract_executed_at <= COALESCE(p_end_date, now());

  -- Count closings (these come from disposition_records which don't have lead_source directly,
  -- so we join through acquisition_records to filter out imported leads)
  SELECT count(*) INTO v_closings FROM disposition_records dr
  WHERE dr.company_id = p_company_id AND dr.status = 'closed'
  AND dr.updated_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
  AND dr.updated_at <= COALESCE(p_end_date, now())
  AND NOT EXISTS (
    SELECT 1 FROM acquisition_records ar
    WHERE ar.opportunity_id = dr.opportunity_id
    AND ar.lead_source = 'csv_import'
  );

  v_lead_to_contract_pct := CASE WHEN v_total_leads > 0 THEN round((v_contracts::numeric / v_total_leads) * 100, 1) ELSE 0 END;
  v_contract_to_closing_pct := CASE WHEN v_contracts > 0 THEN round((v_closings::numeric / v_contracts) * 100, 1) ELSE 0 END;

  -- Avg lead to contract days (EXCLUDING csv_import)
  SELECT COALESCE(avg(extract(epoch FROM (contract_executed_at - created_at)) / 86400), 0)
  INTO v_avg_lead_to_contract_days FROM acquisition_records
  WHERE company_id = p_company_id AND contract_executed_at IS NOT NULL
  AND (lead_source IS NULL OR lead_source != 'csv_import')
  AND contract_executed_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
  AND contract_executed_at <= COALESCE(p_end_date, now());

  -- Avg contract to closing days (EXCLUDING csv_import)
  SELECT COALESCE(avg(extract(epoch FROM (o.closing_date - ar.contract_executed_at)) / 86400), 0)
  INTO v_avg_contract_to_closing_days
  FROM acquisition_records ar JOIN opportunities o ON o.id = ar.opportunity_id
  WHERE ar.company_id = p_company_id AND ar.contract_executed_at IS NOT NULL
  AND o.closing_date IS NOT NULL AND o.status = 'closed'
  AND (ar.lead_source IS NULL OR ar.lead_source != 'csv_import')
  AND ar.contract_executed_at >= COALESCE(p_start_date, '1970-01-01'::timestamptz)
  AND ar.contract_executed_at <= COALESCE(p_end_date, now());

  RETURN jsonb_build_object(
    'total_leads', v_total_leads,
    'contracts', v_contracts,
    'closings', v_closings,
    'lead_to_contract_pct', v_lead_to_contract_pct,
    'contract_to_closing_pct', v_contract_to_closing_pct,
    'avg_lead_to_contract_days', round(v_avg_lead_to_contract_days, 1),
    'avg_contract_to_closing_days', round(v_avg_contract_to_closing_days, 1)
  );
END;
$$;
