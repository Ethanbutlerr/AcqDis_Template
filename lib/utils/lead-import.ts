import { normalizePhone } from './format';

export const LEAD_IMPORT_FIELDS = ['first_name','last_name','phone','email','company_name','mailing_address_1','mailing_address_2','mailing_city','mailing_state','mailing_zip','lead_source','property_address','property_city','property_state','property_zip','property_county','property_type','bedrooms','bathrooms','square_footage','lot_size','year_built','occupancy_status','property_condition','asking_price','estimated_value','estimated_repair_cost','motivation','priority','offer_amount'] as const;

export function prepareLeadImport(row: Record<string, string>) {
  const errors: string[] = [];
  const phone = row.phone?.trim() ? normalizePhone(row.phone) : '';
  if (!row.first_name?.trim() && !row.last_name?.trim() && !phone && !row.email?.trim()) errors.push('Seller name, phone, or email is required');
  if (phone && (phone.length < 10 || phone.length > 15)) errors.push('Invalid phone number');
  if (row.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())) errors.push('Invalid email');
  const numeric = (key: string) => {
    if (!row[key]?.trim()) return null;
    const value = Number(row[key].replace(/[$,\s]/g, ''));
    if (!Number.isFinite(value) || value < 0) { errors.push(`Invalid ${key}`); return null; }
    if (['bedrooms','square_footage','year_built'].includes(key) && !Number.isInteger(value)) errors.push(`${key} must be a whole number`);
    return value;
  };
  const contact = { first_name: row.first_name, last_name: row.last_name, phone, email: row.email?.trim().toLowerCase(), company_name: row.company_name, mailing_address_1: row.mailing_address_1, mailing_address_2: row.mailing_address_2, mailing_city: row.mailing_city, mailing_state: row.mailing_state, mailing_zip: row.mailing_zip };
  const property = { street_address: row.property_address, city: row.property_city, state: row.property_state, zip_code: row.property_zip, county: row.property_county, property_type: row.property_type, bedrooms: numeric('bedrooms'), bathrooms: numeric('bathrooms'), square_footage: numeric('square_footage'), lot_size: row.lot_size, year_built: numeric('year_built'), occupancy_status: row.occupancy_status, property_condition: row.property_condition, asking_price: numeric('asking_price'), estimated_value: numeric('estimated_value'), estimated_repair_cost: numeric('estimated_repair_cost') };
  const priority = row.priority?.trim().toLowerCase() || 'medium';
  if (!['low','medium','high','urgent'].includes(priority)) errors.push('Invalid priority');
  const details = { lead_source: row.lead_source?.trim() || 'CSV import', motivation: row.motivation, priority, offer_amount: numeric('offer_amount') };
  return { contact, property, details, errors };
}
