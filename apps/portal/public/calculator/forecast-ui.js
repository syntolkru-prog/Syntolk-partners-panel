(() => {
  'use strict';
  const root=document.getElementById('partner-forecast'), M=globalThis.SyntolkForecast;
  if(!root||!M)return;
  const KEY=root.dataset.storageKey||'syntolk-partner-forecast-v1';
  let settings=M.newScenario(), scenario='base', month=3, tab='content', results;
  let canSave=true, statusTimer, mobileExpanded=false, formatMenuOpen=false, platformMenuOpen=false, channelFormatMenu=null, suppressPersist=false;
  let facts=null, factViews={}, factStorageKey='', factCatalog='';
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
  const isFact=()=>facts?.active===true;
  const metric=(dimension,id)=>facts?.report?.breakdown?.[dimension]?.find(row=>row.id===id);
  const augment=(base,rows,kind)=>{
    const result=[...base];
    for(const row of rows??[])if(!result.some(item=>item.id===row.id))result.push(kind==='format'?{id:row.id,name:row.name,base:'post'}:{id:row.id,name:row.name,url:'',note:'',group:'custom',formats:row.formats?.map(item=>item.id)??[]});
    return result;
  };
  const channels=()=>isFact()?augment(M.allChannels(settings),facts.report?.breakdown?.platforms,'platform').map(c=>({...c,formats:[...new Set([...c.formats,...metric('platforms',c.id)?.formats?.map(f=>f.id)??[]])]})):M.allChannels(settings);
  const formats=()=>isFact()?augment(M.allFormats(settings),facts.report?.breakdown?.formats,'format'):M.allFormats(settings);
  const channelState=id=>isFact()?{enabled:!!metric('platforms',id),formats:metric('platforms',id)?.formats?.map(row=>row.id)??[]}:settings.channels[id];
  const visibleFormats=()=>formats();
  const newId=prefix=>prefix+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  const formatIcons={
    post:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    short:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="m10 8 5 4-5 4Z"/>',
    long:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/>',
    article:'<path d="M14 3H5v18h14V8Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
    circle:'<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4Z"/>'
  };
  const get=path=>{
    if(!isFact())return path.split('.').reduce((v,k)=>v[k],settings);
    if(path.startsWith('frequency.'))return facts.report?metric('formats',path.slice(10))?.content.preparedMaterials??0:null;
    const channel=/^channels\.(.+)\.(views|ctr)$/.exec(path);
    if(channel){const value=factViews[channel[1]];return channel[2]==='views'?value??null:value>0&&facts.report?Math.round((metric('platforms',channel[1])?.counts.clicks??0)/value*10000)/100:null;}
    const rate=path==='registration'?facts.report?.conversions.clickToRegistration:path==='paidConversion'?facts.report?.conversions.registrationToPayment:null;
    return rate==null?null:Math.round(rate*10000)/100;
  };
  function set(path,value) {
    const keys=path.split('.'), last=keys.pop();
    keys.reduce((v,k)=>v[k],settings)[last]=value;
  }
  function input(path,label,{min=0,max=100,unit='',hint='',ariaLabel='',idPrefix='pf-'}={}) {
    const id=idPrefix+path.replaceAll('.','-');
    const manual=isFact()&&/^channels\..+\.views$/.test(path);
    return `<label class="pf-field" for="${id}"><span>${escape(label)}</span><span class="pf-input-wrap"><input id="${id}" ${isFact()?`data-fact-path="${escape(path)}"${manual?'':' readonly'}`:`data-pf-path="${path}"`}${ariaLabel?` aria-label="${escape(ariaLabel)}"`:''} type="number" inputmode="decimal" min="${min}"${isFact()?'':` max="${max}"`} step="any" value="${get(path)??''}"${isFact()?' placeholder="—"':''}>${unit?`<span aria-hidden="true">${unit}</span>`:''}</span>${hint?`<small>${hint}</small>`:''}</label>`;
  }
  function select(path,label,options,prefix='pf-') {
    const id=prefix+path.replaceAll('.','-');
    return `<label class="pf-field" for="${id}"><span>${escape(label)}</span><select id="${id}" data-pf-path="${path}"${isFact()?' disabled':''}>${options.map(([value,name])=>`<option value="${value}"${String(get(path))===String(value)?' selected':''}>${escape(name)}</option>`).join('')}</select></label>`;
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
    return [...new Set(group.members.flatMap(c=>channelState(c.id).formats))]
      .map(id=>formats().find(f=>f.id===id)?.name).filter(Boolean);
  }
  function platformSourceSettings(c,nested){
    const state=channelState(c.id),row=metric('platforms',c.id);
    const details=isFact()?`Размещено: ${row?.content.publishedPlacements??0}. Регистрации: ${row?.counts.registrations??0}. Оплаты: ${row?.counts.paymentCount??0}. Регистрация из переходов: ${factRate(row?.conversions.clickToRegistration)}. Оплата из регистраций: ${factRate(row?.conversions.registrationToPayment)}. Просмотры вводятся вручную за весь выбранный период.`:escape(c.note);
    const identity=isFact()?`<label class="pf-field"><span>Размещено</span><input type="number" readonly data-fact-count="${escape(c.id)}:placements" aria-label="${escape(c.name)}: фактические размещения" value="${facts.report?row?.content.publishedPlacements??0:''}" placeholder="—"></label><label class="pf-field"><span>Переходы</span><input type="number" readonly data-fact-count="${escape(c.id)}:clicks" aria-label="${escape(c.name)}: фактические переходы" value="${facts.report?row?.counts.clicks??0:''}" placeholder="—"></label>`:`<label class="pf-field"><span>Название</span><input type="text" maxlength="80" data-channel-name="${c.id}" aria-label="Название площадки ${escape(c.name)}" value="${escape(c.name)}"></label><label class="pf-field"><span>Ссылка на площадку</span><input type="url" maxlength="300" data-channel-url="${c.id}" aria-label="Ссылка площадки ${escape(c.name)}" value="${escape(c.url||'')}"></label>`;
    const body=`<div class="pf-fields-grid">${identity}</div><div class="pf-fields-grid">${input('channels.'+c.id+'.views',isFact()?'Просмотры за период':'Просмотры / размещение',{max:1000000})}${input('channels.'+c.id+'.ctr','Переходы из просмотров',{unit:'%'})}</div><p class="pf-help" data-source-help="${escape(c.id)}">${details}${c.url?` <a href="${escape(c.url)}" target="_blank" rel="noopener">О площадке ↗</a>`:''}</p><button class="pf-remove-platform" type="button" data-remove-channel="${c.id}"${isFact()?' disabled':''}>Убрать площадку из сценария</button>`;
    return nested?`<details class="pf-channel pf-channel-variant" data-channel="${c.id}"><summary><span>${escape(c.name)}</span><span class="pf-channel-summary">${state.formats.length?state.formats.map(id=>formats().find(f=>f.id===id)?.name).filter(Boolean).join(' · '):'Форматы не выбраны'}</span></summary><div class="pf-channel-body">${body}</div></details>`:`<div class="pf-channel-source" data-channel="${c.id}">${body}</div>`;
  }
  function channelFormatBase(c){
    const ids=channelState(c.id)?.formats||[];
    const candidate=[...ids,...c.formats].map(id=>formats().find(f=>f.id===id)).find(f=>f&&M.FORMATS.some(base=>base.id===f.base));
    return candidate?.base||'post';
  }
  function primaryChannel(group){
    return group.members[0];
  }
  function channelFormatControl(group){
    const c=primaryChannel(group);
    const open=channelFormatMenu===c.id;
    return `<div class="pf-channel-format-add"><button type="button" class="pf-channel-add-format" data-channel-format-menu="${escape(c.id)}" aria-expanded="${open?'true':'false'}" aria-label="${open?'Закрыть форму добавления формата':'Добавить свой формат для '+escape(c.name)}" title="${open?'Закрыть форму':'Добавить свой формат'}">${open?'×':'+'}</button>${open?`<div class="pf-channel-format-menu"><strong>Свой формат для ${escape(c.name)}</strong><div class="pf-fields-grid"><label class="pf-field"><span>Название формата</span><input type="text" maxlength="80" data-channel-format-name="${escape(c.id)}" placeholder="Например, сообщение в группе"></label><label class="pf-field"><span>Материалов в неделю</span><input type="number" min="0" max="35" step="any" data-channel-format-count="${escape(c.id)}" value="1"></label></div><button type="button" data-channel-format-save="${escape(c.id)}">Сохранить формат</button></div>`:''}</div>`;
  }
  function renderPlatformGroup(group){
    const enabled=group.members.some(c=>channelState(c.id).enabled),chosen=selectedFormats(group);
    const formatOptions=group.members.flatMap(c=>c.formats.filter(id=>formats().some(f=>f.id===id)).map(id=>{const measured=metric('platforms',c.id)?.formats?.find(row=>row.id===id);return `<label class="pf-check"${isFact()?` title="${measured?.counts.clicks??0} переходов; ${measured?.counts.registrations??0} регистраций; регистрация из переходов ${factRate(measured?.conversions.clickToRegistration)}"`:''}><input type="checkbox" data-channel-format="${c.id}" value="${id}"${channelState(c.id).formats.includes(id)?' checked':''}${isFact()?' disabled':''}>${escape(formats().find(f=>f.id===id).name)}</label>`;}));
    const sources=group.members.length===1?platformSourceSettings(group.members[0],false):`<details class="pf-channel-variants"><summary>Настройки источников расчёта</summary>${group.members.map(c=>platformSourceSettings(c,true)).join('')}</details>`;
    const formatAdders=`<div class="pf-channel-format-adders">${channelFormatControl(group)}</div>`;
    return `<details class="pf-channel pf-channel-group" data-channel-group="${escape(group.key)}"${group.members.length===1?` data-channel="${group.members[0].id}"`:''}><summary><span>${escape(group.name)}</span><span class="pf-channel-summary" data-summary="${escape(group.key)}">${enabled?(chosen.length?chosen.join(' · '):'Форматы не выбраны'):'Не выбрана'}</span></summary><div class="pf-channel-body"><label class="pf-check pf-enable"><input type="checkbox" data-channel-enable="${escape(group.key)}"${enabled?' checked':''}>Использовать площадку</label><div class="pf-format-checks">${formatOptions.join('')}</div>${formatAdders}${sources}</div></details>`;
  }
  function renderControls() {
    const previousFilter=$('#pf-channel-filter')?.value;
    const expanded=new Set($$('details[open]').map(disclosureKey));
    const platformScroll=$('.pf-channel-list')?.scrollTop||0;
    $('#pf-panel-content').innerHTML=`
      <div class="pf-row-head"><span>Оригинальные материалы</span><span>В неделю</span></div>
      <div class="pf-format-list">${visibleFormats().map(f=>`<div id="pf-format-${f.id}" class="pf-format-item"><details id="pf-format-settings-${f.id}" class="pf-format-edit"><summary aria-label="Название и удаление формата ${escape(f.name)}" title="Название и удаление формата"><span class="pf-format-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${formatIcons[f.base]||formatIcons.post}</svg></span><span class="pf-format-title">${escape(f.name)}</span></summary><div class="pf-format-edit-body"><label class="pf-field"><span>Название формата</span><input type="text" maxlength="80" aria-label="Название формата ${escape(f.name)}" data-format-name="${f.id}" value="${escape(f.name)}"></label><button class="pf-remove-platform" type="button" data-remove-format="${f.id}">Убрать формат из сценария</button></div></details><input class="pf-format-frequency" id="pf-frequency-${f.id}" aria-label="${escape(f.name)}: оригиналов в неделю" data-pf-path="frequency.${f.id}" type="number" min="0" max="35" step="any" inputmode="decimal" value="${settings.frequency[f.id]}"></div>`).join('')}</div>
      <div class="pf-custom-form"><button type="button" id="pf-format-menu-toggle" aria-expanded="${formatMenuOpen?'true':'false'}" aria-controls="pf-format-menu">${formatMenuOpen?'Скрыть форму':'Добавить формат'}</button>${formatMenuOpen?`<div id="pf-format-menu" class="pf-format-menu"><div class="pf-format-menu-head"><strong>Новый формат</strong><button type="button" id="pf-format-menu-close" class="pf-format-menu-close" aria-label="Закрыть форму добавления формата">Закрыть</button></div><div class="pf-fields-grid"><label class="pf-field pf-custom-name"><span>Название нового формата</span><input id="pf-format-name" maxlength="80" placeholder="Например, мой формат"></label><label class="pf-field"><span>Материалов в неделю</span><input id="pf-format-count" type="number" min="0" max="35" step="any" value="1"></label></div><button type="button" id="pf-add-format">Сохранить формат</button></div>`:''}</div>
      ${settings.removedFormats.length?`<label class="pf-field pf-restore"><span>Вернуть стандартный формат</span><select id="pf-restore-format"><option value="">Выберите формат</option>${M.FORMATS.filter(f=>settings.removedFormats.includes(f.id)).map(f=>`<option value="${f.id}">${f.name}</option>`).join('')}</select></label>`:''}
      <p class="pf-help pf-full-only">0,25 в неделю ≈ один материал в месяц. Копии для других площадок здесь не прибавляйте.</p>
      <details class="pf-details pf-more-settings pf-full-only" id="pf-more-settings"><summary>Рост и другие условия</summary>
      <details class="pf-details"><summary>Старый контент и рост просмотров</summary><div class="pf-fields-grid">${input('growth','Прирост просмотров / месяц',{max:30,unit:'%',hint:'Новые материалы; рост ограничен ×3.'})}${visibleFormats().map(f=>input('tail.'+f.id,'Хвост: '+f.name.toLowerCase(),{max:95,unit:'%'})).join('')}${select('stopAfter','Выпускать новые материалы',[[0,'Не выпускать'],...Array.from({length:12},(_,i)=>[i+1,'Первые '+(i+1)+' мес.'])])}</div><p class="pf-help">Хвост 35%: в следующем месяце — 35% стартовых просмотров, затем 12,25%. После остановки публикаций сохраняются просмотры старого контента и продления.</p></details>
      <details class="pf-details"><summary>А если один ролик наберёт больше?</summary><div class="pf-fields-grid">${input('viralViews','Дополнительные просмотры',{max:10000000})}${select('viralMonth','В каком месяце',Array.from({length:12},(_,i)=>[i+1,i+1]))}${select('viralChannel','На какой площадке',channels().filter(c=>c.formats.includes('short')).map(c=>[c.id,c.name]))}</div><p class="pf-help" id="pf-viral-note">По умолчанию всплеска нет.</p></details></details>`;
    $('#pf-panel-platforms').innerHTML=`
      <div class="pf-platform-tools"><label for="pf-channel-filter" class="sr-only">Показать площадки</label><select id="pf-channel-filter"><option value="matching">Под мой контент</option><option value="selected">Выбранные площадки</option><option value="all">Все площадки</option><option value="social">Соцсети и мессенджеры</option><option value="video">Видеоплощадки</option><option value="expert">Экспертные блоги</option><option value="owned">Свои площадки и СМИ</option><option value="custom">Добавленные мной</option></select><button type="button" id="pf-select-matching" aria-label="Выбрать все подходящие площадки">Выбрать все</button><span id="pf-channel-count"></span></div>
      <p class="pf-help" id="pf-matching-empty" hidden></p>
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
      <details class="pf-details"><summary>Доплаты, возвраты и расходы</summary><div class="pf-fields-grid">${input('addon','Доплаты / активного клиента в месяц',{max:1000000,unit:'₽'})}${input('refunds','Возвращено от суммы оплат',{unit:'%'})}${input('monthlyCost','Денежные расходы / месяц',{max:10000000,unit:'₽'})}</div><p class="pf-help">Бонусный баланс тарифов не считается оплатой. Расходы показаны отдельно от партнёрских начислений.</p></details>`;
    $$('details').forEach(details=>{if(expanded.has(disclosureKey(details)))details.open=true;});
    $('.pf-channel-list').scrollTop=platformScroll;
    syncControls();
  }
  function syncControls() {
    $$('[data-pf-path],[data-fact-path]').forEach(el=>{if(el===document.activeElement&&el.dataset.factPath?.endsWith('.views'))return;const value=get(el.dataset.factPath||el.dataset.pfPath);if(el.type==='checkbox')el.checked=Boolean(value);else el.value=value==null?'':String(value);});
    $('#pf-delayShare').disabled=isFact()||!settings.paymentDelayEnabled;
    platformGroups().forEach(group=>{
      const enabled=group.members.some(c=>channelState(c.id).enabled);
      $(`[data-channel-enable="${group.key}"]`).checked=enabled;
      group.members.forEach(c=>{
        const chosen=channelState(c.id).formats;
        $$(`[data-channel-format="${c.id}"]`).forEach(el=>{el.checked=chosen.includes(el.value);});
      });
    });
    if(!isFact())$('#pf-month').value=String(month);
    if(isFact())decorateFacts();
    filterChannels();
  }
  function filterChannels() {
    const filter=$('#pf-channel-filter').value;
    const activeFormats=formats().filter(format=>isFact()?!!metric('formats',format.id):settings.frequency[format.id]>0);
    let enabled=0,visible=0;
    platformGroups().forEach(group=>{
      const chosen=selectedFormats(group), active=group.members.some(c=>channelState(c.id).enabled), card=$(`[data-channel-group="${group.key}"]`);
      if(active)enabled++;
      $(`[data-summary="${group.key}"]`).textContent=active?(chosen.length?chosen.join(' · '):'Форматы не выбраны'):'Не выбрана';
      card.classList.toggle('pf-is-selected',active);
      const matching=isFact()?active:group.members.some(c=>c.formats.some(id=>settings.frequency[id]>0));
      card.hidden=filter==='matching'?!matching:filter==='selected'?!active:filter!=='all'&&!group.members.some(c=>c.group===filter);
      if(!card.hidden)visible++;
      card.querySelectorAll('[data-channel-format]').forEach(input=>{input.closest('label').hidden=isFact()?!channelState(input.dataset.channelFormat).formats.includes(input.value):activeFormats.length>0&&settings.frequency[input.value]<=0;});
      if(card.hidden&&card.contains(document.activeElement))$('#pf-channel-filter').focus();
    });
    $('#pf-channel-count').textContent=enabled+' из '+platformGroups().length;
    $('#pf-select-matching').disabled=isFact()||!activeFormats.length;
    $('#pf-matching-empty').hidden=visible>0;
    $('#pf-matching-empty').textContent=isFact()?'В выбранном периоде и сценарии действий на площадках нет.':activeFormats.length?'Подходящих площадок нет. Добавьте свою площадку.':'Укажите количество материалов во вкладке «Контент».';
  }
  function setTab(next,focus=false) {
    if(!['content','platforms','sales'].includes(next))return;
    if(next==='platforms')filterChannels();
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
    try { renderControls();$('#pf-channel-filter').value='matching';filterChannels();setTab('content');renderResults(); }
    finally { suppressPersist=false; }
  }
  root.addEventListener('syntolk-calculator-load',event=>{
    if(!event.detail?.settings)return;
    settings=M.normalize(event.detail.settings);
    renderControls();setTab(tab);renderResults();
  });
  root.addEventListener('syntolk-calculator-reset',event=>resetScenario(event.detail?.persist!==false));
  function renderResults() {
    if(isFact()){renderFacts();return;}
    restoreForecastLabels();
    results=Object.fromEntries(Object.keys(M.SCENARIOS).map(id=>[id,M.forecast(settings,id)]));
    month=Math.min(month,settings.forecastMonths);
    const result=results[scenario], visibleMonths=result.months.slice(0,settings.forecastMonths), current=result.months[month-1], year=visibleMonths.at(-1), work=result.work;
    $('#pf-horizon').value=String(settings.forecastMonths);
    $('#pf-month').innerHTML=visibleMonths.map(m=>`<option value="${m.month}"${m.month===month?' selected':''}>${m.month}</option>`).join('');
    $('#pf-total-label').textContent='Всего за '+settings.forecastMonths+' мес.';
    const activeChannels=platformGroups().filter(group=>group.members.some(c=>settings.channels[c.id].enabled)).map(group=>group.name);
    const buyerMix='Личные — '+number.format(100-settings.businessShare)+'%, бизнес — '+number.format(settings.businessShare)+'% первых оплат.';
    const delayNote=settings.paymentDelayEnabled&&settings.delayShare>0?'Перенос на следующий месяц: '+number.format(settings.delayShare)+'% первых оплат.':'';
    $('#pf-buyer-mix').textContent=buyerMix;
    $('#pf-active-delay').textContent=delayNote;$('#pf-active-delay').hidden=!delayNote;
    $('#pf-quick-assumptions').textContent='Площадки: '+(activeChannels.join(', ')||'не выбраны')+'. Материалы в неделю: '+visibleFormats().map(f=>f.name.toLowerCase()+' — '+frequencyNumber.format(settings.frequency[f.id])).join('; ')+'. Регистрация из переходов: '+number.format(settings.registration)+'%. Первая оплата из регистрации: '+number.format(settings.paidConversion)+'%. '+buyerMix+(delayNote?' '+delayNote:'')+' Остальные условия — в полном калькуляторе.';
    $('#pf-quick-scenario').textContent=M.SCENARIOS[scenario].name+' · комиссия 20%';
    $$('[data-scenario]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.scenario===scenario)));
    const sc=M.SCENARIOS[scenario];
    $('#pf-scenario-note').textContent=$('[data-current-values]')?'Прогноз по вашему плану публикаций, не фактический заработок.':`К вашим значениям: просмотры ×${number.format(sc.views)}, регистрации ×${number.format(sc.registration)}, оплаты из регистраций ×${number.format(sc.payment)}. Удержание и цены одинаковы.`;
    $('#pf-income-label').textContent=($('[data-current-values]')?'Прогноз за ':'Начисления за ')+month+'-й месяц';
    $('#pf-income').textContent=money(current.reward);
    $('#pf-income-range').textContent='Другие сценарии: '+money(results.low.months[month-1].reward)+' — '+money(results.high.months[month-1].reward);
    $('#pf-year').textContent=money(year.cumulative);
    $('#pf-cumulative').textContent=money(current.cumulative);
    $('#pf-work').innerHTML=`<div><strong>${number.format(work.originals)} оригинала / неделю</strong></div><div><strong>${number.format(work.placements)} размещений / неделю</strong></div>`;
    const viralEnabled=settings.channels[settings.viralChannel]?.formats.includes('short')&&settings.frequency.short>0&&settings.stopAfter>0;
    $('#pf-viral-note').textContent=settings.viralViews>0&&!viralEnabled?'Всплеск не учтён: добавьте выпуск коротких видео и включите выбранную площадку.':'Дополнительные просмотры одного из ваших коротких роликов. По умолчанию всплеска нет.';
    const peak=Math.max(1,...visibleMonths.map(m=>m.reward));
    $('#pf-chart-hint').textContent=visibleMonths.some(m=>m.reward>0)?'Нажмите на столбец':'Все месяцы — 0 ₽';
    $('#pf-chart').setAttribute('aria-label','Начисления за каждый из '+settings.forecastMonths+' месяцев');
    $('#pf-chart').style.setProperty('--pf-months',String(settings.forecastMonths));
    $('#pf-chart').innerHTML=visibleMonths.map(m=>`<button type="button" class="pf-chart-month${month===m.month?' pf-active-month':''}" data-month="${m.month}" tabindex="${month===m.month?0:-1}" aria-pressed="${month===m.month}" aria-label="Месяц ${m.month}: ${money(m.reward)}"><span class="pf-chart-track"><span style="--pf-bar:${m.reward?Math.max(2,m.reward/peak*100):0}%"></span></span><span>${m.month}</span></button>`).join('');
    $('#pf-views').textContent=integer.format(current.views);
    $('#pf-clicks').textContent=integer.format(current.clicks);
    $('#pf-signups').textContent=count(current.registrations);
    $('#pf-paid').textContent=count(current.newPaid);
    $('#pf-new-income').textContent=money(current.newReward);
    $('#pf-repeat-income').textContent=money(current.repeatReward);
    $('#pf-repeat-bar').style.setProperty('--pf-repeat',current.reward?current.repeatReward/current.reward*100+'%':'0%');
    $('#pf-mix-summary').textContent='Личные: '+result.mix.slice(0,3).map(w=>number.format(w*100)+'%').join(' / ')+' · Бизнес: '+result.mix.slice(3).map(w=>number.format(w*100)+'%').join(' / ')+'.';
    $('#pf-month').value=String(month);
    clearTimeout(statusTimer);
    statusTimer=setTimeout(()=>{$('#pf-live').textContent='Расчёт обновлён. '+month+'-й месяц: '+money(current.reward)+'.';},400);
    save();
  }
  root.addEventListener('input',event=>{
    const el=event.target;
    if(isFact()){
      const path=/^channels\.(.+)\.views$/.exec(el.dataset.factPath||'');
      if(path){const value=el.value===''?null:Number(el.value);if(value===null)delete factViews[path[1]];else if(Number.isFinite(value)&&value>=0)factViews[path[1]]=value;else return;try{localStorage.setItem(factStorageKey,JSON.stringify(factViews));}catch{}syncControls();renderFacts();}
      return;
    }
    if(!el.dataset.pfPath||el.type!=='number'||el.value==='')return;
    const entered=Number(el.value);
    const path=el.dataset.pfPath;
    set(path,entered);settings=M.normalize(settings);
    const applied=get(path);
    // Keep a clamped value visible immediately, but do not interrupt a valid edit.
    if(applied!==entered)el.value=String(applied);
    if(path.startsWith('frequency.'))filterChannels();
    renderResults();
  });
  root.addEventListener('change',event=>{
    const el=event.target;
    if(isFact()){
      if(el.id==='pf-channel-filter'){filterChannels();return;}
      if(el.id==='pf-horizon')root.dispatchEvent(new CustomEvent('syntolk-calculator-fact-filter',{detail:{period:el.value}}));
      if(el.id==='pf-month')root.dispatchEvent(new CustomEvent('syntolk-calculator-fact-filter',{detail:{allContent:el.value==='all'}}));
      return;
    }
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
    if(button.hasAttribute('data-current-refresh')){root.dispatchEvent(new CustomEvent('syntolk-calculator-refresh'));return;}
    if(isFact()&&(button.dataset.factPoint||button.hasAttribute('data-fact-clear'))){root.dispatchEvent(new CustomEvent('syntolk-calculator-fact-point',{detail:button.dataset.factPoint||null}));return;}
    if(isFact()&&button.hasAttribute('data-fact-dates')){root.dispatchEvent(new CustomEvent('syntolk-calculator-fact-filter',{detail:{period:'custom'}}));return;}
    if(isFact()&&button.dataset.month)return;
    if(button.id==='pf-select-matching'){
      settings=M.selectMatchingChannels(settings);$('#pf-channel-filter').value='matching';syncControls();renderResults();return;
    }
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
      const id=newId('format-'),count=Number($(`[data-channel-format-count="${channelId}"]`)?.value)||0,base=channelFormatBase(channel);
      settings.customFormats.push({id,name,base,channelId});
      settings.frequency[id]=count;
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
      settings.customFormats.push({id,name,base});
      settings.frequency[id]=Number($('#pf-format-count').value)||0;
      channels().forEach(c=>{if(c.formats.includes(base)&&settings.channels[c.id].formats.length)settings.channels[c.id].formats.push(id);});
      settings=M.normalize(settings);formatMenuOpen=false;renderControls();setTab('content');renderResults();return;
    }
    if(button.dataset.removeFormat){
      const id=button.dataset.removeFormat;
      if(M.FORMATS.some(f=>f.id===id))settings.removedFormats.push(id);else settings.customFormats=settings.customFormats.filter(f=>f.id!==id);
      settings=M.normalize(settings);renderControls();setTab('content');renderResults();return;
    }
    if(button.id==='pf-reset'){
      const event=new CustomEvent('syntolk-calculator-create-scenario',{bubbles:true,cancelable:true});
      if(!root.dispatchEvent(event))return;
      resetScenario();return;
    }
  });
  root.addEventListener('keydown',event=>{
    const tabs=['content','platforms','sales'], el=event.target;
    if(isFact()&&el.dataset.factPoint){
      if(event.key==='Escape'){event.preventDefault();root.dispatchEvent(new CustomEvent('syntolk-calculator-fact-point',{detail:null}));return;}
      if(['ArrowRight','ArrowLeft','Home','End'].includes(event.key)){
        event.preventDefault();const bars=$$('[data-fact-point]'),index=bars.indexOf(el);
        const next=event.key==='Home'?0:event.key==='End'?bars.length-1:Math.max(0,Math.min(bars.length-1,index+(event.key==='ArrowRight'?1:-1)));
        if(next!==index){bars[next].focus();root.dispatchEvent(new CustomEvent('syntolk-calculator-fact-point',{detail:bars[next].dataset.factPoint}));}return;
      }
    }
    if(el.dataset.pfTab&&['ArrowRight','ArrowLeft','Home','End'].includes(event.key)){
      event.preventDefault();let i=tabs.indexOf(tab);
      i=event.key==='Home'?0:event.key==='End'?2:(i+(event.key==='ArrowRight'?1:2))%3;setTab(tabs[i],true);
    }
    if(el.dataset.month&&['ArrowRight','ArrowLeft','Home','End'].includes(event.key)){
      event.preventDefault();month=event.key==='Home'?1:event.key==='End'?settings.forecastMonths:Math.max(1,Math.min(settings.forecastMonths,month+(event.key==='ArrowRight'?1:-1)));
      renderResults();$(`[data-month="${month}"]`).focus();
    }
  });
  function factCount(value){return value==null?'—':integer.format(value);}
  function factRate(value){return value==null?'—':number.format(value*100)+'%';}
  function factMoney(value){return value==null?'—':new Intl.NumberFormat('ru-RU',{style:'currency',currency:facts.report?.currency||'RUB'}).format(value/100);}
  function leadText(node,text){if(node?.firstChild)node.firstChild.nodeValue=text;}
  function decorateFacts(){
    if(!isFact())return;
    $('#pf-panel-content .pf-row-head').lastElementChild.textContent='За период';
    visibleFormats().forEach(format=>{
      const field=$(`#pf-frequency-${format.id}`);if(!field)return;
      field.readOnly=true;field.removeAttribute('max');field.placeholder='—';
      field.setAttribute('aria-label',format.name+': создано за период');
      const content=metric('formats',format.id)?.content;
      field.title='Фактически подготовлено: '+factCount(facts.report?content?.preparedMaterials??0:null)+'. Опубликовано: '+factCount(facts.report?content?.publishedMaterials??0:null)+'.';
    });
    $('#pf-panel-content > p.pf-help').textContent='Оригиналы за выбранный период. Копии на других площадках не увеличивают число материалов.';
    $('#pf-panel-platforms > p.pf-help:not([id])').textContent='Фактические размещения и переходы. Просмотры можно ввести вручную за тот же период — процент рассчитается автоматически.';
    $('#pf-panel-sales > p.pf-help').textContent='Конверсии рассчитаны по переходам выбранного периода и связанным с ними регистрациям и оплатам. Неизвестные показатели — «—».';
    $$('[data-format-name],[data-channel-name],[data-channel-url]').forEach(field=>{field.readOnly=true;});
    $$('[data-channel-enable],[data-channel-format],[data-pf-path="paymentDelayEnabled"]').forEach(field=>{field.disabled=true;});
    $$('#pf-format-menu-toggle,#pf-platform-menu-toggle,#pf-select-matching,[data-remove-format],[data-remove-channel],[data-channel-format-menu]').forEach(button=>{button.disabled=true;button.title='Структура сценария редактируется в режиме «Мой сценарий». Факт подставляется автоматически.';});
    $$('#pf-restore-format,#pf-restore-channel').forEach(field=>{field.disabled=true;});
    $$('[data-fact-count]').forEach(field=>{
      const split=field.dataset.factCount.lastIndexOf(':'),id=field.dataset.factCount.slice(0,split),kind=field.dataset.factCount.slice(split+1),row=metric('platforms',id);
      field.value=facts.report?String(kind==='clicks'?row?.counts.clicks??0:row?.content.publishedPlacements??0):'';
    });
    channels().forEach(c=>{
      const row=metric('platforms',c.id),help=$(`[data-source-help="${c.id}"]`);
      if(help?.firstChild)help.firstChild.nodeValue=`Размещено: ${factCount(facts.report?row?.content.publishedPlacements??0:null)}. Регистрации: ${factCount(facts.report?row?.counts.registrations??0:null)}. Оплаты: ${factCount(facts.report?row?.counts.paymentCount??0:null)}. Регистрация из переходов: ${factRate(row?.conversions.clickToRegistration)}. Оплата из регистраций: ${factRate(row?.conversions.registrationToPayment)}. Просмотры вводятся вручную за весь выбранный период. `;
      $$(`[data-channel-format="${c.id}"]`).forEach(field=>{const format=row?.formats?.find(item=>item.id===field.value);field.closest('label').title=`Переходы: ${format?.counts.clicks??0}; регистрации: ${format?.counts.registrations??0}; оплаты: ${format?.counts.paymentCount??0}; регистрация из переходов: ${factRate(format?.conversions.clickToRegistration)}; оплата из регистраций: ${factRate(format?.conversions.registrationToPayment)}.`;});
    });
  }
  function restoreForecastLabels(){
    root.dataset.valuesMode='forecast';
    leadText($('#pf-horizon').parentElement,'Период прогноза');
    $('#pf-horizon').removeAttribute('aria-label');$('#pf-month').removeAttribute('aria-label');$('#pf-month').removeAttribute('title');
    delete $('#pf-chart').dataset.factsSeries;
    delete $('#pf-income-range').dataset.factsMarkup;
    if($('#pf-horizon').options[0]?.value!=='1')$('#pf-horizon').innerHTML=Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1} мес.</option>`).join('');
    leadText($('#pf-month').parentElement,'Месяц');
    $('.pf-year-totals > div:last-child > span').textContent='Накоплено к выбранному месяцу';
    $('.pf-chart-caption > span:first-child').textContent='Начисления по месяцам';
    $('.pf-funnel > div:last-child > span').textContent='Первые оплаты';
    leadText($('#pf-new-income').parentElement,'Первые оплаты');leadText($('#pf-repeat-income').parentElement,'Повторные оплаты');
    $('#pf-income').removeAttribute('aria-label');
    $('#pf-scenario-note').removeAttribute('role');$('#pf-scenario-note').classList.remove('pf-warning');
    $('[data-current-values]')?.setAttribute('aria-pressed','false');
  }
  function renderFacts(){
    const report=facts.report;
    root.dataset.valuesMode='current';clearTimeout(statusTimer);
    leadText($('#pf-horizon').parentElement,'Период факта');
    $('#pf-horizon').setAttribute('aria-label','Период факта');$('#pf-month').setAttribute('aria-label','Контент для текущих значений');
    if($('#pf-horizon').options[0]?.value!=='today')$('#pf-horizon').innerHTML=[['today','Сегодня'],['7d','7 дней'],['30d','30 дней'],['all','Всё время'],['custom','Свои даты']].map(([id,name])=>`<option value="${id}">${name}</option>`).join('');
    $('#pf-horizon').value=facts.filter.period;
    leadText($('#pf-month').parentElement,'Учитывать');
    if($('#pf-month').options[0]?.value!=='all'||$('#pf-month').options[1]?.textContent!==facts.scenarioName)$('#pf-month').innerHTML=`<option value="all">Весь контент</option><option value="scenario">${escape(facts.scenarioName)}</option>`;
    $('#pf-month').value=facts.filter.allContent?'all':'scenario';
    const scope=facts.filter.allContent?'Весь мой контент и площадки':facts.scenarioName;
    $('#pf-month').title=scope;
    const empty=report&&!report.counts.clicks&&!report.counts.registrations&&!report.counts.paymentCount&&!report.content.preparedMaterials;
    $('#pf-scenario-note').textContent=facts.error||(empty?(facts.filter.allContent?'За выбранный период действий нет.':`За этот период в «${scope}» действий нет. Данные других сценариев сюда не подмешиваются.`):`${facts.filter.allContent?'Весь контент.':`Сценарий «${facts.scenarioName}».`} Факт обновляется автоматически. Просмотры — вручную в «Площадках».`);
    $('#pf-scenario-note').classList.toggle('pf-warning',!!facts.error);
    if(facts.error)$('#pf-scenario-note').setAttribute('role','alert');else $('#pf-scenario-note').removeAttribute('role');
    const selected=facts.selectedPoint;
    const rangeLabel=selected?selected.from===selected.to?selected.from:selected.from+' — '+selected.to:'';
    $('#pf-income-label').textContent=selected?'Начислено: '+rangeLabel:'Начислено за период';$('#pf-income').textContent=factMoney(report?.amountsMinor.netAccrued);$('#pf-income').setAttribute('aria-label','Фактически начислено');
    const rangeMarkup=`Подготовлено: ${factCount(report?.content.preparedMaterials)} · Опубликовано: ${factCount(report?.content.publishedMaterials)} · Оплат: ${factCount(report?.counts.paymentCount)}${selected?' · <button type="button" data-fact-clear class="pf-text-button">Весь период</button>':facts.filter.period==='custom'?` · <button type="button" data-fact-dates class="pf-text-button">${escape(facts.filter.from)} — ${escape(facts.filter.to)}</button>`:''}`;
    if($('#pf-income-range').dataset.factsMarkup!==rangeMarkup){$('#pf-income-range').innerHTML=rangeMarkup;$('#pf-income-range').dataset.factsMarkup=rangeMarkup;}
    $('#pf-total-label').textContent='Оплачено клиентами';$('#pf-year').textContent=factMoney(report?.amountsMinor.observedPayments);
    $('.pf-year-totals > div:last-child > span').textContent='С учётом возвратов';$('#pf-cumulative').textContent=factMoney(report?.amountsMinor.netPayments);
    $('#pf-work').innerHTML=`<div><strong>${factCount(report?.content.preparedMaterials)} оригиналов за период</strong></div><div><strong>${factCount(report?.content.publishedPlacements)} размещений за период</strong></div>`;
    const chart=facts.chartReport??report,points=chart?.series?.points??[],peak=Math.max(1,...points.map(point=>Math.abs(point.earningsMinor)));
    $('.pf-chart-caption > span:first-child').textContent='Фактические начисления';$('#pf-chart-hint').textContent=chart?.series?.bucket==='month'?'По месяцам · выберите столбец':chart?.series?.bucket==='week'?'По неделям · выберите столбец':'По дням · выберите столбец';
    $('#pf-chart').setAttribute('aria-label','Фактические начисления за выбранный период');$('#pf-chart').style.setProperty('--pf-months',String(Math.max(1,points.length)));
    const seriesKey=JSON.stringify([chart?.currency,chart?.series?.bucket,points.map(point=>[point.date,point.earningsMinor])]);
    if($('#pf-chart').dataset.factsSeries!==seriesKey){
      const focusedPoint=$('#pf-chart').contains(document.activeElement)?document.activeElement.closest('[data-fact-point]')?.dataset.factPoint:null;
      $('#pf-chart').dataset.factsSeries=seriesKey;
      $('#pf-chart').innerHTML=points.map((point,index)=>{const label=chart.series.bucket==='month'?point.date.slice(0,7):String(new Date(point.date+'T12:00:00Z').getUTCDate());const visible=points.length<=12||index===0||index===points.length-1||index<points.length-2&&index%Math.ceil(points.length/8)===0;return `<button type="button" class="pf-chart-month" data-fact-point="${point.date}" aria-label="${point.date}: ${factMoney(point.earningsMinor)}" title="${point.date}: ${factMoney(point.earningsMinor)}"><span class="pf-chart-track"><span style="--pf-bar:${point.earningsMinor?Math.max(2,Math.abs(point.earningsMinor)/peak*100):0}%"></span></span><span>${visible?label:'&nbsp;'}</span></button>`;}).join('');
      if(focusedPoint)$(`[data-fact-point="${focusedPoint}"]`)?.focus({preventScroll:true});
    }
    $$('[data-fact-point]').forEach((button,index)=>{const active=button.dataset.factPoint===selected?.date;button.classList.toggle('pf-active-month',active);button.setAttribute('aria-pressed',String(active));button.tabIndex=active||!selected&&index===0?0:-1;});
    const measuredViews=(report?.breakdown?.platforms??[]).filter(row=>Object.hasOwn(factViews,row.id));
    $('#pf-views').textContent=measuredViews.length?factCount(measuredViews.reduce((sum,row)=>sum+factViews[row.id],0)):'—';
    $('#pf-views').title=`Просмотры введены вручную для ${measuredViews.length} из ${report?.breakdown?.platforms.length??0} площадок выбранного периода. Не заполняются плановыми просмотрами.`;
    $('#pf-clicks').textContent=factCount(report?.counts.clicks);$('#pf-signups').textContent=factCount(report?.counts.registrations);$('#pf-paid').textContent=factCount(report?.counts.firstPaymentCount);
    $('#pf-new-income').textContent=factCount(report?.counts.firstPaymentCount);$('#pf-repeat-income').textContent=factCount(report?.counts.repeatPaymentCount);
    leadText($('#pf-new-income').parentElement,'Первые оплаты, шт.');leadText($('#pf-repeat-income').parentElement,'Повторные оплаты, шт.');
    $('#pf-repeat-bar').style.setProperty('--pf-repeat',report?.counts.paymentCount?report.counts.repeatPaymentCount/report.counts.paymentCount*100+'%':'0%');
    $('#pf-buyer-mix').textContent='Регистрации: '+factCount(report?.counts.registrations)+'. Платящие клиенты: '+factCount(report?.counts.payingCustomers)+'. Оплаты: '+factCount(report?.counts.paymentCount)+'.';
    $('#pf-active-delay').hidden=true;$('#pf-mix-summary').textContent='Фактический состав тарифов и удержание не подменяются плановыми допущениями.';
    $('#pf-registration').title=`${report?.conversions.cohortRegistrations??0} регистраций из ${report?.counts.clicks??0} переходов выбранного периода.`;
    $('#pf-paidConversion').title=`${report?.conversions.cohortPaidRegistrations??0} плательщиков из ${report?.conversions.cohortRegistrations??0} регистраций, связанных с переходами выбранного периода.`;
    $('#pf-quick-assumptions').textContent=scope;$('#pf-quick-scenario').textContent='Текущие значения';
    $('[data-current-values]')?.setAttribute('aria-pressed','true');$$('[data-scenario]').forEach(button=>button.setAttribute('aria-pressed','false'));
    $('#pf-live').textContent=facts.error||(!report?'Загружаем фактические значения…':facts.refreshState==='loading'?'Обновляем фактические данные…':'Фактические значения обновлены: '+factCount(report.counts.clicks)+' переходов, '+factCount(report.counts.registrations)+' регистраций.');
  }
  root.addEventListener('syntolk-calculator-current-values',event=>{
    const wasActive=isFact();facts=event.detail;
    const refresh=$('[data-current-refresh]');
    if(refresh){
      refresh.disabled=facts.refreshState==='loading';refresh.setAttribute('aria-busy',String(refresh.disabled));
      refresh.title=facts.refreshState==='loading'?'Обновляем фактические данные…':facts.refreshState==='success'?'Фактические данные обновлены':facts.refreshState==='error'?'Не удалось обновить. Нажмите, чтобы повторить':'Обновить фактические данные';
      if(facts.refreshState&&facts.refreshState!=='idle')$('#pf-live').textContent=refresh.title;
    }
    if(!facts?.active&&!wasActive)return;
    if(isFact()&&factStorageKey!==facts.storageKey){
      factStorageKey=facts.storageKey;factViews={};
      try{const storedViews=JSON.parse(localStorage.getItem(factStorageKey)||'{}');for(const [id,value]of Object.entries(storedViews))if(typeof value==='number'&&Number.isFinite(value)&&value>=0)factViews[id]=value;}catch{}
    }
    const catalog=JSON.stringify([isFact(),facts.storageKey,facts.report?.breakdown?.formats?.map(row=>[row.id,row.name]).sort((a,b)=>a[0].localeCompare(b[0])),facts.report?.breakdown?.platforms?.map(row=>[row.id,row.name,row.formats?.map(format=>format.id).sort()]).sort((a,b)=>a[0].localeCompare(b[0]))]);
    if(wasActive!==isFact()||catalog!==factCatalog){formatMenuOpen=false;platformMenuOpen=false;channelFormatMenu=null;renderControls();setTab(tab);}else syncControls();
    factCatalog=catalog;renderResults();
  });
  if(scenario!=='base'&&$('[data-current-values]'))scenario='base';
  renderControls();setTab(tab);setMobileMode(false);renderResults();
  root.dispatchEvent(new CustomEvent('syntolk-calculator-ready'));
  mobileQuery?.addEventListener?.('change',()=>{
    if(mobileQuery.matches&&!mobileExpanded)setTab('content');
    updateMobileTitle();
  });
})();
