/*
# Clean "na" values from contacts mailing address fields

1. Changes
   - Sets mailing_address_1, mailing_city, mailing_state, mailing_zip to NULL
     where they currently contain the literal text "na" from the import

2. Important Notes
   - 1,240 contacts affected
   - NULL is semantically correct for "no address provided"
   - The UI filters these properly when NULL but showed "na, na, na, na" before
*/

UPDATE contacts
SET
  mailing_address_1 = CASE WHEN mailing_address_1 = 'na' THEN NULL ELSE mailing_address_1 END,
  mailing_city = CASE WHEN mailing_city = 'na' THEN NULL ELSE mailing_city END,
  mailing_state = CASE WHEN mailing_state = 'na' THEN NULL ELSE mailing_state END,
  mailing_zip = CASE WHEN mailing_zip = 'na' THEN NULL ELSE mailing_zip END
WHERE mailing_address_1 = 'na' OR mailing_city = 'na' OR mailing_state = 'na' OR mailing_zip = 'na';
