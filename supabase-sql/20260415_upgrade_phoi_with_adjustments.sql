-- SQL Migration to support adjustments in phoi_transactions
ALTER TABLE phoi_transactions ADD COLUMN IF NOT EXISTS tx_type text DEFAULT 'in';
ALTER TABLE phoi_transactions ADD COLUMN IF NOT EXISTS adjusted_from_transaction_id uuid REFERENCES phoi_transactions(id) ON DELETE CASCADE;

-- Update existing rows to have tx_type 'in' (already handled by DEFAULT but being explicit)
UPDATE phoi_transactions SET tx_type = 'in' WHERE tx_type IS NULL;
