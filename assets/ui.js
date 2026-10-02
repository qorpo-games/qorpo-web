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
