/* QORPO shared UI: nav, menu, reveal, tilt, counters, film strips, videos */
(function(){
  var page=document.body.getAttribute('data-page');
  document.querySelectorAll('.nav-links a[data-nav]').forEach(function(a){if(a.getAttribute('data-nav')===page){a.classList.add('on');a.setAttribute('aria-current','page')}});

  /* split headings into masked words */
  document.querySelectorAll('[data-split]').forEach(function(h){var w=h.textContent.trim().split(/\s+/);h.innerHTML=w.map(function(x,i){return '<span class="w"><span style="--d:'+i+'">'+x+'</span></span>'}).join(' ')});

  /* reveal on scroll, never leaves content hidden */
  var els=[].slice.call(document.querySelectorAll('.rv,.wipe,[data-split],.stage-art'));
  function all(){els.forEach(function(e){e.classList.add('in')})}
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.08,rootMargin:'0px 0px -6% 0px'});els.forEach(function(e){io.observe(e)});setTimeout(all,2500)}else all();

  /* count up: data-count, optional data-suffix, data-dec */
  window.qCount=function(el,to,dur){var sfx=el.getAttribute('data-suffix')||'',dec=+(el.getAttribute('data-dec')||0),t0=null,from=0;
    function f(v){return v.toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec})+sfx}
    function step(ts){if(!t0)t0=ts;var p=Math.min(1,(ts-t0)/(dur||1400));el.textContent=f(from+(to-from)*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(step)}requestAnimationFrame(step)};
  document.querySelectorAll('[data-count]').forEach(function(el){var n=+el.getAttribute('data-count');if(!n)return;setTimeout(function(){window.qCount(el,n)},1100)});

  /* 3D tilt + glare */
  var fine=window.matchMedia('(hover:hover) and (pointer:fine)').matches,rm=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-tilt]').forEach(function(c){
    if(fine&&!rm){c.addEventListener('pointermove',function(e){var b=c.getBoundingClientRect(),x=(e.clientX-b.left)/b.width,y=(e.clientY-b.top)/b.height;
      c.style.transform='rotateY('+((x-.5)*16)+'deg) rotateX('+((.5-y)*14)+'deg) translateZ(10px)';c.style.setProperty('--gx',x*100+'%');c.style.setProperty('--gy',y*100+'%')});
      c.addEventListener('pointerleave',function(){c.style.transform=''})}
    var href=c.getAttribute('data-href');if(href)c.addEventListener('click',function(e){if(e.target.closest('a'))return;if(href.charAt(0)==='#'){var t=document.querySelector(href);t&&t.scrollIntoView({behavior:'smooth'})}else location.href=href})});

  /* film strips */
  document.querySelectorAll('[data-film]').forEach(function(b){b.addEventListener('click',function(){var f=document.getElementById(b.getAttribute('data-film'));f.scrollBy({left:(+b.getAttribute('data-dir'))*f.clientWidth*.75,behavior:'smooth'})})});
  document.querySelectorAll('.film').forEach(function(f){var down=false,sx=0,sl=0,idle=0;
    f.addEventListener('pointerdown',function(e){if(e.pointerType!=='mouse')return;down=true;sx=e.clientX;sl=f.scrollLeft;f.style.scrollSnapType='none'});
    window.addEventListener('pointermove',function(e){if(down)f.scrollLeft=sl-(e.clientX-sx)});
    window.addEventListener('pointerup',function(){if(!down)return;down=false;f.style.scrollSnapType='';idle=Date.now()});
    if(!rm){setInterval(function(){if(down||Date.now()-idle<6000)return;var r=f.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)return;var max=f.scrollWidth-f.clientWidth;f.scrollBy({left:f.scrollLeft>=max-10?-max:f.clientWidth*.75,behavior:'smooth'})},4200);
      f.addEventListener('wheel',function(){idle=Date.now()},{passive:true});f.addEventListener('touchstart',function(){idle=Date.now()},{passive:true})}});

  /* videos play in view, click toggles */
  document.querySelectorAll('figure.vid').forEach(function(f){var v=f.querySelector('video');if(!v)return;v.muted=true;
    function upd(){f.classList.toggle('playing',!v.paused&&!v.ended)}['play','playing','pause','ended'].forEach(function(e){v.addEventListener(e,upd)});
    function go(){var p=v.play();if(p&&p.catch)p.catch(upd)}
    f.addEventListener('click',function(){v.paused?go():v.pause()});
    if('IntersectionObserver' in window)new IntersectionObserver(function(es){es.forEach(function(e){e.isIntersecting?go():v.pause()})},{threshold:.3}).observe(f);else go()});

  /* ambient light behind a video: <canvas data-ambient="#videoFigureId"> */
  document.querySelectorAll('canvas[data-ambient]').forEach(function(cv){var v=document.querySelector(cv.getAttribute('data-ambient')+' video');if(!v||!cv.getContext)return;var ctx=cv.getContext('2d'),run=false;
    function paint(src,w,h){var s=Math.max(cv.width/w,cv.height/h);ctx.drawImage(src,(cv.width-w*s)/2,(cv.height-h*s)/2,w*s,h*s)}
    function draw(){if(!run)return;try{if(v.readyState>=2)paint(v,v.videoWidth,v.videoHeight)}catch(e){}requestAnimationFrame(draw)}
    var im=new Image();im.onload=function(){paint(im,im.width,im.height)};im.src=v.getAttribute('poster');
    v.addEventListener('play',function(){if(!run){run=true;requestAnimationFrame(draw)}});v.addEventListener('pause',function(){run=false})});

  /* copy buttons: data-copy="#elementId" */
  document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){var t=document.querySelector(b.getAttribute('data-copy')).textContent.trim(),o=b.textContent;
    (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.textContent='Copied'},function(){b.textContent='Select it'});setTimeout(function(){b.textContent=o},1800)})});

  /* mobile menu */
  var hb=document.querySelector('.hamb'),mn=document.getElementById('mnav');if(!hb||!mn)return;
  function set(o,f){document.body.classList.toggle('menu-open',o);hb.setAttribute('aria-expanded',o?'true':'false');mn.setAttribute('aria-hidden',o?'false':'true');
    if(o){setTimeout(function(){mn.querySelector('.mclose').focus({preventScroll:true})},60)}else if(f){hb.focus({preventScroll:true})}}
  hb.addEventListener('click',function(){set(true)});mn.querySelector('.mclose').addEventListener('click',function(){set(false,true)});
  mn.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(e){set(false);
    var u;try{u=new URL(a.href,location.href)}catch(x){return}
    if(u.hash&&u.pathname===location.pathname&&u.origin===location.origin){var t=document.querySelector(u.hash);if(t){e.preventDefault();requestAnimationFrame(function(){requestAnimationFrame(function(){t.scrollIntoView({behavior:'smooth',block:'start'});try{history.replaceState(null,'',u.hash)}catch(x){}})})}}})});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&document.body.classList.contains('menu-open'))set(false,true)});
  window.matchMedia('(min-width:961px)').addEventListener('change',function(m){if(m.matches)set(false)});
})();

