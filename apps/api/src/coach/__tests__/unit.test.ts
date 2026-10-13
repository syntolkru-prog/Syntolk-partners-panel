import { describe, expect, it } from 'vitest';
import { profileSchema, validatePlan, shouldRemind, safePublicationUrl } from '../schemas.js';
import { templatePlan } from '../planner.js';
import { assertIsolatedCoachDatabase } from '../test-guard.js';
import { calculateCoachForecast } from '../forecast-adapter.js';
import { welcomeMessage } from '../welcome.js';
import { validateGeneratedPlan, planSummary } from '../plan-validation.js';

export const profile = profileSchema.parse({goalMinor:3000000,goalMetric:'monthly_net_accrual',targetDate:'2027-01-01',weeklyMinutes:120,sessionMinutes:30,daysPerWeek:3,timezone:'Europe/Moscow',channels:[{platform:'telegram',label:'Тестовый канал',formats:['post','circle'],audience:'Юристы',views:null}],experience:'tried',productUnderstanding:'Помощник по документам',preferences:'Без камеры',mode:'on_request',quietStart:21,quietEnd:9,proactiveConsent:false});
describe('A01: guard before any database mutation',()=>{
  it('rejects working DB, even with different credentials',()=>{expect(()=>assertIsolatedCoachDatabase('postgres://other:pass@localhost:5433/openpartner')).toThrow();expect(()=>assertIsolatedCoachDatabase('postgres://a@localhost:5433/x_test','postgres://b@localhost:5433/x_test')).toThrow();});
  it('accepts explicitly isolated database',()=>expect(()=>assertIsolatedCoachDatabase('postgres://a@localhost:5433/coach_test','postgres://a@localhost:5433/openpartner')).not.toThrow());
});
describe('B05: constrained planning',()=>{
  it('computes the displayed plan summary from tasks, not model prose',()=>{
    const plan=templatePlan(profile);expect(planSummary(plan.tasks,profile)).toContain('3 задания, 90 из 120');
  });
  it('repairs arithmetic once and validates the repaired result',async()=>{
    const valid={output:templatePlan(profile),usage:{},model:'mock'};
    const bad=structuredClone(valid);bad.output.tasks[0]!.steps[0]!.minutes++;
    let calls=0;
    const fixed=await validateGeneratedPlan(bad,profile,async feedback=>{calls++;expect(feedback).toContain('Время шагов');return valid;});
    expect(calls).toBe(1);expect(fixed).toBe(valid);
  });
  it('does not accept a second invalid answer or retry forever',async()=>{
    const bad={output:templatePlan(profile),usage:{},model:'mock'};bad.output.tasks[0]!.minutes++;
    let calls=0;await expect(validateGeneratedPlan(bad,profile,async()=>{calls++;return bad;})).rejects.toThrow('Время шагов');expect(calls).toBe(1);
  });
  for(const minutes of [20,30,60,90])it(`fits ${minutes}-minute sessions`,()=>{const p={...profile,sessionMinutes:minutes};const plan=templatePlan(p);expect(()=>validatePlan(plan.tasks,p)).not.toThrow();expect(plan.tasks.every(t=>t.minutes<=minutes)).toBe(true);});
  it('rejects bad arithmetic',()=>{const plan=templatePlan(profile);plan.tasks[0]!.steps[0]!.minutes++;expect(()=>validatePlan(plan.tasks,profile)).toThrow();});
  it('rejects missing platforms and incompatible formats',()=>{const plan=templatePlan(profile);plan.tasks[0]!.platform='youtube';expect(()=>validatePlan(plan.tasks,profile)).toThrow();});
  it('zero available time gives no fake income or tasks',()=>expect(templatePlan({...profile,weeklyMinutes:0}).tasks).toEqual([]));
  it('novice with no audience gets preparation',()=>expect(templatePlan({...profile,channels:[]}).tasks[0]!.platform).toBe('preparation'));
});
describe('D03-D04: consent and quiet hours',()=>{
  it('requires explicit consent and active mode',()=>expect(shouldRemind(profile,new Date('2026-10-12T10:00:00Z'))).toBe(false));
  it('does not remind at night',()=>expect(shouldRemind({...profile,mode:'gentle',proactiveConsent:true},new Date('2026-10-12T20:00:00Z'))).toBe(false));
  it('respects daytime and pause',()=>{expect(shouldRemind({...profile,mode:'gentle',proactiveConsent:true},new Date('2026-10-12T10:00:00Z'))).toBe(true);expect(shouldRemind({...profile,mode:'paused',proactiveConsent:true},new Date('2026-10-12T10:00:00Z'))).toBe(false);});
  it('uses local quiet hours on both sides of the daylight saving transition',()=>{
    const p={...profile,timezone:'Europe/Berlin',mode:'gentle' as const,proactiveConsent:true,quietStart:21,quietEnd:9};
    for(const at of ['2026-10-25T00:30:00Z','2026-10-25T01:30:00Z'])expect(shouldRemind(p,new Date(at))).toBe(false);
    expect(shouldRemind(p,new Date('2026-10-25T08:30:00Z'))).toBe(true);
  });
});
describe('A03: original forecast adapter',()=>{
  it('matches baseline and stores three scenarios',async()=>{const r=await calculateCoachForecast({});expect(r.scenarios).toHaveLength(3);expect(r.scenarios[1].result.months[2].reward).toBeCloseTo(3965.015028199679,8);expect(r.commission).toBe(.2);});
});
describe('input validation',()=>{
  it('rejects unsafe protocols and credentials',()=>{for(const url of ['http://example.com','file:///secret','https://a:b@example.com'])expect(()=>safePublicationUrl(url)).toThrow();});
  it('rejects invalid timezone and extra secret fields',()=>{expect(profileSchema.safeParse({...profile,timezone:'invalid'}).success).toBe(false);expect(profileSchema.safeParse({...profile,password:'no'}).success).toBe(false);});
});
describe('B01, B06 and C11: welcoming without coercion or provider calls',()=>{
  it('introduces AI and asks for voluntary onboarding',()=>{expect(welcomeMessage('Иван Партнёр')).toContain('ИИ-помощник');expect(welcomeMessage('Иван Партнёр')).toContain('Привет, Иван');});
  it('recalls the confirmed goal and next step without repeated disclaimers',()=>{const text=welcomeMessage('Иван',profile,'Показать пример');expect(text).toContain('30');expect(text).toContain('Показать пример');expect(text).not.toMatch(/Доход зависит|не гарантируется/);});
  it('respects pause and human takeover',()=>{expect(welcomeMessage('Иван',{...profile,mode:'paused'})).toContain('на паузе');expect(welcomeMessage('Иван',profile,'Задача',true)).toContain('менеджер');});
});
