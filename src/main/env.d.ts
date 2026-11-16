// Variáveis de ambiente do processo principal (arquivo .env na raiz do projeto, prefixo MAIN_VITE_).
interface ImportMetaEnv {
  readonly MAIN_VITE_SUPABASE_URL?: string
  readonly MAIN_VITE_SUPABASE_ANON_KEY?: string
  readonly MAIN_VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
