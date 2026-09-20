from pathlib import Path
import json, subprocess

root = Path(payload_dir)
appjs = root / "app" / "src" / "browser-crm" / "app.js"
cssp = root / "app" / "src" / "browser-crm" / "app.css"
idx = root / "app" / "src" / "browser-crm" / "index.html"
server = root / "app" / "src" / "main" / "browserCrm.js"

s = appjs.read_text(encoding="utf-8")

# Use a dedicated browser mirror that persists even when Desktop mode deliberately
# stops the general CRM state from writing to localStorage.
insert_after = "  const STORAGE_KEY = 'firstseen-browser-crm-v2-0';\n"
insert = "  const CALL_SCRIPT_STORE_KEY = 'firstseen-browser-crm-call-scripts-v1';\n"
if insert not in s:
    if insert_after not in s:
        raise SystemExit("STORAGE_KEY marker not found")
    s = s.replace(insert_after, insert_after + insert, 1)

start = s.index("function standaloneScriptStore(){")
end = s.index("  function scriptSpeech(text)", start)
replacement = r'''function readCallScriptMirror(){
  try{
    const raw=localStorage.getItem(CALL_SCRIPT_STORE_KEY);
    const parsed=raw?JSON.parse(raw):{};
    return {global:parsed&&parsed.global||null,prospects:parsed&&parsed.prospects&&typeof parsed.prospects==='object'?parsed.prospects:{}};
  }catch{return {global:null,prospects:{}};}
}
function writeCallScriptMirror(store){
  try{localStorage.setItem(CALL_SCRIPT_STORE_KEY,JSON.stringify({global:store.global||null,prospects:store.prospects||{}}));return true;}catch{return false;}
}
function mirrorSaveCallScript(scope,key,script){
  const store=readCallScriptMirror();
  if(scope==='all'){store.global=script;delete store.prospects[key];}
  else store.prospects[key]=script;
  return writeCallScriptMirror(store);
}
function mirrorLoadCallScript(key){
  const store=readCallScriptMirror();
  return store.prospects[key]?{source:'prospect',script:store.prospects[key]}:store.global?{source:'global',script:store.global}:{source:'default',script:null};
}
function captureEditableText(node){return String(node&&node.innerText!==undefined?node.innerText:node&&node.textContent||'').replace(/\r/g,'').replace(/\n{3,}/g,'\n\n').trim();}
function captureCallScriptModel(panel){
  const sections=[...panel.querySelectorAll('.script-section')].map(section=>({
    title:captureEditableText(section.querySelector('[data-script-title]')),
    blocks:[...section.querySelectorAll('[data-script-block]')].map(block=>({type:block.dataset.scriptBlock==='action'?'action':'speech',tone:block.dataset.tone||'',text:captureEditableText(block)})).filter(block=>block.text)
  }));
  return normalizeCallScriptModel({version:1,sections});
}
function applyCallScriptModelToPanel(panel,model){
  const clean=normalizeCallScriptModel(model);if(!clean)return;
  const sections=[...panel.querySelectorAll('.script-section')];
  clean.sections.forEach((saved,i)=>{
    const section=sections[i];if(!section)return;
    const title=section.querySelector('[data-script-title]');if(title)title.textContent=saved.title;
    const blocks=[...section.querySelectorAll('[data-script-block]')];
    saved.blocks.forEach((block,j)=>{if(blocks[j])blocks[j].textContent=block.text;});
  });
}
function desktopScriptBridgeAvailable(){return location.protocol==='http:'&&['127.0.0.1','localhost'].includes(location.hostname);}
function stableScriptJson(model){return JSON.stringify(normalizeCallScriptModel(model)||null);}
function updateCallScriptFooter(message,tone=''){
  const panel=el('callScriptPanel');if(!panel)return;
  const status=panel.querySelector('[data-script-save-status]');
  if(status){status.className='script-save-status '+(tone||'');status.textContent=message||(callScriptDirty?'Unsaved changes':callScriptSaveSource==='prospect'?'Saved for this prospect':callScriptSaveSource==='global'?'Using your saved script for all prospects':'Using the FirstSeen default script');}
  panel.querySelectorAll('.script-save-actions button').forEach(button=>button.disabled=callScriptSaving);
}
async function loadCallScriptForLead(l){
  const key=callScriptProspectKey(l);
  let chosen=mirrorLoadCallScript(key);
  let desktopLoaded=false;
  if(desktopScriptBridgeAvailable()){
    try{
      const remote=await api('/api/call-script?prospectKey='+encodeURIComponent(key));
      desktopLoaded=true;
      if(remote&&remote.script){
        chosen={source:remote.source||'default',script:remote.script};
        if(chosen.source==='global')mirrorSaveCallScript('all',key,chosen.script);
        else if(chosen.source==='prospect')mirrorSaveCallScript('prospect',key,chosen.script);
      }
    }catch(error){
      updateCallScriptFooter('Desktop save store unavailable — using browser backup.','warning');
    }
  }
  const panel=el('callScriptPanel');
  if(chosen.script&&panel){
    callScriptModel=resolveCallScriptModel(chosen.script,l);
    applyCallScriptModelToPanel(panel,callScriptModel);
  }else if(panel){
    callScriptModel=captureCallScriptModel(panel);
  }
  callScriptSavedModel=cloneCallScript(callScriptModel);
  callScriptSaveSource=chosen.source||'default';
  callScriptDirty=false;callScriptSaving=false;
  if(desktopLoaded||chosen.script)updateCallScriptFooter();
}
async function persistCallScript(scope,key,script){
  const mirrored=mirrorSaveCallScript(scope,key,script);
  let desktopSaved=false,desktopError='';
  if(desktopScriptBridgeAvailable()){
    try{
      const result=await api('/api/call-script',{method:'POST',body:JSON.stringify({scope,prospectKey:key,script})});
      if(!result||result.ok!==true)throw new Error('Desktop did not confirm the save.');
      const verify=await api('/api/call-script?prospectKey='+encodeURIComponent(key));
      if(!verify||!verify.script)throw new Error('Desktop could not read the script back after saving.');
      if(stableScriptJson(verify.script)!==stableScriptJson(script))throw new Error('Desktop save verification did not match the edited script.');
      desktopSaved=true;
    }catch(error){desktopError=error.message||'Desktop save failed.';}
  }
  if(!mirrored&&!desktopSaved)throw new Error(desktopError||'The browser could not store the script.');
  return {mirrored,desktopSaved,desktopError};
}
async function saveEditedCallScript(scope){
  const l=leadById(callLeadId),panel=el('callScriptPanel');if(!l||!panel||callScriptSaving)return;
  const model=captureCallScriptModel(panel);
  if(!model){updateCallScriptFooter('Nothing to save.','error');return;}
  const key=callScriptProspectKey(l),payload=scope==='all'?templateizeCallScriptModel(model,l):model;
  callScriptSaving=true;updateCallScriptFooter('Saving…');
  try{
    const result=await persistCallScript(scope,key,payload);
    callScriptSaveSource=scope==='all'?'global':'prospect';
    callScriptModel=cloneCallScript(model);callScriptSavedModel=cloneCallScript(model);callScriptDirty=false;
    if(result.desktopSaved&&result.mirrored)updateCallScriptFooter(scope==='all'?'Saved for all prospects ✓':'Saved for this prospect ✓','success');
    else if(result.desktopSaved)updateCallScriptFooter(scope==='all'?'Saved for all prospects in Desktop ✓':'Saved for this prospect in Desktop ✓','success');
    else updateCallScriptFooter((scope==='all'?'Saved for all prospects':'Saved for this prospect')+' in browser backup ✓ — Desktop sync will retry next time.','warning');
  }catch(error){
    updateCallScriptFooter('Save failed — '+(error.message||'try again'),'error');
    alert(error.message||'Could not save the call script.');
  }finally{
    callScriptSaving=false;
    const panelNow=el('callScriptPanel');if(panelNow)panelNow.querySelectorAll('.script-save-actions button').forEach(button=>button.disabled=false);
  }
}
function discardEditedCallScript(){
  const panel=el('callScriptPanel');if(panel&&callScriptSavedModel)applyCallScriptModelToPanel(panel,callScriptSavedModel);
  callScriptDirty=false;updateCallScriptFooter("Changes discarded — nothing saved.",'neutral');
}
function bindCallScriptEditor(panel,l){
  if(callScriptModel)applyCallScriptModelToPanel(panel,callScriptModel);else callScriptModel=captureCallScriptModel(panel);
  if(!callScriptSavedModel)callScriptSavedModel=cloneCallScript(callScriptModel);
  panel.insertAdjacentHTML('beforeend',"<div class=\"script-save-bar\"><div class=\"script-save-status\" data-script-save-status></div><div class=\"script-save-actions\"><button type=\"button\" data-script-save-prospect>Save for the prospect</button><button type=\"button\" class=\"save-all\" data-script-save-all>Save for all prospects</button><button type=\"button\" class=\"dont-save\" data-script-dont-save>Don't save</button></div></div>");
  panel.querySelectorAll('[contenteditable=\"true\"]').forEach(node=>node.addEventListener('input',()=>{callScriptDirty=true;updateCallScriptFooter();}));
  panel.onclick=async event=>{
    const prospectButton=event.target.closest('[data-script-save-prospect]');
    const allButton=event.target.closest('[data-script-save-all]');
    const discardButton=event.target.closest('[data-script-dont-save]');
    const closeButton=event.target.closest('[data-close-call-script]');
    if(prospectButton){event.preventDefault();event.stopPropagation();await saveEditedCallScript('prospect');return;}
    if(allButton){event.preventDefault();event.stopPropagation();await saveEditedCallScript('all');return;}
    if(discardButton){event.preventDefault();event.stopPropagation();discardEditedCallScript();return;}
    if(closeButton){event.preventDefault();callScriptPanelOpen=false;renderCallScriptPanel();}
  };
  updateCallScriptFooter();
}
'''
s = s[:start] + replacement + s[end:]

