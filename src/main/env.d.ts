// Variáveis de ambiente do processo principal (arquivo .env na raiz do projeto, prefixo MAIN_VITE_).
interface ImportMetaEnv {
  readonly MAIN_VITE_SUPABASE_URL?: string
  readonly MAIN_VITE_SUPABASE_ANON_KEY?: string
  readonly MAIN_VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Só desenvolvimento: chama o provedor de IA direto (não use em instaladores). */
  readonly MAIN_VITE_AI_API_KEY?: string
  readonly MAIN_VITE_AI_BASE_URL?: string
  readonly MAIN_VITE_AI_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
