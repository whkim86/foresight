-- AI 신호등 7단계: 운영자 자동 요약 글 + 안내 글
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)

-- ---------- 1. 자동 글 구분 키 (같은 날 요약은 한 글만, 다시 수집되면 내용만 갱신) ----------
alter table public.posts add column if not exists auto_key text unique;

-- ---------- 2. 글 저장 규칙: 서버(수집 스크립트·SQL Editor)가 쓰는 글은 지정한 작성자로 ----------
-- 로그인한 회원이 쓰면 지금처럼 본인으로 고정. auth.uid() 가 없는 경우는 service_role 뿐
-- (비로그인 방문자는 RLS 에 쓰기 정책이 없어 애초에 못 씀)
create or replace function public.posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null then
      if new.user_id is null then raise exception '자동 글에는 작성자(user_id)가 필요해요'; end if;
      new.author := coalesce(nullif(new.author, ''), (select nickname from profiles where id = new.user_id));
    else
      new.user_id := auth.uid();
      new.author := (select nickname from profiles where id = auth.uid());
      if not is_admin() then new.pinned := false; end if;
    end if;
    new.comment_count := 0;
    new.report_count := 0;
    new.created_at := now();
  else
    new.user_id := old.user_id;
    new.author := old.author;
    new.board := old.board;
    new.created_at := old.created_at;
    new.auto_key := old.auto_key;
    if current_setting('portal.counter', true) is distinct from 'on' then
      new.comment_count := old.comment_count;
      new.report_count := old.report_count;
      if auth.uid() is not null and not is_admin() then new.pinned := old.pinned; end if;
      if new.title is distinct from old.title or new.body is distinct from old.body then
        new.updated_at := now();
      end if;
    end if;
  end if;
  if new.board = 'payment' then new.is_secret := true; end if;
  return new;
end;
$$;

-- ---------- 3. 운영자 안내 글 (공지 고정) ----------
do $$
declare
  admin_id uuid := (select id from profiles where role = 'admin' order by joined_at limit 1);
  m record;
  guide text;