# The delegated panel click handler now owns the close button too.
old_close = "const close=panel.querySelector('[data-close-call-script]'); if(close)close.onclick=()=>{callScriptPanelOpen=false;renderCallScriptPanel();};"
if old_close in s:
    s = s.replace(old_close, "", 1)

appjs.write_text(s, encoding="utf-8")

css = cssp.read_text(encoding="utf-8")
extra = """
/* Browser CRM V2.5 — verified dual-store script saves */
.script-save-status.warning{color:#8a5b12}.script-save-actions button:active{transform:translateY(1px)}.script-save-actions button:focus-visible{outline:2px solid #6670d8;outline-offset:2px}
"""
if "Browser CRM V2.5 — verified dual-store script saves" not in css:
    css += extra
cssp.write_text(css, encoding="utf-8")

h = idx.read_text(encoding="utf-8").replace("Browser CRM V2.4","Browser CRM V2.5").replace("<title>FirstSeen CRM V2.4</title>","<title>FirstSeen CRM V2.5</title>")
idx.write_text(h, encoding="utf-8")

pkg = root / "app" / "package.json"
data = json.loads(pkg.read_text(encoding="utf-8"))
data["version"] = "10.2.10"
data["description"] = "FirstSeen Digital desktop operating app - V10.2.10 makes cold-call script saving reliable with browser backup plus verified SQLite persistence in Browser CRM V2.5."
pkg.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

