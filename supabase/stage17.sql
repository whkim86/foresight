-- AI 신호등 17단계: 방문 흐름(퍼널) 분석 — 운영자 전용
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
--
-- 화면을 열 때·떠날 때, 대시보드에서 종목을 고르거나 검색할 때 한 줄씩 기록 (assets/app.js PortalEvents).
-- · 회원·방문자는 기록만 할 수 있고 읽을 수 없음. 읽기는 운영자 화면(analytics.html)의 funnel_stats() 로만
-- · 운영자 계정의 활동은 기록하지 않음 · 90일 지난 기록은 매일 자동 삭제
-- · 개인을 찾아보는 화면은 만들지 않음 (집계만)

create table if not exists public.events (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  session_id text not null,          -- 브라우저 탭 단위 방문 번호 (무작위, 30분 쉬면 새 번호)
  user_id    uuid,                   -- 로그인 회원이면 회원 id, 소개 화면 등 비로그인은 비움
  kind       text not null check (kind in ('view', 'leave', 'coin', 'search', 'search_miss', 'explain')),
  page       text,                   -- 예: landing, login, home, dash:coin:chart, board:coin
  market     text,                   -- coin, bithumb, nasdaq, kospi (종목 기록일 때)
  symbol     text,                   -- 고른 코인·종목 이름
  term       text,                   -- 검색어 (결과 없음은 20자까지만)
  dur_ms     int                     -- leave: 그 화면에 실제로 머문 시간(밀리초)
);
create index if not exists events_ts_idx on public.events (ts);
create index if not exists events_session_idx on public.events (session_id, ts);

alter table public.events enable row level security;
drop policy if exists "운영자 조회" on public.events;
create policy "운영자 조회" on public.events for select to authenticated using (public.is_admin());

