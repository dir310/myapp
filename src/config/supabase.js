import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rgdrgbfkoczjeddgbuxq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_k-68jStH-ZieKHp5TdPFhg_Kx2FleQm';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
