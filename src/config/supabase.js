import { createClient } from '@supabase/supabase-js';

// Las credenciales se leen del archivo .env (que NO está en Git)
// En producción (GitHub Pages / Netlify / etc.) se configuran como Environment Variables del servidor
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('⚠️ Faltan variables de entorno de Supabase. Verifica el archivo .env');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
