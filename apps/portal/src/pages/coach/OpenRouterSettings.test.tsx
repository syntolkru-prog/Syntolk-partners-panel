// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {OpenRouterSettings} from './OpenRouterSettings.js';
import {api} from '../../api.js';
const tenant=vi.hoisted(()=>({value:null as string|null}));
vi.mock('../../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>tenant.value}));
let client:QueryClient;
const initial={version:'v1',hasKey:true,keySource:'ui',model:'test/model',modelSelection:'catalog' as const,secureStorage:true,verification:null};
const changed=vi.fn();
beforeEach(()=>{tenant.value=null;sessionStorage.clear();client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});client.setQueryData(['coach-openrouter',null],initial);client.setQueryData(['coach-models',null],{models:[{id:'test/model',name:'Тестовая модель',contextLength:10000,inputPerMillion:1,outputPerMillion:2},{id:'other/model',name:'Другая модель',contextLength:10000,inputPerMillion:0,outputPerMillion:0}]});vi.mocked(api).mockResolvedValue(initial);});
afterEach(()=>{cleanup();client.clear();sessionStorage.clear();tenant.value=null;vi.clearAllMocks();});
function show(){return render(<QueryClientProvider client={client}><div className="coach"><OpenRouterSettings enabled={true} provider="template" dailyRuns={20} onChanged={changed}/></div></QueryClientProvider>);}
describe('OpenRouter settings UI',()=>{
  it('can persist an environment connection before its first explicit probe without retyping its key',async()=>{
    client.setQueryData(['coach-openrouter',null],{...initial,version:'env',keySource:'env'});show();
    expect((screen.getByRole('button',{name:'Сохранить ключ и модель'}) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'Сохранить ключ и модель'}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/admin/coach/openrouter',{method:'PUT',body:{version:'env',model:'test/model',modelSelection:'catalog'}}));
  });
  it('has a password field, compatible model chooser and guarded activation',()=>{show();expect((screen.getByLabelText('API-ключ OpenRouter') as HTMLInputElement).type).toBe('password');expect(screen.getByLabelText('Модель')).toBeTruthy();expect((screen.getByRole('button',{name:'Включить ИИ OpenRouter'}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'Проверить подключение'}) as HTMLButtonElement).disabled).toBe(true);});
  it('saves a new key only in the request body, clears the field and caches no secret',async()=>{show();const key='draft-key';vi.mocked(api).mockResolvedValue({...initial,version:'v2'});fireEvent.change(screen.getByLabelText('API-ключ OpenRouter'),{target:{value:key}});fireEvent.click(screen.getByRole('button',{name:'Сохранить ключ и модель'}));await waitFor(()=>expect(screen.getByText('Настройки сохранены. Теперь можно проверить подключение.')).toBeTruthy());expect(api).toHaveBeenCalledWith('/admin/coach/openrouter',{method:'PUT',body:{version:'v1',apiKey:key,model:'test/model',modelSelection:'catalog'}});expect((screen.getByLabelText('API-ключ OpenRouter') as HTMLInputElement).value).toBe('');expect(JSON.stringify(client.getQueryData(['coach-openrouter',null]))).not.toContain(key);});
  it('does not erase a saved key when only a model changes',async()=>{show();fireEvent.change(screen.getByLabelText('Модель'),{target:{value:'other/model'}});fireEvent.click(screen.getByRole('button',{name:'Сохранить ключ и модель'}));await waitFor(()=>expect(api).toHaveBeenCalledWith('/admin/coach/openrouter',{method:'PUT',body:{version:'v1',model:'other/model',modelSelection:'catalog'}}));});
  it('restores manual model selection from the server after remount',async()=>{client.setQueryData(['coach-openrouter',null],{...initial,model:'provider/manual',modelSelection:'manual'});show();await waitFor(()=>expect((screen.getByLabelText('Указать ID модели вручную') as HTMLInputElement).checked).toBe(true));expect((screen.getByLabelText('ID модели OpenRouter') as HTMLInputElement).value).toBe('provider/manual');});
  it('saves an explicit manual model change',async()=>{show();fireEvent.click(screen.getByLabelText('Указать ID модели вручную'));fireEvent.change(screen.getByLabelText('ID модели OpenRouter'),{target:{value:'provider/new-model'}});vi.mocked(api).mockResolvedValue({...initial,version:'v2',model:'provider/new-model',modelSelection:'manual'});fireEvent.click(screen.getByRole('button',{name:'Сохранить ключ и модель'}));await waitFor(()=>expect(api).toHaveBeenCalledWith('/admin/coach/openrouter',{method:'PUT',body:{version:'v1',model:'provider/new-model',modelSelection:'manual'}}));});
  it('keeps dirty draft fields and original version when a newer server response arrives',async()=>{show();fireEvent.change(screen.getByLabelText('Модель'),{target:{value:'other/model'}});fireEvent.change(screen.getByLabelText('API-ключ OpenRouter'),{target:{value:'draft-key'}});client.setQueryData(['coach-openrouter',null],{...initial,version:'v2',model:'server/model'});await waitFor(()=>expect((screen.getByLabelText('Модель') as HTMLSelectElement).value).toBe('other/model'));expect((screen.getByLabelText('API-ключ OpenRouter') as HTMLInputElement).value).toBe('draft-key');fireEvent.click(screen.getByRole('button',{name:'Сохранить ключ и модель'}));await waitFor(()=>expect(api).toHaveBeenCalledWith('/admin/coach/openrouter',{method:'PUT',body:{version:'v1',apiKey:'draft-key',model:'other/model',modelSelection:'catalog'}}));});
  it('rebases a pristine form to a newer server snapshot before saving',async()=>{show();client.setQueryData(['coach-openrouter',null],{...initial,version:'v2',model:'server/model'});await waitFor(()=>expect((screen.getByLabelText('Модель') as HTMLSelectElement).value).toBe('server/model'));fireEvent.change(screen.getByLabelText('Модель'),{target:{value:'other/model'}});fireEvent.click(screen.getByRole('button',{name:'Сохранить ключ и модель'}));await waitFor(()=>expect(api).toHaveBeenCalledWith('/admin/coach/openrouter',{method:'PUT',body:{version:'v2',model:'other/model',modelSelection:'catalog'}}));});
  it('requires cost consent and saved changes before a paid check',async()=>{show();fireEvent.click(screen.getByLabelText(/Разрешаю тестовые запросы/));expect((screen.getByRole('button',{name:'Проверить подключение'}) as HTMLButtonElement).disabled).toBe(false);fireEvent.change(screen.getByLabelText('Модель'),{target:{value:'other/model'}});expect((screen.getByRole('button',{name:'Проверить подключение'}) as HTMLButtonElement).disabled).toBe(true);expect(api).not.toHaveBeenCalled();});
  it('keeps paid-test consent after a meaningful save and skips no-op saves',async()=>{show();const save=screen.getByRole('button',{name:'Сохранить ключ и модель'}) as HTMLButtonElement;expect(save.disabled).toBe(true);fireEvent.click(screen.getByLabelText(/Разрешаю тестовые запросы/));expect((screen.getByRole('button',{name:'Проверить подключение'}) as HTMLButtonElement).disabled).toBe(false);fireEvent.change(screen.getByLabelText('Модель'),{target:{value:'other/model'}});vi.mocked(api).mockResolvedValue({...initial,version:'v2',model:'other/model'});fireEvent.click(save);await waitFor(()=>expect(screen.getByText('Настройки сохранены. Теперь можно проверить подключение.')).toBeTruthy());expect((screen.getByLabelText(/Разрешаю тестовые запросы/) as HTMLInputElement).checked).toBe(true);expect((screen.getByRole('button',{name:'Проверить подключение'}) as HTMLButtonElement).disabled).toBe(false);expect(api).toHaveBeenCalledTimes(1);});
  it('reports that a verified enabled connection remains verified after metadata save',async()=>{client.setQueryData(['coach-openrouter',null],{...initial,verification:{ok:true,at:'2026-10-12T19:00:00Z',detail:'Проверено',model:'test/model'}});const view=render(<QueryClientProvider client={client}><div className="coach"><OpenRouterSettings enabled={true} provider="openrouter" dailyRuns={20} onChanged={changed}/></div></QueryClientProvider>);fireEvent.click(screen.getByLabelText('Указать ID модели вручную'));fireEvent.change(screen.getByLabelText('ID модели OpenRouter'),{target:{value:'test/model'}});vi.mocked(api).mockResolvedValue({...initial,modelSelection:'manual',verification:{ok:true,at:'2026-10-12T19:00:00Z',detail:'Проверено',model:'test/model'}});fireEvent.click(screen.getByRole('button',{name:'Сохранить ключ и модель'}));await waitFor(()=>expect(screen.getByText('Настройки сохранены. ИИ остаётся включённым, подключение проверено.')).toBeTruthy());expect(screen.getByText('Проверка пройдена')).toBeTruthy();view.unmount();});
  it('reloads an actionable server version after conflict without forcing key re-entry',async()=>{show();fireEvent.change(screen.getByLabelText('Модель'),{target:{value:'other/model'}});let refreshed=false;vi.mocked(api).mockImplementation(async path=>{if(path==='/admin/coach/openrouter'&&!refreshed)throw Object.assign(new Error('conflict'),{status:409});if(path==='/admin/coach/openrouter')return {...initial,version:'v2',model:'server/model'};return initial as never;});fireEvent.click(screen.getByRole('button',{name:'Сохранить ключ и модель'}));await waitFor(()=>expect(screen.getByText('Настройки изменились на сервере')).toBeTruthy());refreshed=true;fireEvent.click(screen.getByRole('button',{name:'Обновить серверные данные'}));await waitFor(()=>expect(screen.getByText('Серверная версия обновлена. Черновик сохранён.')).toBeTruthy());expect((screen.getByLabelText('Модель') as HTMLSelectElement).value).toBe('other/model');expect((screen.getByLabelText('API-ключ OpenRouter') as HTMLInputElement).value).toBe('');expect((screen.getByRole('button',{name:'Сохранить ключ и модель'}) as HTMLButtonElement).disabled).toBe(false);fireEvent.click(screen.getByRole('button',{name:'Сохранить ключ и модель'}));await waitFor(()=>expect(api).toHaveBeenCalledWith('/admin/coach/openrouter',{method:'PUT',body:{version:'v2',model:'other/model',modelSelection:'catalog'}}));});
  it('shows a failed probe honestly and keeps activation disabled',async()=>{show();vi.mocked(api).mockImplementation(async path=>path.endsWith('/test')?{ok:false,detail:'Модель недоступна'}:initial as never);fireEvent.click(screen.getByLabelText(/Разрешаю тестовые запросы/));fireEvent.click(screen.getByRole('button',{name:'Проверить подключение'}));await waitFor(()=>expect(screen.getByText('Модель недоступна')).toBeTruthy());expect((screen.getByRole('button',{name:'Включить ИИ OpenRouter'}) as HTMLButtonElement).disabled).toBe(true);});
  it('does not claim a conflict was refreshed when loading server data fails',async()=>{
    show();fireEvent.change(screen.getByLabelText('Модель'),{target:{value:'other/model'}});
    vi.mocked(api).mockImplementation(async(_path,options)=>{if(options?.method==='PUT')throw Object.assign(new Error('conflict'),{status:409});throw new Error('Сеть недоступна');});
    fireEvent.click(screen.getByRole('button',{name:'Сохранить ключ и модель'}));
    await waitFor(()=>expect(screen.getByText('Настройки изменились на сервере')).toBeTruthy());
    fireEvent.click(screen.getByRole('button',{name:'Обновить серверные данные'}));
    await waitFor(()=>expect(screen.getAllByText('Сеть недоступна').length).toBeGreaterThan(0));
    expect(screen.queryByText('Серверная версия обновлена. Черновик сохранён.')).toBeNull();
    expect((screen.getByLabelText('Модель') as HTMLSelectElement).value).toBe('other/model');
    expect(screen.getByRole('button',{name:'Обновить серверные данные'})).toBeTruthy();
  });
  it('activates only the verified provider using the strict settings body',async()=>{client.setQueryData(['coach-openrouter',null],{...initial,verification:{ok:true,at:'2026-10-12T19:00:00Z',detail:'Проверено',model:'test/model'}});show();fireEvent.click(screen.getByRole('button',{name:'Включить ИИ OpenRouter'}));await waitFor(()=>expect(api).toHaveBeenCalledWith('/admin/coach/settings',{method:'PATCH',body:{enabled:true,provider:'openrouter',dailyRuns:20}}));expect(changed).toHaveBeenCalled();});
  it('replaces the dead activation button with an explicit active state and chat instructions',()=>{
    client.setQueryData(['coach-openrouter',null],{...initial,verification:{ok:true,at:'2026-10-13T00:00:00Z',detail:'Проверено',model:'test/model'}});
    render(<QueryClientProvider client={client}><OpenRouterSettings enabled={true} provider="openrouter" dailyRuns={20} onChanged={changed}/></QueryClientProvider>);
    expect(screen.getByRole('heading',{name:'4. ИИ-куратор включён'})).toBeTruthy();
    expect(screen.getByText('ИИ OpenRouter включён')).toBeTruthy();
    expect(screen.getByText('Сохранённая модель: test/model. Повторно включать ИИ не нужно.')).toBeTruthy();
    expect(screen.getByText(/Для диалога откройте «Партнёры»/)).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Включить ИИ OpenRouter'})).toBeNull();
    expect((screen.getByRole('button',{name:'Вернуть демонстрационный режим'}) as HTMLButtonElement).disabled).toBe(false);
    expect(api).not.toHaveBeenCalled();
  });
  it('does not invite repeated activation after testing an already enabled model',async()=>{
    const verified={...initial,verification:{ok:true,at:'2026-10-13T00:00:00Z',detail:'Проверено',model:'test/model'}};
    client.setQueryData(['coach-openrouter',null],verified);
    vi.mocked(api).mockImplementation(async path=>path.endsWith('/test')?{ok:true,detail:'Проверено'}:verified as never);
    render(<QueryClientProvider client={client}><OpenRouterSettings enabled={true} provider="openrouter" dailyRuns={20} onChanged={changed}/></QueryClientProvider>);
    fireEvent.click(screen.getByLabelText(/Разрешаю тестовые запросы/));fireEvent.click(screen.getByRole('button',{name:'Проверить подключение'}));
    await waitFor(()=>expect(screen.getByText('Подключение проверено. ИИ OpenRouter включён. Повторное включение не требуется.')).toBeTruthy());
    expect(screen.queryByText('Подключение проверено. Можно включить ИИ.')).toBeNull();
    expect(api).not.toHaveBeenCalledWith('/admin/coach/settings',expect.anything());
  });
  it('updates the probe instructions when the actual provider changes',async()=>{
    const verified={...initial,verification:{ok:true,at:'2026-10-13T00:00:00Z',detail:'Проверено',model:'test/model'}};
    vi.mocked(api).mockImplementation(async path=>path.endsWith('/test')?{ok:true,detail:'Проверено'}:verified as never);
    const view=show();fireEvent.click(screen.getByLabelText(/Разрешаю тестовые запросы/));fireEvent.click(screen.getByRole('button',{name:'Проверить подключение'}));
    await waitFor(()=>expect(screen.getByText('Подключение проверено. Нажмите «Включить ИИ OpenRouter».')).toBeTruthy());
    expect((screen.getByRole('button',{name:'Включить ИИ OpenRouter'}) as HTMLButtonElement).disabled).toBe(false);
    view.rerender(<QueryClientProvider client={client}><div className="coach"><OpenRouterSettings enabled={true} provider="openrouter" dailyRuns={20} onChanged={changed}/></div></QueryClientProvider>);
    expect(screen.getByText('Подключение проверено. ИИ OpenRouter включён. Повторное включение не требуется.')).toBeTruthy();
    expect(screen.queryByText('Подключение проверено. Нажмите «Включить ИИ OpenRouter».')).toBeNull();
  });
  it('explains why activation is disabled instead of leaving a silent dead button',()=>{
    show();expect(screen.getByText('Сначала успешно проверьте подключение.')).toBeTruthy();
    expect((screen.getByRole('button',{name:'Включить ИИ OpenRouter'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps activation busy until the parent has refreshed the server settings',async()=>{
    client.setQueryData(['coach-openrouter',null],{...initial,verification:{ok:true,at:'2026-10-13T00:00:00Z',detail:'Проверено',model:'test/model'}});
    let finishRefresh!:()=>void;
    const refresh=vi.fn(()=>new Promise<void>(resolve=>{finishRefresh=resolve;}));
    render(<QueryClientProvider client={client}><OpenRouterSettings enabled={false} provider="openrouter" dailyRuns={20} onChanged={refresh}/></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button',{name:'Включить ИИ OpenRouter'}));
    await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
    expect((screen.getByRole('button',{name:'Включаем…'}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('ИИ-куратор включён. Партнёрам доступен диалог.')).toBeNull();
    finishRefresh();await waitFor(()=>expect(screen.getByText('ИИ-куратор включён. Партнёрам доступен диалог.')).toBeTruthy());
  });
  it('reports an activation failure without claiming that AI was enabled',async()=>{
    client.setQueryData(['coach-openrouter',null],{...initial,verification:{ok:true,at:'2026-10-13T00:00:00Z',detail:'Проверено',model:'test/model'}});
    show();vi.mocked(api).mockRejectedValue(new Error('Сервер недоступен'));
    fireEvent.click(screen.getByRole('button',{name:'Включить ИИ OpenRouter'}));
    await waitFor(()=>expect(screen.getByText('Сервер недоступен')).toBeTruthy());
    expect(screen.queryByText('ИИ-куратор включён. Партнёрам доступен диалог.')).toBeNull();
    expect(screen.queryByText('ИИ OpenRouter включён')).toBeNull();expect(changed).not.toHaveBeenCalled();
  });
  it('requires explicit confirmation to remove a connection',async()=>{show();fireEvent.click(screen.getByRole('button',{name:'Удалить подключение'}));expect(api).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Отмена'})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Да, удалить подключение'}));await waitFor(()=>expect(api).toHaveBeenCalledWith('/admin/coach/openrouter',{method:'DELETE',body:{version:'v1'}}));});
  it('clears drafts and keeps paid-test consent isolated when the tenant changes',async()=>{const view=show();fireEvent.change(screen.getByLabelText('API-ключ OpenRouter'),{target:{value:'tenant-a-draft'}});fireEvent.click(screen.getByLabelText(/Разрешаю тестовые запросы/));tenant.value='tenant-b';client.setQueryData(['coach-openrouter','tenant-b'],{...initial,version:'b1',model:'tenant-b/model',modelSelection:'manual'});client.setQueryData(['coach-models','tenant-b'],{models:[]});view.rerender(<QueryClientProvider client={client}><div className="coach"><OpenRouterSettings enabled={true} provider="template" dailyRuns={20} onChanged={changed}/></div></QueryClientProvider>);await waitFor(()=>expect((screen.getByLabelText('ID модели OpenRouter') as HTMLInputElement).value).toBe('tenant-b/model'));expect((screen.getByLabelText('API-ключ OpenRouter') as HTMLInputElement).value).toBe('');expect((screen.getByLabelText(/Разрешаю тестовые запросы/) as HTMLInputElement).checked).toBe(false);});
});
