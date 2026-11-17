import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { theme } from './theme.js';

const port = Number(process.env.PORT || 3080);
const html = fileURLToPath(new URL('../frontend/index.html', import.meta.url));
const tonies = [{id:'demo-dragon',name:'Dragon Tonie'},{id:'demo-bear',name:'Bedtime Bear'},{id:'demo-hero',name:'Hero Tonie'}];
const drafts = new Map();
const mainHeroId = 'archie';
let sessionGeminiKey = null;
const activeGeminiKey=()=>sessionGeminiKey||process.env.GEMINI_API_KEY||'';
const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let s='';for await(const chunk of req){s+=chunk;if(s.length>20000)throw Error('Request too large');}return JSON.parse(s);}
const ids=(values,role)=>Array.isArray(values)&&values.every(id=>typeof id==='string'&&theme.characters.some(c=>c.id===id&&c.role===role))&&new Set(values).size===values.length;
export function validateStory(input){
 if(!input||typeof input!=='object')return 'Invalid request';
 if(!ids(input.heroes,'hero')||!ids(input.villains,'villain'))return 'Invalid character selection';
 if(!ids(input.coreHeroes,'hero')||input.coreHeroes.includes(mainHeroId)||input.heroes.includes(mainHeroId))return 'Invalid core hero selection';
 if(input.coreHeroes.length>3)return 'Choose up to three core heroes';
 if(input.heroes.length<1||input.heroes.length>4)return 'Choose one to four guest heroes';
 if(input.heroes.some(id=>input.coreHeroes.includes(id)))return 'A character cannot be both a core and guest hero';
 if(input.villains.length<1||input.villains.length>3)return 'Choose one to three villains';
 if(!Number.isInteger(input.minutes)||input.minutes<5||input.minutes>10)return 'Choose 5–10 minutes';
 if(typeof input.idea!=='string'||input.idea.trim().length<3||input.idea.length>1200)return 'Enter a story idea (3–1200 characters)';
 if(typeof input.toneId!=='string'||!tonies.some(t=>t.id===input.toneId))return 'Select a Creative-Tonie';
 return null;
}
function prompt(input){
 const heroIds=[mainHeroId,...input.coreHeroes,...input.heroes];
 const roster=[...heroIds,...input.villains].map(id=>theme.characters.find(c=>c.id===id));
 return `Write one ORIGINAL children's bedtime story for the universe "${theme.name}".
Universe rules:
${theme.rules.map(x=>'- '+x).join('\n')}
Follow these stages IN ORDER: ${theme.stages.join(' → ')}.
Locations: ${theme.locations.join(', ')}.
Familiar sound cues, only where appropriate: ${theme.sounds.join(', ')}.
Main character (always central): Superhero Archie.\nCore companions: ${input.coreHeroes.map(id=>theme.characters.find(c=>c.id===id).name).join(', ')||'None'}.\nGuest companions: ${input.heroes.map(id=>theme.characters.find(c=>c.id===id).name).join(', ')}.\nSelected characters (do not add unselected named heroes):
${roster.map(c=>c.name+' — '+c.role+': '+c.bio).join('\n')}
${input.autoVillain?'Invent one additional gentle, silly villain, while keeping total villains at most three.':''}
Adventure idea: ${JSON.stringify(input.idea)}
Target duration: ${input.minutes} minutes spoken at about 125 words per minute. Target about ${input.minutes*125} words.
Keep the narrative warm, coherent and age-appropriate. Do not portray physical combat. All selected heroes should matter; villains become cozy and sleepy. Include all five stages naturally without headings in the narrated text.
Return JSON ONLY with keys "title" and "story". No Markdown.`;
}
async function generate(input){
 const key=activeGeminiKey();
 if(!key)throw Object.assign(new Error('GEMINI_API_KEY is not configured on the server.'),{status:503});
 const model=process.env.GEMINI_MODEL||'gemini-3.8-flash';
 let response;
 const endpoint='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent';
 const payload=JSON.stringify({contents:[{parts:[{text:prompt(input)}]}],generationConfig:{responseMimeType:'application/json',temperature:0.8}});
 for(let attempt=1;attempt<=3;attempt++){
  try{
   response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},body:payload,signal:AbortSignal.timeout(90000)});
  }catch(e){
   console.error('Gemini network error:',e.message);
   throw Object.assign(new Error('Could not reach Gemini. Check internet connectivity and server logs.'),{status:502});
  }
  if(response.ok)break;
  let details={};try{details=await response.json();}catch{}
  const code=details.error?.status||'';
  const message=String(details.error?.message||'').slice(0,400);
  console.error('Gemini API failure:',{httpStatus:response.status,code,message,model,attempt});
  if((response.status===503||response.status===502||response.status===504)&&attempt<3){
   const delay=attempt===1?2000:5000;
   console.log('Gemini temporarily unavailable; retrying in '+delay/1000+' seconds...');
   await new Promise(resolve=>setTimeout(resolve,delay));
   continue;
  }
  const advice=response.status===400?'Check the Gemini model name and request settings.'
   :response.status===401||response.status===403?'Check your Gemini API key and API permissions.'
   :response.status===404?'The configured Gemini model was not found. Check GEMINI_MODEL.'
   :response.status===429?'Gemini quota or rate limit reached. Check Google AI Studio usage and billing.'
   :response.status>=500?'Gemini is experiencing high demand. Please try again in a few minutes.'
   :'Check the server console for the Gemini error details.';
  throw Object.assign(new Error('Gemini returned HTTP '+response.status+' ('+(code||'API error')+'). '+advice),{status:response.status===429?429:response.status===503?503:502});
 }
 let data;
 try{data=await response.json();}catch{throw Object.assign(new Error('Gemini returned unreadable JSON.'),{status:502});}
 const candidate=data.candidates?.[0];
 const raw=candidate?.content?.parts?.map(p=>p.text||'').join('')||'';
 if(!raw){
  console.error('Gemini produced no text:',{finishReason:candidate?.finishReason,promptFeedback:data.promptFeedback});
  throw Object.assign(new Error('Gemini returned no story text (finish reason: '+(candidate?.finishReason||'unknown')+').'),{status:502});
 }
 let result;try{result=JSON.parse(raw);}catch{
  console.error('Gemini returned non-JSON story text:',raw.slice(0,200));
  throw Object.assign(new Error('Gemini returned text that was not valid story JSON. Try generating again.'),{status:502});
 }
 if(typeof result.title!=='string'||typeof result.story!=='string'||result.story.length<200)
  throw Object.assign(new Error('Gemini returned an incomplete story. Try generating again.'),{status:502});
 return {title:result.title.slice(0,120),story:result.story};
}
export function createServer({generateStory=generate}={}){
 return http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(await readFile(html));}
   if(req.method==='GET'&&url.pathname==='/api/status')return reply(res,200,{phase:'story-builder',geminiConfigured:!!activeGeminiKey(),toniesLive:false});
   if(req.method==='GET'&&url.pathname==='/api/settings/gemini')return reply(res,200,{configured:!!activeGeminiKey(),source:sessionGeminiKey?'web session':process.env.GEMINI_API_KEY?'environment':'none',model:process.env.GEMINI_MODEL||'gemini-3.8-flash'});
   if(req.method==='POST'&&url.pathname==='/api/settings/gemini/test'){
    const b=await body(req);
    const key=typeof b.key==='string'&&b.key.trim()?b.key.trim():activeGeminiKey();
    if(!key||key.length>512)return reply(res,400,{error:'Enter a valid Gemini API key to test.'});
    let response;
    try{response=await fetch('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(15000)});}
    catch(e){return reply(res,502,{error:e.name==='TimeoutError'?'Gemini verification timed out after 15 seconds.':'Unable to contact Gemini: '+e.message});}
    let data={};try{data=await response.json();}catch{}
    if(!response.ok)return reply(res,400,{verified:false,error:'Gemini rejected the key (HTTP '+response.status+'): '+String(data.error?.message||'Unknown API error').slice(0,250)});
    const models=(data.models||[]).filter(m=>m.supportedGenerationMethods?.includes('generateContent')).map(m=>m.name);
    return reply(res,200,{verified:true,message:'API key accepted by Gemini.',models});
   }
   if(req.method==='POST'&&url.pathname==='/api/settings/gemini'){
    const b=await body(req);
    if(typeof b.key!=='string'||!b.key.trim()||b.key.length>512)return reply(res,400,{error:'Enter a Gemini API key.'});
    const key=b.key.trim();
    let response;
    try{response=await fetch('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(15000)});}
    catch(e){return reply(res,502,{error:'Could not verify the API key: '+e.message});}
    if(!response.ok)return reply(res,400,{error:'Key not saved. Gemini rejected it (HTTP '+response.status+').'});
    sessionGeminiKey=key;
    return reply(res,200,{configured:true,message:'Verified and saved for this server session. Restarting StoryBot clears this key.'});
   }
   if(req.method==='GET'&&url.pathname==='/api/tonies')return reply(res,200,{tonies,integrationPending:true});
   if(req.method==='GET'&&url.pathname==='/api/theme')return reply(res,200,{...theme,mainHeroId});
   if(req.method==='POST'&&url.pathname==='/api/story'){
    const b=await body(req);const error=validateStory(b);if(error)return reply(res,400,{error});
    if(b.autoVillain&&b.villains.length>=3)return reply(res,400,{error:'Auto villain requires a free villain slot'});
    const story=await generateStory(b);
    const id=crypto.randomUUID();
    const draft={id,...story,approved:false,minutes:b.minutes,heroes:[mainHeroId,...b.coreHeroes,...b.heroes],coreHeroes:b.coreHeroes,guestHeroes:b.heroes,villains:b.villains,createdAt:new Date().toISOString()};
    drafts.set(id,draft);return reply(res,200,draft);
   }
   const match=url.pathname.match(/^\/api\/stories\/([a-f0-9-]+)$/);
   if(match&&req.method==='GET')return drafts.has(match[1])?reply(res,200,drafts.get(match[1])):reply(res,404,{error:'Draft not found'});
   if(match&&req.method==='PUT'){
    const draft=drafts.get(match[1]);if(!draft)return reply(res,404,{error:'Draft not found'});
    const b=await body(req);
    if(typeof b.story!=='string'||b.story.trim().length<200||b.story.length>25000)return reply(res,400,{error:'Story must be 200–25000 characters'});
    draft.story=b.story;draft.approved=false;return reply(res,200,draft);
   }
   if(req.method==='POST'&&url.pathname.match(/^\/api\/stories\/[a-f0-9-]+\/approve$/)){
    const id=url.pathname.split('/')[3],draft=drafts.get(id);
    if(!draft)return reply(res,404,{error:'Draft not found'});
    draft.approved=true;return reply(res,200,draft);
   }
   if(req.method==='POST'&&url.pathname==='/api/upload')return reply(res,501,{error:'Tonies upload is not implemented'});
   return reply(res,404,{error:'Not found'});
  }catch(e){return reply(res,e.status||400,{error:e.message});}
 });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fileURLToPath(new URL('file://'+process.argv[1]))){
 createServer().listen(port,'127.0.0.1',()=>console.log('StoryBot: http://localhost:'+port));
}
