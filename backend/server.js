import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { theme } from './theme.js';
import { createNarration, readNarration } from './tts.js';

const port = Number(process.env.PORT || 3080);
const html = fileURLToPath(new URL('../frontend/index.html', import.meta.url));
const childHtml = fileURLToPath(new URL('../frontend/child.html', import.meta.url));
const tonies = [{id:'demo-dragon',name:'Dragon Tonie'},{id:'demo-bear',name:'Bedtime Bear'},{id:'demo-hero',name:'Hero Tonie'}];
const drafts = new Map();
const mainHeroId = 'archie';
const characterFile=join(process.env.STORYBOT_DATA_DIR||fileURLToPath(new URL('../data',import.meta.url)),'characters.json');
let charactersLoaded=false;
async function loadCharacters(){if(charactersLoaded)return;try{const saved=JSON.parse(await readFile(characterFile,'utf8'));if(Array.isArray(saved))theme.characters=saved;}catch(e){if(e.code!=='ENOENT')console.error('Character file load error:',e.message);}charactersLoaded=true;}
async function saveCharacters(){await mkdir(dirname(characterFile),{recursive:true});await writeFile(characterFile,JSON.stringify(theme.characters,null,2),'utf8');}
function validCharacter(c){return c&&typeof c.name==='string'&&c.name.trim().length>=2&&c.name.length<=80&&typeof c.bio==='string'&&c.bio.trim().length>=5&&c.bio.length<=800&&['hero','villain'].includes(c.role)&&(!c.imageUrl||typeof c.imageUrl==='string'&&c.imageUrl.length<=500&&(/^https:\/\//.test(c.imageUrl)||/^\/assets\//.test(c.imageUrl)));}
let sessionGeminiKey = null;
let sessionOpenAIKey = null;
let selectedOllamaModel = process.env.OLLAMA_MODEL || '';
const ollamaBase=(process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434').replace(/\/$/,'');
const activeOpenAIKey=()=>sessionOpenAIKey||process.env.OPENAI_API_KEY||'';
const openAIModel=()=>process.env.OPENAI_MODEL||'gpt-4.1-mini';
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
async function generateGemini(input){
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
async function generateOpenAI(input){
 const key=activeOpenAIKey();
 if(!key)throw Object.assign(new Error('Configure an OpenAI API key in Parent Settings first.'),{status:503});
 const model=openAIModel();
 let response;
 try{
  response=await fetch('https://api.openai.com/v1/responses',{
   method:'POST',
   headers:{'content-type':'application/json','authorization':'Bearer '+key},
   body:JSON.stringify({model,input:prompt(input),text:{format:{type:'json_object'}}}),
   signal:AbortSignal.timeout(90000)
  });
 }catch(e){
  console.error('OpenAI connection error:',e.message);
  throw Object.assign(new Error('OpenAI request timed out or could not connect.'),{status:502});
 }
 const data=await response.json().catch(()=>({}));
 if(!response.ok){
  const msg=String(data.error?.message||'Unknown API error').slice(0,300);
  console.error('OpenAI API failure:',{status:response.status,model,message:msg});
  throw Object.assign(new Error('OpenAI HTTP '+response.status+': '+msg),{status:response.status===429?429:502});
 }
 const raw=(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text||'').join('');
 let result;
 try{result=JSON.parse(raw);}catch{throw Object.assign(new Error('OpenAI did not return valid story JSON.'),{status:502});}
 if(typeof result.title!=='string'||typeof result.story!=='string'||result.story.length<200)throw Object.assign(new Error('OpenAI returned an incomplete story.'),{status:502});
 return {title:result.title.slice(0,120),story:result.story,model,provider:'openai'};
}
const minimumStoryCharacters=8000;
async function ollamaText(model,instruction,maxTokens=3000,onProgress=()=>{},stage='Writing'){
 let response;
 try{response=await fetch(ollamaBase+'/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,prompt:instruction,stream:true,keep_alive:'15m',options:{temperature:0.7,num_predict:maxTokens}}),signal:AbortSignal.timeout(360000)});}
 catch(e){throw Object.assign(new Error('Ollama connection failed or timed out: '+e.message),{status:502});}
 if(!response.ok){const data=await response.json().catch(()=>({}));throw Object.assign(new Error('Ollama HTTP '+response.status+': '+String(data.error||'Unknown error').slice(0,250)),{status:502});}
 let output='',buffer='',lastUpdate=0;
 const decoder=new TextDecoder();
 for await(const chunk of response.body){
  buffer+=decoder.decode(chunk,{stream:true});
  let index;
  while((index=buffer.indexOf('\n'))!==-1){
   const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);
   if(!line)continue;
   const data=JSON.parse(line);
   if(data.error)throw Object.assign(new Error('Ollama: '+data.error),{status:502});
   output+=data.response||'';
   const now=Date.now();
   if(now-lastUpdate>350){onProgress({stage,generatedCharacters:output.length});lastUpdate=now;}
  }
 }
 onProgress({stage,generatedCharacters:output.length});
 return output.trim();
}
function cleanNarration(value){
 if(typeof value!=='string')return '';
 let text=value.trim();
 for(let i=0;i<3;i++){
  let parsed;
  try{parsed=JSON.parse(text);}catch{break;}
  if(typeof parsed==='string'){text=parsed.trim();continue;}
  if(parsed&&typeof parsed==='object'&&typeof parsed.story==='string'){text=parsed.story.trim();continue;}
  break;
 }
 // Reject malformed JSON rather than exposing structural metadata in narration.
 if(/^\s*\{\s*"(?:title|story)"\s*:/i.test(text)||/^\s*"(?:title|story)"\s*:/i.test(text))return '';
 text=text.replace(/\\n/g,'\n').replace(/\\r/g,'').replace(/\\t/g,' ');
 return text.trim();
}
async function generateOllama(input,onProgress=()=>{}){
 const model=selectedOllamaModel;
 if(!model)throw Object.assign(new Error('Choose an installed Ollama model in Parent Settings first.'),{status:503});
 const instructions=prompt(input);
 onProgress({stage:'Preparing story',characters:0,target:minimumStoryCharacters,model});
 const initial=await ollamaText(model,instructions+'\nReturn valid JSON with title and story. Write as much detailed narrative as possible; story must be at least 8000 characters.',3500,p=>onProgress({...p,characters:0,target:minimumStoryCharacters}),'Writing first draft');
 let result;
 try{result=JSON.parse(initial);}catch{throw Object.assign(new Error('Ollama returned invalid story JSON. Try another model.'),{status:502});}
 if(typeof result.title!=='string'||typeof result.story!=='string'||result.story.length<200)throw Object.assign(new Error('Ollama returned an incomplete story.'),{status:502});
 let story=cleanNarration(result.story);
 if(story.length<200)throw Object.assign(new Error('Ollama returned JSON metadata instead of a usable story.'),{status:502});
 onProgress({stage:'Checking first draft',characters:story.length,target:minimumStoryCharacters});
 for(let attempt=0;story.length<minimumStoryCharacters&&attempt<6;attempt++){
  const paragraphs=story.split(/\n\s*\n/);
  const ending=paragraphs.length>1?paragraphs.pop():'';
  const prefix=paragraphs.length?paragraphs.join('\n\n'):story;
  const recent=prefix.slice(-2000);
  const base=story.length;
  const extra=await ollamaText(model,
   'Write ONE NEW SCENE of at least 1400 characters to expand this gentle Bricksburg bedtime story. No headings, JSON, recap, or ending. Continue the plot naturally and keep the characters consistent.\n'+instructions+'\nRecent context:\n'+recent,1800,p=>onProgress({...p,stage:'Expanding story · scene '+(attempt+1),characters:base+p.generatedCharacters,target:minimumStoryCharacters}),'Expanding story · scene '+(attempt+1));
  const scene=cleanNarration(extra);
  if(scene.length<250)break;
  story=prefix+'\n\n'+scene+'\n\n'+ending;
  onProgress({stage:'Checking story length',characters:story.length,target:minimumStoryCharacters});
 }
 if(story.length<minimumStoryCharacters)throw Object.assign(new Error('Ollama generated '+story.length+' characters, below the 8000-character minimum. Try a larger model or generate again.'),{status:502});
 return {title:result.title.slice(0,120),story,model,provider:'ollama',characterCount:story.length};
}
async function generate(input){return generateOllama(input);}
export function createServer({generateStory=generate}={}){
 return http.createServer(async(req,res)=>{
  try{
   await loadCharacters();
   const url=new URL(req.url,'http://localhost');
   if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(await readFile(childHtml));}
   if(req.method==='GET'&&url.pathname==='/parent'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end(await readFile(html));}
   if(req.method==='GET'&&url.pathname==='/api/status')return reply(res,200,{phase:'story-builder',geminiConfigured:!!activeGeminiKey(),openaiConfigured:!!activeOpenAIKey(),provider:'ollama',ollamaModel:selectedOllamaModel,toniesLive:false});
   if(req.method==='GET'&&url.pathname==='/api/settings/ollama'){
    try{
     const response=await fetch(ollamaBase+'/api/tags',{signal:AbortSignal.timeout(5000)});
     if(!response.ok)throw Error('HTTP '+response.status);
     const data=await response.json();
     const models=(data.models||[]).map(m=>m.name);
     if(!selectedOllamaModel&&models.length)selectedOllamaModel=models[0];
     return reply(res,200,{connected:true,models,selectedModel:selectedOllamaModel});
    }catch(e){return reply(res,200,{connected:false,models:[],selectedModel:selectedOllamaModel,error:'Cannot connect to Ollama at localhost:11434: '+e.message});}
   }
   if(req.method==='POST'&&url.pathname==='/api/settings/ollama'){
    const b=await body(req);
    if(typeof b.model!=='string'||!b.model||b.model.length>200)return reply(res,400,{error:'Select a model.'});
    try{
     const response=await fetch(ollamaBase+'/api/tags',{signal:AbortSignal.timeout(5000)});
     if(!response.ok)throw Error('Ollama unavailable');
     const data=await response.json();
     if(!(data.models||[]).some(m=>m.name===b.model))return reply(res,400,{error:'Model is not installed in Ollama.'});
     selectedOllamaModel=b.model;
     return reply(res,200,{selectedModel:selectedOllamaModel,message:'Ollama model selected.'});
    }catch(e){return reply(res,502,{error:'Ollama unavailable: '+e.message});}
   }
   if(req.method==='GET'&&url.pathname==='/api/settings/openai')return reply(res,200,{configured:!!activeOpenAIKey(),model:openAIModel(),source:sessionOpenAIKey?'web session':process.env.OPENAI_API_KEY?'environment':'none'});
   if(req.method==='POST'&&(url.pathname==='/api/settings/openai/test'||url.pathname==='/api/settings/openai')){
    const b=await body(req);
    const key=typeof b.key==='string'&&b.key.trim()?b.key.trim():activeOpenAIKey();
    if(!key||key.length>512)return reply(res,400,{error:'Enter an OpenAI API key.'});
    let response;
    try{response=await fetch('https://api.openai.com/v1/models',{headers:{authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});}
    catch(e){return reply(res,502,{error:'Could not reach OpenAI: '+e.message});}
    const data=await response.json().catch(()=>({}));
    if(!response.ok)return reply(res,400,{verified:false,error:'OpenAI rejected the key (HTTP '+response.status+'): '+String(data.error?.message||'Unknown error').slice(0,250)});
    const models=(data.data||[]).map(m=>m.id).filter(id=>id.startsWith('gpt-')).sort();
    if(url.pathname==='/api/settings/openai')sessionOpenAIKey=key;
    return reply(res,200,{verified:true,configured:url.pathname==='/api/settings/openai',message:url.pathname==='/api/settings/openai'?'Key verified and activated until server restart.':'Key accepted by OpenAI. Model access and billing must still be checked with a generation request.',model:openAIModel(),models});
   }
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
   if(req.method==='POST'&&url.pathname==='/api/characters/suggest-villain'){
    const b=await body(req);
    const idea=typeof b.idea==='string'?b.idea.slice(0,500):'A gentle silly bedtime adventure in Bricksburg';
    if(!selectedOllamaModel)return reply(res,503,{error:'Select an Ollama model first.'});
    const raw=await ollamaText(selectedOllamaModel,'Invent ONE original, gentle, funny, nonviolent villain for a LEGO-inspired bedtime story in Bricksburg. Story idea: '+idea+'\nReturn only valid JSON with keys "name" and "bio". The bio should describe appearance, silly mischief and a peaceful resolution. Avoid scary or violent themes.',400);
    let suggested;try{suggested=JSON.parse(raw);}catch{return reply(res,502,{error:'Ollama did not return valid villain details. Try again.'});}
    const villain={name:suggested.name,role:'villain',bio:suggested.bio,imageUrl:''};
    if(!validCharacter(villain))return reply(res,502,{error:'Ollama returned incomplete villain details.'});
    return reply(res,200,{villain,pendingApproval:true});
   }
   if(req.method==='GET'&&url.pathname==='/api/characters')return reply(res,200,{characters:theme.characters});
   if(req.method==='POST'&&url.pathname==='/api/characters'){
    const b=await body(req);if(!validCharacter(b))return reply(res,400,{error:'Provide a name, role, description and optional HTTPS image URL.'});
    const c={id:'custom-'+crypto.randomUUID(),name:b.name.trim(),role:b.role,bio:b.bio.trim(),imageUrl:b.imageUrl||'',enabled:true};
    theme.characters.push(c);await saveCharacters();return reply(res,201,c);
   }
   const characterMatch=url.pathname.match(/^\/api\/characters\/([a-z0-9-]+)$/);
   if(characterMatch&&['PUT','DELETE'].includes(req.method)){
    const i=theme.characters.findIndex(c=>c.id===characterMatch[1]);
    if(i<0)return reply(res,404,{error:'Character not found'});
    if(theme.characters[i].id==='archie')return reply(res,403,{error:'Superhero Archie is required and cannot be edited or removed.'});
    if(req.method==='DELETE'){const [deleted]=theme.characters.splice(i,1);await saveCharacters();return reply(res,200,{deleted:deleted.id});}
    const b=await body(req);const updated={...theme.characters[i],...b,id:theme.characters[i].id};
    if(!validCharacter(updated)||typeof updated.enabled!=='boolean')return reply(res,400,{error:'Invalid character details.'});
    theme.characters[i]={id:updated.id,name:updated.name.trim(),role:updated.role,bio:updated.bio.trim(),imageUrl:updated.imageUrl||'',enabled:updated.enabled};
    await saveCharacters();return reply(res,200,theme.characters[i]);
   }
   if(req.method==='GET'&&url.pathname==='/api/stories')return reply(res,200,{stories:[...drafts.values()].map(d=>({id:d.id,title:d.title,approved:d.approved,createdAt:d.createdAt,characterCount:d.story.length}))});
   if(req.method==='GET'&&url.pathname==='/api/tonies')return reply(res,200,{tonies,integrationPending:true});
   if(req.method==='GET'&&url.pathname==='/api/theme')return reply(res,200,{...theme,characters:theme.characters.filter(c=>c.enabled!==false),mainHeroId});
   if(req.method==='POST'&&url.pathname==='/api/story/stream'){
    const b=await body(req);const error=validateStory(b);
    if(error)return reply(res,400,{error});
    if(b.autoVillain&&b.villains.length>=3)return reply(res,400,{error:'Auto villain requires a free villain slot'});
    res.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
    const send=(type,data)=>{if(!res.destroyed)res.write(JSON.stringify({type,...data})+'\n');};
    try{
     const story=await generateOllama(b,progress=>send('progress',progress));
     const id=crypto.randomUUID();
     const draft={id,...story,approved:false,minutes:b.minutes,heroes:[mainHeroId,...b.coreHeroes,...b.heroes],coreHeroes:b.coreHeroes,guestHeroes:b.heroes,villains:b.villains,createdAt:new Date().toISOString()};
     drafts.set(id,draft);send('complete',{draft});
    }catch(e){send('error',{error:e.message});}
    return res.end();
   }
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
    draft.story=b.story;draft.approved=false;draft.narration=null;return reply(res,200,draft);
   }
   if(req.method==='POST'&&url.pathname.match(/^\/api\/stories\/[a-f0-9-]+\/approve$/)){
    const id=url.pathname.split('/')[3],draft=drafts.get(id);
    if(!draft)return reply(res,404,{error:'Draft not found'});
    draft.approved=true;return reply(res,200,draft);
   }
   const narrateMatch=url.pathname.match(/^\/api\/stories\/([a-f0-9-]+)\/narrate$/);
   if(req.method==='POST'&&narrateMatch){
    const draft=drafts.get(narrateMatch[1]);
    if(!draft)return reply(res,404,{error:'Story not found'});
    if(!draft.approved)return reply(res,403,{error:'Approve the story before generating narration.'});
    if(draft.narration)return reply(res,200,{audioUrl:'/api/audio/'+draft.narration,alreadyGenerated:true});
    const result=await createNarration(draft.id,draft.story);
    draft.narration=result.filename;
    return reply(res,200,{audioUrl:'/api/audio/'+result.filename,bytes:result.bytes});
   }
   const audioMatch=url.pathname.match(/^\/api\/audio\/([a-f0-9-]+\.wav)$/);
   if(req.method==='GET'&&audioMatch){
    const file=audioMatch[1];
    if(![...drafts.values()].some(d=>d.narration===file))return reply(res,404,{error:'Audio not found'});
    const wav=await readNarration(file);
    res.writeHead(200,{'content-type':'audio/wav','content-length':wav.length,'cache-control':'no-store','content-disposition':'inline; filename="'+file+'"'});return res.end(wav);
   }
   if(req.method==='POST'&&url.pathname==='/api/upload')return reply(res,501,{error:'Tonies upload is not implemented'});
   return reply(res,404,{error:'Not found'});
  }catch(e){return reply(res,e.status||400,{error:e.message});}
 });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fileURLToPath(new URL('file://'+process.argv[1]))){
 createServer().listen(port,'127.0.0.1',()=>console.log('StoryBot: http://localhost:'+port));
}
