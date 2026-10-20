// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {api} from '../api.js';
import {LinksPage} from './Links.js';

vi.mock('../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
let client:QueryClient;
afterEach(()=>{cleanup();client?.clear();vi.clearAllMocks();});

it('shows permanent links without scenario sources and keeps historical links collapsed',async()=>{
  const link={id:'base',linkKey:'partner',programId:'p',createdAt:'2026-10-15',label:'Мой канал',channel:null};
  vi.mocked(api).mockImplementation(async path=>path==='/me/programs'?{programs:[{id:'p',name:'Syntolk',destinationUrl:'https://syntolk.ru'}]}:path.includes('/analytics?')?{rows:[],period:{since:'2026-09-20T21:00:00Z',until:'2026-10-20T12:00:00Z'}}:{links:[link,{...link,id:'old',linkKey:'old-partner',label:'Старая ссылка',archived:true}]});
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/links?view=links']}><LinksPage principal={{role:'partner',partnerId:'partner'}}/></MemoryRouter></QueryClientProvider>);
  await screen.findByText('Мой канал');
  expect(screen.getByText('Архив').closest('details')!.open).toBe(false);
  expect(screen.queryByLabelText('Сценарий ссылок')).toBeNull();
  expect(screen.queryByText('Ссылки источников сценария')).toBeNull();
  expect(vi.mocked(api).mock.calls.every(([path])=>!path.includes('/link-sources'))).toBe(true);
});
