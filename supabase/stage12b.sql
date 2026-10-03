-- AI 신호등 12b: 게시글 조회수 +1 은 로그인한 회원만 (비로그인 호출로 조회수 부풀리기 방지)
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
create or replace function public.view_post(p_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if auth.uid() is null then return null; end if;          -- 비로그인: 아무것도 안 함
  if public.is_admin() then                                 -- 운영자: 세지 않고 현재 값만
    select view_count into v from posts where id = p_id;
    return v;
  end if;
  perform set_config('portal.counter', 'on', true);
  update posts set view_count = view_count + 1
   where id = p_id and (not is_secret or user_id = auth.uid())
  returning view_count into v;
  perform set_config('portal.counter', 'off', true);
  return v;
end;
$$;
revoke execute on function public.view_post(bigint) from public, anon;
grant execute on function public.view_post(bigint) to authenticated;
