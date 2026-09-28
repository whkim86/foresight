-- AI 신호등 6단계: 가입 전 소개 화면용 맛보기 데이터 (로그인 없이 호출 가능)
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
--
-- 공개하는 것은 시장별 1위 종목 하나와 신호 분포 숫자, 게시판 최신 글 제목뿐.
-- 2위 이하 종목, 대시보드 원본 데이터, 작성자 정보는 내보내지 않음.

-- 시장별: 최신 예측일, 상승·혼돈·하락 수, '상승 신호가 가장 강한 종목' 1개
-- 강도 순서: 6일 합의도(상승 쪽) → 상승 본 모델 수 → D+1 중앙값 변화율
create or replace function public.landing_teaser()
returns table (
  market text, pred_date date,
  up_n int, mx_n int, dn_n int,
  top_symbol text, top_up_n int, top_models int, top_cons_up real, top_med1 double precision
) language sql stable security definer set search_path = public as $$
  with latest as (
    select p.market, max(p.pred_date) as d from predictions p group by p.market
  ), top1 as (
    select distinct on (p.market) p.market, p.symbol, p.up_n, p.n_models, p.cons_up, p.med1
      from predictions p join latest l on l.market = p.market and l.d = p.pred_date
     where p.verdict = 'up'
     order by p.market, p.cons_up desc nulls last, p.up_n desc, p.med1 desc
  )
  select l.market, l.d,
         count(*) filter (where p.verdict = 'up')::int,
         count(*) filter (where p.verdict = 'mx')::int,
         count(*) filter (where p.verdict = 'dn')::int,
         t.symbol, t.up_n, t.n_models, t.cons_up, t.med1
    from latest l
    join predictions p on p.market = l.market and p.pred_date = l.d
    left join top1 t on t.market = l.market
   group by l.market, l.d, t.symbol, t.up_n, t.n_models, t.cons_up, t.med1;
$$;

-- 시장 게시판별 최신 공개 글 제목 2개 (작성자·본문 제외, 비밀글 제외)
create or replace function public.landing_posts()
returns table (board text, title text, created_at timestamptz, comment_count int)
language sql stable security definer set search_path = public as $$
  select board, title, created_at, comment_count from (
    select p.board, p.title, p.created_at, p.comment_count,
           row_number() over (partition by p.board order by p.created_at desc) as rn
      from posts p
     where p.board in ('coin', 'nasdaq', 'kospi') and not p.is_secret
  ) x where rn <= 2
  order by board, created_at desc;
$$;

grant execute on function public.landing_teaser(), public.landing_posts() to anon, authenticated;
