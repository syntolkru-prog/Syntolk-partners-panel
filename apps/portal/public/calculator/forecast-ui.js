(() => {
  'use strict';
  const root=document.getElementById('partner-forecast'), M=globalThis.SyntolkForecast;
  if(!root||!M)return;
  const KEY='syntolk-partner-forecast-v1';
  let settings=M.defaults(), scenario='base', month=3, tab='content', results;
  let canSave=true, statusTimer, mobileExpanded=false, extraFormatsExpanded=false;
  const mobileQuery=globalThis.matchMedia?.('(max-width:760px)');
  let stored;
  try {
    const serialized=localStorage.getItem(KEY);
    // A damaged draft does not mean the browser has disabled storage.
    try { stored=JSON.parse(serialized||'null'); } catch { stored=null; }
  } catch { canSave=false; }
  if(stored?.version===1){
    settings=M.normalize(stored.settings);
    if(Object.hasOwn(M.SCENARIOS,stored.scenario))scenario=stored.scenario;
    month=Math.max(1,Math.min(12,Math.floor(Number(stored.month)||3)));
  }
  const $=selector=>root.querySelector(selector);
  const $$=selector=>[...root.querySelectorAll(selector)];
  const number=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
  const frequencyNumber=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2});
  const integer=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0});
  const money=v=>integer.format(Math.abs(v)<0.5?0:v)+' ₽';
  const count=v=>v>0&&v<0.1?'< 0,1':number.format(v);
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const formatIcons={
    post:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    short:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="m10 8 5 4-5 4Z"/>',
    long:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/>',
    article:'<path d="M14 3H5v18h14V8Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
    circle:'<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4Z"/>'
  };
  const get=path=>path.split('.').reduce((v,k)=>v[k],settings);
  function set(path,value) {
    const keys=path.split('.'), last=keys.pop();
    keys.reduce((v,k)=>v[k],settings)[last]=value;
  }
  function input(path,label,{min=0,max=100,unit='',hint=''}={}) {
    const id='pf-'+path.replaceAll('.','-');
    return `<label class="pf-field" for="${id}"><span>${label}</span><span class="pf-input-wrap"><input id="${id}" data-pf-path="${path}" type="number" inputmode="decimal" min="${min}" max="${max}" step="any" value="${get(path)}">${unit?`<span aria-hidden="true">${unit}</span>`:''}</span>${hint?`<small>${hint}</small>`:''}</label>`;
  }
  function select(path,label,options,prefix='pf-') {
    const id=prefix+path.replaceAll('.','-');
    return `<label class="pf-field" for="${id}"><span>${label}</span><select id="${id}" data-pf-path="${path}">${options.map(([value,name])=>`<option value="${value}"${String(get(path))===String(value)?' selected':''}>${name}</option>`).join('')}</select></label>`;
  }
  function renderControls() {
    $('#pf-quick-profile').innerHTML=select('profile','Ваша аудитория',Object.entries(M.PROFILES).map(([id,p])=>[id,p.name]),'pf-quick-input-');
    $('#pf-panel-content').innerHTML=`
      <div class="pf-budget pf-full-only">${input('budgetHours','Моё время в неделю',{max:168,unit:'ч'})}<span>Создание, размещение<br>и общение с аудиторией</span></div>
      <div class="pf-row-head"><span>Оригинальные материалы</span><span>В неделю</span></div>
      <div class="pf-format-list">${M.FORMATS.map((f,i)=>`<div id="pf-format-${f.id}" class="pf-format-row${i>1?' pf-secondary-format':''}"><div><span class="pf-format-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">${formatIcons[f.id]}</svg></span><label for="pf-frequency-${f.id}">${f.name}<small>${f.hint}</small></label></div><input id="pf-frequency-${f.id}" aria-label="${f.name}: оригиналов в неделю" data-pf-path="frequency.${f.id}" type="number" min="0" max="35" step="any" inputmode="decimal" value="${settings.frequency[f.id]}"></div>`).join('')}</div>
      <button class="pf-text-button pf-quick-only pf-extra-toggle" id="pf-extra-formats-toggle" type="button" aria-expanded="${extraFormatsExpanded}" aria-controls="pf-format-long pf-format-article pf-format-circle">Другие форматы</button>
      <p class="pf-help pf-full-only">0,25 в неделю ≈ один материал в месяц. Копии для других площадок здесь не прибавляйте.</p>
      <details class="pf-details pf-more-settings pf-full-only" id="pf-more-settings"><summary>Время создания, рост и другие условия</summary>
      <details class="pf-details"><summary>Время на создание и публикацию</summary><div class="pf-fields-grid">${M.FORMATS.map(f=>input('minutes.'+f.id,f.name,{min:1,max:600,unit:'мин'})).join('')}${input('publishMinutes','Разместить одну копию',{max:120,unit:'мин'})}${input('adminMinutes','Общение и аналитика / неделю',{max:10080,unit:'мин'})}</div></details>
      <details class="pf-details"><summary>Старый контент и рост просмотров</summary><div class="pf-fields-grid">${input('growth','Прирост просмотров / месяц',{max:30,unit:'%',hint:'Новые материалы; рост ограничен ×3.'})}${input('newVisitorShare','Новых посетителей из переходов',{unit:'%',hint:'Остальные — повторы и пересечение аудиторий.'})}${M.FORMATS.map(f=>input('tail.'+f.id,'Хвост: '+f.name.toLowerCase(),{max:95,unit:'%'})).join('')}${select('stopAfter','Выпускать новые материалы',[[0,'Не выпускать'],...Array.from({length:12},(_,i)=>[i+1,'Первые '+(i+1)+' мес.'])])}</div><p class="pf-help">Хвост 35%: в следующем месяце — 35% стартовых просмотров, затем 12,25%. После остановки публикаций сохраняются просмотры старого контента, продления и заданное время общения/аналитики.</p></details>
      <details class="pf-details"><summary>А если один ролик наберёт больше?</summary><div class="pf-fields-grid">${input('viralViews','Дополнительные просмотры',{max:10000000})}${select('viralMonth','В каком месяце',Array.from({length:12},(_,i)=>[i+1,i+1]))}${select('viralChannel','На какой площадке',M.CHANNELS.filter(c=>c.formats.includes('short')).map(c=>[c.id,c.name]))}</div><p class="pf-help" id="pf-viral-note">По умолчанию всплеска нет.</p></details></details>`;
    $('#pf-panel-platforms').innerHTML=`
      <div class="pf-platform-tools"><label for="pf-channel-filter" class="sr-only">Показать площадки</label><select id="pf-channel-filter"><option value="selected">Выбранные площадки</option><option value="all">Все 19 площадок</option><option value="social">Соцсети и мессенджеры</option><option value="video">Видеоплощадки</option><option value="expert">Экспертные блоги</option><option value="owned">Свои площадки и СМИ</option></select><span id="pf-channel-count"></span></div>
      <p class="pf-help">Выберите, куда публикуете каждый формат. Просмотры — на одно размещение за первый месяц; переходы — доля этих просмотров.</p>
      <div class="pf-channel-list">${M.CHANNELS.map(c=>{
        const state=settings.channels[c.id];
        return `<details class="pf-channel" data-channel="${c.id}"><summary><span>${c.name}</span><span class="pf-channel-summary" data-summary="${c.id}"></span></summary><div class="pf-channel-body"><label class="pf-check pf-enable"><input type="checkbox" data-channel-enable="${c.id}"${state.formats.length?' checked':''}>Использовать площадку</label><div class="pf-format-checks">${c.formats.map(f=>`<label class="pf-check"><input type="checkbox" data-channel-format="${c.id}" value="${f}"${state.formats.includes(f)?' checked':''}>${M.FORMATS.find(x=>x.id===f).name}</label>`).join('')}</div><div class="pf-fields-grid">${input('channels.'+c.id+'.views','Просмотры / размещение',{max:1000000})}${input('channels.'+c.id+'.ctr','Переходы из просмотров',{unit:'%'})}</div><p class="pf-help">${c.note}${c.url?` <a href="${escape(c.url)}" target="_blank" rel="noopener">О площадке ↗</a>`:''}</p></div></details>`;
      }).join('')}</div>`;
    $('#pf-panel-sales').innerHTML=`
      ${select('profile','Кому вы рекомендуете Syntolk',Object.entries(M.PROFILES).map(([id,p])=>[id,p.name]))}
      <p class="pf-help">Профиль меняет только долю бизнес-аудитории, конверсии, удержание и стартовые тарифы.</p>
      <div class="pf-fields-grid">${input('registration','Регистрация из посетителя',{unit:'%'})}${input('personalPaid','Оплата из личной регистрации',{unit:'%'})}${input('businessShare','Бизнес-аудитория',{unit:'%'})}${input('businessPaid','Оплата из бизнес-регистрации',{unit:'%'})}</div>
      <details class="pf-details"><summary>Продления и повышение тарифа</summary><div class="pf-fields-grid">${input('personalRetention','Продлевают: личные',{unit:'%'})}${input('businessRetention','Продлевают: бизнес',{unit:'%'})}${input('personalUpgrade','Повышают тариф: личные',{unit:'%'})}${input('businessUpgrade','Повышают тариф: бизнес',{unit:'%'})}${input('delayShare','Первая оплата в следующем месяце',{unit:'%'})}</div><p class="pf-help">Проценты — за месяц. Повышение на одну ступень внутри сегмента. Автоматического перехода с личного тарифа на бизнес нет.</p></details>
      <details class="pf-details"><summary>Тарифы и состав первых оплат</summary><p class="pf-help">Цена за месяц и вес тарифа внутри своей группы. Веса приводятся к 100%; при всех нулях используется первый тариф группы. <a href="https://syntolk.ru/" target="_blank" rel="noopener">Тарифы Syntolk ↗</a> · проверены 11.10.2026.</p><div class="pf-plan-head"><span>Тариф</span><span>Цена, ₽</span><span>Вес, %</span></div>${M.PLANS.map((p,i)=>`${i===0||i===3?`<div class="pf-segment-label">${i===0?'Личные тарифы':'Для бизнеса'}</div>`:''}<div class="pf-plan-row"><span>${p.name}</span><input data-pf-path="prices.${i}" aria-label="${p.name}: цена в рублях" type="number" inputmode="decimal" min="0" max="1000000" step="any" value="${settings.prices[i]}"><input data-pf-path="mix.${i}" aria-label="${p.name}: вес в группе" type="number" inputmode="decimal" min="0" max="100" step="any" value="${settings.mix[i]}"></div>`).join('')}<p class="pf-help" id="pf-mix-summary"></p></details>
      <details class="pf-details"><summary>Доплаты, возвраты и расходы</summary><div class="pf-fields-grid">${input('addon','Доплаты / активного клиента в месяц',{max:1000000,unit:'₽'})}${input('refunds','Возвращено от суммы оплат',{unit:'%'})}${input('monthlyCost','Денежные расходы / месяц',{max:10000000,unit:'₽'})}${input('hourlyCost','Оценка часа вашей работы',{max:100000,unit:'₽'})}</div><p class="pf-help">Бонусный баланс тарифов не считается оплатой. Расходы показаны отдельно от партнёрских начислений.</p></details>`;
    syncControls();
  }
  function syncControls() {
    $$('[data-pf-path]').forEach(el=>{el.value=String(get(el.dataset.pfPath));});
    M.CHANNELS.forEach(c=>{
      const chosen=settings.channels[c.id].formats;
      $(`[data-channel-enable="${c.id}"]`).checked=chosen.length>0;
      $$(`[data-channel-format="${c.id}"]`).forEach(el=>{el.checked=chosen.includes(el.value);});
    });
    $('#pf-month').value=String(month);
    filterChannels();
  }
  function filterChannels() {
    const filter=$('#pf-channel-filter').value;
    let enabled=0;
    M.CHANNELS.forEach(c=>{
      const chosen=settings.channels[c.id].formats, card=$(`[data-channel="${c.id}"]`);
      if(chosen.length)enabled++;
      $(`[data-summary="${c.id}"]`).textContent=chosen.length?chosen.map(f=>({post:'пост',short:'shorts',long:'видео',article:'статья',circle:'кружок'}[f])).join(' · '):'Не выбрана';
      card.classList.toggle('pf-is-selected',chosen.length>0);
      card.hidden=filter==='selected'?!chosen.length:filter!=='all'&&filter!==c.group;
      if(card.hidden&&card.contains(document.activeElement))$('#pf-channel-filter').focus();
    });
    $('#pf-channel-count').textContent=enabled+' из '+M.CHANNELS.length;
  }
  function setTab(next,focus=false) {
    if(!['content','platforms','sales'].includes(next))return;
    tab=next;
    $$('[data-pf-tab]').forEach(button=>{
      const selected=button.dataset.pfTab===tab;
      button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
      if(selected&&focus)button.focus();
    });
    $$('[data-pf-panel]').forEach(panel=>{panel.hidden=panel.dataset.pfPanel!==tab;});
  }
  function setMobileMode(expanded) {
    mobileExpanded=expanded;
    root.dataset.mobileMode=expanded?'full':'compact';
    const toggle=$('#pf-mode-toggle');
    toggle.setAttribute('aria-expanded',String(expanded));
    toggle.innerHTML=expanded?'Свернуть до быстрого расчёта <span aria-hidden="true">↑</span>':'Открыть полный калькулятор <span aria-hidden="true">↓</span>';
    if(!expanded)setTab('content');
    updateMobileTitle();
  }
  function updateMobileTitle() {
    // The portal uses its shared page header rather than the landing heading.
    const heading=$('.pf-toolbar h3');
    if(heading)heading.textContent=mobileQuery?.matches?(mobileExpanded?'Полный калькулятор':'Быстрый расчёт'):'Соберите свой сценарий';
  }
  function updateExtraFormats() {
    root.dataset.extraFormats=extraFormatsExpanded?'open':'closed';
    const toggle=$('#pf-extra-formats-toggle'), active=M.FORMATS.slice(2).filter(f=>settings.frequency[f.id]>0).length;
    toggle.setAttribute('aria-expanded',String(extraFormatsExpanded));
    toggle.textContent=extraFormatsExpanded?'Скрыть другие форматы ↑':active?'Ещё '+active+(active===1?' формат':' формата')+' в расчёте ↓':'Другие форматы ↓';
  }
  function save() {
    if(canSave){try{localStorage.setItem(KEY,JSON.stringify({version:1,settings,scenario,month}));}catch{canSave=false;}}
  }
  function cellTable(headings,rows,caption) {
    return `<div class="pf-table-scroll" tabindex="0" role="region" aria-label="${caption}"><table class="pf-table"><caption class="sr-only">${caption}</caption><thead><tr>${headings.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map((v,i)=>i===0?`<th scope="row">${v}</th>`:`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function renderResults() {
    results=Object.fromEntries(Object.keys(M.SCENARIOS).map(id=>[id,M.forecast(settings,id)]));
    const result=results[scenario], current=result.months[month-1], year=result.year, work=result.work;
    updateExtraFormats();
    const channels=M.CHANNELS.filter(c=>settings.channels[c.id].formats.length).map(c=>c.name);
    $('#pf-quick-assumptions').textContent='Площадки: '+(channels.join(', ')||'не выбраны')+'. Материалы в неделю: '+M.FORMATS.map(f=>f.name.toLowerCase()+' — '+frequencyNumber.format(settings.frequency[f.id])).join('; ')+'. Регистрация: '+number.format(settings.registration)+'%. Оплата из регистрации: личная — '+number.format(settings.personalPaid)+'%, бизнес — '+number.format(settings.businessPaid)+'%. Время по плану: '+number.format(work.hours)+' ч/неделю из доступных '+number.format(settings.budgetHours)+' ч. Остальные условия — в полном калькуляторе.';
    $('#pf-quick-scenario').textContent=M.SCENARIOS[scenario].name+' · комиссия 20%';
    $$('[data-scenario]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.scenario===scenario)));
    const sc=M.SCENARIOS[scenario];
    $('#pf-scenario-note').textContent=`К вашим значениям: просмотры ×${number.format(sc.views)}, регистрации ×${number.format(sc.registration)}, оплаты из регистраций ×${number.format(sc.payment)}. Удержание и цены одинаковы.`;
    $('#pf-income-label').textContent='Начисления за '+month+'-й месяц';
    $('#pf-income').textContent=money(current.reward);
    $('#pf-income-range').textContent='Другие сценарии: '+money(results.low.months[month-1].reward)+' — '+money(results.high.months[month-1].reward);
    $('#pf-year').textContent=money(year.cumulative);
    $('#pf-hours').textContent=number.format(year.cumulativeHours)+' ч';
    $('#pf-cumulative').textContent=money(current.cumulative);
    $('#pf-work').innerHTML=`<div><strong>${number.format(work.hours)} ч / неделю</strong><span>из доступных ${number.format(settings.budgetHours)} ч</span></div><div><strong>${number.format(work.originals)} оригинала</strong><span>${number.format(work.placements)} размещений / неделю</span></div>`;
    const over=work.minutes>work.budgetMinutes+0.01;
    $('#pf-work').classList.toggle('pf-over-budget',over);
    $('#pf-fit').hidden=!over;
    $('#pf-budget-note').textContent=over?'План превышает ваш бюджет времени. Уменьшите частоту или увеличьте доступные часы.':'Создание считается один раз. На каждую копию добавляется только время размещения.';
    $('#pf-fit').textContent='Сократить план до '+number.format(settings.budgetHours)+' ч / неделю';
    const orphan=work.unplaced.map(id=>M.FORMATS.find(f=>f.id===id).name.toLowerCase());
    $('#pf-unplaced').hidden=!orphan.length;
    $('#pf-unplaced').textContent=orphan.length?'Не выбраны площадки для форматов: '+orphan.join(', ')+'. Время на создание учтено, просмотров нет.':'';
    const viralEnabled=settings.channels[settings.viralChannel].formats.includes('short')&&settings.frequency.short>0&&settings.stopAfter>0;
    $('#pf-viral-note').textContent=settings.viralViews>0&&!viralEnabled?'Всплеск не учтён: добавьте выпуск коротких видео и включите выбранную площадку.':'Дополнительные просмотры одного из ваших коротких роликов. По умолчанию всплеска нет.';
    const peak=Math.max(1,...result.months.map(m=>m.reward));
    $('#pf-chart').innerHTML=result.months.map(m=>`<button type="button" class="pf-chart-month${month===m.month?' pf-active-month':''}" data-month="${m.month}" tabindex="${month===m.month?0:-1}" aria-pressed="${month===m.month}" aria-label="Месяц ${m.month}: ${money(m.reward)}"><span class="pf-chart-track"><span style="--pf-bar:${m.reward?Math.max(2,m.reward/peak*100):0}%"></span></span><span>${m.month}</span></button>`).join('');
    $('#pf-views').textContent=integer.format(current.views);
    $('#pf-clicks').textContent=integer.format(current.clicks);
    $('#pf-signups').textContent=count(current.registrations);
    $('#pf-paid').textContent=count(current.newPaid);
    $('#pf-active-clients').textContent=count(current.active);
    $('#pf-old-share').textContent=(current.views?number.format(current.oldViews/current.views*100):'0')+'%';
    $('#pf-new-income').textContent=money(current.newReward);
    $('#pf-repeat-income').textContent=money(current.repeatReward);
    $('#pf-repeat-bar').style.setProperty('--pf-repeat',current.reward?current.repeatReward/current.reward*100+'%':'0%');
    $('#pf-net').textContent=money(current.net);
    $('#pf-new-visitors').textContent=count(current.visitors);
    $('#pf-upgrades').textContent=count(current.upgrades.reduce((a,b)=>a+b,0));
    $('#pf-churned').textContent=count(current.churned);
    $('#pf-plan-output').innerHTML=cellTable(['Тариф','Активных','Повысили до'],M.PLANS.map((p,i)=>[p.name+'<small>'+money(settings.prices[i])+'/мес.</small>',count(current.byPlan[i]),count(current.upgrades[i])]),'Состав клиентов в выбранном месяце');
    const contributing=current.channels.filter(c=>c.views>0||c.active>0);
    $('#pf-channel-output').innerHTML=contributing.length?cellTable(['Площадка','Переходы','Активных','Начислено'],contributing.map(c=>[c.name,count(c.clicks),count(c.active),money(c.reward)]),'Вклад площадок в выбранном месяце'):'<p class="pf-help">Выберите площадки и добавьте публикации, чтобы увидеть их вклад.</p>';
    $('#pf-cohort-output').innerHTML=current.cohorts.length?cellTable(['Первая оплата','Активных сейчас','Начислено'],current.cohorts.map(c=>[c.month+'-й месяц',count(c.active),money(c.reward)]),'Группы клиентов по месяцу первой оплаты'):'<p class="pf-help">В этом сценарии оплат пока нет.</p>';
    $('#pf-monthly-output').innerHTML=cellTable(['Месяц','Просмотры','Переходы','Регистрации','Первые оплаты','Активных','Первые начисления','Продления','Всего за месяц','Накоплено'],result.months.map(m=>[m.month,integer.format(m.views),integer.format(m.clicks),count(m.registrations),count(m.newPaid),count(m.active),money(m.newReward),money(m.repeatReward),money(m.reward),money(m.cumulative)]),'Помесячный сценарий на год');
    $('#pf-mix-summary').textContent='Личные: '+result.mix.slice(0,3).map(w=>number.format(w*100)+'%').join(' / ')+' · Бизнес: '+result.mix.slice(3).map(w=>number.format(w*100)+'%').join(' / ')+'.';
    $('#pf-result-details-title').textContent='Клиенты, тарифы и источники · '+month+'-й месяц';
    $('#pf-month').value=String(month);
    clearTimeout(statusTimer);
    statusTimer=setTimeout(()=>{$('#pf-live').textContent='Расчёт обновлён. '+month+'-й месяц: '+money(current.reward)+'.';},400);
    save();
  }
  root.addEventListener('input',event=>{
    const el=event.target;
    if(!el.dataset.pfPath||el.type!=='number'||el.value==='')return;
    const entered=Number(el.value);
    set(el.dataset.pfPath,entered);settings=M.normalize(settings);
    const applied=get(el.dataset.pfPath);
    // Keep a clamped value visible immediately, but do not interrupt a valid edit.
    if(applied!==entered)el.value=String(applied);
    renderResults();
  });
  root.addEventListener('change',event=>{
    const el=event.target;
    if(el.id==='pf-channel-filter'){filterChannels();return;}
    if(el.id==='pf-month'){month=Number(el.value);renderResults();return;}
    if(el.dataset.pfPath){
      if(el.dataset.pfPath==='profile'){
        const profile=M.PROFILES[el.value];
        Object.entries(profile).forEach(([k,v])=>{if(k!=='name')settings[k]=Array.isArray(v)?[...v]:v;});
        settings.profile=el.value;
      } else set(el.dataset.pfPath,el.tagName==='SELECT'&&el.dataset.pfPath==='viralChannel'?el.value:Number(el.value));
      settings=M.normalize(settings);syncControls();renderResults();return;
    }
    const enable=el.dataset.channelEnable, format=el.dataset.channelFormat;
    if(enable){const c=M.CHANNELS.find(c=>c.id===enable);settings.channels[enable].formats=el.checked?(c.formats.filter(f=>settings.frequency[f]>0).length?c.formats.filter(f=>settings.frequency[f]>0):[c.formats[0]]):[];}
    if(format){const c=M.CHANNELS.find(c=>c.id===format);settings.channels[format].formats=c.formats.filter(f=>f===el.value?el.checked:settings.channels[format].formats.includes(f));}
    if(enable||format){syncControls();renderResults();}
  });
  root.addEventListener('click',event=>{
    const button=event.target.closest('button,a');if(!button)return;
    if(button.id==='pf-mode-toggle'){setMobileMode(!mobileExpanded);return;}
    if(button.id==='pf-extra-formats-toggle'){extraFormatsExpanded=!extraFormatsExpanded;updateExtraFormats();return;}
    if(button.dataset.pfTab){setTab(button.dataset.pfTab);return;}
    if(button.dataset.scenario){scenario=button.dataset.scenario;renderResults();return;}
    if(button.dataset.month){month=Number(button.dataset.month);renderResults();$(`[data-month="${month}"]`).focus();return;}
    if(button.id==='pf-fit'){settings=M.fitBudget(settings);syncControls();renderResults();return;}
    if(button.id==='pf-reset'){settings=M.defaults();scenario='base';month=3;renderControls();setTab('content');renderResults();return;}
    if(button.id==='pf-export'){
      const blob=new Blob([M.csv(settings)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='Syntolk-partner-scenario.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  });
  root.addEventListener('keydown',event=>{
    const tabs=['content','platforms','sales'], el=event.target;
    if(el.dataset.pfTab&&['ArrowRight','ArrowLeft','Home','End'].includes(event.key)){
      event.preventDefault();let i=tabs.indexOf(tab);
      i=event.key==='Home'?0:event.key==='End'?2:(i+(event.key==='ArrowRight'?1:2))%3;setTab(tabs[i],true);
    }
    if(el.dataset.month&&['ArrowRight','ArrowLeft','Home','End'].includes(event.key)){
      event.preventDefault();month=event.key==='Home'?1:event.key==='End'?12:Math.max(1,Math.min(12,month+(event.key==='ArrowRight'?1:-1)));
      renderResults();$(`[data-month="${month}"]`).focus();
    }
  });
  renderControls();setTab(tab);setMobileMode(false);renderResults();
  $('.pf-under>.pf-details').classList.add('pf-full-only');
  mobileQuery?.addEventListener?.('change',()=>{
    if(mobileQuery.matches&&!mobileExpanded)setTab('content');
    updateMobileTitle();
  });
})();
