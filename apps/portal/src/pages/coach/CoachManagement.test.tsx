// @vitest-environment jsdom
import {useState} from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AdminManagement,CoachInterview,ManagementFields,PartnerManagement,TaskFollowThrough,defaultManagement,defaultQuestions,type InterviewAnswer} from './CoachManagement.js';
import {api} from '../../api.js';
vi.mock('../../api.js',()=>({api:vi.fn(),currentTenantSlug:()=>null}));
let client:QueryClient;
beforeEach(()=>{client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});vi.mocked(api).mockResolvedValue({});});
afterEach(()=>{cleanup();client.clear();vi.clearAllMocks();});
const show=(ui:React.ReactNode)=>render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
function Interview(){const [answers,setAnswers]=useState<InterviewAnswer[]>([]);return <><CoachInterview questions={defaultQuestions} answers={answers} onChange={setAnswers}/><output>{JSON.stringify(answers)}</output></>;}
const task={status:'planned',dueAt:'2026-10-01T10:00:00Z',data:{}};
const counts={open:1,overdue:1,waitingReview:0,completed:0,needsManager:1};
const nextTask={id:'own-task',title:'Снять кружочек',status:'planned',dueAt:task.dueAt,overdue:true,overdueHours:72,reschedules:2,needsManager:true,reasons:['Партнёр сообщил о препятствии'],lastCheckIn:{at:task.dueAt,state:'blocked',text:'Нужны первые пять секунд'}};
describe('manager controls and interview',()=>{
  it('starts with a free answer, keeps it between questions and blocks empty required steps',()=>{
    show(<Interview/>);expect(screen.getByRole('heading',{name:'Сначала познакомимся — вашими словами'})).toBeTruthy();
    expect((screen.getByRole('button',{name:'Следующий вопрос'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'Хочу развивать свой канал и получать доход'}});fireEvent.click(screen.getByRole('button',{name:'Следующий вопрос'}));
    expect(screen.getByText(/Какой контент вам нравится/)).toBeTruthy();fireEvent.change(screen.getByRole('textbox'),{target:{value:'Люблю короткие кружочки, два раза в неделю'}});
    fireEvent.click(screen.getByRole('button',{name:'Предыдущий вопрос'}));expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Хочу развивать свой канал и получать доход');
    fireEvent.click(screen.getByRole('button',{name:'Все вопросы и ответы'}));expect(screen.getAllByRole('textbox')).toHaveLength(5);expect(screen.getByRole('status').textContent).toContain('два раза в неделю');
  });
  it('does not replace a free answer with a predefined format',()=>{
    const changed=vi.fn();show(<CoachInterview questions={[{id:'own',question:'Какой у вас собственный формат?',required:false}]} answers={[]} onChange={changed}/>);
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'Разбор документов на экране без камеры'}});
    expect(changed).toHaveBeenCalledWith([{id:'own',question:'Какой у вас собственный формат?',answer:'Разбор документов на экране без камеры'}]);
  });
  it('exposes all management settings including strictness and replacement rules',()=>{
    const changed=vi.fn();show(<ManagementFields value={defaultManagement} onChange={changed}/>);
    fireEvent.change(screen.getByLabelText('Требовательность куратора'),{target:{value:'strict'}});expect(changed).toHaveBeenLastCalledWith({...defaultManagement,style:'strict'});
    fireEvent.change(screen.getByLabelText('Переносов без согласования менеджером'),{target:{value:'0'}});expect(changed).toHaveBeenLastCalledWith({...defaultManagement,maxReschedules:0});
    fireEvent.click(screen.getByLabelText('Не заменять незавершённую работу новым планом'));expect(changed).toHaveBeenLastCalledWith({...defaultManagement,preventPlanReplacement:false});
  });
  it('saves a blocked report without marking completion and keeps the draft on failure',async()=>{
    const action=vi.fn().mockResolvedValue(false);show(<TaskFollowThrough task={task} busy={false} action={action}/>);
    fireEvent.change(screen.getByLabelText('Отчёт о ходе работы'),{target:{value:'Не знаю, как начать ролик'}});fireEvent.change(screen.getByLabelText('Состояние работы'),{target:{value:'blocked'}});
    fireEvent.click(screen.getByRole('button',{name:'Сохранить отчёт о ходе работы'}));await waitFor(()=>expect(action).toHaveBeenCalledWith('check-in',{state:'blocked',text:'Не знаю, как начать ролик'}));
    expect((screen.getByLabelText('Отчёт о ходе работы') as HTMLTextAreaElement).value).toBe('Не знаю, как начать ролик');expect(action).not.toHaveBeenCalledWith('complete',expect.anything());
  });
  it('requires the configured reason before postponing and allows cancelling the form',async()=>{
    const action=vi.fn().mockResolvedValue(true);show(<TaskFollowThrough task={task} busy={false} action={action}/>);
    fireEvent.click(screen.getByRole('button',{name:'Согласовать новый срок'}));expect((screen.getByRole('button',{name:'Подтвердить перенос'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Причина переноса'),{target:{value:'Нужен вечер для записи'}});fireEvent.click(screen.getByRole('button',{name:'Подтвердить перенос'}));
    await waitFor(()=>expect(action).toHaveBeenCalledWith('reschedule',expect.objectContaining({reason:'Нужен вечер для записи',dueAt:expect.any(String)})));
    await waitFor(()=>expect(screen.queryByLabelText('Причина переноса')).toBeNull());
  });
  it('does not let work awaiting review be restarted or postponed',()=>{
    show(<TaskFollowThrough task={{...task,status:'needs_human'}} busy={false} action={vi.fn()}/>);
    expect(screen.queryByRole('button',{name:'Согласовать новый срок'})).toBeNull();expect(screen.queryByLabelText('Отчёт о ходе работы')).toBeNull();
  });
  it('returns the partner to their actual unfinished work, not a new abstract plan',()=>{
    const ask=vi.fn();client.setQueryData(['coach-management',null,'own-partner','own-program'],{counts,nextTask,policy:defaultManagement,tasks:[nextTask]});
    show(<PartnerManagement prefix="/coach/me" partnerId="own-partner" programId="own-program" onAsk={ask}/>);
    expect(screen.getByText(/Нужны первые пять секунд/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Помоги закончить эту работу'}));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('«Снять кружочек»'));expect(ask).toHaveBeenCalledWith(expect.stringContaining('не создавай новый план'));
  });
  it('opens the correct partner from the admin control list',()=>{
    const select=vi.fn();client.setQueryData(['coach-control',null],{items:[{partnerId:'ivan',name:'Иван',profileComplete:true,counts,nextTask,tasks:[nextTask]}],limit:200});
    show(<AdminManagement onSelect={select}/>);expect(screen.getByText('Снять кружочек: Партнёр сообщил о препятствии')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Открыть сопровождение'}));expect(select).toHaveBeenCalledWith('ivan');
  });
});
