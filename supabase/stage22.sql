-- AI 신호등 22단계: 게시판 [필독] 신호등 보는 법 — 모델 수를 '52개'로 명시
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
-- 처음 문구('15개 …', stage7)와 stage14 에서 바꾼 문구('전체 …') 둘 다 52개 문구로 바꿈. 나머지 내용은 그대로

update public.posts
   set body = replace(replace(replace(replace(replace(replace(body,
         '15개 예측 모델 중 60% 이상이', '52개 예측 모델 중 60% 이상이'),
         '전체 예측 모델 중 60% 이상이', '52개 예측 모델 중 60% 이상이'),
         '15개 모델이 그린 6일 종가·고점·저점 예측선', '52개 모델이 그린 6일 종가·고점·저점 예측선'),
         '예측 모델들이 그린 6일 종가·고점·저점 예측선', '52개 모델이 그린 6일 종가·고점·저점 예측선'),
         '15개 모델 × 6일 = 90개 예측값 중', '52개 모델 × 6일 = 312개 예측값 중'),
         '전체 모델 × 6일 예측값 중', '52개 모델 × 6일 = 312개 예측값 중')
 where auto_key like 'guide-%';

-- 확인용: guide-coin · guide-nasdaq · guide-kospi 가 has_52 = 3, left_15 = 0 이면 정상 (guide-request 는 모델 문구가 없어 0)
select auto_key, title,
       (length(body) - length(replace(body, '52개', ''))) / length('52개') as has_52,
       position('15개' in body) as left_15
  from public.posts where auto_key like 'guide-%' order by auto_key;
