import { createClient } from '@supabase/supabase-js';

// Clave pública (anon/publishable) — es segura en el frontend.
// La protección real de los datos está en las reglas RLS de Supabase.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
