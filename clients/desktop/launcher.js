'use strict';
const list=document.querySelector('.cards');
list.replaceChildren();
for(const [i,s]of (window.SPDesktopLauncher?.getServers()||[]).entries()){
  const card=document.createElement('a');card.className='card';card.href=s.url;
  const top=document.createElement('div');top.className='card-top';
  const id=document.createElement('span');id.textContent='SERVER '+String(i+1).padStart(2,'0');
  const badge=document.createElement('span');badge.className='tag';badge.textContent=s.badge;top.append(id,badge);
  const title=document.createElement('h2');title.textContent=s.name;
  const desc=document.createElement('p');desc.style.whiteSpace='pre-line';desc.textContent=s.description;
  const action=document.createElement('span');action.className='enter';action.textContent='进入 '+s.name;
  const arrow=document.createElement('span');arrow.textContent='→';arrow.setAttribute('aria-hidden','true');action.append(arrow);
  card.append(top,title,desc,action);list.append(card);
}