begin
  if admin_id is null then raise exception '운영자 계정이 없어요'; end if;

  for m in select * from (values
      ('coin',   '코인',      'BTC',        '매일 오전 9시 이후 (업비트 일봉 기준)'),
      ('nasdaq', '나스닥',    'SP500',      '매일 오전 8시 이후 (전날 미국 장 마감 기준)'),
      ('kospi',  '코스피200', 'SK하이닉스', '매일 밤 11시 이후 (그날 한국 장 마감 기준)')
    ) as v(board, name, lead, schedule)
  loop
    guide := format($t$AI 신호등 %1$s 게시판에 오신 걸 환영해요!

■ 신호등 색의 뜻
· 빨강 = 상승 : 15개 예측 모델 중 60%% 이상이 다음 날(D+1) 종가를 직전 종가보다 높게 보고, 모델 중앙값 변화도 충분히 클 때
· 노랑 = 혼돈 : 모델 의견이 갈리거나 변화폭이 작아서 방향을 단정하기 어려울 때
· 파랑 = 하락 : 60%% 이상이 낮게 보고, 중앙값 변화도 충분히 클 때

■ 대시보드 두 화면
· 우선순위 : 오늘 먼저 볼 종목을 신호 강도순으로 정리했어요
· 가격 차트 : 15개 모델이 그린 6일 종가·고점·저점 예측선과 D+1 해석을 볼 수 있어요

■ 6일 합의도
15개 모델 × 6일 = 90개 예측값 중 기준 종가보다 높은(낮은) 값의 비율이에요. 한쪽으로 많이 모일수록 모델들이 같은 방향을 보고 있다는 뜻이에요.

■ 업데이트
%3$s 새 예측이 올라와요. 이 게시판에는 매일 '오늘의 신호 요약'이 자동으로 올라가요. 요약에는 전체 신호 분포와 기준 종목 %2$s 의 판정이 담겨요.

■ 꼭 알아두세요
이 서비스의 정보는 예측 모델의 출력을 정리한 참고 자료이며, 투자 권유나 종목 추천이 아닙니다. 투자 판단과 그 결과에 대한 책임은 이용자 본인에게 있어요.

궁금한 점은 댓글로 편하게 남겨주세요.$t$, m.name, m.lead, m.schedule);

    insert into posts (board, user_id, author, title, body, pinned, auto_key)
    values (m.board, admin_id, 'AI 신호등', format('[필독] %s 신호등 보는 법', m.name), guide, true, 'guide-' || m.board)
    on conflict (auto_key) do nothing;
  end loop;

  insert into posts (board, user_id, author, title, body, pinned, auto_key)
  values ('request', admin_id, 'AI 신호등', '[안내] 종목 추가 요청은 이렇게 남겨주세요',
$t$새로 예측해줬으면 하는 코인·종목이 있으면 이 게시판에 남겨주세요.

■ 이렇게 적어주시면 빨라요
· 시장 : 코인(업비트) / 나스닥·미국 / 코스피
· 종목 : 이름과 티커 (예: 솔라나 SOL, 엔비디아 NVDA, 한화에어로스페이스)
· 이유 : 관심 있는 이유를 한 줄로 (선택)

■ 참고
· 요청이 많은 종목부터 검토해요. 같은 종목을 원하시면 새 글 대신 댓글로 '저도요'를 남겨주세요.
· 데이터가 충분하지 않은 종목은 추가가 어려울 수 있어요.
· 추가되면 이 글의 댓글과 게시판 공지로 알려드릴게요.$t$, true, 'guide-request')
  on conflict (auto_key) do nothing;

  insert into posts (board, user_id, author, title, body, pinned, auto_key)
  values ('request', admin_id, 'AI 신호등', '[공지] 자주 묻는 질문 (무료체험 · 결제 · 환불)',
$t$Q. 무료체험은 어떻게 되나요?
가입한 날부터 7일 동안 코인·나스닥·코스피200 전체를 무료로 볼 수 있어요. 카드 등록은 필요 없어요.

Q. 체험이 끝나면요?
대시보드의 자세한 내용이 잠겨요. 게시판과 마이페이지는 계속 이용할 수 있어요.

Q. 가격은요?
보고 싶은 시장만 골라요. 1달 기준 1개 4,900원 · 2개 8,900원 · 3개 12,900원이에요.
3달 10%, 6달 20%, 1년 40% 할인돼요.

Q. 결제는 어떻게 하나요?
마이페이지에서 시장과 기간을 고른 뒤 안내된 계좌로 입금하고 [입금 신청]을 눌러주세요. 입금자명은 가입 닉네임과 똑같이 적어주세요. 운영자가 확인하면 선택한 탭이 바로 열려요.

Q. 환불은요?
1달권은 이용 시작 후 7일 이내 100% 환불되고, 7일이 지나면 환불이 어려워요.
3달·6달·1년권은 7일 이내 100%, 그 이후에는 남은 기간 비율만큼 환불돼요.

Q. 예측은 언제 바뀌나요?
나스닥은 매일 오전 8시, 코인은 오전 9시, 코스피200은 밤 11시 이후에 새로 올라와요. 휴장일에는 바뀌지 않아요.

Q. 예측이 얼마나 맞나요?
매일 판정과 실제 결과를 비교해 기록하고 있어요. 기록이 충분히 쌓이면 상승·하락·전체 적중률을 함께 공개할게요.

Q. 입금·연장 문의는요?
입금 문의 게시판에 남겨주세요. 글쓴이와 운영자만 볼 수 있는 비밀글이에요.

※ 이 서비스의 정보는 예측 모델의 출력을 정리한 참고 자료이며, 투자 권유나 종목 추천이 아닙니다.$t$, true, 'guide-faq')
  on conflict (auto_key) do nothing;
end $$;
