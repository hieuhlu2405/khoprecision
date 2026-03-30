const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// 1. Read .env.local
const envContent = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...vals] = line.split('=');
  if (key && vals.length > 0) {
    env[key.trim()] = vals.join('=').trim().replace(/['"]/g, '');
  }
});

const url = env['NEXT_PUBLIC_SUPABASE_URL'];
const key = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

if (!url || !key) {
  console.log("Missing Supabase env vars");
  process.exit(1);
}

const supabase = createClient(url, key);

async function run() {
  console.log("Calling RPC...");
  const { data, error } = await supabase.rpc('inventory_calculate_report_v2', {
    p_baseline_date: '2026-03-01',
    p_movements_start_date: '2026-03-01',
    p_movements_end_date: '2026-04-01'
  });
  
  if (error) {
    console.log("RPC ERROR:", JSON.stringify(error, null, 2));
  } else {
    console.log("RPC SUCCESS:", data?.length, "rows returned");
  }
}

run();
