#!/usr/bin/env node
/**
 * Prepara todo lo necesario para instalar ELI-LUMINARIA a un cliente nuevo (una instalación por cliente, en TUS cuentas).
 *
 *   node server/nuevo-cliente.js --nombre "Alcaldía de Soacha" --vence 2027-01-31 --contacto "ventas@enerlight.co" \
 *       [--slug alcaldia-soacha] [--admin "Administrador"] [--subdominio enerlight] [--gracia 15] [--pais 57]
 *       [--mapa-calles "https://…/{z}/{x}/{y}.png?key=…" --mapa-satelite "https://…/{z}/{x}/{y}.jpg?key=…" --mapa-atribucion "© Proveedor"]
 *
 * Crea la carpeta  clientes/<slug>/  (NO se sube a GitHub: tiene claves) con:
 *   LEEME.txt          paso a paso para instalar a ese cliente
 *   apps-script.txt    las dos líneas de tokens para pegar en el script de Google
 *   secretos.json      secretos del proxy (se cargan con un solo comando)
 *   cliente.json       datos no secretos: nombre, vencimiento de la licencia, contacto…
 *   servidor.json      dirección del proxy de ese cliente (va dentro de su web)
 *   1-proxy.ps1        publica el proxy del cliente (también sirve para RENOVAR la licencia: cambia "vence" en cliente.json y vuelve a ejecutarlo)
 *   2-web.ps1          publica la web del cliente
 *   entrega.txt        lo que se le entrega al cliente (dirección, usuario y clave del administrador)
 *
 *   --renovar <slug> --vence AAAA-MM-DD   solo actualiza el vencimiento en cliente.json (luego ejecuta 1-proxy.ps1)
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALFABETO_CLAVE = 'abcdefghjkmnpqrstuvwxyz23456789';   // sin letras que se confunden (l, i, o, 0, 1)

const quitarTildes = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '');
const aSlug = (t) => quitarTildes(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

function aleatorioPorDefecto(n) { return crypto.randomBytes(n); }

/** Token largo (base64url) y clave legible para personas. */
function token(aleatorio) { return aleatorio(24).toString('base64').replace(/[+/=]/g, '').slice(0, 32).padEnd(32, 'x'); }
function claveLegible(aleatorio, largo = 14) {
  const b = aleatorio(largo); let s = '';
  for (let i = 0; i < largo; i++) s += ALFABETO_CLAVE[b[i] % ALFABETO_CLAVE.length];
  return s.slice(0, 5) + '-' + s.slice(5, 10) + '-' + s.slice(10);
}

