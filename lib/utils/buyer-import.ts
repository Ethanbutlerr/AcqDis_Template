/**
 * Client-side CSV parser and buyer import utilities.
 * Handles parsing, normalization, validation, deduplication, and template rendering.
 */

import type { BuyerCsvField, ParsedCsvRow } from '@/lib/types';

// ─── CSV Parsing ─────────────────────────────────────────────────────────────

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] ?? '').trim();
    });
    rows.push(row);
  }

  return { headers, rows };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─── Phone Normalization ─────────────────────────────────────────────────────

export function normalizePhoneForImport(raw: string): { normalized: string | null; error: string | null } {
  if (!raw || !raw.trim()) return { normalized: null, error: 'Phone number is empty' };

  const digits = raw.replace(/\D/g, '');

  if (digits.length === 10) return { normalized: '1' + digits, error: null };
  if (digits.length === 11 && digits.startsWith('1')) return { normalized: digits, error: null };
  if (digits.length < 10) return { normalized: null, error: `Phone too short: "${raw}"` };
  if (digits.length > 11) return { normalized: null, error: `Phone too long: "${raw}"` };

  return { normalized: null, error: `Invalid phone format: "${raw}"` };
}

export function formatPhoneDisplay(normalized: string): string {
  if (normalized.length === 11 && normalized.startsWith('1')) {
    const d = normalized.slice(1);
    return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return normalized;
}

// ─── Auto Column Mapping ─────────────────────────────────────────────────────

const COLUMN_HINTS: Record<BuyerCsvField, string[]> = {
  first_name:             ['first', 'firstname', 'fname', 'first_name', 'given'],
  last_name:              ['last', 'lastname', 'lname', 'last_name', 'surname', 'family'],
  full_name:              ['full', 'fullname', 'name', 'full_name', 'contact'],
  phone:                  ['phone', 'mobile', 'cell', 'tel', 'telephone', 'number', 'ph'],
  email:                  ['email', 'e-mail', 'mail'],
  company:                ['company', 'business', 'org', 'organization', 'firm'],
  city:                   ['city', 'town', 'municipality'],
  state:                  ['state', 'province', 'st'],
  zip:                    ['zip', 'zipcode', 'zip_code', 'postal', 'postcode'],
  county:                 ['county', 'parish'],
  buyer_type:             ['buyer', 'buyertype', 'buyer_type', 'type', 'investor'],
  property_type_interest: ['property', 'propertytype', 'interest', 'looking', 'wants'],
  price_range:            ['price', 'budget', 'range', 'pricerange', 'max'],
  notes:                  ['notes', 'note', 'comments', 'comment', 'remarks'],
  skip:                   [],
};

export function autoMapColumns(headers: string[]): Record<string, BuyerCsvField> {
  const mapping: Record<string, BuyerCsvField> = {};
  const usedFields = new Set<BuyerCsvField>();

  for (const header of headers) {
    const h = header.toLowerCase().replace(/[^a-z0-9]/g, '');
    let bestMatch: BuyerCsvField = 'skip';

    for (const [field, hints] of Object.entries(COLUMN_HINTS) as [BuyerCsvField, string[]][]) {
      if (field === 'skip') continue;
      if (usedFields.has(field)) continue;
      for (const hint of hints) {
        if (h.includes(hint) || hint.includes(h)) {
          bestMatch = field;
          break;
        }
      }
      if (bestMatch !== 'skip') break;
    }

    if (bestMatch !== 'skip') usedFields.add(bestMatch);
    mapping[header] = bestMatch;
  }

  return mapping;
}

// ─── Row Normalization ────────────────────────────────────────────────────────

export function normalizeRow(
  raw: Record<string, string>,
  mapping: Record<string, BuyerCsvField>,
  rowNumber: number,
): ParsedCsvRow {
  const get = (field: BuyerCsvField): string => {
    const header = Object.entries(mapping).find(([, v]) => v === field)?.[0];
    return header ? (raw[header] ?? '').trim() : '';
  };

  let firstName = get('first_name');
  let lastName = get('last_name');
  const fullName = get('full_name');

  if (fullName && !firstName) {
    const parts = fullName.split(/\s+/);
    firstName = parts[0] ?? '';
    lastName = parts.slice(1).join(' ');
  }

  const rawPhone = get('phone');
  const { normalized: normalizedPhone, error: phoneError } = normalizePhoneForImport(rawPhone);

  const errors: string[] = [];
  if (phoneError) errors.push(phoneError);
  if (!firstName && !lastName && !fullName) errors.push('No name provided');

  const state = get('state').toUpperCase().slice(0, 2);

  return {
    rowNumber,
    raw,
    firstName,
    lastName,
    phone: rawPhone,
    normalizedPhone: normalizedPhone ?? '',
    email: get('email').toLowerCase(),
    city: get('city'),
    state,
    zip: get('zip'),
    county: get('county'),
    buyerType: get('buyer_type'),
    propertyTypeInterest: get('property_type_interest'),
    priceRange: get('price_range'),
    notes: get('notes'),
    status: errors.length > 0 ? 'invalid' : 'valid',
    errors,
    existingContactId: null,
    isExisting: false,
    duplicateOfRow: null,
  };
}

// ─── Deduplication ───────────────────────────────────────────────────────────

export function detectDuplicates(rows: ParsedCsvRow[]): ParsedCsvRow[] {
  const seenPhones = new Map<string, number>();
  return rows.map((row) => {
    if (row.status === 'invalid' || !row.normalizedPhone) return row;
    if (seenPhones.has(row.normalizedPhone)) {
      return {
        ...row,
        status: 'duplicate',
        duplicateOfRow: seenPhones.get(row.normalizedPhone)!,
        errors: [...row.errors, `Duplicate of row ${seenPhones.get(row.normalizedPhone)}`],
      };
    }
    seenPhones.set(row.normalizedPhone, row.rowNumber);
    return row;
  });
}

// ─── Template Rendering ───────────────────────────────────────────────────────

export interface TemplateVarValues {
  buyer_first_name?: string;
  property_address?: string;
  city?: string;
  state?: string;
  property_type?: string;
  bedrooms?: string;
  bathrooms?: string;
  asking_price?: string;
  arv?: string;
  repair_estimate?: string;
  closing_date?: string;
  deal_link?: string;
  sender_name?: string;
  company_name?: string;
}

export function renderTemplate(template: string, vars: TemplateVarValues): { body: string; warnings: string[] } {
  const warnings: string[] = [];
  let body = template;

  const varMap: Record<string, string | undefined> = {
    '{buyer_first_name}': vars.buyer_first_name,
    '{property_address}': vars.property_address,
    '{city}': vars.city,
    '{state}': vars.state,
    '{property_type}': vars.property_type,
    '{bedrooms}': vars.bedrooms,
    '{bathrooms}': vars.bathrooms,
    '{asking_price}': vars.asking_price,
    '{arv}': vars.arv,
    '{repair_estimate}': vars.repair_estimate,
    '{closing_date}': vars.closing_date,
    '{deal_link}': vars.deal_link,
    '{sender_name}': vars.sender_name,
    '{company_name}': vars.company_name,
  };

  for (const [placeholder, value] of Object.entries(varMap)) {
    if (body.includes(placeholder)) {
      if (!value) {
        warnings.push(`Variable ${placeholder} has no value — will appear blank`);
        body = body.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), '');
      } else {
        body = body.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
      }
    }
  }

  return { body, warnings };
}