/* promo popup: Buy $QORPO, home only, once a day, after 7s or half a scroll */
(function(){if(document.body.getAttribute('data-page')!=='games')return;
  var KEY='qp_seen',now=Date.now();try{var s=+localStorage.getItem(KEY)||0;if(now-s<864e5)return}catch(e){}
  var el=document.createElement('div');el.className='qp';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-labelledby','qpT');el.setAttribute('aria-hidden','true');
  el.innerHTML='<div class="qp-card"><button class="qp-x" type="button" aria-label="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'+
   '<div class="qp-art"><img src="assets/img/q_coin.webp" alt=""></div>'+
   '<div class="qp-tx"><span class="qp-k"><span class="dot live-dot" style="background:#ff9fd6"></span>$QORPO</span>'+
   '<h2 id="qpT">Buy $QORPO. <em>Be part of the ecosystem.</em></h2>'+
   '<p>One token behind every game we ship: AneeMate, One Life, Tamitos and what comes next.</p>'+
   '<ul><li><i>1</i>Back a studio that keeps shipping games</li><li><i>2</i>Stake it for daily Community Points and free spins</li><li><i>3</i>Game revenue buys $QORPO back from the market</li></ul>'+
   '<div class="qp-cta"><a class="btn btn-mint" href="/token#buy"><img class="btn-ic" src="assets/img/logo.webp" alt="">Buy $QORPO</a><a class="btn btn-ghost" href="/token#engine">How it works</a></div>'+
   '<button class="qp-later" type="button">Not now</button><div class="qp-note">Not financial advice. Crypto prices can go down as well as up.</div></div></div>';
  document.body.appendChild(el);var last=null,shown=false;
  function close(){el.classList.remove('open');el.setAttribute('aria-hidden','true');document.documentElement.style.overflow='';try{localStorage.setItem(KEY,String(Date.now()))}catch(e){}if(last&&last.focus)last.focus({preventScroll:true})}
  function open(){if(shown||document.body.classList.contains('menu-open'))return;shown=true;last=document.activeElement;el.classList.add('open');el.setAttribute('aria-hidden','false');document.documentElement.style.overflow='hidden';setTimeout(function(){el.querySelector('.qp-cta .btn').focus({preventScroll:true})},80);
    try{localStorage.setItem(KEY,String(Date.now()))}catch(e){}window.removeEventListener('scroll',onS)}
  el.querySelector('.qp-x').addEventListener('click',close);el.querySelector('.qp-later').addEventListener('click',close);
  el.addEventListener('click',function(e){if(e.target===el)close()});
  el.querySelectorAll('.qp-cta a').forEach(function(a){a.addEventListener('click',function(){el.classList.remove('open');document.documentElement.style.overflow=''})});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&el.classList.contains('open'))close()});
  function onS(){var h=document.documentElement.scrollHeight-innerHeight;if(h>0&&scrollY/h>.45)open()}
  window.addEventListener('scroll',onS,{passive:true});setTimeout(open,7000);
  window.qpOpen=open})();