-- 기록 (누구나 호출, 운영자는 무시). 값 길이·형식을 제한해 엉뚱한 값이 쌓이지 않게
create or replace function public.log_event(
  p_session text, p_kind text, p_page text default null, p_market text default null,
  p_symbol text default null, p_term text default null, p_dur_ms int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return; end if;
  if p_session is null or p_session !~ '^[a-z0-9]{8,40}$' then return; end if;
  if p_kind not in ('view', 'leave', 'coin', 'search', 'search_miss', 'explain') then return; end if;
  if p_page is not null and p_page !~ '^[a-z0-9:_-]{1,60}$' then return; end if;
  if p_market is not null and p_market not in ('coin', 'bithumb', 'nasdaq', 'kospi') then return; end if;
  insert into events (session_id, user_id, kind, page, market, symbol, term, dur_ms)
  values (p_session, auth.uid(), p_kind, p_page, p_market,
          left(nullif(trim(p_symbol), ''), 40),
          left(nullif(trim(p_term), ''), case when p_kind = 'search_miss' then 20 else 40 end),
          case when p_dur_ms between 0 and 3600000 then p_dur_ms end);
end;
$$;
grant execute on function public.log_event(text, text, text, text, text, text, int) to anon, authenticated;

-- 90일 지난 기록 자동 삭제 (매일 KST 04:00)
do $$ begin perform cron.unschedule(jobname) from cron.job where jobname = 'events-retention'; end $$;
select cron.schedule('events-retention', '0 19 * * *', $$delete from public.events where ts < now() - interval '90 days'$$);

-- 운영자 화면용 집계 (최근 p_days 일, KST 기준). 한 번에 JSON 으로
create or replace function public.funnel_stats(p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  since timestamptz := (date_trunc('day', now() at time zone 'Asia/Seoul') - make_interval(days => greatest(p_days, 1) - 1)) at time zone 'Asia/Seoul';
  out jsonb;
begin
  if not public.is_admin() then raise exception '운영자만 볼 수 있어요'; end if;

  with e as (select * from events where ts >= since),
  v as (  -- 화면 열기만, 방문별 순서
    select session_id, user_id, page, ts,
           lead(page) over (partition by session_id order by ts) as next_page,
           row_number() over (partition by session_id order by ts desc) as rn_last
      from e where kind = 'view'
  ),
  s as (  -- 방문(세션)별 요약
    select session_id,
           min(ts) as first_ts,
           max(user_id::text) as uid,
           coalesce(sum(dur_ms) filter (where kind = 'leave'), 0) as active_ms,
           bool_or(kind = 'view' and page = 'landing') as f_landing,
           bool_or(kind = 'view' and page = 'login') as f_login,
           bool_or(kind = 'view' and page = 'home') as f_home,
           bool_or(kind = 'view' and page like 'dash:%' and page not like '%:locked') as f_dash,
           bool_or(kind = 'view' and page like 'dash:%:chart') as f_chart,
           bool_or(kind = 'explain') as f_explain
      from e group by session_id
  ),
  dw as (  -- 화면별 머문 시간: 한 방문에서 그 화면에 머문 시간 합계(탭을 숨겼다 돌아오면 나눠 기록되므로)의 중간값·평균
    select page, count(*) as n,
           percentile_cont(0.5) within group (order by ms) as med_ms,
           avg(ms) as avg_ms
      from (select session_id, page, sum(dur_ms) as ms
              from e where kind = 'leave' and dur_ms is not null group by 1, 2) x
     group by page
  ),
  pv as (select page, count(*) as views, count(distinct session_id) as sess from v group by page),
  ex as (select page, count(*) as exits from v where rn_last = 1 group by page)
  select jsonb_build_object(
    'kpi', (select jsonb_build_object(
              'sessions', count(*),
              'members', count(distinct uid),
              'returning', (select count(*) from (select uid from s where uid is not null group by uid
                                                   having count(distinct (first_ts at time zone 'Asia/Seoul')::date) > 1) r),
              'med_active_ms', percentile_cont(0.5) within group (order by active_ms) filter (where active_ms > 0),
              'avg_active_ms', avg(active_ms) filter (where active_ms > 0),
              'landing', count(*) filter (where f_landing),
              'landing_to_home', count(*) filter (where f_landing and f_home))
            from s),
    'funnel_new', (select jsonb_build_array(
              count(*) filter (where f_landing),
              count(*) filter (where f_landing and f_login),
              count(*) filter (where f_landing and f_login and f_home),
              count(*) filter (where f_landing and f_login and f_home and f_dash),
              count(*) filter (where f_landing and f_login and f_home and f_dash and f_chart)) from s),
    'funnel_member', (select jsonb_build_array(
              count(*) filter (where f_home),
              count(*) filter (where f_home and f_dash),
              count(*) filter (where f_home and f_dash and f_chart),
              count(*) filter (where f_home and f_dash and f_chart and f_explain)) from s),
    'home_next', coalesce((select jsonb_agg(jsonb_build_object('to', t, 'n', n) order by n desc)
              from (select coalesce(case when next_page like 'dash:%' then split_part(next_page, ':', 1) || ':' || split_part(next_page, ':', 2)
                                         when next_page like 'board:%' then 'board' else next_page end, 'exit') as t,
                           count(*) as n
                      from v where page = 'home' group by 1) x), '[]'::jsonb),
    'heatmap', coalesce((select jsonb_agg(jsonb_build_object('dow', d, 'hour', h, 'n', n))
              from (select extract(isodow from first_ts at time zone 'Asia/Seoul')::int as d,
                           extract(hour from first_ts at time zone 'Asia/Seoul')::int as h, count(*) as n
                      from s group by 1, 2) x), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('page', pv.page, 'views', pv.views, 'sess', pv.sess,
                                   'med_ms', dw.med_ms, 'avg_ms', dw.avg_ms, 'exits', coalesce(ex.exits, 0)) order by pv.views desc)
              from pv left join dw on dw.page = pv.page left join ex on ex.page = pv.page), '[]'::jsonb),
    'coins', coalesce((select jsonb_agg(jsonb_build_object('market', market, 'symbol', symbol, 'n', n, 'sess', sess) order by n desc)
              from (select market, symbol, count(*) as n, count(distinct session_id) as sess
                      from e where kind = 'coin' and symbol is not null group by 1, 2 order by 3 desc limit 60) x), '[]'::jsonb),
    'searches', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'market', market, 'term', term, 'n', n) order by n desc)
              from (select kind, market, upper(term) as term, count(*) as n
                      from e where kind in ('search', 'search_miss') and term is not null group by 1, 2, 3 order by 4 desc limit 60) x), '[]'::jsonb),
    'explains', coalesce((select jsonb_agg(jsonb_build_object('market', market, 'symbol', symbol, 'n', n) order by n desc)
              from (select market, symbol, count(*) as n from e where kind = 'explain' group by 1, 2 order by 3 desc limit 20) x), '[]'::jsonb)
  ) into out;
  return out;
end;
$$;
