// Pages Function: reescribe /t/<codigo>/... hacia /trials/<codigo>/... e inyecta
// el aviso de prueba. Cloudflare Pages sirve los .html con URL limpia (sin
// extension), por eso las rutas index se piden sin sufijo "index.html".
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  const trialCodes = new Set(['a7', 'g4', 't8', 'p6', 'r3', 'x9']);
  const match = pathname.match(/^\/t\/([a-z0-9]+)(?:\/(.*))?$/i);
  if (match && trialCodes.has(match[1])) {
    const code = match[1];
    if (match[2] === undefined) return Response.redirect(new URL(`/t/${code}/`, url), 302);

    const rawPath = match[2] || '';
    const isHtmlIndex = rawPath === '' || rawPath === 'index.html' || rawPath.endsWith('/index.html');
    const cleanPath = isHtmlIndex ? rawPath.replace(/index\.html$/, '') : rawPath;
    const assetUrl = new URL(`/trials/${code}/${cleanPath}`, url);
    const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
    if (!assetResponse.ok || !isHtmlIndex) return assetResponse;
    if (code === 'x9') return assetResponse;

    const source = await assetResponse.text();
    const bootstrap = trialBootstrap(code);
    return new Response(source.replace('<head>', `<head>${bootstrap}`), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  if (pathname === '/') {
    const response = await env.ASSETS.fetch(request);
    if (response.status === 200) {
      const source = await response.text();
      return new Response(source.replace('</body>', `${landingTrialConsent()}</body>`), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return response;
  }

  return env.ASSETS.fetch(request);
}

function trialBootstrap(code) {
  const p6TrialLicense = code === 'p6' ? `<script>(function(){if(localStorage.getItem('PampaPorcinosLicense'))return;var now=new Date(),expiresAt=new Date(now.getTime()+10*24*60*60*1000).toISOString();localStorage.setItem('PampaPorcinosLicense',JSON.stringify({key:'NEXO-MTRI-AL10-0001',code:'M',version:'premium',type:'trial',expiresAt:expiresAt,activatedAt:now.toISOString()}));})();</script>` : '';
  return p6TrialLicense + `<script>(function(){var code='${code}',days=10,trialKey='pampaWebTrial:'+code,consentKey='pampaWebTrialConsent:'+code;function read(k){try{return JSON.parse(localStorage.getItem(k)||'null')}catch(e){return null}}function consent(){return localStorage.getItem(consentKey)==='accepted'}function overlay(title,text,accept){if(document.getElementById('pampaTrialGate'))return;var gate=document.createElement('div');gate.id='pampaTrialGate';gate.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.94);display:grid;place-items:center;padding:20px;color:#f8fafc;font:16px Arial,sans-serif';gate.innerHTML='<div style="max-width:480px;background:#fff;color:#172033;padding:24px;border-radius:10px;box-shadow:0 18px 48px rgba(0,0,0,.4)"><h2 style="margin:0 0 12px;font-size:22px">'+title+'</h2><p style="line-height:1.5">'+text+'</p><p style="font-size:13px;line-height:1.45;color:#475569">La prueba guarda datos localmente en este dispositivo. Consultá la <a href="/privacidad.html" target="_blank" rel="noopener" style="color:#1d4ed8">Política de Privacidad</a>.</p><div style="display:flex;gap:10px;flex-wrap:wrap">'+(accept?'<button id="pampaTrialAccept" type="button" style="padding:10px 14px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer">Aceptar e iniciar prueba</button><button id="pampaTrialReject" type="button" style="padding:10px 14px;border:1px solid #94a3b8;border-radius:6px;background:#fff;color:#172033;cursor:pointer">Volver al catálogo</button>':'<a href="/" style="padding:10px 14px;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;text-decoration:none">Volver al catálogo</a>')+'</div></div>';document.addEventListener('DOMContentLoaded',function(){document.body.appendChild(gate);if(accept){document.getElementById('pampaTrialAccept').onclick=function(){localStorage.setItem(consentKey,'accepted');location.href=location.pathname+'?trial=auto'};document.getElementById('pampaTrialReject').onclick=function(){location.href='/'}}});if(consent())return;var saved=read(trialKey);var now=Date.now();if(!saved){overlay('Prueba gratuita de '+days+' días','Estás por iniciar la prueba de esta aplicación. Los datos que cargues se guardan localmente en este dispositivo.',true);return}var elapsedDays=(now-saved.start)/86400000;if(elapsedDays>days){overlay('Prueba finalizada','El período de prueba de '+days+' días finalizó. Contactanos para continuar con una licencia.',false)}})();</script>`;
}

function landingTrialConsent() {
  return `<script>(function(){var nonTrialCodes={x9:true};function show(href){var existing=document.getElementById('pampaLandingTrialConsent');if(existing){existing.remove()}var box=document.createElement('div');box.id='pampaLandingTrialConsent';box.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.72);display:grid;place-items:center;padding:20px;font:16px Arial,sans-serif';box.innerHTML='<div style="max-width:480px;background:#fff;color:#172033;padding:24px;border-radius:10px;box-shadow:0 18px 48px rgba(0,0,0,.4)"><h2 style="margin:0 0 12px;font-size:22px">Prueba gratuita de 10 días</h2><p style="line-height:1.5">La aplicación se abrirá en modo de prueba. Los datos que cargues durante la prueba se guardan localmente en tu dispositivo.</p><p style="font-size:13px;line-height:1.45;color:#475569">Al continuar aceptás la <a href="/privacidad.html" target="_blank" rel="noopener" style="color:#1d4ed8">Política de Privacidad</a>.</p><div style="display:flex;gap:10px;flex-wrap:wrap"><button id="pampaLandingTrialAccept" type="button" style="padding:10px 14px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer">Aceptar y ver aplicación</button><button id="pampaLandingTrialCancel" type="button" style="padding:10px 14px;border:1px solid #94a3b8;border-radius:6px;background:#fff;color:#172033;cursor:pointer">Cancelar</button></div></div>';document.body.appendChild(box);document.getElementById('pampaLandingTrialAccept').onclick=function(){var match=href.match(/^\/t\/([a-z0-9]+)\/?$/i);if(match)localStorage.setItem('pampaWebTrialConsent:'+match[1],'accepted');location.href=href+(href.includes('?')?'&':'?')+'trial=auto'};document.getElementById('pampaLandingTrialCancel').onclick=function(){box.remove()}}document.addEventListener('click',function(event){var link=event.target.closest('a[href^="/t/"]');if(!link)return;var href=link.getAttribute('href');var match=href.match(/^\/t\/([a-z0-9]+)\/?$/i);if(match&&nonTrialCodes[match[1]])return;event.preventDefault();show(href)})})();</script>`;
}