/** Devuelve { slug, archivos: { nombre: contenido }, resumen }. `aleatorio(n)` → Buffer de n bytes (se inyecta en las pruebas). */
function crearCliente(o, aleatorio = aleatorioPorDefecto) {
  const nombre = String(o.nombre ?? '').trim();
  if (!nombre) throw new Error('Falta --nombre (el nombre del cliente).');
  const slug = o.slug ? aSlug(o.slug) : aSlug(nombre);
  if (!slug || slug.length < 3) throw new Error('El identificador del cliente (slug) debe tener al menos 3 letras o números. Usa --slug.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.vence ?? '')) || Number.isNaN(Date.parse(o.vence + 'T00:00:00Z'))) throw new Error('Falta --vence AAAA-MM-DD (último día de la licencia).');
  const gracia = o.gracia === undefined ? 15 : Number(o.gracia);
  if (!Number.isInteger(gracia) || gracia < 0 || gracia > 120) throw new Error('--gracia debe ser un número de días entre 0 y 120.');
  const pais = String(o.pais ?? '57').replace(/\D/g, '') || '57';
  const admin = String(o.admin ?? 'Administrador').trim();
  if (!/^[^:,\n]{2,40}$/.test(admin)) throw new Error('--admin: entre 2 y 40 caracteres, sin ":" ni ",".');
  const subdominio = String(o.subdominio ?? 'enerlight').trim();
  const contacto = String(o.contacto ?? '').trim();
  const tesela = (u, nombreOpcion) => {
    if (u === undefined) return undefined;
    if (!/^https:\/\/[^\s<>"']+$/.test(u) || !['{z}', '{x}', '{y}'].every((p) => u.includes(p))) throw new Error(`${nombreOpcion} debe ser una dirección https con {z}, {x} y {y}.`);
    return u;
  };
  const mapas = {};
  const calles = tesela(o.mapaCalles, '--mapa-calles'), satelite = tesela(o.mapaSatelite, '--mapa-satelite');
  if (calles) mapas.calles = calles;
  if (satelite) mapas.satelite = satelite;
  if (o.mapaAtribucion) mapas.atribucion = String(o.mapaAtribucion).replace(/[<>]/g, '').slice(0, 200);

  const nombreProxy = `eli-${slug}-proxy`, proyectoWeb = `eli-${slug}`;
  const urlProxy = `https://${nombreProxy}.${subdominio}.workers.dev`;
  const urlWeb = `https://${proyectoWeb}.pages.dev`;
  const syncToken = token(aleatorio), syncTokenAdmin = token(aleatorio), claveAdmin = claveLegible(aleatorio);

  const cliente = { nombre, slug, vence: o.vence, graciaDias: gracia, contacto, codigoPais: pais, proxy: nombreProxy, web: proyectoWeb, urlProxy, urlWeb, creado: new Date().toISOString().slice(0, 10) };
  const secretos = { SYNC_TOKEN: syncToken, SYNC_TOKEN_ADMIN: syncTokenAdmin, ADMIN_TOKENS: `${admin}:${claveAdmin}` };

  const archivos = {
    'cliente.json': JSON.stringify(cliente, null, 2) + '\n',
    'secretos.json': JSON.stringify(secretos, null, 2) + '\n',
    'servidor.json': JSON.stringify({ proxy: urlProxy, codigoPais: pais, ...(Object.keys(mapas).length ? { mapas } : {}) }) + '\n',
    'apps-script.txt': `Propiedades del script de Google de ${nombre}.\nEn Apps Script: ⚙ Configuración del proyecto → Propiedades del script → Añadir propiedad (una por cada línea):\n\nTOKEN = ${syncToken}\nTOKEN_ADMIN = ${syncTokenAdmin}\nCARPETA_FOTOS_ID = (el ID de la carpeta FOTOS de este cliente en Drive: lo que va después de /folders/ en su dirección)\n\nAsí, al pegar una versión nueva del código no hay que volver a editar nada.\n`,
    '1-proxy.ps1': `# Publica (o actualiza) el proxy de ${nombre}. También renueva la licencia: cambia "vence" en cliente.json y vuelve a ejecutar.
$ErrorActionPreference = 'Stop'
$c = Get-Content "$PSScriptRoot\\cliente.json" -Raw | ConvertFrom-Json
Set-Location "$PSScriptRoot\\..\\.."
npx wrangler deploy server/worker.ts --name $c.proxy --compatibility-date 2026-01-01 --var "LICENCIA_VENCE:$($c.vence)" --var "LICENCIA_GRACIA_DIAS:$($c.graciaDias)" --var "LICENCIA_CLIENTE:$($c.nombre)" --var "LICENCIA_CONTACTO:$($c.contacto)"
Write-Host "Proxy listo: $($c.urlProxy)  (licencia hasta $($c.vence))"
`,
    '2-web.ps1': `# Publica la web de ${nombre} (usa el servidor.json de este cliente).
$ErrorActionPreference = 'Stop'
$c = Get-Content "$PSScriptRoot\\cliente.json" -Raw | ConvertFrom-Json
Set-Location "$PSScriptRoot\\..\\..\\web"
npm run build
Copy-Item "$PSScriptRoot\\servidor.json" "dist\\servidor.json" -Force
npx wrangler pages deploy dist --project-name $c.web --branch main
Write-Host "Web lista: $($c.urlWeb)"
`,
    'entrega.txt': `ELI-LUMINARIA · ${nombre}\n\nDirección de la aplicación: ${urlWeb}\nAdministrador: ${admin}\nClave: ${claveAdmin}\n\nCon este usuario el administrador crea a las demás personas (técnicos y supervisores) desde Administración → Usuarios.\nLa clave es personal: entrégala en privado y pide que la cambie creando su propia cuenta de administrador.\nLicencia vigente hasta el ${o.vence}${contacto ? `. Renovaciones y soporte: ${contacto}` : ''}.\n`,
    'LEEME.txt': `INSTALACIÓN DE ${nombre.toUpperCase()}   (identificador: ${slug})
=====================================================================
Estos archivos tienen CLAVES. No los subas a GitHub ni los mandes por correo sin protección. Guárdalos en tu gestor de contraseñas.

A. Hoja de Google y script (en la cuenta de Google del cliente, o en la tuya si así lo pactaron)
   1. Crea una hoja de cálculo nueva llamada "ELI-LUMINARIA datos - ${nombre}".
   2. Extensiones → Apps Script. Pega todo el archivo server/google-apps-script.gs.
   3. ⚙ Configuración del proyecto → Propiedades del script: crea TOKEN, TOKEN_ADMIN y CARPETA_FOTOS_ID como dice apps-script.txt (NO edites el código).
   4. Crea una carpeta de Drive "FOTOS" para este cliente y pon su ID en la propiedad CARPETA_FOTOS_ID. Si no la pones, las fotos van a una carpeta suelta.
   5. Implementar → Nueva implementación → Aplicación web. Ejecutar como: Yo. Quién tiene acceso: Cualquier persona. Copia la URL que termina en /exec.
   6. Acepta los permisos que pida Google (hoja, Drive).

B. Proxy (Cloudflare, en TU cuenta)
   1. PowerShell en la carpeta del proyecto:  .\\clientes\\${slug}\\1-proxy.ps1
   2. Carga los secretos:  npx wrangler secret bulk clientes/${slug}/secretos.json --name ${nombreProxy}
   3. Carga la dirección del script (la URL /exec del paso A.5):  npx wrangler secret put SYNC_URL --name ${nombreProxy}
   4. Carga la clave de la IA (Gemini o la que uses):  npx wrangler secret put GEMINI_API_KEY --name ${nombreProxy}
      (usa la capa de PAGO para clientes: la gratuita permite que Google use las fotos para mejorar sus productos)
   5. Direcciones con placa completa (recomendado para clientes que pagan): npx wrangler secret put GOOGLE_GEOCODING_KEY --name ${nombreProxy}
      Mapas: el fondo por defecto (OpenStreetMap y Esri) es para pruebas. Para uso comercial usa un proveedor con plan de pago (MapTiler, Mapbox…)
      y vuelve a generar servidor.json con --mapa-calles / --mapa-satelite / --mapa-atribucion (o edita "mapas" en servidor.json).

C. Web
   1. Una sola vez:  npx wrangler pages project create ${proyectoWeb} --production-branch main
   2. .\\clientes\\${slug}\\2-web.ps1

D. Probar (10 minutos)
   1. Abre ${urlWeb} y entra con el administrador de entrega.txt.
   2. Administración → Usuarios: crea un técnico. Administración → Proyectos: crea un proyecto.
   3. Con el técnico: captura una luminaria con foto, sincroniza y revisa la hoja y la carpeta FOTOS.
   4. Revisa que NO aparezca ningún aviso de licencia (si aparece, revisa la fecha en cliente.json).

E. Entrega
   - Entrega al cliente el contenido de entrega.txt (en privado).
   - Capacita al administrador (Usuarios, Proyectos, Fotos) y a un técnico piloto.

F. Cobro y licencia
   - La licencia vence el ${o.vence}. Quince días antes la app avisa; después del vencimiento hay ${gracia} días de gracia con aviso; pasada la gracia se bloquea
     el envío de datos y la IA (se puede seguir consultando y exportando lo ya guardado).
   - Al recibir el pago de la renovación: node server/nuevo-cliente.js --renovar ${slug} --vence AAAA-MM-DD  y luego .\\clientes\\${slug}\\1-proxy.ps1
   - Para suspender por falta de pago antes de tiempo: pon una fecha pasada y ejecuta 1-proxy.ps1 (o borra el proxy en Cloudflare).
`,
  };
  return { slug, archivos, resumen: { nombre, slug, urlProxy, urlWeb, vence: o.vence } };
}

/** Cambia el vencimiento de un cliente ya creado. Devuelve el cliente.json nuevo. */
function renovar(carpetaCliente, vence) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(vence ?? '')) || Number.isNaN(Date.parse(vence + 'T00:00:00Z'))) throw new Error('Falta --vence AAAA-MM-DD.');
  const ruta = path.join(carpetaCliente, 'cliente.json');
  if (!fs.existsSync(ruta)) throw new Error(`No existe ${ruta}. ¿El identificador del cliente es correcto?`);
  const c = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  c.vence = vence;
  fs.writeFileSync(ruta, JSON.stringify(c, null, 2) + '\n');
  return c;
}

