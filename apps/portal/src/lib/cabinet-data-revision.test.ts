// @vitest-environment jsdom
import {beforeEach,expect,it} from 'vitest';
import {applyCabinetDataRevision} from './cabinet-data-revision.js';

beforeEach(()=>{localStorage.clear();sessionStorage.clear();});
it('removes saved activity after a reset and preserves authentication and appearance',()=>{
  const drafts=['syntolk-partner-forecast-v1:null:partner:program:scenario','syntolk-partner-selection:default:partner','syntolk-partner-base-link:default:partner:program','syntolk-calculator-fact-views-v1:[null,"partner"]','syntolk-partner-forecast-v1'];
  for(const key of drafts)localStorage.setItem(key,'old data');
  sessionStorage.setItem('syntolk-coach-invitation:default:partner','1');
  localStorage.setItem('op:localApiKey','test-login');sessionStorage.setItem('op:apiKey','test-login');localStorage.setItem('sidebar:collapsed','1');
  applyCabinetDataRevision('reset-1',null);
  for(const key of drafts)expect(localStorage.getItem(key)).toBeNull();
  expect(sessionStorage.getItem('syntolk-coach-invitation:default:partner')).toBeNull();
  expect(localStorage.getItem('op:localApiKey')).toBe('test-login');expect(sessionStorage.getItem('op:apiKey')).toBe('test-login');expect(localStorage.getItem('sidebar:collapsed')).toBe('1');
});
it('does not remove new drafts again on the next login',()=>{
  applyCabinetDataRevision('reset-1',null);localStorage.setItem('syntolk-partner-forecast-v1:null:partner:program:new','new draft');
  applyCabinetDataRevision('reset-1',null);expect(localStorage.getItem('syntolk-partner-forecast-v1:null:partner:program:new')).toBe('new draft');
});
it('scopes a reset to one tenant and leaves data intact without a reset marker',()=>{
  localStorage.setItem('syntolk-partner-forecast-v1:other:partner:program:scenario','other draft');
  localStorage.setItem('syntolk-partner-forecast-v1:mine:partner:program:scenario','mine draft');
  applyCabinetDataRevision(undefined,'mine');expect(localStorage.getItem('syntolk-partner-forecast-v1:mine:partner:program:scenario')).toBe('mine draft');
  applyCabinetDataRevision('reset-1','mine');expect(localStorage.getItem('syntolk-partner-forecast-v1:mine:partner:program:scenario')).toBeNull();expect(localStorage.getItem('syntolk-partner-forecast-v1:other:partner:program:scenario')).toBe('other draft');
});
