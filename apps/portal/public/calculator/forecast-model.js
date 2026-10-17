/* Syntolk partner scenarios. No observed conversion statistics are embedded. */
(() => {
  'use strict';
  const WEEKS = 52 / 12, COMMISSION = 0.2, VERIFIED = '2026-10-11';
  const FORMATS = [
    { id: 'post', name: 'Посты', hint: 'Текст и изображение', tail: 0.10 },
    { id: 'short', name: 'Короткие видео', hint: 'Один ролик → несколько площадок', tail: 0.35 },
    { id: 'long', name: 'Длинные видео', hint: 'Обзоры и разборы продукта', tail: 0.55 },
    { id: 'article', name: 'Статьи', hint: 'Кейсы, инструкции, сравнения', tail: 0.60 },
    { id: 'circle', name: 'Кружочки', hint: 'Отдельные видео для Telegram', tail: 0.05 }
  ];
  const PLANS = [
    { name: 'Базовый', price: 990, segment: 'personal' },
    { name: 'Стандарт', price: 1990, segment: 'personal' },
    { name: 'Максимум', price: 3990, segment: 'personal' },
    { name: 'Старт', price: 10000, segment: 'business' },
    { name: 'Бизнес', price: 20000, segment: 'business' },
    { name: 'Про', price: 30000, segment: 'business' }
  ];
  // Views and click rates are editable demonstration assumptions, never benchmarks.
  const CHANNELS = [
    { id:'telegram-post', name:'Telegram — Посты', formats:['post'], selected:['post'], sourceFormat:'post', views:350, ctr:1.5, group:'social', note:'Посты в Telegram-канале или группе.', url:'https://telegram.org/tour/channels' },
    { id:'telegram-short', name:'Telegram — Короткие видео', formats:['short'], selected:['short'], sourceFormat:'short', views:350, ctr:1.5, group:'social', note:'Короткие видео в Telegram-канале или группе.', url:'https://telegram.org/tour/channels' },
    { id:'telegram-long', name:'Telegram — Длинные видео', formats:['long'], selected:[], sourceFormat:'long', views:350, ctr:1.5, group:'social', note:'Длинные видео в Telegram-канале или группе.', url:'https://telegram.org/tour/channels' },
    { id:'telegram-circle', name:'Telegram — Кружочки', formats:['circle'], selected:['circle'], sourceFormat:'circle', views:350, ctr:1.5, group:'social', note:'Кружочки в Telegram-канале или группе.', url:'https://telegram.org/tour/channels' },
    { id:'vk', name:'ВКонтакте', formats:['post'], selected:['post'], views:250, ctr:1, group:'social', note:'Посты в сообществе или личном блоге.', url:'https://vk.com/' },
    { id:'vkclips', name:'VK Клипы', formats:['short'], selected:['short'], views:1000, ctr:0.35, group:'video', note:'Короткие ролики. Задайте свои просмотры и переходы.', url:'https://vkclips.app/special/authors' },
    { id:'vkvideo', name:'VK Видео', formats:['long'], selected:[], views:500, ctr:1, group:'video', note:'Длинные обзоры; отдельный от Клипов формат.', url:'https://vkvideo.ru/' },
    { id:'dzen', name:'Дзен', formats:['post','short','long','article'], selected:['article'], views:400, ctr:1, group:'social', note:'Статьи и видео. Проверьте доступные форматы в своём аккаунте.', url:'https://dzen.ru/' },
    { id:'ytshorts', name:'YouTube Shorts', formats:['short'], selected:['short'], views:1200, ctr:0.2, group:'video', note:'URL в описании Shorts не кликабелен. Учитывайте путь через профиль или связанное видео.', url:'https://support.google.com/youtube/answer/13748639?hl=ru' },
    { id:'youtube', name:'YouTube', formats:['long'], selected:['long'], views:500, ctr:1, group:'video', note:'Длинные видео. Публикация и ссылки зависят от возможностей аккаунта.', url:'https://support.google.com/youtube/answer/13748639?hl=ru' },
    { id:'rutubeshorts', name:'RUTUBE Shorts', formats:['short'], selected:[], views:500, ctr:0.3, group:'video', note:'Вертикальные короткие видео; переходы задаются отдельно.', url:'https://rutube.ru/info/shorts/' },
    { id:'rutube', name:'RUTUBE', formats:['long'], selected:[], views:300, ctr:0.8, group:'video', note:'Длинные видео и разборы.', url:'https://rutube.ru/' },
    { id:'ok', name:'Одноклассники', formats:['post','short','long'], selected:[], views:300, ctr:1, group:'social', note:'Посты и видео на странице или в группе.', url:'https://ok.ru/help/zametki-v-odnoklassnikah' },
    { id:'vc', name:'vc.ru', formats:['article'], selected:[], views:600, ctr:1.5, group:'expert', note:'Предметные кейсы по правилам площадки, без массового рекламного спама.', url:'https://vc.ru/rules' },
    { id:'tenchat', name:'TenChat', formats:['post','article'], selected:[], views:350, ctr:1.5, group:'expert', note:'Деловой блог и профессиональные кейсы.', url:'https://tenchat.ru/' },
    { id:'spark', name:'Spark', formats:['article'], selected:[], views:250, ctr:1, group:'expert', note:'Материалы о бизнесе и опыте внедрения.', url:'https://spark.ru/' },
    { id:'pikabu', name:'Пикабу', formats:['article'], selected:[], views:500, ctr:0.5, group:'expert', note:'Продвижение — только в разрешённом рекламном формате аккаунта.', url:'https://pikabu.ru/information/adrules' },
    { id:'tiktok', name:'TikTok', formats:['short'], selected:[], views:1000, ctr:0.2, group:'video', note:'Выбирайте, если вашему аккаунту доступны публикации и ссылка в профиле. Покажите зрителю, где найти ссылку.', url:'https://support.tiktok.com/ru/getting-started/setting-up-your-profile' },
    { id:'blog', name:'Свой сайт / блог', formats:['article'], selected:[], views:250, ctr:2, group:'owned', note:'Собственные статьи, поиск и база читателей.', url:'' },
    { id:'email', name:'Email-рассылка', formats:['post'], selected:[], views:300, ctr:2, group:'owned', note:'Здесь просмотры — прочтения письма, а не вся база подписчиков.', url:'' },
    { id:'media', name:'Отраслевые СМИ', formats:['article'], selected:[], views:700, ctr:1, group:'owned', note:'Считайте только согласованные публикации. Редакционное принятие не гарантировано.', url:'' }
  ];
  const SCENARIOS = {
    low: { name:'Ниже ожиданий', views:0.5, registration:0.8, payment:0.7 },
    base: { name:'Мой сценарий', views:1, registration:1, payment:1 },
    high: { name:'Выше ожиданий', views:1.8, registration:1.2, payment:1.2 }
  };
  const DEFAULT_SALES = {
    businessShare:0, registration:18, paidConversion:12,
    personalRetention:80, businessRetention:90, mix:[35,45,20,65,25,10]
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const num = (value, fallback, min, max) => {
    if (value === '' || value === null || typeof value === 'boolean') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };
  const pct = n => n / 100;
  const total = values => values.reduce((a,b) => a+b, 0);
  const text = (value,max) => typeof value==='string'?value.trim().slice(0,max):'';
  function normalizeCustomFormats(raw) {
    if(!Array.isArray(raw))return [];
    const ids=new Set(FORMATS.map(f=>f.id)), result=[];
    for(const item of raw.slice(0,15)){
      if(!item||typeof item!=='object')continue;
      const id=text(item.id,40).toLowerCase(),name=text(item.name,80);
      if(!/^format-[a-z0-9-]+$/.test(id)||ids.has(id)||!name)continue;
      const base=FORMATS.find(f=>f.id===item.base)??FORMATS[0];
      const channelId=text(item.channelId,40).toLowerCase();
      const scopedChannel=CHANNELS.some(c=>c.id===channelId)||/^custom-[a-z0-9-]+$/.test(channelId)?channelId:'';
      ids.add(id);result.push({id,name,base:base.id,channelId:scopedChannel,hint:text(item.hint,160)||base.hint,tail:base.tail,custom:true});
    }
    return result;
  }
  function allFormats(settings={}) {
    const removed=Array.isArray(settings.removedFormats)?settings.removedFormats:[];
    return [...FORMATS.filter(f=>!removed.includes(f.id)).map(f=>({...f,name:text(settings.formatOverrides?.[f.id]?.name,80)||f.name,base:f.id})),...normalizeCustomFormats(settings.customFormats)];
  }
  function normalizeCustomChannels(raw,formatDefs=FORMATS) {
    if(!Array.isArray(raw))return [];
    const ids=new Set(CHANNELS.map(c=>c.id)), result=[];
    for(const item of raw.slice(0,30)){
      if(!item||typeof item!=='object')continue;
      const id=text(item.id,40).toLowerCase();
      const name=text(item.name,80);
      if(!/^custom-[a-z0-9-]+$/.test(id)||ids.has(id)||!name)continue;
      ids.add(id);
      let url=text(item.url,300);
      if(url&&!/^https?:\/\//i.test(url))url='';
      const availableFormats=formatDefs.filter(f=>!f.channelId||f.channelId===id);
      const formats=availableFormats.filter(f=>Array.isArray(item.formats)&&(item.formats.includes(f.id)||item.formats.includes(f.base))).map(f=>f.id);
      result.push({id,name,formats:formats.length?formats:availableFormats.map(f=>f.id),selected:[],enabled:item.enabled!==false,views:num(item.views,250,0,1000000),ctr:num(item.ctr,1,0,100),group:'custom',note:text(item.note,240)||'',url});
    }
    return result;
  }
  function allChannels(settings={}) {
    const formatDefs=allFormats(settings), removed=Array.isArray(settings.removedChannels)?settings.removedChannels:[];
    return [...CHANNELS.filter(c=>!removed.includes(c.id)).map(c=>({...c,
      name:text(settings.channelOverrides?.[c.id]?.name,80)||c.name,
      url:typeof settings.channelOverrides?.[c.id]?.url==='string'?text(settings.channelOverrides[c.id].url,300):c.url,
      formats:formatDefs.filter(f=>c.formats.includes(f.base??f.id)&&(!f.channelId||f.channelId===c.id)).map(f=>f.id),
      selected:c.selected.filter(id=>formatDefs.some(f=>f.id===id))})),...normalizeCustomChannels(settings.customChannels,formatDefs)];
  }
  function defaults() {
    return {
      version:1, conversionVersion:2,
      customChannels:[], customFormats:[], removedChannels:[], removedFormats:[], channelOverrides:{}, formatOverrides:{}, forecastMonths:12,
      frequency:{ post:3, short:2, long:0.25, article:0.25, circle:1 },
      channels:Object.fromEntries(CHANNELS.map(c=>[c.id,{ enabled:c.selected.length>0, formats:[...c.selected], views:c.views, ctr:c.ctr }])),
      ...clone(DEFAULT_SALES), prices:PLANS.map(p=>p.price),
      paymentDelayEnabled:false, delayShare:0, growth:3,
      tail:Object.fromEntries(FORMATS.map(f=>[f.id,f.tail*100])),
      personalUpgrade:3, businessUpgrade:2, addon:0, refunds:0,
      monthlyCost:0, stopAfter:12,
      viralViews:0, viralMonth:3, viralChannel:'ytshorts'
    };
  }
  function normalize(raw = {}) {
    const d=defaults(), s=raw && typeof raw==='object' ? raw : {};
    const out=clone(d);
    const legacyTelegram=s.channels?.telegram&&typeof s.channels.telegram==='object'?s.channels.telegram:null;
    const legacyTelegramFormats=Array.isArray(legacyTelegram?.formats)?legacyTelegram.formats:[];
    const legacyTelegramRemoved=Array.isArray(s.removedChannels)&&s.removedChannels.includes('telegram');
    out.customFormats=normalizeCustomFormats(s.customFormats);
    out.removedFormats=FORMATS.filter(f=>Array.isArray(s.removedFormats)&&s.removedFormats.includes(f.id)).map(f=>f.id);
    out.removedChannels=CHANNELS.filter(c=>Array.isArray(s.removedChannels)&&(s.removedChannels.includes(c.id)||(c.sourceFormat&&legacyTelegramRemoved))).map(c=>c.id);
    for(const f of FORMATS)if(text(s.formatOverrides?.[f.id]?.name,80))out.formatOverrides[f.id]={name:text(s.formatOverrides[f.id].name,80)};
    for(const c of CHANNELS){
      const item=s.channelOverrides?.[c.id]||(c.sourceFormat?s.channelOverrides?.telegram:null);
      if(!item)continue;
      const url=text(item.url,300);
      out.channelOverrides[c.id]={name:text(item.name,80)||c.name,url:url&&/^https?:\/\//i.test(url)?url:''};
    }
    out.customChannels=normalizeCustomChannels(s.customChannels,allFormats(out));
    out.forecastMonths=Math.floor(num(s.forecastMonths,12,1,12));
    const bounds={ businessShare:[0,100],registration:[0,100],paidConversion:[0,100],
      personalRetention:[0,100],businessRetention:[0,100],delayShare:[0,100],
      growth:[0,30],personalUpgrade:[0,100],businessUpgrade:[0,100],addon:[0,1000000],refunds:[0,100],
      monthlyCost:[0,10000000],stopAfter:[0,12],viralViews:[0,10000000],viralMonth:[1,12] };
    Object.entries(bounds).forEach(([k,[min,max]])=>{out[k]=num(s[k],d[k],min,max);});
    // Old snapshots expressed registration per new visitor and split people
    // before payment. Translate those rates once into the new denominators.
    const legacySales=s.conversionVersion!==2&&s.paidConversion===undefined&&
      ['personalPaid','businessPaid','newVisitorShare'].some(key=>s[key]!==undefined);
    if(legacySales){
      const business=pct(num(s.businessShare,0,0,100));
      const personalPaid=num(s.personalPaid,12,0,100),businessPaid=num(s.businessPaid,6,0,100);
      out.registration*=pct(num(s.newVisitorShare,70,0,100));
      out.paidConversion=(1-business)*personalPaid+business*businessPaid;
      out.businessShare=out.paidConversion>0?100*business*businessPaid/out.paidConversion:100*business;
    }
    // No implicit one-month delay, including in legacy snapshots. A saved
    // delay percentage takes effect only after the partner enables it.
    out.paymentDelayEnabled=s.paymentDelayEnabled===true;
    out.stopAfter=Math.floor(out.stopAfter);out.viralMonth=Math.floor(out.viralMonth);
    out.frequency={};out.tail={};
    allFormats(out).forEach(f=>{
      out.frequency[f.id]=num(s.frequency?.[f.id],d.frequency[f.id]??0,0,35);
      out.tail[f.id]=num(s.tail?.[f.id],f.tail*100,0,95);
    });
    allChannels(out).forEach(c=>{
      const rawChannel=s.channels?.[c.id]||(c.sourceFormat&&legacyTelegram?{
        ...legacyTelegram,
        enabled:legacyTelegram.enabled!==false&&legacyTelegramFormats.includes(c.sourceFormat),
        formats:legacyTelegramFormats.includes(c.sourceFormat)?[c.sourceFormat]:[]
      }:undefined);
      out.channels[c.id]={
        enabled:rawChannel&&typeof rawChannel==='object'&&typeof rawChannel.enabled==='boolean'?rawChannel.enabled:(rawChannel&&typeof rawChannel==='object'&&Array.isArray(rawChannel.formats)?rawChannel.formats.length>0:c.enabled!==false&&c.selected.length>0),
        formats:rawChannel&&typeof rawChannel==='object'&&Array.isArray(rawChannel.formats)?c.formats.filter(f=>rawChannel.formats.includes(f)):[...(c.selected.length?c.selected:(c.group==='custom'?c.formats:[]))],
        views:num(rawChannel&&typeof rawChannel==='object'?rawChannel.views:undefined,c.views,0,1000000), ctr:num(rawChannel&&typeof rawChannel==='object'?rawChannel.ctr:undefined,c.ctr,0,100)
      };
    });
    out.viralChannel=allChannels(out).some(c=>c.id===s.viralChannel&&c.formats.includes('short'))?s.viralChannel:allChannels(out).find(c=>c.formats.includes('short'))?.id??'';
    out.prices=PLANS.map((p,i)=>num(s.prices?.[i],p.price,0,1000000));
    out.mix=PLANS.map((p,i)=>num(s.mix?.[i],d.mix[i],0,100));
    return out;
  }
  function weights(values) {
    const sum=total(values);
    return sum>0?values.map(v=>v/sum):[1,0,0];
  }
  function newScenario(raw = {}) {
    const settings=normalize(raw);
    Object.keys(settings.frequency).forEach(id=>{settings.frequency[id]=0;});
    Object.values(settings.channels).forEach(channel=>{channel.enabled=false;channel.formats=[];});
    return settings;
  }
  function workload(raw) {
    const s=normalize(raw);
    const channelDefs=allChannels(s);
    const formatDefs=allFormats(s);
    const originals=total(formatDefs.map(f=>s.frequency[f.id]));
    const placements=total(channelDefs.map(c=>s.channels[c.id].enabled?total(s.channels[c.id].formats.map(f=>s.frequency[f])):0));
    return { originals, placements,
      unplaced:formatDefs.filter(f=>s.frequency[f.id]>0&&!channelDefs.some(c=>s.channels[c.id].enabled&&s.channels[c.id].formats.includes(f.id))).map(f=>f.id) };
  }
  function selectMatchingChannels(raw) {
    const s=normalize(raw);
    Object.values(s.channels).forEach(channel=>{channel.enabled=false;channel.formats=[];});
    allChannels(s).forEach(channel=>{
      const formats=channel.formats.filter(id=>s.frequency[id]>0);
      s.channels[channel.id].enabled=formats.length>0;
      s.channels[channel.id].formats=formats;
    });
    return s;
  }
  function transition(vector, s) {
    const next=Array(6).fill(0), upgrades=Array(6).fill(0);
    vector.forEach((count,i)=>{
      const business=i>=3;
      const retained=count*pct(business?s.businessRetention:s.personalRetention);
      const moved=i===2||i===5?0:retained*pct(business?s.businessUpgrade:s.personalUpgrade);
      next[i]+=retained-moved;
      if(moved){next[i+1]+=moved;upgrades[i+1]+=moved;}
    });
    return { next,upgrades };
  }
  function forecast(raw, scenarioId='base') {
    const scenarioKey=typeof scenarioId==='string'&&Object.hasOwn(SCENARIOS,scenarioId)?scenarioId:'base';
    const s=normalize(raw), scenario=SCENARIOS[scenarioKey];
    const work=workload(s), personalMix=weights(s.mix.slice(0,3)), businessMix=weights(s.mix.slice(3));
    const channelDefs=allChannels(s);
    const formatDefs=allFormats(s);
    const histories=Object.fromEntries(channelDefs.map(c=>[c.id,Object.fromEntries(formatDefs.map(f=>[f.id,[]]))]));
    const cohorts=[], months=[];
    const previousPotential=Object.fromEntries(channelDefs.map(c=>[c.id,0]));
    const delayedShare=s.paymentDelayEnabled?pct(s.delayShare):0;
    let cumulative=0, cumulativeNet=0;
    for(let m=1;m<=12;m++) {
      const activePublication=m<=s.stopAfter;
      const factor=Math.min(3,Math.pow(1+pct(s.growth),m-1));
      const channels=channelDefs.map(c=>{
        const config=s.channels[c.id];
        let freshViews=0,oldViews=0,placements=0;
        formatDefs.forEach(f=>{
          const count=activePublication&&config.enabled&&config.formats.includes(f.id)?s.frequency[f.id]*WEEKS:0;
          const history=histories[c.id][f.id];
          let fresh=count*config.views*factor*scenario.views;
          const hasPublishedShort=f.id==='short'&&config.enabled&&config.formats.includes('short')&&s.frequency.short>0&&s.stopAfter>0;
          if(hasPublishedShort&&m===s.viralMonth&&c.id===s.viralChannel) fresh+=s.viralViews*scenario.views;
          oldViews+=total(history.map((v,index)=>v*Math.pow(pct(s.tail[f.id]),m-1-index)));
          history.push(fresh); freshViews+=fresh; placements+=count;
        });
        const views=freshViews+oldViews, clicks=views*pct(config.ctr);
        const registrations=clicks*Math.min(1,pct(s.registration)*scenario.registration);
        const potentialPaid=registrations*Math.min(1,pct(s.paidConversion)*scenario.payment);
        const newPaid=potentialPaid*(1-delayedShare)+previousPotential[c.id]*delayedShare;
        previousPotential[c.id]=potentialPaid;
        const newBusiness=newPaid*pct(s.businessShare),newPersonal=newPaid-newBusiness;
        return { id:c.id,name:c.name,placements,freshViews,oldViews,views,clicks,registrations,
          newPersonal,newBusiness,newPaid,active:0,reward:0 };
      });
      const channelMap=Object.fromEntries(channels.map(c=>[c.id,c]));
      const upgrades=Array(6).fill(0);
      let churned=0;
      cohorts.forEach(cohort=>{
        const change=transition(cohort.plans,s);
        // Calculate churn from its rate. Subtracting nearly equal cohort totals
        // produces tiny positive/negative losses even when retention is 100%.
        churned+=total(cohort.plans.map((count,i)=>count*(1-pct(i>=3?s.businessRetention:s.personalRetention))));
        cohort.plans=change.next;
        change.upgrades.forEach((v,i)=>{upgrades[i]+=v;});
      });
      channels.forEach(c=>{
        const plans=[...personalMix.map(v=>v*c.newPersonal),...businessMix.map(v=>v*c.newBusiness)];
        if(total(plans)>0)cohorts.push({month:m,channel:c.id,plans});
      });
      const byPlan=Array(6).fill(0), cohortSummary=[];
      let payments=0,newPayments=0,repeatPayments=0;
      const revenueFactor=1-pct(s.refunds);
      cohorts.forEach(cohort=>{
        const active=total(cohort.plans);
        const paid=total(cohort.plans.map((v,i)=>v*s.prices[i]))+active*s.addon;
        payments+=paid;
        if(cohort.month===m)newPayments+=paid;else repeatPayments+=paid;
        cohort.plans.forEach((v,i)=>{byPlan[i]+=v;});
        channelMap[cohort.channel].active+=active;
        channelMap[cohort.channel].reward+=paid*revenueFactor*COMMISSION;
        let row=cohortSummary.find(r=>r.month===cohort.month);
        if(!row){row={month:cohort.month,active:0,reward:0};cohortSummary.push(row);}
        row.active+=active; row.reward+=paid*revenueFactor*COMMISSION;
      });
      const sum=key=>total(channels.map(c=>c[key]));
      const reward=payments*revenueFactor*COMMISSION;
      // A fixed monthly spend continues until explicitly changed, even after posting stops.
      const costs=s.monthlyCost, net=reward-costs;
      cumulative+=reward;cumulativeNet+=net;
      months.push({ month:m, originals:activePublication?work.originals*WEEKS:0,placements:sum('placements'),
        freshViews:sum('freshViews'),oldViews:sum('oldViews'),views:sum('views'),clicks:sum('clicks'),
        registrations:sum('registrations'),newPaid:sum('newPaid'),
        newPersonal:sum('newPersonal'),newBusiness:sum('newBusiness'),active:total(byPlan),churned,
        byPlan,upgrades,cohorts:cohortSummary,channels,payments,eligiblePayments:payments*revenueFactor,
        newReward:newPayments*revenueFactor*COMMISSION,repeatReward:repeatPayments*revenueFactor*COMMISSION,
        reward,cumulative,costs,net,cumulativeNet });
    }
    return { settings:s,scenario:scenarioKey,work,months,year:months[11],mix:[...personalMix,...businessMix] };
  }
  globalThis.SyntolkForecast=Object.freeze({ WEEKS,COMMISSION,VERIFIED,FORMATS,PLANS,CHANNELS,SCENARIOS,defaults,normalize,newScenario,allFormats,allChannels,workload,selectMatchingChannels,transition,forecast });
})();