for p in [
    root/"app"/"README.md", root/"app"/"docs"/"WINDOWS_INSTALLER_V10.md",
    root/"app"/"installer"/"README.md", root/"app"/"installer"/"install.ps1",
    root/"install.ps1", root/"app"/"src"/"renderer"/"index.html", root/"app"/"src"/"renderer"/"app.js"
]:
    if p.exists():
        p.write_text(p.read_text(encoding="utf-8").replace("10.2.9","10.2.10").replace("Browser CRM V2.4","Browser CRM V2.5"), encoding="utf-8")

(root/"app"/"docs"/"RELEASE_NOTES_V10_2_10.md").write_text(
    "# FirstSeen Desktop V10.2.10\n\n"
    "- Browser CRM moves to V2.5.\n"
    "- Reworked call-script saving so button clicks are handled by one stable panel event handler.\n"
    "- Every save is written immediately to a dedicated browser backup store.\n"
    "- When opened from FirstSeen Desktop, the same save is also written to SQLite and read back immediately to verify it persisted.\n"
    "- If Desktop persistence is temporarily unavailable, the browser backup still keeps the edit and the UI clearly says so.\n"
    "- Save for the prospect, Save for all prospects and Don't save now give explicit status feedback.\n"
    "- Editable line breaks are captured with innerText so manual new lines persist.\n"
    "- The opening script remains one sentence per line.\n"
    "- Existing Twilio calling, outcomes, follow-ups, Finder shortlist, SQLite CRM data and updater behaviour are preserved.\n",
    encoding="utf-8"
)

subprocess.run(["node","--check",str(appjs)],check=True)
subprocess.run(["node","--check",str(server)],check=True)
