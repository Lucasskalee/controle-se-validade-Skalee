-- Alinha acesso a locais com a regra de produtos:
-- usuario normal (sem perfil ativo de promotor) pode ver todos os locais ativos;
-- promotor ativo continua restrito aos locais atribuidos.

create or replace function private.can_view_location(target_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      (select private.is_platform_admin())
      or not exists (
        select 1
        from public.promoter_profiles profile
        where profile.user_id = (select auth.uid())
          and profile.active = true
      )
      or exists (
        select 1
        from public.retail_locations location
        join public.organization_memberships membership
          on membership.organization_id = location.retailer_organization_id
         and membership.user_id = (select auth.uid())
         and membership.active = true
        where location.id = target_location_id
      )
      or exists (
        select 1
        from public.promoter_location_assignments assignment
        where assignment.promoter_user_id = (select auth.uid())
          and assignment.location_id = target_location_id
          and assignment.active = true
      )
    );
$$;
