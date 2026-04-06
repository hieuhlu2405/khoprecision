
const { createClient } = require('@supabase/supabase-client');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("--- DATABASE COUNT CHECK ---");
  
  // 1. Total Products
  const { count: prodCount } = await supabase.from('products').select('*', { count: 'exact', head: true }).is('deleted_at', null);
  console.log("Total Products (not deleted):", prodCount);

  // 2. Latest Stocktake
  const { data: latestStk } = await supabase.from('inventory_stocktakes')
    .select('*')
    .is('deleted_at', null)
    .order('confirmed_at', { ascending: false })
    .limit(1);

  if (latestStk && latestStk.length > 0) {
    const stk = latestStk[0];
    console.log(`Latest Confirmed Stocktake: ID=${stk.id}, Date=${stk.stocktake_date}, Status=${stk.status}`);
    
    const { count: lineCount } = await supabase.from('inventory_stocktake_lines')
      .select('*', { count: 'exact', head: true })
      .eq('stocktake_id', stk.id)
      .is('deleted_at', null);
    console.log(`- Lines in this stocktake:`, lineCount);

    const { count: openingCount } = await supabase.from('inventory_opening_balances')
      .select('*', { count: 'exact', head: true })
      .eq('period_month', stk.stocktake_date)
      .eq('source_stocktake_id', stk.id)
      .is('deleted_at', null);
    console.log(`- Opening Balance records linked to this stocktake:`, openingCount);
    
    const { count: totalOpeningCount } = await supabase.from('inventory_opening_balances')
      .select('*', { count: 'exact', head: true })
      .eq('period_month', stk.stocktake_date)
      .is('deleted_at', null);
    console.log(`- Total Opening Balance records on this date:`, totalOpeningCount);
  } else {
    console.log("No confirmed stocktakes found.");
  }

  // 3. Check for products with no opening balance
  console.log("\n--- DISCREPANCY ANALYSIS ---");
  // This is harder to do without a join, but let's just see if we can find any product_id in stocktake_lines not in opening_balances
}

run();
