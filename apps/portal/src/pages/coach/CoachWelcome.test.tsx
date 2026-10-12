// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {CoachWelcome} from './CoachWelcome.js';
vi.mock('../../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
afterEach(()=>cleanup());
function setup(extra:object={},onAction?:ReturnType<typeof vi.fn>){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  client.setQueryData(['coach',null,'p','/coach/me','welcome'],{enabled:true,paused:false,needsOnboarding:false,takeover:false,message:'Привет, Иван! Я твой ИИ-помощник.',task:null,...extra});
  render(<MemoryRouter><QueryClientProvider client={client}><CoachWelcome partnerId="p" onAction={onAction}/></QueryClientProvider></MemoryRouter>);
}
describe('entry assistant',()=>{
  it('links to accompaniment on the dashboard without calling a model',()=>{setup();expect(screen.getByRole('link',{name:'Продолжить с помощником →'}).getAttribute('href')).toBe('/coach');});
  it('offers a 20-minute conversation without silently sending or changing the profile',()=>{const action=vi.fn();setup({},action);fireEvent.click(screen.getByRole('button',{name:'У меня 20 минут'}));expect(action).toHaveBeenCalledWith('chat',20);});
  it('respects pause',()=>{setup({paused:true},vi.fn());expect(screen.queryByRole('button',{name:'У меня 20 минут'})).toBeNull();expect(screen.getByRole('button',{name:'Настройки сопровождения'})).toBeTruthy();});
  it('does not interfere when the module is disabled',()=>{setup({enabled:false});expect(screen.queryByText('Твой помощник Syntolk')).toBeNull();});
});
