// "Meu Perfil": informações extras da conta (tabela profiles) e foto (Supabase Storage, bucket "avatars").
import { dialog, nativeImage, type BrowserWindow } from 'electron'
import type { ProfileInfo, ProfileResult, PublicProfile } from '../shared/types'
import { sanitizeTcgInfo, tcgProfileDef } from '../shared/profileFields'
import { t } from '../shared/i18n/index.ts'
import { authConfigured, notifyAuthChange, supabaseClient } from './auth'

const AVATAR_SIZE = 256

interface ProfileRow {
  id: string
  username: string | null
  display_name: string | null
  bio: string | null
  location: string | null
  favorite_tcg: string | null
  tcg_info: unknown
  // colunas da primeira versão do perfil (só Magic): migradas para tcg_info.mtg
  favorite_format?: string | null
  favorite_colors?: string | null
  playing_since?: number | null
  avatar_url: string | null
  created_at: string | null
}

const COLUMNS = 'id, username, display_name, bio, location, favorite_tcg, tcg_info, favorite_format, favorite_colors, playing_since, avatar_url, created_at'
const PUBLIC_COLUMNS = 'id, username, display_name, bio, location, favorite_tcg, tcg_info, avatar_url, created_at'

function toInfo(r: Partial<ProfileRow> | null): ProfileInfo {
  let tcgInfo = sanitizeTcgInfo(r?.tcg_info)
  if (!Object.keys(tcgInfo).length && (r?.favorite_colors || r?.favorite_format || r?.playing_since)) {
    tcgInfo = sanitizeTcgInfo({ mtg: { colors: r.favorite_colors, format: r.favorite_format, since: r.playing_since } })
  }
  const fav = tcgProfileDef(r?.favorite_tcg)?.id ?? (tcgInfo.mtg ? 'mtg' : '')
  return {
    username: r?.username ?? null,
    displayName: r?.display_name ?? '',
    bio: r?.bio ?? '',
    location: r?.location ?? '',
    favoriteTcg: fav,
    tcgInfo,
    avatarUrl: r?.avatar_url ?? null,
    memberSince: r?.created_at ?? null
  }
}

function errorText(msg: string | undefined): string {
  if (!msg) return t('Algo deu errado. Tente de novo.')
  // colunas/bucket ainda não criados: o schema.sql novo não foi executado no Supabase
  if (/column|schema cache|does not exist|Bucket not found|bucket/i.test(msg)) return t('O perfil ainda não foi configurado no Supabase: rode o supabase/schema.sql atualizado (veja SUPABASE.md).')
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED/i.test(msg)) return t('Sem conexão com o servidor de contas. Verifique sua internet.')
  return msg
}

async function userId(): Promise<string | null> {
  if (!authConfigured()) return null
  const { data } = await supabaseClient().auth.getUser()
  return data.user?.id ?? null
}

export async function getProfile(): Promise<ProfileResult> {
  const id = await userId()
  if (!id) return { ok: false, error: t('Você não está conectado.') }
  const { data, error } = await supabaseClient().from('profiles').select(COLUMNS).eq('id', id).maybeSingle()
  if (error) return { ok: false, error: errorText(error.message) }
  return { ok: true, profile: toInfo(data as ProfileRow | null) }
}

/** Perfis de outros jogadores (lobby e mesa online). */
export async function getPublicProfiles(ids: string[]): Promise<PublicProfile[]> {
  if (!Array.isArray(ids) || !(await userId())) return []
  const list = [...new Set(ids.filter((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 8)
  if (!list.length) return []
  const { data, error } = await supabaseClient().from('profiles').select(PUBLIC_COLUMNS).in('id', list)
  if (error) return []
  return ((data ?? []) as ProfileRow[]).map((r) => ({ ...toInfo(r), userId: r.id, username: r.username }))
}

const clean = (s: unknown, max: number): string | null => {
  const v = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : ''
  return v || null
}

export async function saveProfile(info: Omit<ProfileInfo, 'avatarUrl' | 'memberSince' | 'username'>): Promise<ProfileResult> {
  const id = await userId()
  if (!id) return { ok: false, error: t('Você não está conectado.') }
  const row = {
    display_name: clean(info.displayName, 40),
    // a bio pode ter quebras de linha
    bio: typeof info.bio === 'string' ? info.bio.trim().slice(0, 300) || null : null,
    location: clean(info.location, 60),
    favorite_tcg: tcgProfileDef(info.favoriteTcg)?.id ?? null,
    tcg_info: sanitizeTcgInfo(info.tcgInfo),
    updated_at: new Date().toISOString()
  }
  const { error } = await supabaseClient().from('profiles').update(row).eq('id', id)
  if (error) return { ok: false, error: errorText(error.message) }
  await notifyAuthChange()
  return getProfile()
}

/** Recorta no centro (quadrado), reduz para 256px e converte para JPEG. */
function prepareAvatar(file: string): Buffer | null {
  let img = nativeImage.createFromPath(file)
  if (img.isEmpty()) return null
  const { width, height } = img.getSize()
  const side = Math.min(width, height)
  img = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
  if (side > AVATAR_SIZE) img = img.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE, quality: 'best' })
  return img.toJPEG(85)
}

async function removeOldAvatars(id: string, keep?: string): Promise<void> {
  const storage = supabaseClient().storage.from('avatars')
  const { data } = await storage.list(id)
  const old = (data ?? []).map((f) => `${id}/${f.name}`).filter((p) => p !== keep)
  if (old.length) await storage.remove(old)
}

export async function chooseAvatar(win: BrowserWindow | null): Promise<ProfileResult> {
  const id = await userId()
  if (!id) return { ok: false, error: t('Você não está conectado.') }
  const opts = {
    title: t('Escolher foto de perfil'),
    properties: ['openFile' as const],
    filters: [{ name: t('Imagens'), extensions: ['jpg', 'jpeg', 'png', 'bmp', 'gif'] }]
  }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }
  const jpg = prepareAvatar(r.filePaths[0])
  if (!jpg) return { ok: false, error: t('Não foi possível abrir essa imagem. Use JPG ou PNG.') }
  // nome novo a cada troca: evita que o cache mostre a foto antiga
  const path = `${id}/avatar-${Date.now()}.jpg`
  const storage = supabaseClient().storage.from('avatars')
  const up = await storage.upload(path, jpg, { contentType: 'image/jpeg', upsert: true })
  if (up.error) return { ok: false, error: errorText(up.error.message) }
  const url = storage.getPublicUrl(path).data.publicUrl
  const { error } = await supabaseClient().from('profiles').update({ avatar_url: url, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: errorText(error.message) }
  await removeOldAvatars(id, path).catch(() => undefined)
  await notifyAuthChange()
  return getProfile()
}

export async function removeAvatar(): Promise<ProfileResult> {
  const id = await userId()
  if (!id) return { ok: false, error: t('Você não está conectado.') }
  const { error } = await supabaseClient().from('profiles').update({ avatar_url: null, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { ok: false, error: errorText(error.message) }
  await removeOldAvatars(id).catch(() => undefined)
  await notifyAuthChange()
  return getProfile()
}
