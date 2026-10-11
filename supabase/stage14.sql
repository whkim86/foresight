-- AI 신호등 14단계: 가격 차트 모델 52개 대비 — 게시판 [필독] 안내 글의 '15개 모델' 문구를 모델 수와 무관하게
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)

update public.posts
   set body = replace(replace(replace(body,
         '15개 예측 모델 중 60% 이상이', '전체 예측 모델 중 60% 이상이'),
         '15개 모델이 그린 6일 종가·고점·저점 예측선', '예측 모델들이 그린 6일 종가·고점·저점 예측선'),
         '15개 모델 × 6일 = 90개 예측값 중', '전체 모델 × 6일 예측값 중')
 where auto_key like 'guide-%' and body like '%15개%';

-- 확인용: 남은 '15개' 문구가 없어야 함
select auto_key, position('15개' in body) as left_15 from public.posts where auto_key like 'guide-%';
