import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../backend/server.js';

test('Bricksburg theme, selection validation and approval safeguards',async()=>{
 const server=createServer().listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(path,method='GET',data)=>fetch(base+path,{method,headers:{'content-type':'application/json'},body:data?JSON.stringify(data):undefined});
 try{
  const theme=await(await request('/api/theme')).json();
  assert.equal(theme.id,'bricksburg');
  assert.deepEqual(theme.coreIds,['archie','bolt','rupert']);
  assert.ok(theme.characters.some(c=>c.id==='bob'));
  assert.equal((await request('/api/theme/core','PUT',{coreIds:['archie','bolt','rupert','millie','spidey']})).status,400);
  const bad={toneId:'demo-dragon',heroes:['millie','spidey'],villains:['bob'],idea:'Find missing moon bricks',minutes:7};
  assert.equal((await request('/api/story','POST',bad)).status,400);
  const valid={...bad,heroes:['millie']};
  assert.equal((await request('/api/story','POST',valid)).status,503);
  assert.equal((await request('/api/upload','POST')).status,501);
  assert.equal((await request('/api/stories/00000000-0000-0000-0000-000000000000/approve','POST')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
