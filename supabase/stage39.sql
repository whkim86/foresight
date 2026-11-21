-- AI 신호등 39단계: 무료 종목 페이지 → 가입 흐름 (2026-11-21) — 운영자 전용 집계
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
--
-- · 방문 기록(events)에 '들어온 곳(src)' 칸 추가: yt(유튜브) · blog(블로그) · search(검색) · direct(직접) · other
-- · 무료 페이지 기록에 종목 이름(symbol)·시장(market)도 같이 남김 (assets/app.js · s/<종목>/index.html)
-- · '무료로 시작하기' 클릭은 page = 'pick_cta' 로 남김
-- · 읽기는 운영자 화면(analytics.html)의 pick_stats() 로만. 개인을 찾아보는 화면 없음 (집계만)

alter table public.events add column if not exists src text;

-- 예전 함수(7개 인자)를 지우고 src 를 받는 함수로 바꿈 (이름이 같은 함수가 둘이면 호출이 헷갈리므로)
drop function if exists public.log_event(text, text, text, text, text, text, int);
create or replace function public.log_event(
  p_session text, p_kind text, p_page text default null, p_market text default null,
  p_symbol text default null, p_term text default null, p_dur_ms int default null, p_src text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return; end if;
  if p_session is null or p_session !~ '^[a-z0-9]{8,40}$' then return; end if;
  if p_kind not in ('view', 'leave', 'coin', 'search', 'search_miss', 'explain') then return; end if;
  if p_page is not null and p_page !~ '^[a-z0-9:_-]{1,60}$' then return; end if;
  if p_market is not null and p_market not in ('coin', 'bithumb', 'nasdaq', 'kospi') then return; end if;
  insert into events (session_id, user_id, kind, page, market, symbol, term, dur_ms, src)
  values (p_session, auth.uid(), p_kind, p_page, p_market,
          left(nullif(trim(p_symbol), ''), 40),
          left(nullif(trim(p_term), ''), case when p_kind = 'search_miss' then 20 else 40 end),
          case when p_dur_ms between 0 and 3600000 then p_dur_ms end,
          case when p_src ~ '^[a-z_]{1,20}$' then p_src end);
end;
$$;
grant execute on function public.log_event(text, text, text, text, text, text, int, text) to anon, authenticated;

-- 무료 페이지 흐름 집계 (최근 p_days 일, KST). 무료 페이지를 본 방문(세션)만 대상
create or replace function public.pick_stats(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  since timestamptz := (date_trunc('day', now() at time zone 'Asia/Seoul') - make_interval(days => greatest(p_days, 1) - 1)) at time zone 'Asia/Seoul';
  out jsonb;
begin
  if not public.is_admin() then raise exception '운영자만 볼 수 있어요'; end if;

  with e as (select * from events where ts >= since),
  fp as (  -- 방문별 첫 무료 페이지 (그 뒤 행동만 셈)
    select distinct on (session_id) session_id, ts as t0, symbol, market, coalesce(src, 'unknown') as src
      from e where kind = 'view' and page = 'pick' order by session_id, ts
  ),
  s as (
    select fp.session_id, fp.symbol, fp.market, fp.src, fp.t0,
           bool_or(x.kind = 'view' and x.page = 'pick_chart') as f_chart,
           bool_or(x.kind = 'view' and x.page = 'pick_cta' and x.ts >= fp.t0) as f_cta,
           bool_or(x.kind = 'view' and x.page = 'login' and x.ts >= fp.t0) as f_login,
           bool_or(x.user_id is not null and x.ts >= fp.t0) as f_member,
           bool_or(x.kind = 'view' and x.page like 'dash:%' and x.page not like '%:locked' and x.ts >= fp.t0) as f_dash
      from fp join e x on x.session_id = fp.session_id
     group by 1, 2, 3, 4, 5
  )
  select jsonb_build_object(
    'funnel', (select jsonb_build_array(count(*), count(*) filter (where f_chart), count(*) filter (where f_cta),
                                        count(*) filter (where f_login), count(*) filter (where f_member), count(*) filter (where f_dash)) from s),
    'by_symbol', coalesce((select jsonb_agg(jsonb_build_object('symbol', symbol, 'market', market, 'n', n, 'chart', ch, 'cta', cta, 'login', lg, 'member', mb) order by n desc)
              from (select coalesce(symbol, '(기록 전)') as symbol, market, count(*) as n, count(*) filter (where f_chart) as ch,
                           count(*) filter (where f_cta) as cta, count(*) filter (where f_login) as lg, count(*) filter (where f_member) as mb
                      from s group by 1, 2 order by 3 desc limit 40) x), '[]'::jsonb),
    'by_src', coalesce((select jsonb_agg(jsonb_build_object('src', src, 'n', n, 'cta', cta, 'login', lg, 'member', mb) order by n desc)
              from (select src, count(*) as n, count(*) filter (where f_cta) as cta, count(*) filter (where f_login) as lg,
                           count(*) filter (where f_member) as mb from s group by 1) x), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'n', n, 'login', lg) order by d)
              from (select (t0 at time zone 'Asia/Seoul')::date as d, count(*) as n, count(*) filter (where f_login) as lg
                      from s group by 1) x), '[]'::jsonb)
  ) into out;
  return out;
end;
$$;
grant execute on function public.pick_stats(int) to authenticated;
