import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { theme } from './theme.js';

const port = Number(process.env.PORT || 3080);
const html = fileURLToPath(new URL('../frontend/index.html', import.meta.url));
const tonies = [{id:'demo-dragon',name:'Dragon Tonie'},{id:'demo-bear',name:'Bedtime Bear'},{id:'demo-hero',name:'Hero Tonie'}];
const drafts = new Map();
let coreIds = [...theme.defaultCoreIds];
const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let s='';for await(const chunk of req){s+=chunk;if(s.length>20000)throw Error('Request too large');}return JSON.parse(s);}
const ids=(values,role)=>Array.isArray(values)&&values.every(id=>typeof id==='string'&&theme.characters.some(c=>c.id===id&&c.role===role))&&new Set(values).size===values.length;
export function validateStory(input){
 if(!input||typeof input!=='object')return 'Invalid request';
 if(!ids(input.heroes,'hero')||!ids(input.villains,'villain'))return 'Invalid character selection';
 if(coreIds.length+input.heroes.filter(id=>!coreIds.includes(id)).length>4)return 'Maximum four heroes including core heroes';
 if(input.villains.length<1||input.villains.length>3)return 'Choose one to three villains';
 if(!Number.isInteger(input.minutes)||input.minutes<5||input.minutes>10)return 'Choose 5–10 minutes';
 if(typeof input.idea!=='string'||input.idea.trim().length<3||input.idea.length>1200)return 'Enter a story idea (3–1200 characters)';
 if(typeof input.toneId!=='string'||!tonies.some(t=>t.id===input.toneId))return 'Select a Creative-Tonie';
 return null;
}
function prompt(input){
 const heroIds=[...new Set([...coreIds,...input.heroes])];
 const roster=[...heroIds,...input.villains].map(id=>theme.characters.find(c=>c.id===id));
 return `Write one ORIGINAL children's bedtime story for the universe "${theme.name}".
Universe rules:
${theme.rules.map(x=>'- '+x).join('\n')}
Follow these stages IN ORDER: ${theme.stages.join(' → ')}.
Locations: ${theme.locations.join(', ')}.
Familiar sound cues, only where appropriate: ${theme.sounds.join(', ')}.
Selected characters (do not add unselected named heroes):
${roster.map(c=>c.name+' — '+c.role+': '+c.bio).join('\n')}
${input.autoVillain?'Invent one additional gentle, silly villain, while keeping total villains at most three.':''}
Adventure idea: ${JSON.stringify(input.idea)}
Target duration: ${input.minutes} minutes spoken at about 125 words per minute. Target about ${input.minutes*125} words.
Keep the narrative warm, coherent and age-appropriate. Do not portray physical combat. All selected heroes should matter; villains become cozy and sleepy. Include all five stages naturally without headings in the narrated text.
Return JSON ONLY with keys "title" and "story". No Markdown.`;
}
async function generate(input){
 const key=process.env.GEMINI_API_KEY;
 if(!key)throw Object.assign(new Error('Configure GEMINI_API_KEY on the server to generate real stories.'),{status:503});
 const model=process.env.GEMINI_MODEL||'gemini-2.5-flash';
 const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
 method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},
 body:JSON.stringify({contents:[{parts:[{text:prompt(input)}]}],generationConfig:{responseMimeType:'application/json',temperature:0.8}})
 });
 if(!response.ok)throw Object.assign(new Error('Gemini request failed ('+response.status+').'),{status:502});
 const data=await response.json();
 const raw=data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
 let result;try{result=JSON.parse(raw);}catch{throw Object.assign(new Error('Gemini returned an invalid story response.'),{status:502});}
 if(typeof result.title!=='string'||typeof result.story!=='string'||result.story.length<200)throw Object.assign(new Error('Gemini returned an incomplete story.'),{status:502});
 return {title:result.title.slice(0,120),story:result.story};
}
export function createServer(){
 return http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(await readFile(html));}
   if(req.method==='GET'&&url.pathname==='/api/status')return reply(res,200,{phase:'story-builder',geminiConfigured:!!process.env.GEMINI_API_KEY,toniesLive:false});
   if(req.method==='GET'&&url.pathname==='/api/tonies')return reply(res,200,{tonies,integrationPending:true});
   if(req.method==='GET'&&url.pathname==='/api/theme')return reply(res,200,{...theme,coreIds});
   if(req.method==='PUT'&&url.pathname==='/api/theme/core'){
    const b=await body(req);
    if(!ids(b.coreIds,'hero')||b.coreIds.length>4)return reply(res,400,{error:'Choose up to four valid core heroes'});
    coreIds=[...b.coreIds];return reply(res,200,{coreIds});
   }
   if(req.method==='POST'&&url.pathname==='/api/story'){
    const b=await body(req);const error=validateStory(b);if(error)return reply(res,400,{error});
    if(b.autoVillain&&b.villains.length>=3)return reply(res,400,{error:'Auto villain requires a free villain slot'});
    const story=await generate(b);
    const id=crypto.randomUUID();
    const draft={id,...story,approved:false,minutes:b.minutes,heroes:[...new Set([...coreIds,...b.heroes])],villains:b.villains,createdAt:new Date().toISOString()};
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
