/*
# Parse full addresses into proper city/state/zip columns

1. Changes
   - For all properties where city = 'na', parses the street_address field
     which contains the full formatted address like "Street, City, State Zip (original)"
   - Extracts city, state, and zip into their proper columns
   - Strips the parenthesized original input from street_address
   - Only the street portion remains in street_address

2. Important Notes
   - Pattern: "123 Main St, Springfield, IL 62701 (original input)"
   - The part before the first parenthesis is the clean address
   - Split on commas: first part = street, second = city, third = "State Zip"
   - Non-destructive: only updates records where city is currently 'na'
*/

UPDATE properties
SET
  street_address = trim(split_part(split_part(street_address, '(', 1), ',', 1)),
  city = trim(split_part(split_part(street_address, '(', 1), ',', 2)),
  state = trim(
    CASE 
      WHEN split_part(split_part(street_address, '(', 1), ',', 3) ~ '^\s*[A-Za-z]+\s+\d'
      THEN regexp_replace(trim(split_part(split_part(street_address, '(', 1), ',', 3)), '\s+\d.*$', '')
      ELSE trim(split_part(split_part(street_address, '(', 1), ',', 3))
    END
  ),
  zip_code = trim(
    CASE 
      WHEN split_part(split_part(street_address, '(', 1), ',', 3) ~ '\d{5}'
      THEN (regexp_match(split_part(split_part(street_address, '(', 1), ',', 3), '(\d{5})'))[1]
      ELSE 'na'
    END
  )
WHERE city = 'na'
  AND street_address LIKE '%,%,%';
