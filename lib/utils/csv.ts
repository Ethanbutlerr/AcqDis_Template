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
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          result.push(current);
          current = '';
        } else {
          current += char;
        }
      }
    }
    result.push(current);
    return result;
  };

  const headers = parseLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = (values[i] ?? '').trim();
    });
    return row;
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
