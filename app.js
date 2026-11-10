// Edit these defaults and redeploy to change the public page for every visitor.
const defaults = {
  name: 'Hey, I’m Olivia', handle: '@heyitsolivia',
  bio: 'Creative mind, coffee enthusiast, and collector of little moments. Glad you’re here ♡',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&h=300&fit=crop&crop=faces',
  socials: [
    { label: 'Instagram', url: 'https://instagram.com/', icon: 'instagram' },
    { label: 'TikTok', url: 'https://tiktok.com/', icon: 'tiktok' },
    { label: 'YouTube', url: 'https://youtube.com/', icon: 'youtube' },
    { label: 'Email', url: 'mailto:hello@example.com', icon: 'mail' }
  ],
  links: [
    { title: 'A little more about me', subtitle: 'Come say hello and stay a while', url: 'https://example.com/', icon: '✳' },
    { title: 'Shop my favorites', subtitle: 'Things I love, all in one place', url: 'https://example.com/', icon: '✿' },
    { title: 'The journal', subtitle: 'Notes, stories & little inspirations', url: 'https://example.com/', icon: '☼' },
    { title: 'Let’s work together', subtitle: 'For the big ideas and little ones', url: 'mailto:hello@example.com', icon: '✉' }
  ]
};
const icons = {
 instagram:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm5 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm5.5-3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>',
 tiktok:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2h3c.2 2.2 1.4 3.6 3.5 3.8v3a7 7 0 0 1-3.5-1v6.8a5.4 5.4 0 1 1-4.7-5.3v3.1a2.4 2.4 0 1 0 1.7 2.3V2z"/></svg>',
 youtube:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 7.3a2.8 2.8 0 0 0-2-2C18.2 5 12 5 12 5s-6.2 0-8 .3a2.8 2.8 0 0 0-2 2A29 29 0 0 0 1.7 12c0 1.6.1 3.2.3 4.7a2.8 2.8 0 0 0 2 2c1.8.3 8 .3 8 .3s6.2 0 8-.3a2.8 2.8 0 0 0 2-2c.2-1.5.3-3.1.3-4.7s-.1-3.2-.3-4.7zM10 15V9l5.2 3-5.2 3z"/></svg>',
 mail:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm9 8 8-5V7l-8 5-8-5v1l8 5z"/></svg>'
};
const $ = id => document.getElementById(id);
const storageKey = 'littlelinks-profile-v1';
function load() { try { const saved = JSON.parse(localStorage.getItem(storageKey)); return saved && Array.isArray(saved.links) ? {...defaults, ...saved} : structuredClone(defaults); } catch { return structuredClone(defaults); } }
let profile = load();
function safeUrl(value, mail = true) { try { const url = new URL(value); return ['https:', 'http:', ...(mail ? ['mailto:'] : [])].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function render() {
 $('name').replaceChildren(document.createTextNode(profile.name + ' ')); const sparkle = document.createElement('span'); sparkle.textContent = '✳'; $('name').append(sparkle);
 $('handle').textContent = profile.handle; $('bio').textContent = profile.bio; $('avatar').src = safeUrl(profile.avatar, false) || defaults.avatar;
 $('socials').replaceChildren(); (profile.socials || []).forEach(s => { const href = safeUrl(s.url); if (!href || !icons[s.icon]) return; const a = document.createElement('a'); a.href=href; a.target='_blank'; a.rel='noopener noreferrer'; a.setAttribute('aria-label',s.label); a.innerHTML=icons[s.icon]; $('socials').append(a); });
 $('links').replaceChildren(); profile.links.forEach(link => { const href = safeUrl(link.url); if (!href) return; const a=document.createElement('a'); a.className='link-card'; a.href=href; a.target='_blank'; a.rel='noopener noreferrer'; const icon=document.createElement('span'); icon.className='link-icon'; icon.textContent=link.icon || '✳'; const copy=document.createElement('span'); copy.className='link-copy'; const title=document.createElement('strong'); title.textContent=link.title; const subtitle=document.createElement('small'); subtitle.textContent=link.subtitle; copy.append(title,subtitle); const arrow=document.createElement('span'); arrow.className='link-arrow'; arrow.textContent='↗'; a.append(icon,copy,arrow); $('links').append(a); });
}
function addLinkField(link={title:'',subtitle:'',url:'',icon:'✳'}) { const row=document.createElement('div'); row.className='link-edit'; [['title','Title','text'],['subtitle','Description','text'],['url','URL (https:// or mailto:)','text']].forEach(([key,label,type])=>{ const wrapper=document.createElement('label'); wrapper.textContent=label; const input=document.createElement('input'); input.name=key; input.type=type; input.value=link[key] || ''; input.required=key!=='subtitle'; wrapper.append(input); row.append(wrapper); }); row.dataset.icon=link.icon || '✳'; const remove=document.createElement('button'); remove.type='button'; remove.className='remove-link'; remove.setAttribute('aria-label','Remove link'); remove.textContent='×'; remove.onclick=()=>row.remove(); row.append(remove); $('linkFields').append(row); }
function openEditor(){ const form=$('editorForm'); ['name','handle','bio','avatar'].forEach(key=>form.elements[key].value=profile[key] || ''); $('linkFields').replaceChildren(); profile.links.forEach(addLinkField); $('editor').showModal(); }
function toast(message){ $('toast').textContent=message; $('toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),2500); }
$('editButton').addEventListener('click',openEditor); $('closeEditor').addEventListener('click',()=>$('editor').close()); $('addLink').addEventListener('click',()=>addLinkField());
$('editorForm').addEventListener('submit',e=>{ e.preventDefault(); const form=e.currentTarget; const links=[...document.querySelectorAll('.link-edit')].map(row=>({title:row.querySelector('[name=title]').value.trim(),subtitle:row.querySelector('[name=subtitle]').value.trim(),url:row.querySelector('[name=url]').value.trim(),icon:row.dataset.icon})); if (links.some(link=>!safeUrl(link.url))) { toast('Please use a valid http, https, or mailto link.'); return; } const avatar=form.elements.avatar.value.trim(); if (avatar && !safeUrl(avatar,false)) { toast('Please use a valid http or https image URL.'); return; } profile={...profile,name:form.elements.name.value.trim(),handle:form.elements.handle.value.trim(),bio:form.elements.bio.value.trim(),avatar,links}; try { localStorage.setItem(storageKey,JSON.stringify(profile)); } catch { toast('Could not save in this browser.'); return; } render(); $('editor').close(); toast('Saved in this browser'); });
$('resetButton').addEventListener('click',()=>{ if (!confirm('Reset this browser’s changes to the default page?')) return; localStorage.removeItem(storageKey); profile=structuredClone(defaults); render(); $('editor').close(); toast('Page reset'); });
$('shareButton').addEventListener('click',async()=>{ try { if (navigator.share) await navigator.share({title:profile.name,url:location.href}); else { await navigator.clipboard.writeText(location.href); toast('Page link copied'); } } catch (error) { if (error.name !== 'AbortError') toast('Could not share this page'); } });
$('backTop').addEventListener('click',e=>{e.preventDefault();window.scrollTo({top:0,behavior:'smooth'});});
render();
