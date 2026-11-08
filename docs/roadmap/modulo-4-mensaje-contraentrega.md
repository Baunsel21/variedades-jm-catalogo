# Módulo 4 — Mensaje informativo de contraentrega

## Estado

Implementación guardada como incremento independiente en la rama `feature/admin-dashboard-critical-fixes`. No se ha aplicado la migración al único proyecto Supabase compartido, no se hizo merge a `main` ni despliegue. Los PASS locales no demuestran funcionamiento publicado ni ejecución de las RPC en una base aislada.

## Resultado implementado

En Configuración hay un editor de título y contenido con vista previa local, interruptor independiente del medio de pago y guardado por Supabase RPC administrativa. Admite párrafos, saltos de línea, listas con `- `, `* ` o `• `, símbolos y emojis. Los límites son 120 caracteres Unicode para título y 3.000 para contenido; no admite controles ajenos a salto de línea/tabulación. El texto y cualquier HTML introducido se escapan antes de renderizarse. El texto activado es público: la UI indica que no debe contener datos privados.

La tabla singleton `storefront_cod_notice_settings` comienza desactivada y sin copy inventado. Tiene RLS habilitado y acceso directo revocado a PUBLIC, anon, authenticated y service_role. La RPC pública entrega solo título/contenido si está activado; un borrador desactivado no se divulga. Las RPC administrativas requieren `is_store_admin()` y solo tienen EXECUTE para authenticated; todas fijan search_path.

La tienda muestra la información inmediatamente debajo de la opción contraentrega solo cuando ese medio está seleccionado y habilitado. Oculta el mensaje si la RPC falta, falla o devuelve payload inválido. Ocultarlo o desactivarlo no altera la opción COD, tarifas, ciudades, reservas ni validación del pedido. Se consulta al abrir checkout desde ficha o carrito, al seleccionar COD, al volver desde BFCache, al recuperar visibilidad con checkout abierto y ante una notificación `cod-notice-changed` ya usada por el proyecto. No se añade polling continuo ni se cachea el copy en localStorage.

El panel revalida identidad/admin antes de leer o guardar, bloquea controles durante consultas y usa época/secuencia para descartar respuestas tras logout. Un error ambiguo de guardado no se anuncia como éxito: exige recargar antes de repetir. Logout vacía el borrador y vista previa.

## Archivos

- `admin.html`: editor, preview, lectura/guardado, validación de sesión y limpieza.
- `index.html`: aviso accesible y refrescos de la lectura pública; no modifica los payloads de pedidos ni pagos.
- `scripts/cod_notice.js`: helper compartido, sin red/persistencia, para límites Unicode y render escapado de párrafos/listas.
- `supabase/migrations/20261108130000_storefront_cod_notice.sql`: singleton y RPCs aisladas.
- `tests/cod_notice_regression.mjs`: helper, XSS, límites, visibilidad, errores y deduplicación.
- `tests/admin_cod_notice_regression.mjs`: consultas reales con mocks, permisos/cambio de cuenta, preview, guardado y logout tardío.
- `tests/cod_notice_regression.sql`: ACL/search_path/RLS y fixtures reversibles para ejecutar únicamente en staging.
- `scripts/validate.mjs`: orden de migración y contratos estáticos del módulo.

## Pruebas y salida segura

Los tests JavaScript funcionan sin red ni sesiones reales. El parser local acepta la migración (16 sentencias SQL, 4 unidades PL/pgSQL). La regresión SQL se preparó y analizó localmente; no se ejecutó contra Supabase. El proyecto no tiene diagnósticos del Host porque no hay un proyecto Webdev activo; se usan `node --check`, el validador existente y las regresiones independientes como comprobación local.

La revisión independiente encontró dos diferencias de contrato, corregidas antes del commit: SQL ahora usa explícitamente el conjunto de espacios de `String.trim()` (incluye NBSP/U+2003/BOM), con controles C0/C1 validados; la prueba SQL cubre solicitudes directas con whitespace Unicode. Una notificación mientras hay una lectura en vuelo invalida el resultado anterior y encola una única consulta fresca; la prueba JS verifica que nunca reaparezca el copy antiguo.

La nueva regresión inspecciona PUBLIC mediante `aclexplode`/`grantee=0`, porque PUBLIC es un pseudo-rol ACL y no un nombre ordinario de `pg_roles`. Antes de ejecutar la suite SQL heredada en staging hay que revisar sus usos de `has_function_privilege('public',...)`/`has_table_privilege('public',...)`; esa revisión no se sustituyó por un PASS del parser ni se amplió este slice a todas las pruebas antiguas.

Instalar primero la migración y ejecutar las pruebas transaccionales en una base aislada compatible, con un runner autorizado para SET LOCAL ROLE. Confirmar admin/no-admin/anon, texto largo y malicioso, desactivación, carga lenta, errores de red y las rutas de apertura. Después publicar el frontend por la secuencia aprobada. Si el frontend aparece antes que la RPC, el aviso queda oculto y el editor no permite un guardado falso; el checkout conserva su flujo.

Si se necesita retirar el mensaje, desactivarlo por la RPC admin después de validar en staging; no borrar el singleton ni alterar pedidos. No se implementa rollback destructivo en este incremento.

## Pendientes explícitos del requerimiento completo

Este slice permite escribir condiciones, transportadora y tiempo informativo reales, pero no crea un motor de logística ni cambia la elegibilidad/precio. No configura plantillas de confirmación WhatsApp, no envía mensajes y no guarda un snapshot de las condiciones en cada pedido histórico. Esas partes siguen abiertas: necesitan contrato del pedido/canal, consentimiento cuando corresponda y persistencia transaccional, no una copia del navegador ni un join por teléfono. Tampoco activa nuevos medios de pago ni marca compras como pagadas.

Los cambios concurrentes de configuración se serializan por el singleton de PostgreSQL; la última escritura válida prevalece, como en la configuración existente. No se afirma edición colaborativa ni control optimista del borrador. Los ETA son copy manual, no una promesa calculada por transportadora.
