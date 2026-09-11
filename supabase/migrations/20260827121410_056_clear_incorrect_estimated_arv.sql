/*
# Clear incorrectly populated estimated_arv values

1. Modified Tables
   - `acquisition_records`: SET `estimated_arv` to NULL for all rows

2. Important Notes
   - The original spreadsheet import never had an ARV column
   - The import logic incorrectly copied the Opinion of Value into estimated_arv
   - This migration nulls out estimated_arv so it reflects "unknown"
   - Opinion of Value remains correctly stored in properties.estimated_value
*/

UPDATE acquisition_records SET estimated_arv = NULL WHERE estimated_arv IS NOT NULL;
