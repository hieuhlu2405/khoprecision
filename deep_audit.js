
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("--- DEEP DATA AUDIT ---");
  
  // 1. Get latest stocktake
  const { data: stocktakes } = await supabase.from('inventory_stocktakes')
    .select('*')
    .is('deleted_at', null)
    .order('confirmed_at', { ascending: false })
    .limit(1);

  if (!stocktakes || stocktakes.length === 0) {
    console.log("No confirmed stocktakes found.");
    return;
  }
  const stk = stocktakes[0];
  console.log(`Checking Stocktake ID: ${stk.id}, Date: ${stk.stocktake_date}`);

  // 2. Get lines
  const { data: lines } = await supabase.from('inventory_stocktake_lines')
    .select('product_id, actual_qty_after')
    .eq('stocktake_id', stk.id)
    .is('deleted_at', null);
  
  console.log(`Total lines in Stocktake: ${lines.length}`);

  // 3. Get opening balances for that date
  const { data: openings } = await supabase.from('inventory_opening_balances')
    .select('product_id, opening_qty')
    .eq('period_month', stk.stocktake_date)
    .is('deleted_at', null);

  console.log(`Total opening balances on ${stk.stocktake_date}: ${openings.length}`);

  // 4. Compare
  const lineProductIds = new Set(lines.map(l => l.product_id));
  const openingProductIds = new Set(openings.map(o => o.product_id));

  const missingInOpening = lines.filter(l => !openingProductIds.has(l.product_id));
  console.log(`Missing in Opening Balances: ${missingInOpening.length}`);

  if (missingInOpening.length > 0) {
    console.log("Example missing product IDs:", missingInOpening.slice(0, 5).map(l => l.product_id));
  }

  // 5. Check if those missing ones have 0 quantity
  const zeros = missingInOpening.filter(l => l.actual_qty_after === 0);
  console.log(`Of the missing ones, how many have 0 quantity: ${zeros.length}`);
}

run();
