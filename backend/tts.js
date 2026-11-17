import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const dataDir=process.env.STORYBOT_DATA_DIR||fileURLToPath(new URL('../data/',import.meta.url));
export async function createNarration(storyId,text){
 if(process.platform!=='win32')throw Object.assign(new Error('Windows speech is available only on Windows. A cross-platform TTS engine will be added for Docker.'),{status:501});
 const folder=join(dataDir,'audio');await mkdir(folder,{recursive:true});
 const filename=storyId+'-'+randomUUID()+'.wav',path=join(folder,filename);
 const input=join(folder,randomUUID()+'.txt');await writeFile(input,text,'utf8');
 const script=[
  'Add-Type -AssemblyName System.Speech',
  '$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '$speaker.Rate = -2',
  '$speaker.SetOutputToWaveFile($args[1])',
  'try { $speaker.Speak([System.IO.File]::ReadAllText($args[0], [System.Text.Encoding]::UTF8)) } finally { $speaker.Dispose() }'
 ].join('; ');
 try{
  await new Promise((resolve,reject)=>{
   const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script,input,path],{windowsHide:true,stdio:['ignore','ignore','pipe']});
   let errors='';child.stderr.on('data',d=>{errors+=d.toString().slice(0,1000);});
   child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Windows speech failed: '+errors.slice(0,400))));
  });
  const wav=await readFile(path);if(wav.length<44)throw Error('Audio output was empty');
  return {filename,bytes:wav.length};
 }finally{await import('node:fs/promises').then(fs=>fs.unlink(input).catch(()=>{}));}
}
export async function readNarration(filename){
 if(!/^[a-f0-9-]+\.wav$/.test(filename))throw Object.assign(new Error('Invalid audio filename'),{status:400});
 return readFile(join(dataDir,'audio',filename));
}
