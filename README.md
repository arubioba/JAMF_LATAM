# JAMF LATAM Lead Gen System

Portal privado para consultas de prospectos JAMF LATAM. El portal es públicamente accesible, pero requiere autenticación.

## Configuración en Railway

Configura estas variables en el servicio:

- `ADMIN_USER`: usuario administrador.
- `ADMIN_PASSWORD`: contraseña segura del usuario administrador.
- `SESSION_SECRET`: secreto aleatorio largo para firmar la sesión.
- `PORTAL_USER_1` / `PORTAL_PASSWORD_1`: primer usuario adicional del portal.
- `PORTAL_USER_2` / `PORTAL_PASSWORD_2`: segundo usuario adicional del portal.
- `NODE_ENV=production`.

Railway detectará `railway.json`, instalará las dependencias y ejecutará `npm start`.

La fuente inicial está en `data/leads.json`, generada desde la hoja `Contacts` del Excel proporcionado. La hoja vacía `Hoja 1` no se utiliza.



Deploy sync marker: access fix.
