import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../backend/server.js';

test('Bricksburg theme, selection validation and approval safeguards',async()=>{
 const server=createServer({generateStory:async()=>({title:'Moon Brick Mystery',story:'Archie and his friends explored Moon-Bricksburg together. '.repeat(12)})}).listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(path,method='GET',data)=>fetch(base+path,{method,headers:{'content-type':'application/json'},body:data?JSON.stringify(data):undefined});
 try{
  const theme=await(await request('/api/theme')).json();
  assert.equal(theme.id,'bricksburg');
  assert.equal(theme.mainHeroId,'archie');
  assert.ok(theme.characters.some(c=>c.id==='bob'));
  assert.equal((await request('/api/theme/core','PUT',{coreIds:['bolt']})).status,404);
  const bad={toneId:'demo-dragon',coreHeroes:['bolt','rupert','millie','spidey'],heroes:['queen-mummy'],villains:['bob'],idea:'Find missing moon bricks',minutes:7};
  assert.equal((await request('/api/story','POST',bad)).status,400);
  const valid={...bad,coreHeroes:['bolt','rupert'],heroes:['millie']};
  const generated=await request('/api/story','POST',valid);
  assert.equal(generated.status,200);
  const draft=await generated.json();
  assert.equal(draft.approved,false);
  assert.deepEqual(draft.coreHeroes,['bolt','rupert']);
  assert.deepEqual(draft.guestHeroes,['millie']);
  assert.deepEqual(draft.heroes,['archie','bolt','rupert','millie']);
  const edited=await request('/api/stories/'+draft.id,'PUT',{story:'Archie and his friends returned safely home. '.repeat(12)});
  assert.equal(edited.status,200);
  assert.equal((await edited.json()).approved,false);
  const approved=await request('/api/stories/'+draft.id+'/approve','POST');
  assert.equal(approved.status,200);
  assert.equal((await approved.json()).approved,true);
  assert.equal((await request('/api/upload','POST')).status,501);
  assert.equal((await request('/api/stories/00000000-0000-0000-0000-000000000000/approve','POST')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
