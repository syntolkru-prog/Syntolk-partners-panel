// @vitest-environment jsdom
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {api} from '../../api.js';
import {PartnerWorkCalendar} from './PartnerWorkCalendar.js';
import type {CalendarMaterial} from './work-calendar-model.js';
vi.mock('../../api.js',()=>({api:vi.fn(),apiBlob:vi.fn(),currentTenantSlug:()=>null}));
vi.mock('../MaterialEditor.js',()=>({MaterialEditor:()=> <div>Размещения материала</div>,materialError:(error:unknown)=>error}));
beforeAll(()=>{Object.defineProperty(HTMLDialogElement.prototype,'showModal',{value:function(this:HTMLDialogElement){this.setAttribute('open','');},configurable:true});});
let client:QueryClient,materials:CalendarMaterial[],content='',failUpload=false;
afterEach(()=>{cleanup();client?.clear();vi.clearAllMocks();localStorage.clear();});
async function show(url='/plan?day=2026-10-23'){
  content='';failUpload=false;materials=[{id:'one',title:'Мой ролик',formatId:'short',formatName:'Короткое видео',scenarioId:null,scheduledDay:'2026-10-23',platforms:[{id:'vk',name:'ВКонтакте'}],revision:1,ready:false,hasContent:false,fileCount:0,status:'draft',totalPlacements:1,publishedPlacements:0}];
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  vi.mocked(api).mockImplementation(async(path,options)=>{
    if(path==='/coach/me')return {programs:[{id:'program',name:'Syntolk'}]};
    if(path.includes('material-catalog'))return {formats:[{id:'short',name:'Короткое видео'}],platforms:[{id:'vk',name:'ВКонтакте',formats:['short']}],scenarios:[{id:'scenario',name:'Мой план'}]};
    if(path.includes('work-calendar'))return {today:'2026-10-23',materials:[...materials],plans:[]};
    if(path.endsWith('/workspace')){const body=options?.body as {revision:number;content?:string;scheduledDay?:string|null;ready?:boolean};const index=materials.findIndex(m=>path.includes('/'+m.id+'/'));const m=materials[index]!;materials[index]={...m,...body,revision:m.revision+1};if(body.content!==undefined)content=body.content;return {ok:true,revision:materials[index]!.revision};}
    if(path.endsWith('/files')){if(failUpload){failUpload=false;throw new Error('Сеть недоступна');}return {file:{id:'file'}};}
    if(path.endsWith('/materials')&&options?.method==='POST'){const body=options.body as CalendarMaterial;const material={...materials[0]!,...body,revision:1};if(!materials.some(m=>m.id===material.id))materials.push(material);return {material};}
    if(path.includes('/materials/')&&options?.method==='DELETE'){materials=materials.filter(m=>!path.endsWith('/'+m.id));return {ok:true};}
    if(path.includes('/materials/')){const m=materials.find(m=>path.endsWith('/'+m.id))??materials[0]!;return {material:{...m,content},files:[],placements:[]};}
    return {};
  });
  render(<MemoryRouter initialEntries={[url]}><QueryClientProvider client={client}><PartnerWorkCalendar partnerId="partner"/></QueryClientProvider></MemoryRouter>);
  await screen.findByRole('button',{name:/Мой ролик/});
}
describe('partner work calendar',()=>{
  it.each(['plan','materials'])('deletes a material from %s and keeps it removed after switching views',async(view)=>{
    await show();if(view==='materials'){materials[0]!.scheduledDay=null;await client.invalidateQueries({queryKey:['work-calendar']});fireEvent.click(screen.getByRole('button',{name:/^Материалы \d+$/}));}
    fireEvent.click(screen.getByRole('button',{name:/Мой ролик/}));const dialog=await screen.findByRole('dialog');await within(dialog).findByLabelText('Текст материала');
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
    fireEvent.click(within(dialog).getByRole('button',{name:'Удалить материал'}));expect(vi.mocked(api).mock.calls.some(([,o])=>o?.method==='DELETE')).toBe(false);
    confirm.mockReturnValue(true);fireEvent.click(within(dialog).getByRole('button',{name:'Удалить материал'}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/partners/partner/materials/one',{method:'DELETE',body:{revision:1}}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());await waitFor(()=>expect(screen.queryByRole('button',{name:/Мой ролик/})).toBeNull());
    fireEvent.click(screen.getByRole('button',{name:view==='materials'?'План':/^Материалы \d+$/}));expect(screen.queryByRole('button',{name:/Мой ролик/})).toBeNull();
    confirm.mockRestore();
  });
  it('keeps the material open and shows a failed deletion instead of hiding it',async()=>{
    await show();fireEvent.click(screen.getByRole('button',{name:/Мой ролик/}));const dialog=await screen.findByRole('dialog');await within(dialog).findByLabelText('Текст материала');
    const original=vi.mocked(api).getMockImplementation()!;vi.mocked(api).mockImplementation(async(p,o)=>{if(o?.method==='DELETE')throw new Error('Материал изменён в другой вкладке');return original(p,o);});
    const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);fireEvent.click(within(dialog).getByRole('button',{name:'Удалить материал'}));
    expect(await within(dialog).findByText('Материал изменён в другой вкладке')).toBeTruthy();expect(screen.getByRole('dialog')).toBeTruthy();expect(materials).toHaveLength(1);confirm.mockRestore();
  });
  it('keeps material cards as standard dialogs without window management',async()=>{
    await show();fireEvent.click(screen.getByRole('button',{name:/Мой ролик/}));const dialog=await screen.findByRole('dialog');
    await within(dialog).findByLabelText('Текст материала');
    expect(dialog.className).toBe('wc-dialog wc-dialog--drawer');expect(dialog.getAttribute('style')).toBeNull();
    expect(within(dialog).queryByRole('button',{name:'Свернуть окно'})).toBeNull();expect(within(dialog).queryByRole('button',{name:'Развернуть окно'})).toBeNull();expect(dialog.querySelectorAll('[data-window-edge]')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button',{name:'Закрыть'}));expect(screen.queryByRole('dialog')).toBeNull();
    expect(vi.mocked(api).mock.calls.every(([,options])=>!options?.method)).toBe(true);
  });
  it('keeps plan and stock separate, with period and filters in compact menus',async()=>{
    await show();expect(screen.getByRole('button',{name:'План'}).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByText('Фильтры',{selector:'summary'}));expect((screen.getByLabelText('Сценарий календаря') as HTMLSelectElement).value).toBe('all');
    fireEvent.click(screen.getByRole('button',{name:/Материалы 0/}));expect(screen.queryByLabelText('Сводка календаря')).toBeNull();expect(screen.getByText('Запас материалов')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'План'}));fireEvent.click(document.querySelector('.wc-period-picker summary')!);fireEvent.change(screen.getByLabelText('Вид календаря'),{target:{value:'month'}});
    expect(screen.getByLabelText('1 октября')).toBeTruthy();expect(vi.mocked(api).mock.calls.every(([,o])=>!o?.method)).toBe(true);
  });
  it('saves text, date and readiness together without inventing a publication',async()=>{
    await show();fireEvent.click(screen.getByRole('button',{name:/Мой ролик/}));const dialog=await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText('Текст материала'),{target:{value:'Черновик'}});fireEvent.change(within(dialog).getByLabelText('День публикации'),{target:{value:'2026-10-26'}});fireEvent.change(within(dialog).getByLabelText('Время публикации'),{target:{value:'12:30'}});fireEvent.click(within(dialog).getByRole('checkbox',{name:/Материал готов/}));
    fireEvent.click(within(dialog).getByRole('button',{name:'Сохранить'}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/partners/partner/materials/one/workspace',{method:'PATCH',body:{revision:1,title:'Мой ролик',content:'Черновик',scheduledDay:'2026-10-26',scheduledTime:'12:30',ready:true}}));
    expect(vi.mocked(api).mock.calls.some(([p])=>p.includes('link-sources'))).toBe(false);
    await within(dialog).findByText('Сохранено');expect((within(dialog).getByLabelText('Текст материала') as HTMLTextAreaElement).value).toBe('Черновик');
  });
  it('enters publication separately and keeps placement controls',async()=>{
    await show();fireEvent.click(screen.getByRole('button',{name:/Мой ролик/}));const dialog=await screen.findByRole('dialog');await within(dialog).findByLabelText('Текст материала');fireEvent.click(within(dialog).getByRole('button',{name:'К публикации'}));expect(within(dialog).getByText('Размещения материала')).toBeTruthy();expect(within(dialog).getByRole('tab',{name:'Публикация'}).getAttribute('aria-selected')).toBe('true');
  });
  it('accepts a drag between days without duplicating or publishing the material',async()=>{
    await show();const target=screen.getByLabelText('24 октября');fireEvent.drop(target,{dataTransfer:{getData:()=> 'one'}});
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/partners/partner/materials/one/workspace',{method:'PATCH',body:{revision:1,scheduledDay:'2026-10-24'}}));
  });
  it('creates a standalone undated material with text without forcing a scenario',async()=>{
    await show();fireEvent.click(screen.getByRole('button',{name:'Добавить материал'}));const dialog=await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Название материала'),{target:{value:'Отснятый ролик'}});fireEvent.change(within(dialog).getByLabelText('Текст материала'),{target:{value:'Описание'}});fireEvent.click(within(dialog).getByRole('checkbox',{name:'ВКонтакте'}));fireEvent.click(within(dialog).getByRole('button',{name:'Сохранить'}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/partners/partner/materials',expect.objectContaining({method:'POST',body:expect.objectContaining({scenarioId:null,scheduledDay:null,title:'Отснятый ролик',content:'Описание',platforms:[{id:'vk',name:'ВКонтакте'}]})})));
  });
  it('groups several files in one material by default and retries without duplicate creation',async()=>{
    await show();fireEvent.click(screen.getByRole('button',{name:/Материалы 0/}));fireEvent.click(screen.getAllByRole('button',{name:'Загрузить файлы'})[0]!);const dialog=await screen.findByRole('dialog');
    fireEvent.change(dialog.querySelector('input[type=file]')!,{target:{files:[new File(['text'],'one.txt',{type:'text/plain'}),new File(['text2'],'two.txt',{type:'text/plain'})]}});failUpload=true;
    fireEvent.click(within(dialog).getByRole('button',{name:'Сохранить'}));await within(dialog).findByText('Сеть недоступна');fireEvent.click(within(dialog).getByRole('button',{name:'Повторить загрузку'}));
    await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Загрузить материалы'})).toBeNull());
    const creates=vi.mocked(api).mock.calls.filter(([p,o])=>p.endsWith('/materials')&&o?.method==='POST');expect(creates).toHaveLength(1);
    const uploads=vi.mocked(api).mock.calls.filter(([p])=>p.endsWith('/files'));expect(uploads).toHaveLength(3);expect(uploads[0]![1]?.headers).toEqual(uploads[1]![1]?.headers);expect(new Set(uploads.map(([p])=>p)).size).toBe(1);
  });
  it('can explicitly import separate materials for separate files',async()=>{
    await show();fireEvent.click(screen.getByRole('button',{name:/Материалы 0/}));fireEvent.click(screen.getAllByRole('button',{name:'Загрузить файлы'})[0]!);const dialog=await screen.findByRole('dialog');fireEvent.click(within(dialog).getByRole('checkbox',{name:'Отдельный материал для каждого файла'}));fireEvent.change(dialog.querySelector('input[type=file]')!,{target:{files:[new File(['a'],'a.txt'),new File(['b'],'b.txt')]}});fireEvent.click(within(dialog).getByRole('button',{name:'Сохранить'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(vi.mocked(api).mock.calls.filter(([p,o])=>p.endsWith('/materials')&&o?.method==='POST')).toHaveLength(2);
  });
  it('refuses oversized files before creating an empty material',async()=>{
    await show();fireEvent.click(screen.getByRole('button',{name:'Добавить материал'}));const dialog=await screen.findByRole('dialog');const file=new File(['x'],'too-big.mp4');Object.defineProperty(file,'size',{value:101*1024*1024});fireEvent.change(dialog.querySelector('input[type=file]')!,{target:{files:[file]}});expect(await within(dialog).findByText('Размер файла: от 1 байта до 100 МБ.')).toBeTruthy();expect(vi.mocked(api).mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
  });
});
