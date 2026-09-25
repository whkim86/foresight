-- 예측 포털 4-3: 수집을 정시에 실행 (Supabase pg_cron → GitHub Actions 실행 요청)
-- GitHub 자체 예약 실행은 몇 시간씩 늦거나 건너뛸 수 있어서, Supabase 가 정해진 시각에 직접 깨움
--
-- 준비: GitHub 에서 foresight 저장소 전용 토큰을 하나 더 만듦
--   Fine-grained token → Repository access: Only select → foresight
--   Permissions → Actions: Read and write
-- 아래 [여기에 토큰] 을 그 토큰으로 바꾼 뒤 전체 Run. (토큰은 Supabase Vault 에 암호화 저장)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- 1. 토큰 저장 (다시 실행하면 새 값으로 교체) ----------
do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'github_dispatch_token';
  if v_id is null then
    perform vault.create_secret('[여기에 토큰]', 'github_dispatch_token', 'foresight 수집 워크플로 실행용');
  else
    perform vault.update_secret(v_id, '[여기에 토큰]');
  end if;
end $$;

-- ---------- 2. GitHub 수집 워크플로 실행 요청 ----------
create or replace function public.trigger_ingest()
returns void language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'github_dispatch_token';
  perform net.http_post(
    url     := 'https://api.github.com/repos/whkim86/foresight/actions/workflows/ingest.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'Accept', 'application/vnd.github+json',
      'User-Agent', 'foresight-supabase-cron'),
    body    := '{"ref":"main"}'::jsonb
  );
end;
$$;
revoke execute on function public.trigger_ingest() from public, anon, authenticated;

-- ---------- 3. 예약 (시각은 UTC, KST = UTC+9) ----------
do $$ begin perform cron.unschedule(jobname) from cron.job where jobname like 'ingest-%'; end $$;
select cron.schedule('ingest-nasdaq', '5-55/10 23 * * *', 'select public.trigger_ingest()');  -- KST 08:05~08:55
select cron.schedule('ingest-coin',   '5-55/10 0 * * *',  'select public.trigger_ingest()');  -- KST 09:05~09:55
select cron.schedule('ingest-kospi',  '5-55/10 14 * * *', 'select public.trigger_ingest()');  -- KST 23:05~23:55
select cron.schedule('ingest-late',   '20 1,15 * * *',    'select public.trigger_ingest()');  -- KST 10:20, 00:20

-- 확인용: 예약 목록과 최근 요청 결과 (status_code 204 면 성공)
-- select jobname, schedule from cron.job;
-- select created, status_code, content from net._http_response order by created desc limit 5;
