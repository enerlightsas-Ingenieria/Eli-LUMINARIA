import { beforeEach, describe, expect, it } from 'vitest';
import { cargarAjustes, guardarAjustes } from '../src/servicios/ajustes';
import { cerrarSesion } from '../src/servicios/identidad';
import { claveDeSesion, fijarClaveDeSesion, guardarVerificador, hayVerificador, normalizar, olvidarVerificador, tomarAviso, dejarAviso, usuarioGuardado, verificarLocal } from '../src/servicios/sesion';

beforeEach(() => { localStorage.clear(); fijarClaveDeSesion(''); });

describe('sesión: la clave no se guarda en el dispositivo', () => {
  it('al guardar los ajustes la clave queda en memoria pero NO en el almacenamiento', async () => {
    await guardarAjustes({ ...(await cargarAjustes()), apiKey: 'clave-secreta-123', tecnico: 'Ana', usuario: 'ana' });
    expect(claveDeSesion()).toBe('clave-secreta-123');
    expect((await cargarAjustes()).apiKey).toBe('clave-secreta-123');
    const crudo = localStorage.getItem('eli.ajustes.v1')!;
    expect(crudo).not.toContain('clave-secreta-123');
    expect(JSON.parse(crudo)).not.toHaveProperty('apiKey');
  });

  it('al "abrir de nuevo" (memoria vacía) no hay clave: toca ingresar', async () => {
    await guardarAjustes({ ...(await cargarAjustes()), apiKey: 'clave-secreta-123', tecnico: 'Ana' });
    fijarClaveDeSesion('');                                   // simula cerrar y volver a abrir la página
    expect((await cargarAjustes()).apiKey).toBe('');
    expect((await cargarAjustes()).tecnico).toBe('Ana');       // lo que no es secreto se recuerda
  });

  it('salir borra la clave de memoria y conserva el usuario para el próximo ingreso', async () => {
    await guardarAjustes({ ...(await cargarAjustes()), apiKey: 'clave-secreta-123', tecnico: 'Ana', usuario: 'ana' });
    await guardarVerificador('ana', 'clave-secreta-123');
    await cerrarSesion();
    expect(claveDeSesion()).toBe('');
    expect((await cargarAjustes()).apiKey).toBe('');
    expect(usuarioGuardado()).toBe('ana');
  });

  it('una versión anterior que guardaba la clave: se retira del almacenamiento y queda listo el ingreso sin conexión', async () => {
    localStorage.setItem('eli.ajustes.v1', JSON.stringify({ apiKey: 'clave-vieja-999', tecnico: 'Beto', usuario: 'beto', endpoint: 'https://p.example' }));
    const a = await cargarAjustes();
    expect(a.apiKey).toBe('');                                  // ya no inicia sesión sola
    expect(localStorage.getItem('eli.ajustes.v1')).not.toContain('clave-vieja-999');
    expect(await verificarLocal('beto', 'clave-vieja-999')).toBe(true);
  });
});

describe('verificador local (ingreso sin internet)', () => {
  it('acepta usuario y clave correctos (sin distinguir mayúsculas/acentos del usuario) y rechaza todo lo demás', async () => {
    await guardarVerificador('Darío Ruiz', 'clave-dario-1');
    expect(await verificarLocal('dario ruiz', 'clave-dario-1')).toBe(true);
    expect(await verificarLocal('  DARÍO  RUIZ ', ' clave-dario-1 ')).toBe(true);
    expect(await verificarLocal('Darío Ruiz', 'clave-dario-2')).toBe(false);
    expect(await verificarLocal('otro', 'clave-dario-1')).toBe(false);
    expect(await verificarLocal('Darío Ruiz', '')).toBe(false);
  });

  it('lo guardado es un resumen, no la clave ni el usuario+clave en claro; cada guardado usa una sal distinta', async () => {
    await guardarVerificador('ana', 'clave-secreta-123');
    const a = localStorage.getItem('eli.sesion.v1')!;
    expect(a).not.toContain('clave-secreta-123');
    await guardarVerificador('ana', 'clave-secreta-123');
    const b = localStorage.getItem('eli.sesion.v1')!;
    expect(JSON.parse(a).hash).not.toBe(JSON.parse(b).hash);
    expect(await verificarLocal('ana', 'clave-secreta-123')).toBe(true);
  });

  it('sin verificador no hay ingreso sin conexión; olvidarlo lo borra', async () => {
    expect(hayVerificador()).toBe(false);
    expect(await verificarLocal('ana', 'x')).toBe(false);
    await guardarVerificador('ana', 'clave-1234');
    expect(hayVerificador()).toBe(true);
    olvidarVerificador();
    expect(hayVerificador()).toBe(false);
    expect(await verificarLocal('ana', 'clave-1234')).toBe(false);
  });
});

describe('utilidades', () => {
  it('normalizar ignora mayúsculas, acentos y espacios de más', () => {
    expect(normalizar('  María   López ')).toBe('maria lopez');
  });
  it('el aviso de sesión se muestra una sola vez', () => {
    dejarAviso('Tu acceso ya no está activo');
    expect(tomarAviso()).toBe('Tu acceso ya no está activo');
    expect(tomarAviso()).toBe('');
  });
});