export function getUnusedVars(template: string): string[] {
  const allVars = [
    '{buyer_first_name}','{property_address}','{city}','{state}','{property_type}',
    '{bedrooms}','{bathrooms}','{asking_price}','{arv}','{repair_estimate}',
    '{closing_date}','{deal_link}','{sender_name}','{company_name}',
  ];
  return allVars.filter((v) => !template.includes(v));
}

// ─── Quiet Hours Check ────────────────────────────────────────────────────────

export function isWithinQuietHours(
  now: Date,
  startTime: string, // "HH:MM:SS" or "HH:MM"
  endTime: string,
): boolean {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  if (startMinutes < endMinutes) {
    // Same-day window (e.g., 22:00-23:00)
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  } else {
    // Overnight window (e.g., 21:00-09:00)
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }
}

// ─── Suppress-list Check ─────────────────────────────────────────────────────

export function checkEligibility(row: ParsedCsvRow, suppressedPhones: Set<string>): {
  eligible: boolean;
  reason: string | null;
} {
  if (row.status === 'invalid') return { eligible: false, reason: row.errors.join('; ') };
  if (row.status === 'duplicate') return { eligible: false, reason: `Duplicate of row ${row.duplicateOfRow}` };
  if (row.status === 'suppressed') return { eligible: false, reason: 'Contact is suppressed' };
  if (row.status === 'opted_out') return { eligible: false, reason: 'Contact has opted out' };
  if (!row.normalizedPhone) return { eligible: false, reason: 'Missing phone number' };
  if (suppressedPhones.has(row.normalizedPhone)) return { eligible: false, reason: 'Phone number is suppressed' };
  return { eligible: true, reason: null };
}
