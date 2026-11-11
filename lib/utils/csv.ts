export function toCSV(rows: Record<string, unknown>[], headers?: string[]): string {
  if (rows.length === 0) return '';
  const keys = headers ?? Object.keys(rows[0]);
  const escape = (val: unknown): string => {
    const s = val === null || val === undefined ? '' : String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const headerLine = keys.join(',');
  const dataLines = rows.map((row) => keys.map((k) => escape(row[k])).join(','));
  return [headerLine, ...dataLines].join('\n');
}

export function parseCSV(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let row: string[] = [], value = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  const endRow = () => { row.push(value); if (row.some((v) => v.trim())) records.push(row); row = []; value = ''; };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && input[i+1] === '\n') i++; endRow(); }
    else value += char;
  }
  if (quoted) throw new Error('CSV has an unterminated quoted field.');
  if (value || row.length) endRow();
  if (!records.length) return [];
  const headers = records[0].map((h) => h.trim());
  if (headers.some((h) => !h) || new Set(headers).size !== headers.length) throw new Error('CSV headers must be nonempty and unique.');
  return records.slice(1).map((values, index) => {
    if (values.length > headers.length) throw new Error(`CSV row ${index + 2} has more fields than headers.`);
    return Object.fromEntries(headers.map((header, i) => [header, (values[i] ?? '').trim()]));
  });
}

export const CSV_CONTACT_COLUMNS: { label: string; value: string }[] = [
  { label: 'First Name', value: 'first_name' },
  { label: 'Last Name', value: 'last_name' },
  { label: 'Company Name', value: 'company_name' },
  { label: 'Primary Phone', value: 'primary_phone' },
  { label: 'Primary Email', value: 'primary_email' },
  { label: 'Mailing Address 1', value: 'mailing_address_1' },
  { label: 'Mailing Address 2', value: 'mailing_address_2' },
  { label: 'City', value: 'mailing_city' },
  { label: 'State', value: 'mailing_state' },
  { label: 'ZIP', value: 'mailing_zip' },
  { label: 'Lead Source', value: 'lead_source' },
  { label: 'Assigned User Email', value: 'assigned_user_email' },
];
