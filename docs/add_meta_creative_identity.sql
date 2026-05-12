-- Identidade estável de mídia para deduplicação de criativos
alter table if exists public.meta_ad_creatives
  add column if not exists image_hash text;

