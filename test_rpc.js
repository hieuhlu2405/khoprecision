const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const envContent = fs.readFileSync(".env.local", "utf-8");
const env = {};

envContent.split(/\r?\n/).forEach((line) => {
  const [key, ...vals] = line.split("=");
  if (key && vals.length > 0) {
    env[key.trim()] = vals.join("=").trim().replace(/['"]/g, "");
  }
});

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const args = {
  p_baseline_date: process.argv[2] || "2026-05-01",
  p_movements_start_date: process.argv[3] || "2026-05-01",
  p_movements_end_date: process.argv[4] || "2026-05-04",
};

async function fetchAllRpcRows(queryBuilder) {
  const batch = 1000;
  const rows = [];
  let from = 0;

  while (true) {
    const { data, error } = await queryBuilder.range(from, from + batch - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(...data);
    console.log(`Page ${from}-${from + batch - 1}: ${data.length} rows`);

    if (data.length < batch) break;
    from += batch;
  }

  return rows;
}

async function run() {
  console.log("Testing inventory_calculate_report_v2 with args:", args);

  const normal = await supabase.rpc("inventory_calculate_report_v2", args, {
    count: "exact",
  });
  if (normal.error) throw normal.error;

  console.log("Default rows:", normal.data.length);
  console.log("Exact count:", normal.count);

  const allRows = await fetchAllRpcRows(
    supabase.rpc("inventory_calculate_report_v2", args)
  );

  const productCount = new Set(allRows.map((row) => row.product_id)).size;
  console.log("Paged rows:", allRows.length);
  console.log("Distinct products:", productCount);

  if (normal.data.length < allRows.length) {
    console.log("RESULT: default call is missing rows.");
  } else {
    console.log("RESULT: default call did not miss rows for this date range.");
  }
}

run().catch((err) => {
  console.error("ERROR:", err.message || err);
  process.exit(1);
});
