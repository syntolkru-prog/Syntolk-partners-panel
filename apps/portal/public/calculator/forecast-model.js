/* Syntolk partner scenarios. No observed conversion statistics are embedded. */
(() => {
  'use strict';
  const WEEKS = 52 / 12, COMMISSION = 0.2, VERIFIED = '2026-10-11';
  const FORMATS = [
    { id: 'post', name: 'Посты', hint: 'Текст и изображение', minutes: 15, tail: 0.10 },
    { id: 'short', name: 'Короткие видео', hint: 'Один ролик → несколько площадок', minutes: 15, tail: 0.35 },
    { id: 'long', name: 'Длинные видео', hint: 'Обзоры и разборы продукта', minutes: 60, tail: 0.55 },
    { id: 'article', name: 'Статьи', hint: 'Кейсы, инструкции, сравнения', minutes: 60, tail: 0.60 },
    { id: 'circle', name: 'Кружочки', hint: 'Отдельные видео для Telegram', minutes: 5, tail: 0.05 }
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
    { id:'telegram', name:'Telegram', formats:['post','short','long','circle'], selected:['post','short','circle'], views:350, ctr:1.5, group:'social', note:'Канал: посты, видео и отдельные кружочки.', url:'https://telegram.org/tour/channels' },
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
    { id:'habr', name:'Хабр', formats:['article'], selected:[], views:800, ctr:1, group:'expert', note:'Только допустимый корпоративный/согласованный формат. Рекламные и реферальные ссылки ограничены.', url:'https://habr.com/ru/docs/help/rules/' },
    { id:'tenchat', name:'TenChat', formats:['post','article'], selected:[], views:350, ctr:1.5, group:'expert', note:'Деловой блог и профессиональные кейсы.', url:'https://tenchat.ru/' },
    { id:'spark', name:'Spark', formats:['article'], selected:[], views:250, ctr:1, group:'expert', note:'Материалы о бизнесе и опыте внедрения.', url:'https://spark.ru/' },
    { id:'pikabu', name:'Пикабу', formats:['article'], selected:[], views:500, ctr:0.5, group:'expert', note:'Продвижение — только в разрешённом рекламном формате аккаунта.', url:'https://pikabu.ru/information/adrules' },
    { id:'tiktok', name:'TikTok', formats:['short'], selected:[], views:1000, ctr:0.2, group:'video', note:'Включайте, только если публикация доступна вашему аккаунту. Доступность в России ограничивалась.', url:'https://newsroom.tiktok.com/bringing-more-context-to-content-on-tiktok-eu?lang=en-150' },
    { id:'blog', name:'Свой сайт / блог', formats:['article'], selected:[], views:250, ctr:2, group:'owned', note:'Собственные статьи, поиск и база читателей.', url:'' },
    { id:'email', name:'Email-рассылка', formats:['post'], selected:[], views:300, ctr:2, group:'owned', note:'Здесь просмотры — прочтения письма, а не вся база подписчиков.', url:'' },
    { id:'media', name:'Отраслевые СМИ', formats:['article'], selected:[], views:700, ctr:1, group:'owned', note:'Считайте только согласованные публикации. Редакционное принятие не гарантировано.', url:'' }
  ];
  const SCENARIOS = {
    low: { name:'Ниже ожиданий', views:0.5, registration:0.8, payment:0.7 },
    base: { name:'Мой сценарий', views:1, registration:1, payment:1 },
    high: { name:'Выше ожиданий', views:1.8, registration:1.2, payment:1.2 }
  };
  const PROFILES = {
    blogger: { name:'Обычный блог', businessShare:0, registration:18, personalPaid:12, businessPaid:6, personalRetention:80, businessRetention:90, mix:[35,45,20,65,25,10] },
    education: { name:'Образование', businessShare:0, registration:22, personalPaid:12, businessPaid:6, personalRetention:78, businessRetention:90, mix:[50,40,10,65,25,10] },
    business: { name:'Бизнес / интеграции', businessShare:60, registration:14, personalPaid:10, businessPaid:7, personalRetention:80, businessRetention:92, mix:[20,50,30,65,25,10] }
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const num = (value, fallback, min, max) => {
    if (value === '' || value === null || typeof value === 'boolean') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };
  const pct = n => n / 100;
  const total = values => values.reduce((a,b) => a+b, 0);
  function defaults() {
    return {
      version:1, profile:'blogger', budgetHours:4, publishMinutes:3, adminMinutes:30,
      frequency:{ post:3, short:2, long:0.25, article:0.25, circle:1 },
      minutes:Object.fromEntries(FORMATS.map(f=>[f.id,f.minutes])),
      channels:Object.fromEntries(CHANNELS.map(c=>[c.id,{ formats:[...c.selected], views:c.views, ctr:c.ctr }])),
      ...clone(PROFILES.blogger), prices:PLANS.map(p=>p.price),
      newVisitorShare:70, delayShare:25, growth:3,
      tail:Object.fromEntries(FORMATS.map(f=>[f.id,f.tail*100])),
      personalUpgrade:3, businessUpgrade:2, addon:0, refunds:0,
      monthlyCost:0, hourlyCost:0, stopAfter:12,
      viralViews:0, viralMonth:3, viralChannel:'ytshorts'
    };
  }
  function normalize(raw = {}) {
    const d=defaults(), s=raw && typeof raw==='object' ? raw : {};
    const out=clone(d);
    out.profile=Object.hasOwn(PROFILES,s.profile)?s.profile:d.profile;
    const bounds={ budgetHours:[0,168],publishMinutes:[0,120],adminMinutes:[0,10080],
      businessShare:[0,100],registration:[0,100],personalPaid:[0,100],businessPaid:[0,100],
      personalRetention:[0,100],businessRetention:[0,100],newVisitorShare:[0,100],delayShare:[0,100],
      growth:[0,30],personalUpgrade:[0,100],businessUpgrade:[0,100],addon:[0,1000000],refunds:[0,100],
      monthlyCost:[0,10000000],hourlyCost:[0,100000],stopAfter:[0,12],viralViews:[0,10000000],viralMonth:[1,12] };
    Object.entries(bounds).forEach(([k,[min,max]])=>{out[k]=num(s[k],d[k],min,max);});
    out.stopAfter=Math.floor(out.stopAfter);out.viralMonth=Math.floor(out.viralMonth);
    out.viralChannel=CHANNELS.some(c=>c.id===s.viralChannel&&c.formats.includes('short'))?s.viralChannel:d.viralChannel;
    FORMATS.forEach(f=>{
      out.frequency[f.id]=num(s.frequency?.[f.id],d.frequency[f.id],0,35);
      out.minutes[f.id]=num(s.minutes?.[f.id],d.minutes[f.id],1,600);
      out.tail[f.id]=num(s.tail?.[f.id],d.tail[f.id],0,95);
    });
    CHANNELS.forEach(c=>{
      const rawChannel=s.channels?.[c.id];
      if(!rawChannel||typeof rawChannel!=='object')return;
      out.channels[c.id]={
        formats:Array.isArray(rawChannel.formats)?c.formats.filter(f=>rawChannel.formats.includes(f)):[...c.selected],
        views:num(rawChannel.views,c.views,0,1000000), ctr:num(rawChannel.ctr,c.ctr,0,100)
      };
    });
    out.prices=PLANS.map((p,i)=>num(s.prices?.[i],p.price,0,1000000));
    out.mix=PLANS.map((p,i)=>num(s.mix?.[i],d.mix[i],0,100));
    return out;
  }
  function weights(values) {
    const sum=total(values);
    return sum>0?values.map(v=>v/sum):[1,0,0];
  }
  function workload(raw) {
    const s=normalize(raw);
    const originals=total(FORMATS.map(f=>s.frequency[f.id]));
    const placements=total(CHANNELS.map(c=>total(s.channels[c.id].formats.map(f=>s.frequency[f]))));
    const creationMinutes=total(FORMATS.map(f=>s.frequency[f.id]*s.minutes[f.id]));
    const distributionMinutes=placements*s.publishMinutes;
    const adminMinutes=originals>0?s.adminMinutes:0;
    const minutes=creationMinutes+distributionMinutes+adminMinutes;
    return { originals, placements, creationMinutes, distributionMinutes, adminMinutes,
      minutes, hours:minutes/60, budgetMinutes:s.budgetHours*60,
      unplaced:FORMATS.filter(f=>s.frequency[f.id]>0&&!CHANNELS.some(c=>s.channels[c.id].formats.includes(f.id))).map(f=>f.id) };
  }
  function fitBudget(raw) {
    const s=normalize(raw), w=workload(s), flexible=w.creationMinutes+w.distributionMinutes;
    if(w.minutes<=w.budgetMinutes)return s;
    const ratio=flexible>0?Math.min(1,Math.max(0,(w.budgetMinutes-w.adminMinutes)/flexible)):0;
    FORMATS.forEach(f=>{s.frequency[f.id]=Math.floor(s.frequency[f.id]*ratio*100)/100;});
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
    const histories=Object.fromEntries(CHANNELS.map(c=>[c.id,Object.fromEntries(FORMATS.map(f=>[f.id,[]]))]));
    const cohorts=[], months=[];
    let previousPotential=Object.fromEntries(CHANNELS.map(c=>[c.id,{personal:0,business:0}]));
    let cumulative=0, cumulativeHours=0, cumulativeNet=0;
    for(let m=1;m<=12;m++) {
      const activePublication=m<=s.stopAfter;
      const factor=Math.min(3,Math.pow(1+pct(s.growth),m-1));
      const channels=CHANNELS.map(c=>{
        const config=s.channels[c.id];
        let freshViews=0,oldViews=0,placements=0;
        FORMATS.forEach(f=>{
          const count=activePublication&&config.formats.includes(f.id)?s.frequency[f.id]*WEEKS:0;
          const history=histories[c.id][f.id];
          let fresh=count*config.views*factor*scenario.views;
          const hasPublishedShort=f.id==='short'&&config.formats.includes('short')&&s.frequency.short>0&&s.stopAfter>0;
          if(hasPublishedShort&&m===s.viralMonth&&c.id===s.viralChannel) fresh+=s.viralViews*scenario.views;
          oldViews+=total(history.map((v,index)=>v*Math.pow(pct(s.tail[f.id]),m-1-index)));
          history.push(fresh); freshViews+=fresh; placements+=count;
        });
        const views=freshViews+oldViews, clicks=views*pct(config.ctr);
        const visitors=clicks*pct(s.newVisitorShare);
        const registrations=visitors*Math.min(1,pct(s.registration)*scenario.registration);
        const personal=registrations*(1-pct(s.businessShare))*Math.min(1,pct(s.personalPaid)*scenario.payment);
        const business=registrations*pct(s.businessShare)*Math.min(1,pct(s.businessPaid)*scenario.payment);
        const prev=previousPotential[c.id];
        const newPersonal=personal*(1-pct(s.delayShare))+prev.personal*pct(s.delayShare);
        const newBusiness=business*(1-pct(s.delayShare))+prev.business*pct(s.delayShare);
        previousPotential[c.id]={personal,business};
        return { id:c.id,name:c.name,placements,freshViews,oldViews,views,clicks,visitors,registrations,
          newPersonal,newBusiness,newPaid:newPersonal+newBusiness,active:0,reward:0 };
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
      // Stopping new posts removes production/distribution work, but does not
      // remove the explicitly budgeted ongoing audience communication/analytics.
      const ongoingMinutes=s.stopAfter>0&&work.originals>0?work.adminMinutes:0;
      const hours=(activePublication?work.minutes:ongoingMinutes)*WEEKS/60;
      // A fixed monthly spend continues until explicitly changed, even after posting stops.
      const costs=s.monthlyCost+hours*s.hourlyCost, net=reward-costs;
      cumulative+=reward;cumulativeHours+=hours;cumulativeNet+=net;
      months.push({ month:m, originals:activePublication?work.originals*WEEKS:0,placements:sum('placements'),
        freshViews:sum('freshViews'),oldViews:sum('oldViews'),views:sum('views'),clicks:sum('clicks'),
        visitors:sum('visitors'),registrations:sum('registrations'),newPaid:sum('newPaid'),
        newPersonal:sum('newPersonal'),newBusiness:sum('newBusiness'),active:total(byPlan),churned,
        byPlan,upgrades,cohorts:cohortSummary,channels,payments,eligiblePayments:payments*revenueFactor,
        newReward:newPayments*revenueFactor*COMMISSION,repeatReward:repeatPayments*revenueFactor*COMMISSION,
        reward,cumulative,hours,cumulativeHours,costs,net,cumulativeNet });
    }
    return { settings:s,scenario:scenarioKey,work,months,year:months[11],mix:[...personalMix,...businessMix] };
  }
  function csv(raw) {
    const s=normalize(raw), lines=[];
    const add=(...cells)=>lines.push(cells.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';'));
    add('Syntolk','Сценарный расчёт','Тарифы проверены',VERIFIED,'Комиссия',COMMISSION);
    add('Параметр','Значение');
    Object.entries(s).filter(([,v])=>typeof v==='number'||typeof v==='string').forEach(([k,v])=>add(k,v));
    FORMATS.forEach(f=>add(f.name,'В неделю',s.frequency[f.id],'Минут на оригинал',s.minutes[f.id],'Хвост, %',s.tail[f.id]));
    PLANS.forEach((p,i)=>add(p.name,p.segment,'Цена',s.prices[i],'Вес внутри сегмента',s.mix[i]));
    CHANNELS.forEach(c=>add(c.name,s.channels[c.id].formats.join(', '),'Просмотров на размещение',s.channels[c.id].views,'CTR, %',s.channels[c.id].ctr));
    add('Сценарий','Месяц','Оригиналы','Размещения','Просмотры','Старые просмотры','Переходы','Новые посетители','Регистрации','Первые оплаты','Новые личные','Новые бизнес','Активные','Перестали оплачивать','Оплаты, ₽','Учтено оплат, ₽','Первые начисления, ₽','Продления, ₽','Всего начислено, ₽','Накоплено, ₽','Часы','Расходы, ₽','После расходов, ₽',...PLANS.map(p=>'Клиенты: '+p.name),...PLANS.map(p=>'Повышения: '+p.name));
    Object.entries(SCENARIOS).forEach(([id,sc])=>{
      add(sc.name,'Множители',sc.views,sc.registration,sc.payment);
      forecast(s,id).months.forEach(m=>add(sc.name,m.month,...[m.originals,m.placements,m.views,m.oldViews,m.clicks,m.visitors,m.registrations,m.newPaid,m.newPersonal,m.newBusiness,m.active,m.churned,m.payments,m.eligiblePayments,m.newReward,m.repeatReward,m.reward,m.cumulative,m.hours,m.costs,m.net,...m.byPlan,...m.upgrades].map(v=>v.toFixed(4).replace('.',','))));
    });
    return '\uFEFF'+lines.join('\r\n');
  }
  globalThis.SyntolkForecast=Object.freeze({ WEEKS,COMMISSION,VERIFIED,FORMATS,PLANS,CHANNELS,SCENARIOS,PROFILES,defaults,normalize,workload,fitBudget,transition,forecast,csv });
})();