function argumentos(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Argumento no reconocido: ${a}`);
    const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    o[k] = argv[i + 1]; i++;
  }
  return o;
}

if (require.main === module) {
  try {
    const o = argumentos(process.argv.slice(2));
    const raiz = path.join(__dirname, '..', 'clientes');
    if (o.renovar) {
      const c = renovar(path.join(raiz, aSlug(o.renovar)), o.vence);
      console.log(`Licencia de ${c.nombre} ahora vence el ${c.vence}.\nAplícala con:  .\\clientes\\${c.slug}\\1-proxy.ps1`);
    } else {
      const r = crearCliente(o);
      const carpeta = path.join(raiz, r.slug);
      if (fs.existsSync(carpeta)) throw new Error(`Ya existe clientes/${r.slug}. Usa otro --slug o bórrala si es un error.`);
      fs.mkdirSync(carpeta, { recursive: true });
      for (const [nombre, contenido] of Object.entries(r.archivos)) fs.writeFileSync(path.join(carpeta, nombre), contenido, { mode: nombre === 'secretos.json' || nombre === 'apps-script.txt' || nombre === 'entrega.txt' ? 0o600 : 0o644 });
      console.log(`Listo: clientes/${r.slug}/\n  Proxy: ${r.resumen.urlProxy}\n  Web:   ${r.resumen.urlWeb}\n  Licencia hasta: ${r.resumen.vence}\nSigue clientes/${r.slug}/LEEME.txt (las claves están en esa carpeta; no la subas a GitHub).`);
    }
  } catch (e) { console.error('Error: ' + e.message); process.exit(1); }
}

module.exports = { crearCliente, renovar, argumentos, aSlug, claveLegible };
