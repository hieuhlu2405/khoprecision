import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: products, error: pErr } = await supabase
    .from('products')
    .select('id, sku, name')
    .ilike('name', '%PM%')

  console.log('Products matching name PM:', products);

  const { data: products2, error: pErr2 } = await supabase
    .from('products')
    .select('id, sku, name')
    .ilike('sku', '%ITP%')

  console.log('Products matching sku ITP:', products2);
}

check();