/* live studio toasts: recent builds (and X posts when the feed carries them) pop in bottom right */
(function(){if(window.matchMedia('print').matches)return;
  var OFF='lt_off',seen;try{if(sessionStorage.getItem(OFF))return}catch(e){}
  var P={aneemate:['AneeMate','#ffd23f','/#aneemate'],tamitos:['Tamitos','#c89bff','/#tamitos'],onelife:['One Life','#ff7a1a','/#onelife'],x:['On X','#9fb3c8','']};
  var GH='<svg viewBox="0 0 24 24"><path d="M12 .5a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.3 1.9 1.3 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6a4.7 4.7 0 011.2-3.2c-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0C17.3 4.6 18.3 5 18.3 5c.6 1.7.2 2.9.1 3.2a4.7 4.7 0 011.2 3.2c0 4.6-2.8 5.6-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .5z"/></svg>';
  var XI='<svg viewBox="0 0 24 24"><path d="M18.9 2H22l-7.2 8.2L23 22h-6.6l-5.2-6.8L5.2 22H2l7.7-8.8L1.5 2h6.8l4.7 6.2L18.9 2zm-1.1 18h1.7L7.3 3.9H5.5L17.8 20z"/></svg>';
  function esc(x){return String(x).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function ago(t){var s=(Date.now()-new Date(t))/1000;if(s<90)return 'just now';if(s<3600)return Math.round(s/60)+'m ago';if(s<86400)return Math.round(s/3600)+'h ago';return Math.round(s/86400)+'d ago'}
  function items(d){var out=[];['aneemate','tamitos','onelife'].forEach(function(k){(d[k]||[]).forEach(function(c){out.push({k:k,r:c.r,t:c.t,m:c.m,a:c.a,d:c.d})})});
    (d.x||[]).forEach(function(p){out.push({k:'x',r:p.h,t:p.t,m:p.m,u:p.u})});
    out.sort(function(a,b){return new Date(b.t)-new Date(a.t)});return out.filter(function(i){return Date.now()-new Date(i.t)<14*864e5}).slice(0,24)}
  function kfmt(n){return n>=1e6?(n/1e6).toFixed(n>=1e7?0:1).replace(/\.0$/,'')+'M':n>=1e3?(n/1e3).toFixed(n>=1e4?0:1).replace(/\.0$/,'')+'k':String(n)}
  /* 30 day studio stats from the feed log (every tracked commit, all branches and authors) */
  function stats(d){var log=d.log||[],now=Date.now(),c30=0,c7=0,ln=0,per={aneemate:0,tamitos:0,onelife:0},days=[];for(var j=0;j<14;j++)days.push(0);
    log.forEach(function(e){var age=(now-new Date(e.t))/864e5;if(age>30||age<0)return;c30++;if(age<=7)c7++;ln+=(+e.a||0)+(+e.d||0);if(per[e.p]!=null)per[e.p]++;var di=Math.floor(age);if(di<14)days[13-di]++});
    var st=d.stats||{};return {c30:c30,c7:c7,ln:ln,per:per,days:days,b:st.builders30||0,repos:st.repos||0}}
  function start(list,S){if(!list.length)return;var ticker=list.slice(0,8);
    var box=document.createElement('div');box.className='lt';box.setAttribute('aria-live','polite');box.setAttribute('aria-label','Live from the studio');
    box.innerHTML='<button class="lt-pill" type="button" aria-label="Show live updates"><i></i><b>LIVE</b>'+(S.c30?S.c30+' commits this month':list.length+' updates from the studio')+'</button>';
    document.body.appendChild(box);var pill=box.firstChild,i=0,timer=null,hover=false,DUR=6000,card=null,panel=null;
    function body(it,live){var p=P[it.k];var ln=(it.a!=null&&it.d!=null&&(+it.a||+it.d))?'<span class="lt-ln"><b>+'+kfmt(+it.a)+'</b> <i>&minus;'+kfmt(+it.d)+'</i></span>':'';return '<span class="lt-ic">'+(it.k==='x'?XI:GH)+(live?'<span class="dot"></span>':'')+'</span><span><span class="lt-k">'+p[0]+'<span>'+esc(it.r)+'</span></span><span class="lt-m">'+esc(it.m)+'</span><span class="lt-t">'+(it.k==='x'?'posted ':'shipped ')+ago(it.t)+ln+'</span></span>'}
    var AT=null,ATN={aneemate:['AneeMate','#ffd23f'],cc:['Citizen Conflict','#7cc4ff'],tou:['Tale of Understanding','#9fe0c8'],tamitos:['Tamitos','#c89bff'],onelife:['One Life','#ff7a1a'],platform:['Platform and tools','#9fb3c8']};
    try{fetch('/alltime.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){AT=j}).catch(function(){})}catch(e){}
    function allHtml(){if(!AT)return '';var keys=Object.keys(AT.per).sort(function(a,b){return AT.per[b]-AT.per[a]}),mx=AT.per[keys[0]]||1;
      return '<div class="lt-all-t"><div class="lt-tiles"><div><b>'+kfmt(AT.commits)+'</b><span>commits all time</span></div><div><b>'+AT.repos+'</b><span>repositories</span></div><div><b>'+AT.since+'</b><span>building since</span></div></div><div class="lt-per">'+keys.map(function(k){var n=ATN[k]||[k,'#9fb3c8'];return '<div style="--lc:'+n[1]+'"><span>'+n[0]+'</span><i><em style="width:'+Math.max(2,Math.round(AT.per[k]/mx*100))+'%"></em></i><b>'+kfmt(AT.per[k])+'</b></div>'}).join('')+'</div></div>'}
    function statsHtml(){if(!S.c30)return '';var mx=Math.max.apply(null,S.days)||1,tot=S.per.aneemate+S.per.tamitos+S.per.onelife||1;
      var h='<div class="lt-stats">'+(AT?'<div class="lt-tabs" role="tablist"><button type="button" class="on" data-t="m">Last 30 days</button><button type="button" data-t="a">All time</button></div>':'')+'<div class="lt-m30"><div class="lt-tiles"><div><b>'+kfmt(S.c30)+'</b><span>commits, 30 days</span></div><div><b>'+kfmt(S.ln)+'</b><span>lines shipped</span></div><div><b>'+(S.b||'')+'</b><span>builders'+(S.repos?' in '+S.repos+' repos':'')+'</span></div></div>';
      h+='<div class="lt-spark" aria-label="Commits per day, last 14 days">'+S.days.map(function(v,ix){return '<i style="height:'+Math.max(6,Math.round(v/mx*100))+'%" title="'+v+' commits"></i>'}).join('')+'</div><div class="lt-sparkl"><span>14 days ago</span><span>today</span></div>';
      h+='<div class="lt-per">'+['aneemate','tamitos','onelife'].map(function(k){var v=S.per[k];return '<div style="--lc:'+P[k][1]+'"><span>'+P[k][0]+'</span><i><em style="width:'+Math.max(3,Math.round(v/tot*100))+'%"></em></i><b>'+v+'</b></div>'}).join('')+'</div><div class="lt-wk">'+S.c7+' commits in the last 7 days</div></div>'+allHtml()+'</div>';return h}
    /* expanded view: every update stacked above, rolling up one after another, newest at the bottom */
    function expand(){clearTimeout(timer);if(card){card.remove();card=null}box.classList.remove('min');box.classList.add('open');
      if(panel)panel.remove();panel=document.createElement('div');panel.className='lt-list';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Live from the studio');
      var h='<div class="lt-head"><span><i></i><b>LIVE</b> from the studio</span><button class="lt-close" type="button" aria-label="Collapse live updates"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button></div><div class="lt-scroll">';
      var n=list.length;for(var k=n-1;k>=0;k--){var it=list[k],p=P[it.k],href=it.u||p[2];var tag=href?'a':'div';
        h+='<'+tag+' class="lt-card in" style="--lc:'+p[1]+';--ld:'+((n-1-k)*55)+'ms"'+(href?' href="'+esc(href)+'"'+(it.u?' target="_blank" rel="noopener"':''):'')+'>'+body(it,k===0)+'</'+tag+'>'}
      panel.innerHTML=h.replace('<div class="lt-scroll">',statsHtml()+'<div class="lt-scroll">')+'</div>';box.insertBefore(panel,pill);
      var sc=panel.querySelector('.lt-scroll');sc.scrollTop=sc.scrollHeight;
      panel.querySelector('.lt-close').addEventListener('click',collapse);
      [].forEach.call(panel.querySelectorAll('.lt-tabs button'),function(b){b.addEventListener('click',function(){[].forEach.call(panel.querySelectorAll('.lt-tabs button'),function(x){x.classList.toggle('on',x===b)});panel.querySelector('.lt-stats').classList.toggle('alltime',b.dataset.t==='a')})});
      try{sessionStorage.removeItem(OFF)}catch(e){}}
    function collapse(){if(panel){panel.remove();panel=null}box.classList.remove('open');minimize(false)}
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&panel)collapse()});
    function show(){if(document.querySelector('.qp.open')){timer=setTimeout(show,1500);return}
      var it=ticker[i],p=P[it.k];var href=it.u||p[2];
      var el=document.createElement(href?'a':'div');el.className='lt-card';el.style.setProperty('--lc',p[1]);el.style.setProperty('--ltd',DUR+'ms');if(href){el.href=href;if(it.u){el.target='_blank';el.rel='noopener'}}
      el.innerHTML=body(it,i===0)+'<button class="lt-x" type="button" aria-label="Hide live updates"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'+ (list.length>1?'<button class="lt-all" type="button">All '+list.length+' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg></button>':'')+'<i class="lt-bar"></i>';
      el.querySelector('.lt-x').addEventListener('click',function(e){e.preventDefault();e.stopPropagation();minimize(true)});
      var all=el.querySelector('.lt-all');if(all)all.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();expand()});
      el.addEventListener('mouseenter',function(){hover=true;clearTimeout(timer)});el.addEventListener('mouseleave',function(){hover=false;timer=setTimeout(next,1800)});
      if(card)card.remove();box.insertBefore(el,pill);card=el;requestAnimationFrame(function(){requestAnimationFrame(function(){el.classList.add('in')})});
      timer=setTimeout(next,DUR)}
    function next(){if(hover||!card)return;card.classList.add('out');var c=card;setTimeout(function(){c.remove();if(card===c)card=null},450);i++;
      if(i>=ticker.length){i=0;timer=setTimeout(function(){minimize(false)},500);return}timer=setTimeout(show,700)}
    function minimize(user){clearTimeout(timer);if(card){card.remove();card=null}box.classList.add('min');if(user){try{sessionStorage.setItem(OFF,'1')}catch(e){}}}
    pill.addEventListener('click',expand);
    setTimeout(show,3500)}
  function go(d){d=d||{};start(items(d),stats(d))}
  if(!window.fetch){return}
  fetch('/feed.json?t='+Math.floor(Date.now()/60000),{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(go).catch(function(){if(window.SNAP)go(window.SNAP)});
})();
