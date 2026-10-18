-- AI 신호등 23단계: 코스피 새 종목 공지 숫자 바로잡기 (30개 → 29개)
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)

update public.posts
   set title = replace(title, '30개', '29개')
 where auto_key = 'notice-newsym-202610-kospi';

-- 확인용: 제목에 29개가 보이면 정상
select board, title from public.posts where auto_key = 'notice-newsym-202610-kospi';
