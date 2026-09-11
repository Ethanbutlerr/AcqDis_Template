/*
# Phase 8 — Global Search RPC
Creates a server-side search function that queries contacts, properties, opportunities,
acquisition records, and disposition records by name, phone, email, and address.
*/

CREATE OR REPLACE FUNCTION public.global_search(
  p_company_id uuid,
  p_query text,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_q text := '%' || p_query || '%';
BEGIN
  -- Contacts by name
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'type', 'contact', 'id', id, 'label',
    COALESCE(first_name,'') || ' ' || COALESCE(last_name,''),
    'sub', COALESCE(primary_phone, COALESCE(primary_email, '')),
    'href', '/contacts'
  )), '[]'::jsonb) INTO v_results
  FROM (
    SELECT id, first_name, last_name, primary_phone, primary_email
    FROM contacts
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND (COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) ILIKE v_q
    LIMIT p_limit
  ) sub;

  -- Contacts by phone
  v_results := v_results || (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'type', 'contact', 'id', id, 'label', primary_phone,
      'sub', COALESCE(first_name,'') || ' ' || COALESCE(last_name,''),
      'href', '/contacts'
    )), '[]'::jsonb)
    FROM contacts
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND primary_phone ILIKE v_q
    LIMIT p_limit
  );

  -- Contacts by email
  v_results := v_results || (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'type', 'contact', 'id', id, 'label', primary_email,
      'sub', COALESCE(first_name,'') || ' ' || COALESCE(last_name,''),
      'href', '/contacts'
    )), '[]'::jsonb)
    FROM contacts
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND primary_email ILIKE v_q
    LIMIT p_limit
  );

  -- Properties
  v_results := v_results || (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'type', 'property', 'id', id, 'label', street_address,
      'sub', COALESCE(city,'') || ', ' || COALESCE(state,''),
      'href', '/properties'
    )), '[]'::jsonb)
    FROM properties
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND street_address ILIKE v_q
    LIMIT p_limit
  );

  -- Opportunities by ID
  v_results := v_results || (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'type', 'opportunity', 'id', id, 'label', id::text,
      'sub', status, 'href', '/opportunities'
    )), '[]'::jsonb)
    FROM opportunities
    WHERE company_id = p_company_id AND deleted_at IS NULL
      AND id::text ILIKE v_q
    LIMIT p_limit
  );

  -- Acquisition records by contact name
  v_results := v_results || (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'type', 'acquisition', 'id', ar.id, 'label',
      COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''),
      'sub', COALESCE(p.street_address, ''),
      'href', '/acquisitions'
    )), '[]'::jsonb)
    FROM acquisition_records ar
    LEFT JOIN contacts c ON c.id = ar.contact_id
    LEFT JOIN properties p ON p.id = ar.property_id
    WHERE ar.company_id = p_company_id AND ar.deleted_at IS NULL AND ar.archived_at IS NULL
      AND (COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) ILIKE v_q
    LIMIT p_limit
  );

  -- Disposition records by contact name
  v_results := v_results || (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'type', 'disposition', 'id', dr.id, 'label',
      COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,''),
      'sub', COALESCE(p.street_address, ''),
      'href', '/dispositions'
    )), '[]'::jsonb)
    FROM disposition_records dr
    LEFT JOIN contacts c ON c.id = dr.contact_id
    LEFT JOIN properties p ON p.id = dr.property_id
    WHERE dr.company_id = p_company_id AND dr.deleted_at IS NULL
      AND (COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) ILIKE v_q
    LIMIT p_limit
  );

  RETURN v_results;
END;
$$;
