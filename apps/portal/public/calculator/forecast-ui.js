(() => {
  'use strict';
  const root=document.getElementById('partner-forecast'), M=globalThis.SyntolkForecast;
  if(!root||!M)return;
  const KEY=root.dataset.storageKey||'syntolk-partner-forecast-v1';
  let settings=M.newScenario(), scenario='base', month=3, tab='content', results;
  let canSave=true, statusTimer, mobileExpanded=false, formatMenuOpen=false, platformMenuOpen=false, channelFormatMenu=null, suppressPersist=false;
  const mobileQuery=globalThis.matchMedia?.('(max-width:760px)');
  let stored;
  try {
    const localSerialized=localStorage.getItem(KEY);
    const serialized=localSerialized||root.dataset.initialState;
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
  const channels=()=>M.allChannels(settings);
  const formats=()=>M.allFormats(settings);
  const visibleFormats=()=>formats();
  const newId=prefix=>prefix+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
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
  function input(path,label,{min=0,max=100,unit='',hint='',ariaLabel='',idPrefix='pf-'}={}) {
    const id=idPrefix+path.replaceAll('.','-');
    return `<label class="pf-field" for="${id}"><span>${escape(label)}</span><span class="pf-input-wrap"><input id="${id}" data-pf-path="${path}"${ariaLabel?` aria-label="${escape(ariaLabel)}"`:''} type="number" inputmode="decimal" min="${min}" max="${max}" step="any" value="${get(path)}">${unit?`<span aria-hidden="true">${unit}</span>`:''}</span>${hint?`<small>${hint}</small>`:''}</label>`;
  }
  function select(path,label,options,prefix='pf-') {
    const id=prefix+path.replaceAll('.','-');
    return `<label class="pf-field" for="${id}"><span>${escape(label)}</span><select id="${id}" data-pf-path="${path}">${options.map(([value,name])=>`<option value="${value}"${String(get(path))===String(value)?' selected':''}>${escape(name)}</option>`).join('')}</select></label>`;
  }
  // Each source is shown as its own card. Variants such as VK Clips and
  // YouTube Shorts have separate metrics and must not be hidden inside a
  // combined platform accordion.
  function disclosureKey(details){
    if(details.id)return details.id;
    if(details.dataset.channelGroup)return 'group:'+details.dataset.channelGroup;
    if(details.dataset.channel)return 'source:'+details.dataset.channel;
    if(details.classList.contains('pf-channel-variants'))return 'variants:'+details.closest('[data-channel-group]')?.dataset.channelGroup;
    return (details.closest('[data-pf-panel]')?.id||'calculator')+':'+details.querySelector(':scope > summary')?.textContent.trim();
  }
  const platformGroupKey=c=>c.id;
  function platformGroups(){return channels().map(c=>({key:c.id,name:c.name,members:[c]}));}
  function selectedFormats(group){
    return [...new Set(group.members.flatMap(c=>settings.channels[c.id].formats))]
      .map(id=>formats().find(f=>f.id===id)?.name).filter(Boolean);
  }
  function platformSourceSettings(c,nested){
    const state=settings.channels[c.id];
    const body=`<div class="pf-fields-grid"><label class="pf-field"><span>Название</span><input type="text" maxlength="80" data-channel-name="${c.id}" aria-label="Название площадки ${escape(c.name)}" value="${escape(c.name)}"></label><label class="pf-field"><span>Ссылка на площадку</span><input type="url" maxlength="300" data-channel-url="${c.id}" aria-label="Ссылка площадки ${escape(c.name)}" value="${escape(c.url||'')}"></label></div><div class="pf-fields-grid">${input('channels.'+c.id+'.views','Просмотры / размещение',{max:1000000})}${input('channels.'+c.id+'.ctr','Переходы из просмотров',{unit:'%'})}</div><p class="pf-help">${escape(c.note)}${c.url?` <a href="${escape(c.url)}" target="_blank" rel="noopener">О площадке ↗</a>`:''}</p><button class="pf-remove-platform" type="button" data-remove-channel="${c.id}">Убрать площадку из сценария</button>`;
    return nested?`<details class="pf-channel pf-channel-variant" data-channel="${c.id}"><summary><span>${escape(c.name)}</span><span class="pf-channel-summary">${state.formats.length?state.formats.map(id=>formats().find(f=>f.id===id)?.name).filter(Boolean).join(' · '):'Форматы не выбраны'}</span></summary><div class="pf-channel-body">${body}</div></details>`:`<div class="pf-channel-source" data-channel="${c.id}">${body}</div>`;
  }
  function channelFormatBase(c){
    const ids=settings.channels[c.id]?.formats||[];
    const candidate=[...ids,...c.formats].map(id=>formats().find(f=>f.id===id)).find(f=>f&&M.FORMATS.some(base=>base.id===f.base));
    return candidate?.base||'post';
  }
  function primaryChannel(group){
    return group.members[0];
  }
  function channelFormatControl(group){
    const c=primaryChannel(group);
    const open=channelFormatMenu===c.id;
    return `<div class="pf-channel-format-add"><button type="button" class="pf-channel-add-format" data-channel-format-menu="${escape(c.id)}" aria-expanded="${open?'true':'false'}" aria-label="${open?'Закрыть форму добавления формата':'Добавить свой формат для '+escape(c.name)}" title="${open?'Закрыть форму':'Добавить свой формат'}">${open?'×':'+'}</button>${open?`<div class="pf-channel-format-menu"><strong>Свой формат для ${escape(c.name)}</strong><div class="pf-fields-grid"><label class="pf-field"><span>Название формата</span><input type="text" maxlength="80" data-channel-format-name="${escape(c.id)}" placeholder="Например, сообщение в группе"></label><label class="pf-field"><span>Материалов в неделю</span><input type="number" min="0" max="35" step="any" data-channel-format-count="${escape(c.id)}" value="1"></label><label class="pf-field"><span>Минут на материал</span><input type="number" min="1" max="600" data-channel-format-time="${escape(c.id)}" value="30"></label></div><button type="button" data-channel-format-save="${escape(c.id)}">Сохранить формат</button></div>`:''}</div>`;
  }
  function renderPlatformGroup(group){
    const enabled=group.members.some(c=>settings.channels[c.id].enabled),chosen=selectedFormats(group);
    const formatOptions=group.members.flatMap(c=>c.formats.filter(id=>formats().some(f=>f.id===id)).map(id=>`<label class="pf-check"><input type="checkbox" data-channel-format="${c.id}" value="${id}"${settings.channels[c.id].formats.includes(id)?' checked':''}>${escape(formats().find(f=>f.id===id).name)}</label>`));
    const sources=group.members.length===1?platformSourceSettings(group.members[0],false):`<details class="pf-channel-variants"><summary>Настройки источников расчёта</summary>${group.members.map(c=>platformSourceSettings(c,true)).join('')}</details>`;
    const formatAdders=`<div class="pf-channel-format-adders">${channelFormatControl(group)}</div>`;
    return `<details class="pf-channel pf-channel-group" data-channel-group="${escape(group.key)}"${group.members.length===1?` data-channel="${group.members[0].id}"`:''}><summary><span>${escape(group.name)}</span><span class="pf-channel-summary" data-summary="${escape(group.key)}">${enabled?(chosen.length?chosen.join(' · '):'Форматы не выбраны'):'Не выбрана'}</span></summary><div class="pf-channel-body"><label class="pf-check pf-enable"><input type="checkbox" data-channel-enable="${escape(group.key)}"${enabled?' checked':''}>Использовать площадку</label><div class="pf-format-checks">${formatOptions.join('')}</div>${formatAdders}${sources}</div></details>`;
  }
  function renderControls() {
    const previousFilter=$('#pf-channel-filter')?.value;
    const expanded=new Set($$('details[open]').map(disclosureKey));
    const platformScroll=$('.pf-channel-list')?.scrollTop||0;
    $('#pf-panel-content').innerHTML=`
      <div class="pf-budget pf-full-only">${input('budgetHours','Моё время в неделю',{max:168,unit:'ч'})}<span>Создание, размещение<br>и общение с аудиторией</span></div>
      <div class="pf-row-head"><span>Оригинальные материалы</span><span>В неделю</span></div>
      <div class="pf-format-list">${visibleFormats().map(f=>`<div id="pf-format-${f.id}" class="pf-format-item"><details id="pf-format-settings-${f.id}" class="pf-format-edit"><summary><span class="pf-format-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${formatIcons[f.base]||formatIcons.post}</svg></span><span class="pf-format-title">${escape(f.name)}</span><span class="pf-format-action">Настроить</span></summary><div class="pf-format-edit-body"><label class="pf-field"><span>Название формата</span><input type="text" maxlength="80" aria-label="Название формата ${escape(f.name)}" data-format-name="${f.id}" value="${escape(f.name)}"></label>${input('minutes.'+f.id,'Минут на материал',{min:1,max:600,unit:'мин',ariaLabel:'Минут на материал: '+f.name})}<button class="pf-remove-platform" type="button" data-remove-format="${f.id}">Убрать формат из сценария</button></div></details><input class="pf-format-frequency" id="pf-frequency-${f.id}" aria-label="${escape(f.name)}: оригиналов в неделю" data-pf-path="frequency.${f.id}" type="number" min="0" max="35" step="any" inputmode="decimal" value="${settings.frequency[f.id]}"></div>`).join('')}</div>
      <div class="pf-custom-form"><button type="button" id="pf-format-menu-toggle" aria-expanded="${formatMenuOpen?'true':'false'}" aria-controls="pf-format-menu">${formatMenuOpen?'Скрыть форму':'Добавить формат'}</button>${formatMenuOpen?`<div id="pf-format-menu" class="pf-format-menu"><div class="pf-format-menu-head"><strong>Новый формат</strong><button type="button" id="pf-format-menu-close" class="pf-format-menu-close" aria-label="Закрыть форму добавления формата">Закрыть</button></div><div class="pf-fields-grid"><label class="pf-field pf-custom-name"><span>Название нового формата</span><input id="pf-format-name" maxlength="80" placeholder="Например, мой формат"></label><label class="pf-field"><span>Материалов в неделю</span><input id="pf-format-count" type="number" min="0" max="35" step="any" value="1"></label><label class="pf-field"><span>Минут на материал</span><input id="pf-format-time" type="number" min="1" max="600" value="30"></label></div><button type="button" id="pf-add-format">Сохранить формат</button></div>`:''}</div>
      ${settings.removedFormats.length?`<label class="pf-field pf-restore"><span>Вернуть стандартный формат</span><select id="pf-restore-format"><option value="">Выберите формат</option>${M.FORMATS.filter(f=>settings.removedFormats.includes(f.id)).map(f=>`<option value="${f.id}">${f.name}</option>`).join('')}</select></label>`:''}
      <p class="pf-help pf-full-only">0,25 в неделю ≈ один материал в месяц. Копии для других площадок здесь не прибавляйте.</p>
      <details class="pf-details pf-more-settings pf-full-only" id="pf-more-settings"><summary>Время создания, рост и другие условия</summary>
      <details class="pf-details"><summary>Время на публикацию и общение</summary><div class="pf-fields-grid">${input('publishMinutes','Разместить одну копию',{max:120,unit:'мин'})}${input('adminMinutes','Общение и аналитика / неделю',{max:10080,unit:'мин'})}</div></details>
      <details class="pf-details"><summary>Старый контент и рост просмотров</summary><div class="pf-fields-grid">${input('growth','Прирост просмотров / месяц',{max:30,unit:'%',hint:'Новые материалы; рост ограничен ×3.'})}${visibleFormats().map(f=>input('tail.'+f.id,'Хвост: '+f.name.toLowerCase(),{max:95,unit:'%'})).join('')}${select('stopAfter','Выпускать новые материалы',[[0,'Не выпускать'],...Array.from({length:12},(_,i)=>[i+1,'Первые '+(i+1)+' мес.'])])}</div><p class="pf-help">Хвост 35%: в следующем месяце — 35% стартовых просмотров, затем 12,25%. После остановки публикаций сохраняются просмотры старого контента, продления и заданное время общения/аналитики.</p></details>
      <details class="pf-details"><summary>А если один ролик наберёт больше?</summary><div class="pf-fields-grid">${input('viralViews','Дополнительные просмотры',{max:10000000})}${select('viralMonth','В каком месяце',Array.from({length:12},(_,i)=>[i+1,i+1]))}${select('viralChannel','На какой площадке',channels().filter(c=>c.formats.includes('short')).map(c=>[c.id,c.name]))}</div><p class="pf-help" id="pf-viral-note">По умолчанию всплеска нет.</p></details></details>`;
    $('#pf-panel-platforms').innerHTML=`
      <div class="pf-platform-tools"><label for="pf-channel-filter" class="sr-only">Показать площадки</label><select id="pf-channel-filter"><option value="selected">Выбранные площадки</option><option value="all">Все доступные площадки</option><option value="social">Соцсети и мессенджеры</option><option value="video">Видеоплощадки</option><option value="expert">Экспертные блоги</option><option value="owned">Свои площадки и СМИ</option><option value="custom">Добавленные мной</option></select><span id="pf-channel-count"></span></div>
      <p class="pf-help">Выберите, куда публикуете каждый формат. Просмотры — на одно размещение за первый месяц; переходы — доля этих просмотров.</p>
      <div class="pf-add-platform"><button type="button" id="pf-platform-menu-toggle" aria-expanded="${platformMenuOpen?'true':'false'}" aria-controls="pf-platform-menu">${platformMenuOpen?'Скрыть форму':'Добавить площадку'}</button>${platformMenuOpen?`<div id="pf-platform-menu" class="pf-platform-menu"><div class="pf-platform-menu-head"><strong>Новая площадка</strong><button type="button" id="pf-platform-menu-close" class="pf-platform-menu-close" aria-label="Закрыть форму добавления площадки">Закрыть</button></div><div class="pf-fields-grid"><label class="pf-field"><span>Название площадки</span><input id="pf-custom-name" aria-label="Название" type="text" maxlength="80" placeholder="Например, мой канал в MAX"></label><label class="pf-field"><span>Ссылка на площадку или правила</span><input id="pf-custom-url" aria-label="Ссылка для регистрации или справки" type="url" maxlength="300" placeholder="https://..."></label></div><button type="button" id="pf-add-channel">Сохранить площадку</button></div>`:''}</div>
      <div class="pf-channel-list">${platformGroups().map(renderPlatformGroup).join('')}</div>`;
    if(settings.removedChannels.length)$('#pf-panel-platforms').insertAdjacentHTML('beforeend',`<label class="pf-field pf-restore"><span>Вернуть стандартную площадку</span><select id="pf-restore-channel"><option value="">Выберите площадку</option>${M.CHANNELS.filter(c=>settings.removedChannels.includes(c.id)).map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</select></label>`);
    if(previousFilter)$('#pf-channel-filter').value=previousFilter;
    $('#pf-panel-sales').innerHTML=`
      <p class="pf-help">Эти значения задаются вручную и используются только для сценарного прогноза.</p>
      <div class="pf-fields-grid">${input('registration','Регистрация из переходов',{unit:'%'})}${input('paidConversion','Первая оплата из регистрации',{unit:'%'})}${input('businessShare','Бизнес среди первых оплат',{unit:'%'})}</div>
      <p class="pf-help" id="pf-buyer-mix"></p>
      <p class="pf-help" id="pf-active-delay" hidden></p>
      <details class="pf-details"><summary>Продления и повышение тарифа</summary><div class="pf-fields-grid">${input('personalRetention','Продлевают: личные',{unit:'%'})}${input('businessRetention','Продлевают: бизнес',{unit:'%'})}${input('personalUpgrade','Повышают тариф: личные',{unit:'%'})}${input('businessUpgrade','Повышают тариф: бизнес',{unit:'%'})}</div><p class="pf-help">Проценты — за месяц. Повышение на одну ступень внутри сегмента. Автоматического перехода с личного тарифа на бизнес нет.</p></details>
      <details class="pf-details"><summary>Срок первой оплаты</summary><label class="pf-check"><input type="checkbox" data-pf-path="paymentDelayEnabled">Учитывать перенос первой оплаты</label><div class="pf-fields-grid">${input('delayShare','Доля первых оплат на следующий месяц',{unit:'%'})}</div><p class="pf-help">По умолчанию первые оплаты учитываются в месяце регистрации. При включении указанная доля переносится на следующий месяц.</p></details>
      <details class="pf-details"><summary>Тарифы и состав первых оплат</summary><p class="pf-help">Первые оплаты делятся на личные и бизнес, затем распределяются по тарифам внутри каждой группы. Доли приводятся к 100%; при всех нулях используется первый тариф группы. <a href="https://syntolk.ru/" target="_blank" rel="noopener">Тарифы Syntolk ↗</a> · проверены 11.10.2026.</p><div class="pf-plan-head"><span>Тариф</span><span>Цена, ₽</span><span>Доля, %</span></div>${M.PLANS.map((p,i)=>`${i===0||i===3?`<div class="pf-segment-label">${i===0?'Личные тарифы':'Для бизнеса'}</div>`:''}<div class="pf-plan-row"><span>${p.name}</span><input data-pf-path="prices.${i}" aria-label="${p.name}: цена в рублях" type="number" inputmode="decimal" min="0" max="1000000" step="any" value="${settings.prices[i]}"><input data-pf-path="mix.${i}" aria-label="${p.name}: доля внутри группы" type="number" inputmode="decimal" min="0" max="100" step="any" value="${settings.mix[i]}"></div>`).join('')}<p class="pf-help" id="pf-mix-summary"></p></details>
      <details class="pf-details"><summary>Доплаты, возвраты и расходы</summary><div class="pf-fields-grid">${input('addon','Доплаты / активного клиента в месяц',{max:1000000,unit:'₽'})}${input('refunds','Возвращено от суммы оплат',{unit:'%'})}${input('monthlyCost','Денежные расходы / месяц',{max:10000000,unit:'₽'})}${input('hourlyCost','Оценка часа вашей работы',{max:100000,unit:'₽'})}</div><p class="pf-help">Бонусный баланс тарифов не считается оплатой. Расходы показаны отдельно от партнёрских начислений.</p></details>`;
    $$('details').forEach(details=>{if(expanded.has(disclosureKey(details)))details.open=true;});
    $('.pf-channel-list').scrollTop=platformScroll;
    syncControls();
  }
  function syncControls() {
    $$('[data-pf-path]').forEach(el=>{if(el.type==='checkbox')el.checked=Boolean(get(el.dataset.pfPath));else el.value=String(get(el.dataset.pfPath));});
    $('#pf-delayShare').disabled=!settings.paymentDelayEnabled;
    platformGroups().forEach(group=>{
      const enabled=group.members.some(c=>settings.channels[c.id].enabled);
      $(`[data-channel-enable="${group.key}"]`).checked=enabled;
      group.members.forEach(c=>{
        const chosen=settings.channels[c.id].formats;
        $$(`[data-channel-format="${c.id}"]`).forEach(el=>{el.checked=chosen.includes(el.value);});
      });
    });
    $('#pf-month').value=String(month);
    filterChannels();
  }
  function filterChannels() {
    const filter=$('#pf-channel-filter').value;
    let enabled=0;
    platformGroups().forEach(group=>{
      const chosen=selectedFormats(group), active=group.members.some(c=>settings.channels[c.id].enabled), card=$(`[data-channel-group="${group.key}"]`);
      if(active)enabled++;
      $(`[data-summary="${group.key}"]`).textContent=active?(chosen.length?chosen.join(' · '):'Форматы не выбраны'):'Не выбрана';
      card.classList.toggle('pf-is-selected',active);
      card.hidden=filter==='selected'?!active:filter!=='all'&&!group.members.some(c=>c.group===filter);
      if(card.hidden&&card.contains(document.activeElement))$('#pf-channel-filter').focus();
    });
    $('#pf-channel-count').textContent=enabled+' из '+platformGroups().length;
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
  function save() {
    root.dataset.currentSettings=JSON.stringify(settings);
    if(!suppressPersist&&canSave){try{localStorage.setItem(KEY,JSON.stringify({version:1,settings,scenario,month}));}catch{canSave=false;}}
    root.dispatchEvent(new CustomEvent('syntolk-calculator-change',{bubbles:true,detail:{settings}}));
  }
  function resetScenario(persist=true) {
    settings=M.newScenario(settings);formatMenuOpen=false;platformMenuOpen=false;channelFormatMenu=null;
    suppressPersist=!persist;
    try { renderControls();$('#pf-channel-filter').value='all';filterChannels();setTab('content');renderResults(); }
    finally { suppressPersist=false; }
  }
  root.addEventListener('syntolk-calculator-load',event=>{
    if(!event.detail?.settings)return;
    settings=M.normalize(event.detail.settings);
    renderControls();setTab(tab);renderResults();
  });
  root.addEventListener('syntolk-calculator-reset',event=>resetScenario(event.detail?.persist!==false));
  function cellTable(headings,rows,caption) {
    return `<div class="pf-table-scroll" tabindex="0" role="region" aria-label="${caption}"><table class="pf-table"><caption class="sr-only">${caption}</caption><thead><tr>${headings.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map((v,i)=>i===0?`<th scope="row">${v}</th>`:`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function renderResults() {
    results=Object.fromEntries(Object.keys(M.SCENARIOS).map(id=>[id,M.forecast(settings,id)]));
    month=Math.min(month,settings.forecastMonths);
    const result=results[scenario], visibleMonths=result.months.slice(0,settings.forecastMonths), current=result.months[month-1], year=visibleMonths.at(-1), work=result.work;
    $('#pf-horizon').value=String(settings.forecastMonths);
    $('#pf-month').innerHTML=visibleMonths.map(m=>`<option value="${m.month}"${m.month===month?' selected':''}>${m.month}</option>`).join('');
    $('#pf-total-label').textContent='Всего за '+settings.forecastMonths+' мес.';
    $('#pf-hours-label').textContent='Работы за '+settings.forecastMonths+' мес.';
    const activeChannels=platformGroups().filter(group=>group.members.some(c=>settings.channels[c.id].enabled)).map(group=>group.name);
    const buyerMix='Личные — '+number.format(100-settings.businessShare)+'%, бизнес — '+number.format(settings.businessShare)+'% первых оплат.';
    const delayNote=settings.paymentDelayEnabled&&settings.delayShare>0?'Перенос на следующий месяц: '+number.format(settings.delayShare)+'% первых оплат.':'';
    $('#pf-buyer-mix').textContent=buyerMix;
    $('#pf-active-delay').textContent=delayNote;$('#pf-active-delay').hidden=!delayNote;
    $('#pf-quick-assumptions').textContent='Площадки: '+(activeChannels.join(', ')||'не выбраны')+'. Материалы в неделю: '+visibleFormats().map(f=>f.name.toLowerCase()+' — '+frequencyNumber.format(settings.frequency[f.id])).join('; ')+'. Регистрация из переходов: '+number.format(settings.registration)+'%. Первая оплата из регистрации: '+number.format(settings.paidConversion)+'%. '+buyerMix+(delayNote?' '+delayNote:'')+' Время по плану: '+number.format(work.hours)+' ч/неделю из доступных '+number.format(settings.budgetHours)+' ч. Остальные условия — в полном калькуляторе.';
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
    const orphan=work.unplaced.map(id=>formats().find(f=>f.id===id).name.toLowerCase());
    $('#pf-unplaced').hidden=!orphan.length;
    $('#pf-unplaced').textContent=orphan.length?'Не выбраны площадки для форматов: '+orphan.join(', ')+'. Время на создание учтено, просмотров нет.':'';
    const viralEnabled=settings.channels[settings.viralChannel]?.formats.includes('short')&&settings.frequency.short>0&&settings.stopAfter>0;
    $('#pf-viral-note').textContent=settings.viralViews>0&&!viralEnabled?'Всплеск не учтён: добавьте выпуск коротких видео и включите выбранную площадку.':'Дополнительные просмотры одного из ваших коротких роликов. По умолчанию всплеска нет.';
    const peak=Math.max(1,...visibleMonths.map(m=>m.reward));
    $('#pf-chart').setAttribute('aria-label','Начисления за каждый из '+settings.forecastMonths+' месяцев');
    $('#pf-chart').style.setProperty('--pf-months',String(settings.forecastMonths));
    $('#pf-chart').innerHTML=visibleMonths.map(m=>`<button type="button" class="pf-chart-month${month===m.month?' pf-active-month':''}" data-month="${m.month}" tabindex="${month===m.month?0:-1}" aria-pressed="${month===m.month}" aria-label="Месяц ${m.month}: ${money(m.reward)}"><span class="pf-chart-track"><span style="--pf-bar:${m.reward?Math.max(2,m.reward/peak*100):0}%"></span></span><span>${m.month}</span></button>`).join('');
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
    $('#pf-new-personal').textContent=count(current.newPersonal);
    $('#pf-new-business').textContent=count(current.newBusiness);
    $('#pf-upgrades').textContent=count(current.upgrades.reduce((a,b)=>a+b,0));
    $('#pf-churned').textContent=count(current.churned);
    $('#pf-plan-output').innerHTML=cellTable(['Тариф','Активных','Повысили до'],M.PLANS.map((p,i)=>[p.name+'<small>'+money(settings.prices[i])+'/мес.</small>',count(current.byPlan[i]),count(current.upgrades[i])]),'Состав клиентов в выбранном месяце');
    const contributing=current.channels.filter(c=>c.views>0||c.active>0);
    $('#pf-channel-output').innerHTML=contributing.length?cellTable(['Площадка','Переходы','Активных','Начислено'],contributing.map(c=>[escape(c.name),count(c.clicks),count(c.active),money(c.reward)]),'Вклад площадок в выбранном месяце'):'<p class="pf-help">Выберите площадки и добавьте публикации, чтобы увидеть их вклад.</p>';
    $('#pf-cohort-output').innerHTML=current.cohorts.length?cellTable(['Первая оплата','Активных сейчас','Начислено'],current.cohorts.map(c=>[c.month+'-й месяц',count(c.active),money(c.reward)]),'Группы клиентов по месяцу первой оплаты'):'<p class="pf-help">В этом сценарии оплат пока нет.</p>';
    $('#pf-monthly-output').innerHTML=cellTable(['Месяц','Просмотры','Переходы','Регистрации','Первые оплаты','Активных','Первые начисления','Продления','Всего за месяц','Накоплено'],visibleMonths.map(m=>[m.month,integer.format(m.views),integer.format(m.clicks),count(m.registrations),count(m.newPaid),count(m.active),money(m.newReward),money(m.repeatReward),money(m.reward),money(m.cumulative)]),'Помесячный сценарий');
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
    const path=el.dataset.pfPath;
    set(path,entered);settings=M.normalize(settings);
    const applied=get(path);
    // Keep a clamped value visible immediately, but do not interrupt a valid edit.
    if(applied!==entered)el.value=String(applied);
    renderResults();
  });
  root.addEventListener('change',event=>{
    const el=event.target;
    if(el.id==='pf-channel-filter'){filterChannels();return;}
    if(el.id==='pf-horizon'){settings.forecastMonths=Number(el.value);renderResults();return;}
    if(el.id==='pf-month'){month=Number(el.value);renderResults();return;}
    if(el.id==='pf-restore-channel'){settings.removedChannels=settings.removedChannels.filter(id=>id!==el.value);settings=M.normalize(settings);renderControls();setTab('platforms');renderResults();return;}
    if(el.id==='pf-restore-format'){settings.removedFormats=settings.removedFormats.filter(id=>id!==el.value);settings=M.normalize(settings);renderControls();setTab('content');renderResults();return;}
    if(el.dataset.formatName){
      const id=el.dataset.formatName,name=el.value.trim();if(!name){el.reportValidity();return;}
      const custom=settings.customFormats.find(f=>f.id===id);
      if(custom)custom.name=name;else settings.formatOverrides[id]={name};
      settings=M.normalize(settings);renderControls();setTab('content');renderResults();return;
    }
    if(el.dataset.channelName||el.dataset.channelUrl){
      const id=el.dataset.channelName||el.dataset.channelUrl,channel=channels().find(c=>c.id===id);
      const name=el.dataset.channelName?el.value.trim():channel.name,url=el.dataset.channelUrl?el.value.trim():channel.url;
      if(!name){el.value=channel.name;return;}
      if(url){try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error();}catch{el.setCustomValidity('Укажите полную ссылку с https://');el.reportValidity();return;}}
      el.setCustomValidity('');const custom=settings.customChannels.find(c=>c.id===id);
      if(custom){custom.name=name;custom.url=url;}else settings.channelOverrides[id]={name,url};
      settings=M.normalize(settings);renderControls();setTab('platforms');$(`[data-channel="${id}"]`).open=true;renderResults();return;
    }
    if(el.dataset.pfPath){
      set(el.dataset.pfPath,el.type==='checkbox'?el.checked:el.tagName==='SELECT'&&el.dataset.pfPath==='viralChannel'?el.value:Number(el.value));
      settings=M.normalize(settings);syncControls();renderResults();return;
    }
    const enable=el.dataset.channelEnable, format=el.dataset.channelFormat;
    if(enable){
      const group=platformGroups().find(item=>item.key===enable);
      if(group)group.members.forEach(c=>{settings.channels[c.id].enabled=el.checked;});
      else if(settings.channels[enable])settings.channels[enable].enabled=el.checked;
    }
    if(format){const c=channels().find(c=>c.id===format);settings.channels[format].formats=c.formats.filter(f=>f===el.value?el.checked:settings.channels[format].formats.includes(f));}
    if(enable||format){syncControls();renderResults();}
  });
  root.addEventListener('click',event=>{
    const button=event.target.closest('button,a');if(!button)return;
    if(button.id==='pf-mode-toggle'){setMobileMode(!mobileExpanded);return;}
    if(button.id==='pf-format-menu-toggle'){
      formatMenuOpen=!formatMenuOpen;renderControls();setTab('content');if(formatMenuOpen)$('#pf-format-name')?.focus();return;
    }
    if(button.id==='pf-format-menu-close'){
      formatMenuOpen=false;renderControls();setTab('content');return;
    }
    if(button.id==='pf-platform-menu-toggle'){
      platformMenuOpen=!platformMenuOpen;renderControls();setTab('platforms');if(platformMenuOpen)$('#pf-custom-name')?.focus();return;
    }
    if(button.id==='pf-platform-menu-close'){
      platformMenuOpen=false;renderControls();setTab('platforms');return;
    }
    if(button.dataset.pfTab){setTab(button.dataset.pfTab);return;}
    if(button.dataset.scenario){scenario=button.dataset.scenario;renderResults();return;}
    if(button.dataset.month){month=Number(button.dataset.month);renderResults();$(`[data-month="${month}"]`).focus();return;}
    if(button.dataset.channelFormatMenu){
      channelFormatMenu=channelFormatMenu===button.dataset.channelFormatMenu?null:button.dataset.channelFormatMenu;
      renderControls();setTab('platforms');
      const group=platformGroups().find(item=>item.members.some(c=>c.id===channelFormatMenu));
      const card=group&&$(`[data-channel-group="${group.key}"]`);
      if(card){card.open=true;}
      if(channelFormatMenu)$(`[data-channel-format-name="${channelFormatMenu}"]`)?.focus();
      return;
    }
    if(button.dataset.channelFormatSave){
      const channelId=button.dataset.channelFormatSave,channel=channels().find(c=>c.id===channelId),name=$(`[data-channel-format-name="${channelId}"]`)?.value.trim();
      if(!channel||!name){$(`[data-channel-format-name="${channelId}"]`)?.focus();return;}
      if(settings.customFormats.length>=15){$('#pf-live').textContent='Можно добавить до 15 собственных форматов.';return;}
      const id=newId('format-'),minutes=Number($(`[data-channel-format-time="${channelId}"]`)?.value)||30,count=Number($(`[data-channel-format-count="${channelId}"]`)?.value)||0,base=channelFormatBase(channel);
      settings.customFormats.push({id,name,base,channelId,minutes});
      settings.frequency[id]=count;settings.minutes[id]=minutes;
      settings.channels[channelId].formats=[...new Set([...settings.channels[channelId].formats,id])];
      const customChannel=settings.customChannels.find(c=>c.id===channelId);
      if(customChannel)customChannel.formats=[...new Set([...(customChannel.formats||[]),id])];
      settings=M.normalize(settings);channelFormatMenu=null;renderControls();setTab('platforms');
      const group=platformGroups().find(item=>item.members.some(c=>c.id===channelId)),card=group&&$(`[data-channel-group="${group.key}"]`);
      if(card){card.open=true;const variants=card.querySelector('.pf-channel-variants');if(variants)variants.open=true;const source=card.querySelector(`[data-channel="${channelId}"]`);if(source?.tagName==='DETAILS')source.open=true;}
      renderResults();return;
    }
    if(button.id==='pf-add-channel'){
      const name=$('#pf-custom-name').value.trim(),url=$('#pf-custom-url').value.trim();
      $('#pf-custom-url').setCustomValidity('');
      if(!name){$('#pf-custom-name').focus();return;}
      let validUrl=true;try{if(url){const parsed=new URL(url);validUrl=['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password;}}catch{validUrl=false;}
      if(!validUrl){$('#pf-custom-url').setCustomValidity('Укажите полную ссылку с https://');$('#pf-custom-url').reportValidity();return;}
      if(settings.customChannels.length>=30){$('#pf-live').textContent='Можно добавить до 30 собственных площадок.';return;}
      const id=newId('custom-');
      settings.customChannels=[...(settings.customChannels||[]),{id,name,url,formats:visibleFormats().map(f=>f.id),views:250,ctr:1,note:''}];
      settings.channels[id]={enabled:true,formats:formats().filter(f=>settings.frequency[f.id]>0).map(f=>f.id),views:250,ctr:1};
      settings=M.normalize(settings);platformMenuOpen=false;renderControls();setTab('platforms');renderResults();return;
    }
    if(button.dataset.removeChannel){
      const id=button.dataset.removeChannel;
      if(M.CHANNELS.some(c=>c.id===id))settings.removedChannels.push(id);
      else settings.customChannels=(settings.customChannels||[]).filter(c=>c.id!==id);
      delete settings.channels[id];
      settings=M.normalize(settings);renderControls();setTab('platforms');renderResults();return;
    }
    if(button.id==='pf-add-format'){
      const name=$('#pf-format-name').value.trim();if(!name){$('#pf-format-name').focus();return;}
      if(settings.customFormats.length>=15){$('#pf-live').textContent='Можно добавить до 15 собственных форматов.';return;}
      const id=newId('format-'),base='post';
      settings.customFormats.push({id,name,base,minutes:Number($('#pf-format-time').value)||30});
      settings.frequency[id]=Number($('#pf-format-count').value)||0;settings.minutes[id]=Number($('#pf-format-time').value)||30;
      channels().forEach(c=>{if(c.formats.includes(base)&&settings.channels[c.id].formats.length)settings.channels[c.id].formats.push(id);});
      settings=M.normalize(settings);formatMenuOpen=false;renderControls();setTab('content');renderResults();return;
    }
    if(button.dataset.removeFormat){
      const id=button.dataset.removeFormat;
      if(M.FORMATS.some(f=>f.id===id))settings.removedFormats.push(id);else settings.customFormats=settings.customFormats.filter(f=>f.id!==id);
      settings=M.normalize(settings);renderControls();setTab('content');renderResults();return;
    }
    if(button.id==='pf-fit'){settings=M.fitBudget(settings);syncControls();renderResults();return;}
    if(button.id==='pf-reset'){
      const event=new CustomEvent('syntolk-calculator-create-scenario',{bubbles:true,cancelable:true});
      if(!root.dispatchEvent(event))return;
      resetScenario();return;
    }
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
      event.preventDefault();month=event.key==='Home'?1:event.key==='End'?settings.forecastMonths:Math.max(1,Math.min(settings.forecastMonths,month+(event.key==='ArrowRight'?1:-1)));
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
