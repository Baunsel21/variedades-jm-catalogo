# Despliegue manual de `wompi-create-checkout`

El workflow `.github/workflows/deploy-wompi-create-checkout.yml` está preparado para ejecutarse solo manualmente desde `main`, después de marcar la confirmación explícita y aprobar el environment `sirevya-supabase-production`. Despliega únicamente `wompi-create-checkout`, conserva `verify_jwt=false` y no aplica migraciones ni despliega el webhook u otras funciones. **No se ha hecho commit ni push; el workflow aún no está publicado ni ejecutado.**

## Environment GitHub ya preparado

En `Baunsel21/variedades-jm-catalogo` se creó `sirevya-supabase-production` con:

- Única rama permitida: `main`.
- Reviewer requerido: `Baunsel21`, la única cuenta colaboradora disponible.
- `prevent_self_review=false`: la misma cuenta puede aprobar su propio deployment. Si se requiere separación de funciones, primero debe incorporarse otra persona o equipo autorizado y designarlo como reviewer.
- La respuesta inicial de GitHub reportó `can_admins_bypass=true`; no se modificó. Confirma el control en **Settings → Environments → sirevya-supabase-production** y desactiva el bypass administrativo antes de usarlo si la interfaz lo permite.

## Añadir el secreto sin compartirlo

La conexión GitHub disponible no tiene permiso para leer ni escribir secretos de Actions (la consulta de metadatos devolvió 403). Por eso no pude comprobar si ya existe ni establecer su valor. No se leyó ni modificó ningún secreto.

1. Entra a `https://github.com/Baunsel21/variedades-jm-catalogo/settings/environments/sirevya-supabase-production`.
2. Abre **Environment secrets** y comprueba únicamente si aparece el nombre `SUPABASE_ACCESS_TOKEN`. GitHub no muestra valores existentes. Si ya aparece, no lo sobrescribas sin confirmar que es el token de despliegue autorizado para Supabase.
3. Si no aparece, selecciona **Add environment secret** y escribe el nombre exacto `SUPABASE_ACCESS_TOKEN`.
4. Obtén un Personal Access Token desde tu cuenta de Supabase con autorización para desplegar Edge Functions en el proyecto; pégalo solo en el campo de valor de GitHub y guarda. No lo compartas por este chat ni lo copies a archivos del repositorio.
5. El workflow no necesita `SUPABASE_DB_PASSWORD`, service-role key, claves de Wompi ni otros secretos de runtime.

## Uso posterior (no ejecutar todavía)

Solo después de que el workflow esté publicado en `main` y el secreto esté configurado: abre **Actions → Deploy Wompi checkout to Supabase production**, elige `main`, marca la confirmación de producción y aprueba el environment. El job valida rama/commit y el bundle exacto de dos archivos; despliega solo `wompi-create-checkout` con `--no-verify-jwt`; luego confirma `ACTIVE`, `verify_jwt=false`, versión incrementada y cotejo byte por byte de la fuente remota descargada contra el commit.

El project ref `hnlbbtnfmbnbkcgegufa` está fijado en el workflow como dato público. En el runner efímero se instala Supabase CLI 3.1.0 mediante el action oficial fijado por SHA. La CLI local no se instaló.

## Referencias oficiales

- [Supabase: despliegue de Edge Functions y GitHub Actions](https://supabase.com/docs/guides/functions/deploy)
- [Supabase CLI: funciones deploy/download](https://supabase.com/docs/reference/cli/supabase-functions-deploy)
- [Supabase Management API: consultar una función](https://supabase.com/docs/reference/api/v1-get-a-function)
- [GitHub: ambientes y aprobaciones de despliegue](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [GitHub REST API: ambientes de despliegue](https://docs.github.com/en/rest/deployments/environments)
