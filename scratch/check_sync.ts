import { supabaseAdmin } from './lib/supabase';

async function checkProducts() {
  const { count, error } = await supabaseAdmin
    .from('productos')
    .select('*', { count: 'exact', head: true });
  
  if (error) {
    console.error('Error fetching products:', error);
  } else {
    console.log('Total products in Supabase:', count);
  }
}

checkProducts();
