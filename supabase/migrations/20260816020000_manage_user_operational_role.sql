create or replace function public.set_user_operational_role(
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_role text := lower(btrim(coalesce(p_role, '')));
  target_email text;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Somente o Administrador Skalee pode alterar o tipo de usuário.' using errcode = '42501';
  end if;

  if normalized_role not in ('normal', 'promoter') then
    raise exception 'Tipo de usuário inválido.' using errcode = '23514';
  end if;

  select email into target_email
  from auth.users
  where id = p_user_id;

  if target_email is null then
    raise exception 'Usuário não encontrado.' using errcode = '23503';
  end if;

  insert into public.user_profiles (user_id, full_name, active)
  values (p_user_id, split_part(target_email, '@', 1), true)
  on conflict (user_id) do update
    set active = true,
        updated_at = now();

  if normalized_role = 'promoter' then
    insert into public.promoter_profiles (user_id, active)
    values (p_user_id, true)
    on conflict (user_id) do update
      set active = true,
          updated_at = now();
  else
    update public.promoter_profiles
       set active = false,
           updated_at = now()
     where user_id = p_user_id;

    update public.promoter_brand_assignments
       set active = false
     where promoter_user_id = p_user_id;

    update public.promoter_supplier_assignments
       set active = false
     where promoter_user_id = p_user_id;

    update public.promoter_location_assignments
       set active = false
     where promoter_user_id = p_user_id;
  end if;
end;
$$;

grant execute on function public.set_user_operational_role(uuid, text) to authenticated;
